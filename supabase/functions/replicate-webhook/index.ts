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
      await launchNextPendingJob(adminClient, supabaseUrl, supabaseServiceKey);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    if (payload.type === 'launch_pending_upscales') {
      console.log('[webhook] Received launch_pending_upscales trigger');
      // Launch multiple pending upscales (up to 10)
      for (let i = 0; i < 10; i++) {
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

    // Find the pending prediction
    const { data: prediction, error: predictionError } = await adminClient
      .from('pending_predictions')
      .select('*')
      .eq('prediction_id', predictionId)
      .single();

    if (predictionError || !prediction) {
      console.error(`Prediction ${predictionId} not found in pending_predictions:`, predictionError);
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

    console.log(`Found prediction ${predictionId} for job ${prediction.job_id}, type: ${prediction.prediction_type}`);

    // Handle based on status
    if (status === 'succeeded' && output) {
      // Handle script generation (text output)
      if (prediction.prediction_type === 'script') {
        await handleScriptCompletion(adminClient, prediction, output);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // Handle image generation
      const imageOutput = Array.isArray(output) ? output[0] : output;
      
      if (imageOutput) {
        try {
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

        } catch (error) {
          console.error(`Error processing successful prediction:`, error);
          await adminClient
            .from('pending_predictions')
            .update({
              status: 'failed',
              error_message: error instanceof Error ? error.message : 'Unknown error',
              completed_at: new Date().toISOString()
            })
            .eq('id', prediction.id);
            
          await checkJobCompletion(adminClient, prediction.job_id);
          
          // NEW: Update queue item as failed
          await updateQueueItemStatus(adminClient, predictionId, 'failed', null, error instanceof Error ? error.message : 'Unknown error');
          
          // NEW: Trigger next batch even on failure
          await triggerQueueProcessing(supabaseUrl, supabaseServiceKey);
        }
      }
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
  const { error } = await adminClient
    .from('project_scenes')
    .upsert({
      project_id: projectId,
      scene_index: sceneIndex,
      ...data,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'project_id,scene_index'
    });

  if (error) {
    console.error(`[upsertProjectScene] Error for scene ${sceneIndex}:`, error.message);
    throw error;
  }
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

  console.log(`[updateSceneImage] Writing to project_scenes for scene ${sceneIndex + 1}`);

  // 1. Update the robust normalized table
  await upsertProjectScene(adminClient, prediction.project_id, sceneIndex, {
    image_url: imageUrl,
    image_width: imageWidth > 0 ? imageWidth : null,
    image_height: imageHeight > 0 ? imageHeight : null
  });

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
  
  // Add this thumbnail
  generatedThumbnails.push({
    index: prediction.thumbnail_index,
    url: imageUrl,
    prompt
  });

  // Sort by index
  generatedThumbnails.sort((a: any, b: any) => a.index - b.index);

  // Update job with new thumbnail
  const newProgress = (job.progress || 0) + 1;
  
  await adminClient
    .from('generation_jobs')
    .update({
      progress: newProgress,
      metadata: {
        ...metadata,
        generatedThumbnails
      },
      updated_at: new Date().toISOString()
    })
    .eq('id', jobId);

  console.log(`Updated thumbnail ${prediction.thumbnail_index + 1}, progress: ${newProgress}/3`);
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
    console.log(`[checkJobCompletion] Handling single_image job ${jobId}`);
    
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
  const metadata = job.metadata || {};
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

  const { count: progressImages } = await adminClient
    .from('project_scenes')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', parentJob.project_id)
    .not('image_url', 'is', null);

  const { count: progressQA } = await adminClient
    .from('project_scenes')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', parentJob.project_id)
    .not('qa_status', 'is', null);

  const { count: progressUpscale } = await adminClient
    .from('project_scenes')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', parentJob.project_id)
    .not('upscaled_url', 'is', null);

  const newMetadata = {
    ...(parentJob.metadata || {}),
    progress_images: progressImages || 0,
    progress_qa: progressQA || 0,
    progress_upscale: progressUpscale || 0,
    total_scenes: parentJob.total
  };

  await adminClient
    .from('generation_jobs')
    .update({ 
      progress: progressImages || 0,
      metadata: newMetadata
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
  const { count: processingCount } = await adminClient
    .from('generation_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'processing')
    .eq('job_type', 'single_image');
  
  if ((processingCount || 0) >= MAX_CONCURRENT) return;

  const { data: pendingJobs } = await adminClient
    .from('generation_jobs')
    .select('id, project_id, scene_index, metadata, user_id')
    .eq('status', 'pending')
    .eq('job_type', 'single_image')
    .order('created_at', { ascending: true })
    .limit(1);
  
  if (!pendingJobs || pendingJobs.length === 0) return;
  const jobToClaim = pendingJobs[0];

  const { data: claimed } = await adminClient
    .from('generation_jobs')
    .update({ status: 'processing' })
    .eq('id', jobToClaim.id)
    .eq('status', 'pending')
    .select('id')
    .single();
  
  if (!claimed) return;

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/generate-image-seedream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({
        prompt: jobToClaim.metadata.prompt,
        model: jobToClaim.metadata.model,
        width: jobToClaim.metadata.width,
        height: jobToClaim.metadata.height,
        image_urls: jobToClaim.metadata.styleRefs || [],
        async: true,
        webhook_url: `${supabaseUrl}/functions/v1/replicate-webhook`,
        userId: jobToClaim.user_id,
        projectId: jobToClaim.project_id,
        sceneIndex: jobToClaim.scene_index,
        jobId: jobToClaim.id,
      }),
    });
    
    if (response.ok) {
      const result = await response.json();
      await adminClient.from('pending_predictions').insert({
        job_id: jobToClaim.id,
        prediction_id: result.predictionId,
        prediction_type: 'scene_image',
        scene_index: jobToClaim.scene_index,
        project_id: jobToClaim.project_id,
        user_id: jobToClaim.user_id,
        status: 'pending',
      });
    }
  } catch (error) {
    console.error(`[launchNextPendingJob] Error:`, error);
    await adminClient.from('generation_jobs').update({ status: 'failed', error_message: String(error) }).eq('id', jobToClaim.id);
  }
}

async function createSingleQAJob(adminClient: any, projectId: string, userId: string, sceneIndex: number, parentJobId: string, isRegen: boolean) {
  // Get scene data from project_scenes
  const { data: scene } = await adminClient
    .from('project_scenes')
    .select('*')
    .eq('project_id', projectId)
    .eq('scene_index', sceneIndex)
    .single();

  if (!scene?.image_url) return;

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
  const { count } = await adminClient.from('generation_jobs').select('id', { count: 'exact', head: true }).eq('status', 'processing').eq('job_type', 'single_qa');
  if ((count || 0) >= MAX_QA) return;

  const { data: pending } = await adminClient.from('generation_jobs').select('*').eq('status', 'pending').eq('job_type', 'single_qa').limit(1);
  if (!pending || pending.length === 0) return;

  const { data: claimed } = await adminClient.from('generation_jobs').update({ status: 'processing' }).eq('id', pending[0].id).eq('status', 'pending').select('id').single();
  if (!claimed) return;

  fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/start-generation-job`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
    body: JSON.stringify({ jobId: pending[0].id, projectId: pending[0].project_id, userId: pending[0].user_id, jobType: 'single_qa' })
  }).catch(err => console.error(err));
}

async function launchNextPendingUpscaleJob(adminClient: any) {
  const MAX_UP = 20;
  const { count } = await adminClient.from('generation_jobs').select('id', { count: 'exact', head: true }).eq('status', 'processing').eq('job_type', 'single_upscale');
  if ((count || 0) >= MAX_UP) return;

  const { data: pending } = await adminClient.from('generation_jobs').select('*').eq('status', 'pending').eq('job_type', 'single_upscale').limit(1);
  if (!pending || pending.length === 0) return;

  const { data: claimed } = await adminClient.from('generation_jobs').update({ status: 'processing' }).eq('id', pending[0].id).eq('status', 'pending').select('id').single();
  if (!claimed) return;

  const sceneIndex = pending[0].scene_index;
  const { data: scene } = await adminClient.from('project_scenes').select('image_url').eq('project_id', pending[0].project_id).eq('scene_index', sceneIndex).single();

  if (scene?.image_url) {
    const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/upscale-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
      body: JSON.stringify({ imageUrl: scene.image_url, userId: pending[0].user_id, async: true, webhook_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/replicate-webhook` })
    });
    if (res.ok) {
      const result = await res.json();
      await adminClient.from('pending_predictions').insert({
        job_id: pending[0].id, prediction_id: result.predictionId, prediction_type: 'upscale',
        scene_index: sceneIndex, project_id: pending[0].project_id, user_id: pending[0].user_id, status: 'pending'
      });
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
