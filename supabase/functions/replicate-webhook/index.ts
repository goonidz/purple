import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Declare EdgeRuntime for background task support
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const adminClient = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const payload = await req.json();
    
    // ========================================================================
    // ATOMIC PIPELINE: Handle special message types
    // ========================================================================
    if (payload.type === 'launch_next_image_job') {
      console.log('[webhook] Received launch_next_image_job trigger');
      if (typeof EdgeRuntime !== 'undefined') {
        EdgeRuntime.waitUntil(launchNextPendingJob(adminClient, supabaseUrl, supabaseServiceKey));
      } else {
        await launchNextPendingJob(adminClient, supabaseUrl, supabaseServiceKey);
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    if (payload.type === 'launch_next_qa_job') {
      console.log('[webhook] Received launch_next_qa_job trigger');
      if (typeof EdgeRuntime !== 'undefined') {
        EdgeRuntime.waitUntil(launchNextPendingQAJob(adminClient));
      } else {
        await launchNextPendingQAJob(adminClient);
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    if (payload.type === 'launch_pending_upscales') {
      console.log('[webhook] Received launch_pending_upscales trigger');
      if (typeof EdgeRuntime !== 'undefined') {
        EdgeRuntime.waitUntil(launchNextPendingUpscaleJob(adminClient));
      } else {
        await launchNextPendingUpscaleJob(adminClient);
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    if (payload.type === 'chain_next_job') {
      console.log('[webhook] Received chain_next_job trigger:', payload.completedJobType);
      await chainNextJobFromWebhook(adminClient, payload.projectId, payload.userId, payload.completedJobType, {});
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    console.log("Webhook received:", {
      id: payload.id,
      status: payload.status,
      output: payload.output ? 'present' : 'absent'
    });

    const predictionId = payload.id;
    const status = payload.status;
    const output = payload.output;

    if (!predictionId) {
      console.error("No prediction ID in webhook payload");
      return new Response(JSON.stringify({ error: "Missing prediction ID" }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Find the pending prediction with retry (race condition: webhook may arrive before insert completes)
    let prediction: any = null;
    let predictionError: any = null;
    const MAX_LOOKUP_RETRIES = 3;
    const LOOKUP_RETRY_DELAY_MS = 500;
    
    for (let attempt = 1; attempt <= MAX_LOOKUP_RETRIES; attempt++) {
      const { data, error } = await adminClient
        .from('pending_predictions')
        .select('*')
        .eq('prediction_id', predictionId)
        .single();
      
      prediction = data;
      predictionError = error;
      
      if (prediction) {
        if (attempt > 1) {
          console.log(`[webhook] Found prediction ${predictionId} on attempt ${attempt}`);
        }
        break;
      }
      
      // Only retry for "not found" errors, not for other database errors
      if (attempt < MAX_LOOKUP_RETRIES && error?.code === 'PGRST116') {
        console.log(`[webhook] Prediction ${predictionId} not found (attempt ${attempt}/${MAX_LOOKUP_RETRIES}), waiting ${LOOKUP_RETRY_DELAY_MS}ms...`);
        await new Promise(resolve => setTimeout(resolve, LOOKUP_RETRY_DELAY_MS));
      }
    }

    if (predictionError || !prediction) {
      console.error(`Prediction ${predictionId} not found in pending_predictions after ${MAX_LOOKUP_RETRIES} attempts:`, predictionError);
      // Not an error - might be a duplicate webhook or old prediction
      return new Response(JSON.stringify({ ok: true, message: "Prediction not found" }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // CRITICAL: Ignore duplicate webhooks for already completed/failed predictions
    if (prediction.status === 'completed' || prediction.status === 'failed') {
      console.log(`Webhook DUPLICATE IGNORED: Prediction ${predictionId} already ${prediction.status}`);
      return new Response(JSON.stringify({ ok: true, message: "Already processed" }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found prediction ${predictionId} for job ${prediction.job_id}, type: ${prediction.prediction_type}, scene_index: ${prediction.scene_index}, project: ${prediction.project_id}`);

    // Handle based on status
    if (status === 'succeeded' && output) {
      // Create a background promise for the heavy processing
      const processTask = (async () => {
        try {
          // Handle script generation (text output)
          if (prediction.prediction_type === 'script') {
            await handleScriptCompletion(adminClient, prediction, output);
            return;
          }
          
          // Handle image generation
          const imageOutput = Array.isArray(output) ? output[0] : output;
          
          if (imageOutput) {
            // Download and upload to Supabase Storage
            const imageResponse = await fetch(imageOutput);
            if (!imageResponse.ok) {
              throw new Error(`Failed to fetch image: ${imageResponse.status}`);
            }
            
            const blob = await imageResponse.blob();
            const timestamp = Date.now();
            
            // Determine filename based on prediction type
            let filename: string;
            if (prediction.prediction_type === 'thumbnail') {
              filename = `${prediction.project_id}/thumb_v${(prediction.thumbnail_index || 0) + 1}_${timestamp}.jpg`;
            } else if (prediction.prediction_type === 'upscale') {
              filename = `${prediction.project_id}/scene_${(prediction.scene_index || 0) + 1}_upscaled_${timestamp}.jpg`;
            } else {
              filename = `${prediction.project_id}/scene_${(prediction.scene_index || 0) + 1}_${timestamp}.jpg`;
            }

            const { error: uploadError } = await adminClient.storage
              .from('generated-images')
              .upload(filename, blob, {
                contentType: 'image/jpeg',
                upsert: true
              });

            if (uploadError) {
              throw new Error(`Storage upload failed: ${uploadError.message}`);
            }

            const { data: { publicUrl } } = adminClient.storage
              .from('generated-images')
              .getPublicUrl(filename);

            console.log(`Image uploaded to storage: ${publicUrl}`);

            // Update pending_predictions with result
            await adminClient
              .from('pending_predictions')
              .update({
                status: 'completed',
                result_url: publicUrl,
                completed_at: new Date().toISOString()
              })
              .eq('id', prediction.id);

            // Update the relevant data based on prediction type
            if (prediction.prediction_type === 'scene_image') {
              await updateSceneImage(adminClient, prediction, publicUrl);
            } else if (prediction.prediction_type === 'thumbnail') {
              await updateThumbnail(adminClient, prediction, publicUrl);
            } else if (prediction.prediction_type === 'upscale') {
              await updateUpscaledImage(adminClient, prediction, publicUrl);
            }

            // Check if all predictions for this job are complete
            await checkJobCompletion(adminClient, prediction.job_id);
            
            // NEW: Update generation_queue if this prediction came from the queue
            await updateQueueItemStatus(adminClient, predictionId, 'completed', publicUrl);
            
            // NEW: Trigger next batch processing
            await triggerQueueProcessing(supabaseUrl, supabaseServiceKey);
          }
        } catch (error) {
          console.error(`Error in background processing:`, error);
          await adminClient
            .from('pending_predictions')
            .update({
              status: 'failed',
              error_message: error instanceof Error ? error.message : 'Unknown error',
              completed_at: new Date().toISOString()
            })
            .eq('id', prediction.id);
            
          await checkJobCompletion(adminClient, prediction.job_id);
          await updateQueueItemStatus(adminClient, predictionId, 'failed', null, error instanceof Error ? error.message : 'Unknown error');
          await triggerQueueProcessing(supabaseUrl, supabaseServiceKey);
        }
      })();

      // Use waitUntil to let the background task finish
      if (typeof EdgeRuntime !== 'undefined') {
        EdgeRuntime.waitUntil(processTask);
      }
      
      return new Response(JSON.stringify({ ok: true, message: "Background processing started" }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } else if (status === 'failed' || status === 'canceled') {
      // Capture detailed error from Replicate payload
      const errorDetail = payload.error || payload.logs || `Generation ${status}`;
      console.log(`Prediction ${predictionId} ${status}:`, errorDetail);
      
      await adminClient
        .from('pending_predictions')
        .update({
          status: 'failed',
          error_message: typeof errorDetail === 'string' ? errorDetail.substring(0, 500) : `Generation ${status}`,
          completed_at: new Date().toISOString()
        })
        .eq('id', prediction.id);

      // RETRY: For scene_image predictions, retry the job if under limit
      if (prediction.prediction_type === 'scene_image' && prediction.job_id) {
        const { data: failedJob } = await adminClient
          .from('generation_jobs')
          .select('*')
          .eq('id', prediction.job_id)
          .single();
        
        if (failedJob) {
          const errorMsg = typeof errorDetail === 'string' ? errorDetail.substring(0, 200) : `Generation ${status}`;
          await retryFailedImageJob(adminClient, failedJob, errorMsg);
        }
      }

      await checkJobCompletion(adminClient, prediction.job_id);
      
      // NEW: Update queue item as failed
      await updateQueueItemStatus(adminClient, predictionId, 'failed', null, typeof errorDetail === 'string' ? errorDetail.substring(0, 500) : `Generation ${status}`);
      
      // NEW: Trigger next batch even on failure
      await triggerQueueProcessing(supabaseUrl, supabaseServiceKey);
    }
    // For 'starting' or 'processing' statuses, do nothing - wait for completion

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ========================================================================
// ROBUST ARCHITECTURE: Update project_scenes table
// ========================================================================
async function upsertProjectScene(adminClient: any, projectId: string, sceneIndex: number, data: any) {
  console.log(`[upsertProjectScene] START - Project ${projectId}, Scene ${sceneIndex + 1}, Data keys: ${Object.keys(data).join(', ')}`);
  
  const upsertData = {
    project_id: projectId,
    scene_index: sceneIndex,
    ...data,
    updated_at: new Date().toISOString()
  };
  
  const { error, data: result } = await adminClient
    .from('project_scenes')
    .upsert(upsertData, {
      onConflict: 'project_id,scene_index'
    })
    .select();

  if (error) {
    console.error(`[upsertProjectScene] ERROR for scene ${sceneIndex + 1}:`, error.message);
    throw error;
  }
  
  // Log relevant field based on what was updated
  const logField = data.image_url ? `image_url: ${data.image_url.substring(0, 60)}...` 
    : data.upscaled_url ? `upscaled_url: ${data.upscaled_url.substring(0, 60)}...`
    : `qa_status: ${data.qa_status || 'updated'}`;
  console.log(`[upsertProjectScene] SUCCESS - Scene ${sceneIndex + 1} updated, ${logField}`);
}

async function updateSceneImage(adminClient: any, prediction: any, imageUrl: string) {
  const sceneIndex = prediction.scene_index;
  
  if (sceneIndex === undefined || sceneIndex === null) {
    console.error(`Invalid scene index for prediction ${prediction.id}`);
    return;
  }

  // Get image dimensions
  const metadata = prediction.metadata || {};
  const imageWidth = metadata.imageWidth || metadata.width || 0;
  const imageHeight = metadata.imageHeight || metadata.height || 0;

  // Check if this is a regenerated image - if so, save the regenerated prompt
  let regeneratedPrompt: string | null = null;
  if (prediction.job_id) {
    const { data: job } = await adminClient
      .from('generation_jobs')
      .select('is_regen, metadata')
      .eq('id', prediction.job_id)
      .single();
    
    if (job?.is_regen === true && job?.metadata?.prompt) {
      regeneratedPrompt = job.metadata.prompt;
      console.log(`[updateSceneImage] Scene ${sceneIndex + 1} is regenerated, saving new prompt`);
    }
  }

  console.log(`[updateSceneImage] Writing to project_scenes for scene ${sceneIndex + 1}`);

  // 1. Update the robust normalized table
  // IMPORTANT: Clear upscaled_url, is_upscaled, qa_status when regenerating
  // This ensures the new image is shown instead of the old upscaled one
  const updateData: any = {
    image_url: imageUrl,
    image_width: imageWidth > 0 ? imageWidth : null,
    image_height: imageHeight > 0 ? imageHeight : null,
    // Clear upscale data - new image needs to be re-upscaled
    upscaled_url: null,
    is_upscaled: false,
    // Clear QA data - new image needs to be re-QA'd
    qa_status: null,
    qa_checked: false,
    qa_explication: null,
    qa_regeneration_prompt: null
  };
  
  // Add regenerated_prompt if this is a regen
  if (regeneratedPrompt) {
    updateData.regenerated_prompt = regeneratedPrompt;
  }
  
  await upsertProjectScene(adminClient, prediction.project_id, sceneIndex, updateData);

  // 2. FALLBACK: Also update the legacy JSON array for backward compatibility
  try {
    if (imageWidth > 0 && imageHeight > 0) {
      await adminClient.rpc('update_scene_image_url_with_dimensions', {
        p_project_id: prediction.project_id,
        p_scene_index: sceneIndex,
        p_image_url: imageUrl,
        p_image_width: imageWidth,
        p_image_height: imageHeight
      });
    } else {
      await adminClient.rpc('update_scene_image_url', {
        p_project_id: prediction.project_id,
        p_scene_index: sceneIndex,
        p_image_url: imageUrl
      });
    }
  } catch (err) {
    console.warn(`[updateSceneImage] Legacy JSON update failed (ignored):`, err);
  }
  
  // Always update job progress
  if (prediction.job_id) {
    // Count from project_scenes for correct progress
    const { count } = await adminClient
      .from('project_scenes')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', prediction.project_id)
      .not('image_url', 'is', null);

    await adminClient
      .from('generation_jobs')
      .update({ 
        progress: count || 0,
        updated_at: new Date().toISOString()
      })
      .eq('id', prediction.job_id);
  }
}

async function updateThumbnail(adminClient: any, prediction: any, imageUrl: string) {
  const jobId = prediction.job_id;
  
  if (!jobId) {
    console.error("No job_id for thumbnail prediction");
    return;
  }

  // Get current job metadata
  const { data: job } = await adminClient
    .from('generation_jobs')
    .select('metadata, progress')
    .eq('id', jobId)
    .single();

  if (!job) {
    console.error(`Job ${jobId} not found`);
    return;
  }

  const metadata = job.metadata || {};
  const generatedThumbnails = metadata.generatedThumbnails || [];
  const prompt = prediction.metadata?.prompt || '';
  const thumbnailIndex = prediction.thumbnail_index;
  
  // Check if this thumbnail already exists (prevent duplicates from race conditions)
  const existingIndex = generatedThumbnails.findIndex((t: any) => t.index === thumbnailIndex);
  if (existingIndex >= 0) {
    // Update existing entry
    generatedThumbnails[existingIndex] = {
      index: thumbnailIndex,
      url: imageUrl,
      prompt
    };
    console.log(`Thumbnail ${thumbnailIndex + 1} already exists, updating`);
  } else {
    // Add new thumbnail
    generatedThumbnails.push({
      index: thumbnailIndex,
      url: imageUrl,
      prompt
    });
  }

  // Sort by index
  generatedThumbnails.sort((a: any, b: any) => a.index - b.index);

  // Calculate actual progress based on unique thumbnails
  const uniqueThumbnails = generatedThumbnails.length;
  
  await adminClient
    .from('generation_jobs')
    .update({
      progress: uniqueThumbnails,
      metadata: {
        ...metadata,
        generatedThumbnails
      },
      updated_at: new Date().toISOString()
    })
    .eq('id', jobId);

  console.log(`Updated thumbnail ${thumbnailIndex + 1}, progress: ${uniqueThumbnails}/3`);
}

async function updateUpscaledImage(adminClient: any, prediction: any, imageUrl: string) {
  const sceneIndex = prediction.scene_index;
  
  if (sceneIndex === undefined || sceneIndex === null) {
    console.error(`Invalid scene index for upscale prediction ${prediction.id}`);
    return;
  }

  console.log(`[updateUpscaledImage] Writing to project_scenes for scene ${sceneIndex + 1}`);

  // 1. Update the robust normalized table
  await upsertProjectScene(adminClient, prediction.project_id, sceneIndex, {
    upscaled_url: imageUrl,
    is_upscaled: true
  });

  // 2. FALLBACK: Also update legacy JSON
  try {
    await adminClient.rpc('update_scene_image_url_upscaled', {
      p_project_id: prediction.project_id,
      p_scene_index: sceneIndex,
      p_image_url: imageUrl
    });
  } catch (err) {
    console.warn(`[updateUpscaledImage] Legacy JSON update failed (ignored):`, err);
  }
}

async function checkJobCompletion(adminClient: any, jobId: string) {
  if (!jobId) return;

  // Get job info
  const { data: job } = await adminClient
    .from('generation_jobs')
    .select('job_type, project_id, user_id, metadata, status, total, parent_job_id, scene_index')
    .eq('id', jobId)
    .single();

  if (!job) return;

  if (job.status === 'completed' || job.status === 'failed') {
    return;
  }
  
  if (job.job_type === 'single_image') {
    console.log(`[checkJobCompletion] Handling single_image job ${jobId} for scene ${job.scene_index + 1}`);
    
    // Mark completed
    await adminClient
      .from('generation_jobs')
      .update({
        status: 'completed',
        progress: 1,
        completed_at: new Date().toISOString()
      })
      .eq('id', jobId);
    
    if (job.parent_job_id) {
      const isRegen = job.metadata?.is_regen === true || job.is_regen === true;
      // Trigger QA
      console.log(`[checkJobCompletion] Creating QA job for scene ${job.scene_index + 1}, isRegen: ${isRegen}`);
      await createSingleQAJob(adminClient, job.project_id, job.user_id, job.scene_index, job.parent_job_id, isRegen);
      await launchNextPendingQAJob(adminClient);
      
      // Update parent progress based on project_scenes
      await updateParentProgressFromScenes(adminClient, job.parent_job_id);
    }
    
    await launchNextPendingJob(adminClient, Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    return;
  }

  if (job.job_type === 'single_upscale') {
    // Mark completed
    await adminClient
      .from('generation_jobs')
      .update({
        status: 'completed',
        progress: 1,
        completed_at: new Date().toISOString()
      })
      .eq('id', jobId);
    
    if (job.parent_job_id) {
      await updateParentJobProgressForScene(adminClient, job.parent_job_id, job.scene_index);
    }
    
    await launchNextPendingUpscaleJob(adminClient);
    return;
  }

  // Get all predictions for this job
  const { data: predictions } = await adminClient
    .from('pending_predictions')
    .select('id, status, result_url, prediction_type, thumbnail_index, metadata')
    .eq('job_id', jobId);

  if (!predictions || predictions.length === 0) {
    return;
  }

  const completedCount = predictions.filter((p: any) => p.status === 'completed' || p.status === 'failed').length;
  const pendingCount = predictions.filter((p: any) => p.status === 'pending' || p.status === 'starting').length;
  
  if (pendingCount > 0) {
    return;
  }
  
  const expectedTotal = job.total || 0;
  if (predictions.length < expectedTotal) {
    return;
  }

  // IMPORTANT: Save thumbnails to history BEFORE marking job complete
  // This fixes the race condition where frontend queries history before data is saved
  const metadata = job.metadata || {};
  if (job.job_type === 'thumbnails' && metadata.generatedThumbnails) {
    const thumbnails = metadata.generatedThumbnails as Array<{ url: string; prompt: string; index: number }>;
    if (thumbnails.length > 0) {
      const sortedThumbnails = [...thumbnails].sort((a, b) => a.index - b.index);
      const thumbnailUrls = sortedThumbnails.map(t => t.url);
      const prompts = sortedThumbnails.map(t => t.prompt);
      
      // Only save if we have all 3 thumbnails
      if (thumbnailUrls.length === 3) {
        try {
          await adminClient
            .from('generated_thumbnails')
            .insert({
              project_id: job.project_id,
              thumbnail_project_id: metadata.thumbnailProjectId || null,
              thumbnail_urls: thumbnailUrls,
              prompts: prompts,
              preset_name: metadata.presetName || null,
              user_id: job.user_id
            });
          console.log(`[checkJobCompletion] Saved ${thumbnailUrls.length} thumbnails to history`);
        } catch (err) {
          console.error('[checkJobCompletion] Error saving thumbnails to history:', err);
        }
      }
    }
  }

  const { error: updateError, data: updateData } = await adminClient
    .from('generation_jobs')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString()
    })
    .eq('id', jobId)
    .eq('status', 'processing')
    .select('id')
    .single();

  if (updateError || !updateData) {
    return;
  }

  // Handle semi-auto chaining
  if (job.job_type === 'images' && metadata.semiAutoMode === true) {
    await chainNextJobFromWebhook(adminClient, job.project_id, job.user_id, job.job_type, metadata);
  }
}

async function updateParentProgressFromScenes(adminClient: any, parentJobId: string) {
  const { data: parentJob } = await adminClient
    .from('generation_jobs')
    .select('project_id, total, metadata')
    .eq('id', parentJobId)
    .single();
  
  if (!parentJob) return;

  // Check if this is a manual regeneration (has sceneIndices)
  const sceneIndices = parentJob.metadata?.sceneIndices as number[] | undefined;
  const isManualRegen = sceneIndices && Array.isArray(sceneIndices) && sceneIndices.length > 0;

  let progressImages = 0;
  let progressQA = 0;
  let progressUpscale = 0;

  if (isManualRegen) {
    // For manual regeneration, only count progress for the specific scenes
    const { data: scenes } = await adminClient
      .from('project_scenes')
      .select('scene_index, image_url, qa_status, upscaled_url')
      .eq('project_id', parentJob.project_id)
      .in('scene_index', sceneIndices);
    
    if (scenes) {
      progressImages = scenes.filter((s: any) => s.image_url).length;
      progressQA = scenes.filter((s: any) => s.qa_status).length;
      progressUpscale = scenes.filter((s: any) => s.upscaled_url).length;
    }
    console.log(`[updateParentProgressFromScenes] Manual regen for scenes ${sceneIndices.join(',')}: images=${progressImages}, qa=${progressQA}, upscale=${progressUpscale}`);
  } else {
    // For full batch, count all scenes
    const { count: imgCount } = await adminClient
      .from('project_scenes')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', parentJob.project_id)
      .not('image_url', 'is', null);

    const { count: qaCount } = await adminClient
      .from('project_scenes')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', parentJob.project_id)
      .not('qa_status', 'is', null);

    const { count: upscaleCount } = await adminClient
      .from('project_scenes')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', parentJob.project_id)
      .not('upscaled_url', 'is', null);

    progressImages = imgCount || 0;
    progressQA = qaCount || 0;
    progressUpscale = upscaleCount || 0;
  }

  const newMetadata = {
    ...(parentJob.metadata || {}),
    progress_images: progressImages,
    progress_qa: progressQA,
    progress_upscale: progressUpscale,
    total_scenes: parentJob.total
  };

  await adminClient
    .from('generation_jobs')
    .update({ 
      // CRITICAL: progress column must follow upscaleDone to keep job "processing"
      progress: progressUpscale || 0,
      metadata: newMetadata,
      updated_at: new Date().toISOString()
    })
    .eq('id', parentJobId);
}

async function chainNextJobFromWebhook(
  adminClient: any,
  projectId: string,
  userId: string,
  completedJobType: string,
  metadata: Record<string, any>
) {
  // Keeping this for compatibility, but the atomic pipeline triggers manually
}

async function launchNextPendingJob(adminClient: any, supabaseUrl: string, supabaseServiceKey: string) {
  const MAX_CONCURRENT = 20;
  
  // Proactive cleanup: Fail jobs stuck in processing for > 15 mins
  const timeoutLimit = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  await adminClient
    .from('generation_jobs')
    .update({ status: 'failed', error_message: 'Stuck in processing (timeout)' })
    .eq('status', 'processing')
    .eq('job_type', 'single_image')
    .lt('created_at', timeoutLimit);

  // 1. Get current processing count
  const { count: processingCount } = await adminClient
    .from('generation_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'processing')
    .eq('job_type', 'single_image');
  
  const availableSlots = MAX_CONCURRENT - (processingCount || 0);
  if (availableSlots <= 0) return;

  // 2. Find ALL pending jobs up to the number of available slots
  const { data: pendingJobs } = await adminClient
    .from('generation_jobs')
    .select('id, project_id, scene_index, metadata, user_id')
    .eq('status', 'pending')
    .eq('job_type', 'single_image')
    .order('created_at', { ascending: true })
    .limit(availableSlots);
  
  if (!pendingJobs || pendingJobs.length === 0) return;

  for (const jobToClaim of pendingJobs) {
    const { data: claimed } = await adminClient
      .from('generation_jobs')
      .update({ status: 'processing' })
      .eq('id', jobToClaim.id)
      .eq('status', 'pending')
      .select('id')
      .single();
    
    if (!claimed) continue;

    const imagePromise = (async () => {
      try {
        console.log(`[launchNextPendingJob] Launching image for scene ${jobToClaim.scene_index + 1} of project ${jobToClaim.project_id}`);
        
        // Handle Z-Image turbo resolution logic (960x544 for 16:9)
        let finalWidth = jobToClaim.metadata.width || 1440;
        let finalHeight = jobToClaim.metadata.height || 816;
        const imageModel = jobToClaim.metadata.model || 'seedream-4.5';
        
        const isZImage = imageModel === 'z-image-turbo' || imageModel === 'z-image-turbo-lora';
        if (isZImage) {
          const ratio = finalWidth / finalHeight;
          const is16x9 = Math.abs(ratio - (16 / 9)) < 0.1;
          if (is16x9) {
            console.log(`[launchNextPendingJob] Z-Image 16:9 detected - forcing 960x544`);
            finalWidth = 960;
            finalHeight = 544;
          }
        }

        // Build request body with LoRA if present
        const requestBody: any = {
          prompt: jobToClaim.metadata.prompt,
          model: imageModel,
          width: finalWidth,
          height: finalHeight,
          image_urls: jobToClaim.metadata.styleRefs || [],
          async: true,
          webhook_url: `${supabaseUrl}/functions/v1/replicate-webhook`,
          userId: jobToClaim.user_id,
          projectId: jobToClaim.project_id,
          sceneIndex: jobToClaim.scene_index,
          jobId: jobToClaim.id,
        };
        
        // Add LoRA from metadata if present
        if (jobToClaim.metadata.loraUrl) {
          requestBody.lora_url = jobToClaim.metadata.loraUrl;
          requestBody.lora_steps = jobToClaim.metadata.loraSteps || 10;
          console.log(`[launchNextPendingJob] Adding LoRA to request: ${jobToClaim.metadata.loraUrl}`);
        }

        const response = await fetch(`${supabaseUrl}/functions/v1/generate-image-seedream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify(requestBody),
        });
        
        if (response.ok) {
          const result = await response.json();
          const { error: insertError } = await adminClient.from('pending_predictions').insert({
            job_id: jobToClaim.id,
            prediction_id: result.predictionId,
            prediction_type: 'scene_image',
            scene_index: jobToClaim.scene_index,
            project_id: jobToClaim.project_id,
            user_id: jobToClaim.user_id,
            status: 'pending',
          });
          
          if (insertError) {
            console.error(`[launchNextPendingJob] CRITICAL: Failed to insert pending_prediction for scene ${jobToClaim.scene_index + 1}, prediction ${result.predictionId}:`, insertError);
            // Mark the job as failed - the webhook won't be able to process it
            await adminClient.from('generation_jobs').update({ 
              status: 'failed', 
              error_message: `Failed to track prediction: ${insertError.message}`.substring(0, 200) 
            }).eq('id', jobToClaim.id);
            await retryFailedImageJob(adminClient, jobToClaim, `Failed to track prediction: ${insertError.message}`);
          } else {
            console.log(`[launchNextPendingJob] SUCCESS: Inserted pending_prediction for scene ${jobToClaim.scene_index + 1}, prediction ${result.predictionId}`);
          }
        } else {
          const errorText = await response.text();
          console.error(`[launchNextPendingJob] Failed to start image for scene ${jobToClaim.scene_index + 1}:`, errorText);
          await adminClient.from('generation_jobs').update({ status: 'failed', error_message: errorText.substring(0, 200) }).eq('id', jobToClaim.id);
          // RETRY: Create a new job if under retry limit
          await retryFailedImageJob(adminClient, jobToClaim, errorText.substring(0, 200));
          // Continue the chain - launch next job to fill this failed slot
          await launchNextPendingJob(adminClient, supabaseUrl, supabaseServiceKey);
        }
      } catch (error) {
        console.error(`[launchNextPendingJob] Error for scene ${jobToClaim.scene_index + 1}:`, error);
        await adminClient.from('generation_jobs').update({ status: 'failed', error_message: String(error).substring(0, 200) }).eq('id', jobToClaim.id);
        // RETRY: Create a new job if under retry limit
        await retryFailedImageJob(adminClient, jobToClaim, String(error).substring(0, 200));
        // Continue the chain - launch next job to fill this failed slot
        await launchNextPendingJob(adminClient, supabaseUrl, supabaseServiceKey);
      }
    })();

    if (typeof EdgeRuntime !== 'undefined') {
      EdgeRuntime.waitUntil(imagePromise);
    }
  }
}

// RETRY MECHANISM: Automatically retry failed single_image jobs (max 3 attempts)
const MAX_IMAGE_RETRIES = 3;

async function retryFailedImageJob(adminClient: any, failedJob: any, errorMessage: string): Promise<void> {
  const retryCount = (failedJob.metadata?.retryCount || 0) + 1;
  
  if (retryCount > MAX_IMAGE_RETRIES) {
    console.log(`[retryFailedImageJob] Scene ${failedJob.scene_index + 1}: Max retries (${MAX_IMAGE_RETRIES}) reached, not retrying`);
    return;
  }
  
  console.log(`[retryFailedImageJob] Scene ${failedJob.scene_index + 1}: Creating retry ${retryCount}/${MAX_IMAGE_RETRIES} after error: ${errorMessage.substring(0, 50)}...`);
  
  // Create a new pending job with incremented retry count
  const { error: insertError } = await adminClient.from('generation_jobs').insert({
    project_id: failedJob.project_id,
    user_id: failedJob.user_id,
    job_type: 'single_image',
    status: 'pending',
    progress: 0,
    total: 1,
    scene_index: failedJob.scene_index,
    parent_job_id: failedJob.parent_job_id,
    is_regen: failedJob.is_regen || false,
    metadata: {
      ...failedJob.metadata,
      retryCount,
      lastError: errorMessage.substring(0, 100)
    }
  });
  
  if (insertError) {
    console.error(`[retryFailedImageJob] Failed to create retry job for scene ${failedJob.scene_index + 1}:`, insertError);
  } else {
    console.log(`[retryFailedImageJob] Created retry job for scene ${failedJob.scene_index + 1} (attempt ${retryCount})`);
  }
}

async function createSingleQAJob(adminClient: any, projectId: string, userId: string, sceneIndex: number, parentJobId: string, isRegen: boolean) {
  console.log(`[createSingleQAJob] Creating QA job for scene ${sceneIndex + 1} of project ${projectId}`);
  
  // Get scene data from project_scenes
  const { data: scene } = await adminClient
    .from('project_scenes')
    .select('*')
    .eq('project_id', projectId)
    .eq('scene_index', sceneIndex)
    .single();

  if (!scene?.image_url) {
    console.error(`[createSingleQAJob] CRITICAL: No image_url found for scene ${sceneIndex + 1} in project_scenes - QA job NOT created!`);
    return;
  }
  
  console.log(`[createSingleQAJob] Found image_url for scene ${sceneIndex + 1}: ${scene.image_url.substring(0, 80)}...`);

  await adminClient.from('generation_jobs').insert({
    project_id: projectId,
    user_id: userId,
    job_type: 'single_qa',
    status: 'pending',
    scene_index: sceneIndex,
    parent_job_id: parentJobId,
    is_regen: isRegen,
    metadata: {
      imageUrl: scene.image_url,
      sourcePrompt: scene.prompt || '',
      is_regen: isRegen,
      semiAutoMode: true
    }
  });
}

async function launchNextPendingQAJob(adminClient: any) {
  const MAX_QA = 100;
  
  // Proactive cleanup: Fail jobs stuck in processing for > 15 mins
  const timeoutLimit = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  await adminClient
    .from('generation_jobs')
    .update({ status: 'failed', error_message: 'Stuck in processing (timeout)' })
    .eq('status', 'processing')
    .eq('job_type', 'single_qa')
    .lt('created_at', timeoutLimit);

  // 1. Get current processing count
  const { count: processingCount } = await adminClient
    .from('generation_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'processing')
    .eq('job_type', 'single_qa');
  
  const availableSlots = MAX_QA - (processingCount || 0);
  if (availableSlots <= 0) return;

  // 2. Find ALL pending jobs up to the number of available slots
  const { data: pendingJobs } = await adminClient
    .from('generation_jobs')
    .select('*')
    .eq('status', 'pending')
    .eq('job_type', 'single_qa')
    .order('created_at', { ascending: true })
    .limit(availableSlots);
  
  if (!pendingJobs || pendingJobs.length === 0) {
    console.log('[launchNextPendingQAJob] No pending single_qa jobs');
    return;
  }
  
  console.log(`[launchNextPendingQAJob] Found ${pendingJobs.length} pending QA jobs to launch`);

  for (const pending of pendingJobs) {
    const { data: claimed } = await adminClient
      .from('generation_jobs')
      .update({ status: 'processing' })
      .eq('id', pending.id)
      .eq('status', 'pending')
      .select('id')
      .single();
    
    if (!claimed) continue;

    const qaPromise = (async () => {
      try {
        console.log(`[launchNextPendingQAJob] Launching QA for scene ${pending.scene_index + 1} of project ${pending.project_id}`);
        const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/start-generation-job`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
          body: JSON.stringify({ jobId: pending.id, projectId: pending.project_id, userId: pending.user_id, jobType: 'single_qa' })
        });
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[launchNextPendingQAJob] Failed to start QA for scene ${pending.scene_index + 1}:`, errorText);
          await adminClient.from('generation_jobs').update({ status: 'failed', error_message: errorText.substring(0, 200) }).eq('id', pending.id);
          // Continue the chain - launch next job to fill this failed slot
          await launchNextPendingQAJob(adminClient);
        }
      } catch (err) {
        console.error(`[launchNextPendingQAJob] Error for scene ${pending.scene_index + 1}:`, err);
        await adminClient.from('generation_jobs').update({ status: 'failed', error_message: String(err).substring(0, 200) }).eq('id', pending.id);
        // Continue the chain - launch next job to fill this failed slot
        await launchNextPendingQAJob(adminClient);
      }
    })();

    if (typeof EdgeRuntime !== 'undefined') {
      EdgeRuntime.waitUntil(qaPromise);
    }
  }
}

async function launchNextPendingUpscaleJob(adminClient: any) {
  const MAX_UP = 20;
  
  // Proactive cleanup: Fail jobs stuck in processing for > 15 mins
  const timeoutLimit = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  await adminClient
    .from('generation_jobs')
    .update({ status: 'failed', error_message: 'Stuck in processing (timeout)' })
    .eq('status', 'processing')
    .eq('job_type', 'single_upscale')
    .lt('created_at', timeoutLimit);

  // 1. Get current processing count
  const { count: processingCount } = await adminClient
    .from('generation_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'processing')
    .eq('job_type', 'single_upscale');
  
  const availableSlots = MAX_UP - (processingCount || 0);
  console.log(`[launchNextPendingUpscaleJob] Processing: ${processingCount}/${MAX_UP}, Available: ${availableSlots}`);
  
  if (availableSlots <= 0) return;

  // 2. Find ALL pending upscale jobs up to the number of available slots
  const { data: pendingJobs } = await adminClient
    .from('generation_jobs')
    .select('*')
    .eq('status', 'pending')
    .eq('job_type', 'single_upscale')
    .order('created_at', { ascending: true })
    .limit(availableSlots);
  
  if (!pendingJobs || pendingJobs.length === 0) {
    console.log(`[launchNextPendingUpscaleJob] No pending jobs to launch`);
    return;
  }

  console.log(`[launchNextPendingUpscaleJob] Attempting to launch ${pendingJobs.length} jobs`);

  // 3. Launch each pending job
  for (const pending of pendingJobs) {
    const { data: claimed } = await adminClient
      .from('generation_jobs')
      .update({ status: 'processing' })
      .eq('id', pending.id)
      .eq('status', 'pending')
      .select('id')
      .single();
    
    if (!claimed) continue;

    const sceneIndex = pending.scene_index;
    const { data: scene } = await adminClient
      .from('project_scenes')
      .select('image_url')
      .eq('project_id', pending.project_id)
      .eq('scene_index', sceneIndex)
      .single();

    if (scene?.image_url) {
      console.log(`[launchNextPendingUpscaleJob] Launching upscale for scene ${sceneIndex + 1} of project ${pending.project_id}`);
      
      // Use fire-and-forget for the individual API call to not block the loop
      const upscalePromise = (async () => {
        try {
          const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/upscale-image`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json', 
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` 
            },
            body: JSON.stringify({ 
              imageUrl: scene.image_url, 
              userId: pending.user_id, 
              async: true, 
              webhook_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/replicate-webhook` 
            })
          });
          
          if (res.ok) {
            const result = await res.json();
            const { error: insertError } = await adminClient.from('pending_predictions').insert({
              job_id: pending.id, 
              prediction_id: result.predictionId, 
              prediction_type: 'upscale',
              scene_index: sceneIndex, 
              project_id: pending.project_id, 
              user_id: pending.user_id, 
              status: 'pending'
            });
            
            if (insertError) {
              console.error(`[launchNextPendingUpscaleJob] CRITICAL: Failed to insert pending_prediction for scene ${sceneIndex + 1}, prediction ${result.predictionId}:`, insertError);
              await adminClient.from('generation_jobs').update({ status: 'failed', error_message: `Failed to track prediction: ${insertError.message}`.substring(0, 200) }).eq('id', pending.id);
            } else {
              console.log(`[launchNextPendingUpscaleJob] SUCCESS: Inserted pending_prediction for scene ${sceneIndex + 1}, prediction ${result.predictionId}`);
            }
          } else {
            const errorText = await res.text();
            console.error(`[launchNextPendingUpscaleJob] Failed to start upscale for scene ${sceneIndex + 1}:`, errorText);
            await adminClient.from('generation_jobs').update({ status: 'failed', error_message: errorText.substring(0, 200) }).eq('id', pending.id);
            // Continue the chain - launch next job to fill this failed slot
            await launchNextPendingUpscaleJob(adminClient);
          }
        } catch (err) {
          console.error(`[launchNextPendingUpscaleJob] Error for scene ${sceneIndex + 1}:`, err);
          await adminClient.from('generation_jobs').update({ status: 'failed', error_message: String(err).substring(0, 200) }).eq('id', pending.id);
          // Continue the chain - launch next job to fill this failed slot
          await launchNextPendingUpscaleJob(adminClient);
        }
      })();

      if (typeof EdgeRuntime !== 'undefined') {
        EdgeRuntime.waitUntil(upscalePromise);
      }
    } else {
      console.error(`[launchNextPendingUpscaleJob] No image_url found for scene ${sceneIndex + 1}`);
      await adminClient.from('generation_jobs').update({ status: 'failed', error_message: 'No image_url for upscale' }).eq('id', pending.id);
      // Continue the chain - don't let missing image block other upscales
      // Use fire-and-forget to avoid blocking the loop
      if (typeof EdgeRuntime !== 'undefined') {
        EdgeRuntime.waitUntil(launchNextPendingUpscaleJob(adminClient));
      }
    }
  }
}

async function updateParentJobProgressForScene(adminClient: any, parentJobId: string, sceneIndex: number) {
  await updateParentProgressFromScenes(adminClient, parentJobId);
  const { data: parent } = await adminClient.from('generation_jobs').select('progress, total').eq('id', parentJobId).single();
  if (parent && parent.progress >= parent.total) {
    await adminClient.from('generation_jobs').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', parentJobId);
  }
}

async function updateQueueItemStatus(adminClient: any, predictionId: string, status: string, resultUrl: string | null, error?: string) {
  await adminClient.from('generation_queue').update({ status, completed_at: new Date().toISOString(), result_url: resultUrl, error_message: error }).eq('prediction_id', predictionId);
}

async function triggerQueueProcessing(url: string, key: string) {}
