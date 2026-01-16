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

async function updateSceneImage(adminClient: any, prediction: any, imageUrl: string) {
  const sceneIndex = prediction.scene_index;
  
  if (sceneIndex === undefined || sceneIndex === null) {
    console.error(`Invalid scene index for prediction ${prediction.id}`);
    return;
  }

  // Get image dimensions from prediction metadata or project settings
  const metadata = prediction.metadata || {};
  const imageWidth = metadata.imageWidth || metadata.width || 0;
  const imageHeight = metadata.imageHeight || metadata.height || 0;

  // Use atomic database function with dimensions to prevent race conditions
  // This uses FOR UPDATE row locking to ensure only one update at a time
  let result, rpcError;
  
  if (imageWidth > 0 && imageHeight > 0) {
    // Use new function that stores dimensions
    const response = await adminClient.rpc('update_scene_image_url_with_dimensions', {
      p_project_id: prediction.project_id,
      p_scene_index: sceneIndex,
      p_image_url: imageUrl,
      p_image_width: imageWidth,
      p_image_height: imageHeight
    });
    result = response.data;
    rpcError = response.error;
    
    if (!rpcError && result === true) {
      console.log(`Updated scene ${sceneIndex + 1} with image URL and dimensions ${imageWidth}x${imageHeight} (atomic)`);
    }
  } else {
    // Fallback to old function without dimensions
    const response = await adminClient.rpc('update_scene_image_url', {
      p_project_id: prediction.project_id,
      p_scene_index: sceneIndex,
      p_image_url: imageUrl
    });
    result = response.data;
    rpcError = response.error;
    
    if (!rpcError && result === true) {
      console.log(`Updated scene ${sceneIndex + 1} with image URL (atomic, no dimensions)`);
    }
  }

  if (rpcError) {
    console.error(`Failed to update scene ${sceneIndex + 1} via RPC:`, rpcError);
  } else if (result !== true) {
    console.error(`Scene ${sceneIndex + 1} not found or project missing`);
  }
  
  // Always update job progress
  if (prediction.job_id) {
    const { data: completedPredictions } = await adminClient
      .from('pending_predictions')
      .select('id')
      .eq('job_id', prediction.job_id)
      .eq('status', 'completed');
    
    const completedCount = completedPredictions?.length || 0;
    
    await adminClient
      .from('generation_jobs')
      .update({ 
        progress: completedCount,
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

  // Use atomic database function to update scene image with upscaled version AND mark as upscaled
  const { data: result, error: rpcError } = await adminClient.rpc('update_scene_image_url_upscaled', {
    p_project_id: prediction.project_id,
    p_scene_index: sceneIndex,
    p_image_url: imageUrl
  });

  if (rpcError) {
    console.error(`Failed to update scene ${sceneIndex + 1} with upscaled image via RPC:`, rpcError);
  } else if (result === true) {
    console.log(`✅ Scene ${sceneIndex + 1} upscaled to 1920x1088 and marked as isUpscaled=true`);
  } else {
    console.error(`Scene ${sceneIndex + 1} not found or project missing`);
  }
  
  // Update job progress - account for chunking (global progress)
  if (prediction.job_id) {
    // Get job metadata to check if this is a chunk continuation
    const { data: job } = await adminClient
      .from('generation_jobs')
      .select('metadata, total')
      .eq('id', prediction.job_id)
      .single();
    
    const metadata = job?.metadata || {};
    const alreadyUpscaled = metadata.upscaledIndices?.length || 0;
    
    // Count completed predictions in this job
    const { data: completedPredictions } = await adminClient
      .from('pending_predictions')
      .select('id')
      .eq('job_id', prediction.job_id)
      .eq('status', 'completed');
    
    const completedInThisChunk = completedPredictions?.length || 0;
    
    // Global progress = already upscaled in previous chunks + completed in this chunk
    const globalProgress = alreadyUpscaled + completedInThisChunk;
    
    await adminClient
      .from('generation_jobs')
      .update({ 
        progress: globalProgress,
        updated_at: new Date().toISOString()
      })
      .eq('id', prediction.job_id);
    
    console.log(`Upscale progress updated: ${globalProgress}/${job?.total || '?'} (${alreadyUpscaled} from previous chunks + ${completedInThisChunk} in this chunk)`);
  }
}

async function checkJobCompletion(adminClient: any, jobId: string) {
  if (!jobId) return;

  // Get job info first to know the expected total
  const { data: job } = await adminClient
    .from('generation_jobs')
    .select('job_type, project_id, user_id, metadata, status, total')
    .eq('id', jobId)
    .single();

  if (!job) return;

  // CRITICAL: Skip if job is already completed or failed
  if (job.status === 'completed' || job.status === 'failed') {
    console.log(`Job ${jobId} already marked as ${job.status}, skipping`);
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
  
  // Check if ALL predictions are done (no pending ones left)
  if (pendingCount > 0) {
    console.log(`Job ${jobId}: ${completedCount}/${predictions.length} completed, ${pendingCount} still pending`);
    return;
  }
  
  // Also verify we have received all expected predictions
  const expectedTotal = job.total || 0;
  if (predictions.length < expectedTotal) {
    console.log(`Job ${jobId}: Only ${predictions.length}/${expectedTotal} predictions created, waiting for more`);
    return;
  }

  console.log(`All predictions for job ${jobId} are complete`);

  // Mark job as completed atomically - ONLY if still processing
  // This is the critical race condition prevention
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

  // If no row was updated, another webhook already completed this job
  if (updateError || !updateData) {
    console.log(`Job ${jobId} was already completed by another webhook (update failed), skipping`);
    return;
  }

  const successfulPredictions = predictions.filter((p: any) => p.status === 'completed' && p.result_url);
  const failedCount = predictions.filter((p: any) => p.status === 'failed').length;

  // Update error message if there were failures
  if (failedCount > 0) {
    await adminClient
      .from('generation_jobs')
      .update({ error_message: `${failedCount} générations échouées` })
      .eq('id', jobId);
  }

  // For thumbnails, save to generated_thumbnails table
  if (job.job_type === 'thumbnails' && successfulPredictions.length > 0) {
    const thumbnailPredictions = successfulPredictions
      .filter((p: any) => p.prediction_type === 'thumbnail')
      .sort((a: any, b: any) => (a.thumbnail_index || 0) - (b.thumbnail_index || 0));

    if (thumbnailPredictions.length > 0) {
      // Get preset name and thumbnail project id from job metadata
      const presetName = job.metadata?.presetName || null;
      const thumbnailProjectId = job.metadata?.thumbnailProjectId || null;
      const isStandalone = job.metadata?.standalone === true;
      
      const { error: saveError } = await adminClient
        .from('generated_thumbnails')
        .insert({
          project_id: isStandalone ? null : job.project_id,
          thumbnail_project_id: thumbnailProjectId,
          user_id: job.user_id,
          thumbnail_urls: thumbnailPredictions.map((p: any) => p.result_url),
          prompts: thumbnailPredictions.map((p: any) => p.metadata?.prompt || ''),
          preset_name: presetName,
        });

      if (saveError) {
        console.error("Error saving thumbnails to history:", saveError);
      } else {
        console.log(`Saved ${thumbnailPredictions.length} thumbnails to history (preset: ${presetName || 'none'}, thumbnailProjectId: ${thumbnailProjectId || 'none'})`);
      }
    }
  }

  console.log(`Job ${jobId} marked as completed. Success: ${successfulPredictions.length}, Failed: ${failedCount}`);
  console.log(`Job ${jobId} type: ${job.job_type}, project_id: ${job.project_id}`);

  // Handle chunk continuation or semi-auto mode chaining for images
  const metadata = job.metadata || {};
  if (job.job_type === 'images') {
    // IMPORTANT: Before creating next chunk, ensure ALL predictions from THIS job are complete
    // to avoid race conditions where some images are still being generated
    const { data: pendingInThisJob } = await adminClient
      .from('pending_predictions')
      .select('id')
      .eq('job_id', jobId)
      .in('status', ['pending', 'processing']);
    
    if (pendingInThisJob && pendingInThisJob.length > 0) {
      console.log(`Job ${jobId}: ${pendingInThisJob.length} predictions still pending/processing in this job, waiting before creating next chunk`);
      return; // Don't create next chunk yet - some predictions from this job are still running
    }
    
    // NOTE: We no longer check for pending predictions across the entire project here.
    // The database unique index (idx_unique_active_prediction_per_scene) will prevent
    // duplicate predictions at the DB level. This allows chunks to continue even if
    // some old predictions are stuck in other jobs.
    
    // Check if there are more images to process by re-checking the project
    // This is more reliable than relying on pre-calculated remainingAfterChunk
    // because images are added between chunk starts
    const { data: project } = await adminClient
      .from('projects')
      .select('prompts')
      .eq('id', job.project_id)
      .single();
    
    const prompts = (project?.prompts as any[]) || [];
    const missingCount = prompts.filter((p: any) => p?.prompt && !p?.imageUrl).length;
    
    console.log(`Job ${jobId} complete. All predictions finished. Checking project - ${missingCount} images still missing`);
    
    if (missingCount > 0) {
      // More images need to be generated - create next chunk job
      console.log(`Job ${jobId}: Creating next chunk for ${missingCount} remaining images`);
      
      // Check for existing chunk job to prevent duplicates
      // But first, clean up any stuck jobs (pending/processing for > 10 minutes with no recent activity)
      const TEN_MINUTES_AGO = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      
      const { data: stuckJobs } = await adminClient
        .from('generation_jobs')
        .select('id, updated_at, created_at')
        .eq('project_id', job.project_id)
        .eq('job_type', 'images')
        .in('status', ['pending', 'processing'])
        .lt('updated_at', TEN_MINUTES_AGO)
        .neq('id', jobId);
      
      if (stuckJobs && stuckJobs.length > 0) {
        console.log(`Job ${jobId}: Found ${stuckJobs.length} stuck image jobs, marking them as failed`);
        for (const stuckJob of stuckJobs) {
          await adminClient
            .from('generation_jobs')
            .update({ 
              status: 'failed', 
              error_message: 'Job stuck - cleaned up automatically',
              completed_at: new Date().toISOString()
            })
            .eq('id', stuckJob.id);
          console.log(`Job ${jobId}: Marked stuck job ${stuckJob.id} as failed`);
        }
      }
      
      // Now check for existing active chunk jobs
      const { data: existingChunkJobs } = await adminClient
        .from('generation_jobs')
        .select('id')
        .eq('project_id', job.project_id)
        .eq('job_type', 'images')
        .in('status', ['pending', 'processing'])
        .neq('id', jobId)
        .limit(1);

      if (existingChunkJobs && existingChunkJobs.length > 0) {
        console.log(`Job ${jobId}: Next chunk job ${existingChunkJobs[0].id} already exists, skipping`);
        return;
      }
      
      // Create next chunk job
      const { data: nextChunkJob, error: chunkError } = await adminClient
        .from('generation_jobs')
        .insert({
          project_id: job.project_id,
          user_id: job.user_id,
          job_type: 'images',
          status: 'pending',
          progress: 0,
          total: Math.min(missingCount, 50),
          metadata: {
            ...metadata,
            skipExisting: true, // Always skip existing images
            isChunkContinuation: true
          }
        })
        .select()
        .single();
      
      if (chunkError) {
        console.error("Error creating next chunk job:", chunkError);
        // Fall through to check for semi-auto chaining
      } else {
        console.log(`Created next chunk job ${nextChunkJob.id} for ${Math.min(missingCount, 50)} images`);
        
        // Start next chunk job in background
        EdgeRuntime.waitUntil((async () => {
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          try {
            const response = await fetch(`${supabaseUrl}/functions/v1/start-generation-job`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${serviceRoleKey}`
              },
              body: JSON.stringify({
                jobId: nextChunkJob.id,
                projectId: job.project_id,
                userId: job.user_id,
                jobType: 'images',
                metadata: {
                  ...metadata,
                  skipExisting: true,
                  isChunkContinuation: true
                }
              })
            });
            
            if (response.ok) {
              console.log(`Next chunk job ${nextChunkJob.id} started successfully`);
            } else {
              console.error(`Failed to start next chunk job: ${await response.text()}`);
            }
          } catch (error) {
            console.error("Error starting next chunk job:", error);
          }
        })());
        
        return; // Don't proceed to semi-auto chaining yet - more chunks needed
      }
    }
    
    // All images are done (missingCount === 0)
    // In semi-auto mode, the QA check is now done as a separate job (chained via chainNextJobFromWebhook)
    // Get full project data to check image model and aspect ratio
    const { data: fullProject } = await adminClient
      .from('projects')
      .select('image_model, image_width, image_height, prompts')
      .eq('id', job.project_id)
      .single();
    
    // NOTE: QA check is now handled by a separate 'qa' job in semi-auto mode
    // Skip inline QA and go directly to checking upscale needs
    if (false && fullProject) {
      console.log(`Job ${jobId}: Running QA check on generated images`);
      
      const projectPrompts = (fullProject.prompts as any[]) || [];
      let needsRegeneration = false;
      let updatedPrompts = [...projectPrompts];
      
      // Process images in chunks of 100 in parallel
      const CHUNK_SIZE = 100;
      
      // Filter images that need QA
      const imagesToCheck = projectPrompts
        .map((prompt, index) => ({ prompt, index }))
        .filter(({ prompt }) => 
          prompt && 
          prompt.imageUrl && 
          prompt.qa_checked !== true && 
          prompt.qa_regenerated !== true
        );
      
      console.log(`Job ${jobId}: QA checking ${imagesToCheck.length} images in chunks of ${CHUNK_SIZE}`);
      
      // Process in chunks
      for (let i = 0; i < imagesToCheck.length; i += CHUNK_SIZE) {
        const chunk = imagesToCheck.slice(i, i + CHUNK_SIZE);
        console.log(`Job ${jobId}: Processing QA chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(imagesToCheck.length / CHUNK_SIZE)} (${chunk.length} images)`);
        
        // Process chunk in parallel
        await Promise.all(
          chunk.map(async ({ prompt, index }) => {
            try {
              console.log(`Job ${jobId}: QA checking scene ${index + 1}`);
              
              // Call QA function
              const qaResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/qa-image-gemini`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
                },
                body: JSON.stringify({
                  imageUrl: prompt.imageUrl,
                  userId: job.user_id
                })
              });
              
              if (!qaResponse.ok) {
                console.error(`Job ${jobId}: QA check failed for scene ${index + 1}:`, await qaResponse.text());
                // Mark as checked anyway to not block pipeline
                updatedPrompts[index] = {
                  ...updatedPrompts[index],
                  qa_checked: true,
                  qa_status: 'OK' // Assume OK on error
                };
                return;
              }
              
              const qaResult = await qaResponse.json();
              console.log(`Job ${jobId}: QA result for scene ${index + 1}:`, qaResult.status, qaResult.anomalie_detectee);
              
              if (qaResult.status === 'REJECT' && qaResult.prompt_regeneration) {
                // Need to regenerate this image
                console.log(`Job ${jobId}: Scene ${index + 1} REJECTED. Will regenerate with new prompt.`);
                
                updatedPrompts[index] = {
                  ...updatedPrompts[index],
                  qa_checked: true,
                  qa_status: 'REJECT',
                  qa_regenerated: true, // Mark to avoid re-regenerating
                  qa_explication: qaResult.explication
                };
                
                needsRegeneration = true;
                
                // Create a new prediction for regeneration
                const { error: predError } = await adminClient
                  .from('pending_predictions')
                  .insert({
                    job_id: jobId,
                    project_id: job.project_id,
                    user_id: job.user_id,
                    prediction_type: 'scene_image',
                    scene_index: index,
                    status: 'pending',
                    metadata: {
                      ...metadata,
                      qaRegeneration: true,
                      originalPrompt: prompt.prompt,
                      correctedPrompt: qaResult.prompt_regeneration
                    }
                  });
                
                if (predError) {
                  if (predError.code === '23505') {
                    console.log(`Job ${jobId}: Scene ${index + 1} regeneration already in progress (duplicate prevented by DB)`);
                    return; // Skip triggering regeneration - already being processed
                  }
                  console.error(`Job ${jobId}: Failed to create regeneration prediction for scene ${index + 1}:`, predError);
                  return; // Don't trigger regeneration if prediction creation failed
                } else {
                  console.log(`Job ${jobId}: Created regeneration prediction for scene ${index + 1}`);
                  
                  // Trigger regeneration
                  const styleReference = fullProject.style_reference_url || '';
                  const regenPrompt = qaResult.prompt_regeneration;
                  
                  // Call generate-image-seedream to regenerate
                  EdgeRuntime.waitUntil((async () => {
                    try {
                      await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-image-seedream`, {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
                        },
                        body: JSON.stringify({
                          prompt: regenPrompt,
                          styleImageUrl: styleReference,
                          width: fullProject.image_width || 1920,
                          height: fullProject.image_height || 1080,
                          projectId: job.project_id,
                          sceneIndex: index,
                          userId: job.user_id,
                          jobId: jobId
                        })
                      });
                    } catch (error) {
                      console.error(`Job ${jobId}: Error triggering regeneration for scene ${index + 1}:`, error);
                    }
                  })());
                }
              } else {
                // Image passed QA
                updatedPrompts[index] = {
                  ...updatedPrompts[index],
                  qa_checked: true,
                  qa_status: 'OK'
                };
              }
            } catch (error) {
              console.error(`Job ${jobId}: Error during QA for scene ${index + 1}:`, error);
              // Mark as checked to not block pipeline
              updatedPrompts[index] = {
                ...updatedPrompts[index],
                qa_checked: true,
                qa_status: 'OK'
              };
            }
          })
        );
        
        // Small delay between chunks to avoid overwhelming the API
        if (i + CHUNK_SIZE < imagesToCheck.length) {
          console.log(`Job ${jobId}: Waiting 2s before next chunk...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      // Save updated prompts
      await adminClient
        .from('projects')
        .update({ prompts: updatedPrompts as any })
        .eq('id', job.project_id);
      
      if (needsRegeneration) {
        console.log(`Job ${jobId}: Some images need regeneration. Waiting for regeneration to complete before upscaling.`);
        return; // Stop here, webhook will be called again after regeneration
      }
      
      console.log(`Job ${jobId}: All images passed QA or were regenerated. Proceeding to upscale.`);
    }
    
    // NOTE: All upscale logic is now handled by the chaining system (images -> QA -> upscale)
    // DO NOT create upscale jobs here - it bypasses QA
    
    // Proceed to semi-auto chaining if enabled
    console.log(`Job ${jobId}: Images done. metadata.semiAutoMode = ${metadata.semiAutoMode}, job_type = ${job.job_type}`);
    if (metadata.semiAutoMode === true) {
      console.log(`Job ${jobId}: All images generated. Chaining to next step (QA).`);
      await chainNextJobFromWebhook(adminClient, job.project_id, job.user_id, job.job_type, metadata);
    } else {
      console.log(`Job ${jobId}: Semi-auto mode NOT enabled, pipeline stops here`);
    }
  } else if (job.job_type === 'upscale') {
    console.log(`Job ${jobId}: Processing upscale job completion`);
    const metadata = job.metadata || {};
    
    // If this is a single image upscale, don't check for remaining images
    if (metadata.singleImage === true) {
      console.log(`Job ${jobId}: Single image upscale completed, skipping chunk continuation logic`);
      // Update project dimensions if needed (for Z-Image 16:9)
      await adminClient
        .from('projects')
        .update({ image_width: 1920, image_height: 1088 })
        .eq('id', job.project_id);
      return;
    }
    
    // Check if there are more images to upscale (chunk continuation)
    const { data: fullProject } = await adminClient
      .from('projects')
      .select('prompts, image_width, image_height, image_model')
      .eq('id', job.project_id)
      .single();
    
    if (fullProject) {
      const prompts = (fullProject.prompts as any[]) || [];
      
      // Get indices of images that were just upscaled in this job
      const { data: completedPredictions } = await adminClient
        .from('pending_predictions')
        .select('scene_index')
        .eq('job_id', jobId)
        .eq('status', 'completed');
      
      const justUpscaledIndices = (completedPredictions || []).map((p: any) => p.scene_index);
      const previouslyUpscaled = metadata.upscaledIndices || [];
      const allUpscaledIndices = [...new Set([...previouslyUpscaled, ...justUpscaledIndices])];
      
      // Count images that still need upscaling (check both isUpscaled flag and job tracking)
      const remainingToUpscale = prompts
        .map((prompt: any, index: number) => ({ prompt, index }))
        .filter(({ prompt, index }: any) => {
          if (!prompt || !prompt.imageUrl) return false;
          if (prompt.isUpscaled === true) return false; // Already marked as upscaled
          if (allUpscaledIndices.includes(index)) return false; // Upscaled in this job run
          
          // CRITICAL: Also check dimensions to match processUpscaleJob logic
          const imgWidth = prompt.imageWidth || 0;
          const imgHeight = prompt.imageHeight || 0;
          if (imgWidth >= 1920 && imgHeight >= 1080) {
            console.log(`Webhook: Skipping scene ${index + 1} - already high-res (${imgWidth}x${imgHeight})`);
            return false; // Already high resolution
          }
          
          return true;
        });
      
      console.log(`Job ${jobId}: Upscale chunk complete. ${justUpscaledIndices.length} upscaled this chunk, ${remainingToUpscale.length} remaining`);
      
      if (remainingToUpscale.length > 0) {
        // IMPORTANT: Before creating next chunk, ensure ALL predictions from THIS job are complete
        const { data: pendingInThisJob } = await adminClient
          .from('pending_predictions')
          .select('id')
          .eq('job_id', jobId)
          .in('status', ['pending', 'processing']);
        
        if (pendingInThisJob && pendingInThisJob.length > 0) {
          console.log(`Job ${jobId}: ${pendingInThisJob.length} upscale predictions still pending/processing, waiting before creating next chunk`);
          return; // Don't create next chunk yet - wait for all predictions to finish
        }
        
        // NOTE: We no longer check for pending upscale predictions across the entire project here.
        // The database unique index will prevent duplicate predictions at the DB level.
        
        // More images to upscale - create next chunk job
        console.log(`Job ${jobId}: All upscale predictions complete, creating next chunk for ${remainingToUpscale.length} images`);
        
        // Check for existing upscale chunk job to prevent duplicates (use limit(1) to avoid error on multiple results)
        const { data: existingChunkJobs } = await adminClient
          .from('generation_jobs')
          .select('id, status')
          .eq('project_id', job.project_id)
          .eq('job_type', 'upscale')
          .in('status', ['pending', 'processing'])
          .limit(1);
        
        const existingChunkJob = existingChunkJobs?.[0];

        if (existingChunkJob) {
          console.log(`Job ${jobId}: Upscale chunk job ${existingChunkJob.id} (status: ${existingChunkJob.status}) already exists, skipping`);
        } else {
          // Calculate total global: prefer metadata.totalGlobal, then calculate from actual counts
          // This ensures we always have the correct total even if job.total was not updated properly
          const calculatedTotal = allUpscaledIndices.length + remainingToUpscale.length;
          const totalGlobal = metadata.totalGlobal || job.total || calculatedTotal;
          console.log(`Job ${jobId}: Creating next chunk with totalGlobal=${totalGlobal} (metadata.totalGlobal=${metadata.totalGlobal}, job.total=${job.total}, calculated=${calculatedTotal})`);
          
          const { data: nextChunkJob, error: chunkError } = await adminClient
            .from('generation_jobs')
            .insert({
              project_id: job.project_id,
              user_id: job.user_id,
              job_type: 'upscale',
              status: 'pending',
              progress: allUpscaledIndices.length, // Start progress from where we left off
              total: totalGlobal, // Use total global, not chunk size
              metadata: {
                ...metadata,
                upscaledIndices: allUpscaledIndices,
                isChunkContinuation: true,
                totalGlobal
              }
            })
            .select()
            .single();
          
          if (chunkError) {
            console.error("Error creating next upscale chunk job:", chunkError);
          } else {
            console.log(`Created next upscale chunk job ${nextChunkJob.id} for ${Math.min(remainingToUpscale.length, 30)} images`);
            
            // Start next chunk job in background
            EdgeRuntime.waitUntil((async () => {
              const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
              const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
              
              await new Promise(resolve => setTimeout(resolve, 2000));
              
              try {
                const response = await fetch(`${supabaseUrl}/functions/v1/start-generation-job`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${serviceRoleKey}`
                  },
                  body: JSON.stringify({
                    jobId: nextChunkJob.id,
                    projectId: job.project_id,
                    userId: job.user_id,
                    jobType: 'upscale',
                    metadata: {
                      ...metadata,
                      upscaledIndices: allUpscaledIndices,
                      isChunkContinuation: true
                    }
                  })
                });
                
                if (response.ok) {
                  console.log(`Next upscale chunk job ${nextChunkJob.id} started successfully`);
                } else {
                  console.error(`Failed to start next upscale chunk job: ${await response.text()}`);
                }
              } catch (error) {
                console.error("Error starting next upscale chunk job:", error);
              }
            })());
            
            return; // Don't proceed to dimension update or thumbnails yet
          }
        }
      }
      
      // All upscales done - update project dimensions and verify flags
      const imageModel = fullProject.image_model || '';
      const isZImage = imageModel === 'z-image-turbo' || imageModel === 'z-image-turbo-lora';
      
      if (isZImage) {
        console.log(`Job ${jobId}: All upscales complete. Updating project dimensions to 1920x1088`);
        const { error: updateError } = await adminClient
          .from('projects')
          .update({
            image_width: 1920,
            image_height: 1088
          })
          .eq('id', job.project_id);
        
        if (updateError) {
          console.error(`Job ${jobId}: Failed to update dimensions:`, updateError);
        } else {
          console.log(`Job ${jobId}: Project ${job.project_id} dimensions updated to 1920x1088`);
        }
        
        // Verify and fix any missing isUpscaled flags
        const upscaledWithoutFlag = prompts.filter((p: any) => 
          p && p.imageUrl && p.isUpscaled !== true && 
          (!p.imageWidth || !p.imageHeight || (p.imageWidth >= 1920 && p.imageHeight >= 1080))
        );
        
        if (upscaledWithoutFlag.length > 0) {
          console.log(`Job ${jobId}: Found ${upscaledWithoutFlag.length} images without isUpscaled flag, fixing...`);
          
          // Update all images to have isUpscaled flag if they have high-res dimensions
          const fixedPrompts = prompts.map((p: any) => {
            if (p && p.imageUrl && p.isUpscaled !== true) {
              const imgWidth = p.imageWidth || 0;
              const imgHeight = p.imageHeight || 0;
              if (imgWidth >= 1920 && imgHeight >= 1080) {
                return { ...p, isUpscaled: true };
              }
            }
            return p;
          });
          
          await adminClient
            .from('projects')
            .update({ prompts: fixedPrompts })
            .eq('id', job.project_id);
          
          console.log(`Job ${jobId}: Fixed ${upscaledWithoutFlag.length} missing isUpscaled flags`);
        }
      }
      
      // Chain to thumbnails if semi-auto mode
      if (metadata.semiAutoMode === true) {
        console.log(`Job ${jobId}: Upscale complete. Chaining to thumbnails.`);
        await chainNextJobFromWebhook(adminClient, job.project_id, job.user_id, 'upscale', metadata);
      }
    }
  } else if (job.job_type === 'single_image') {
    // After single image generation, check if we need to upscale it (Z-Image 16:9)
    const { data: project } = await adminClient
      .from('projects')
      .select('image_model, image_width, image_height')
      .eq('id', job.project_id)
      .single();
    
    if (project) {
      const imageModel = project.image_model || '';
      const isZImage = imageModel === 'z-image-turbo' || imageModel === 'z-image-turbo-lora';
      const projectWidth = project.image_width || 1920;
      const projectHeight = project.image_height || 1080;
      const is16x9 = Math.abs((projectWidth / projectHeight) - (16 / 9)) < 0.1 || (projectWidth === 960 && projectHeight === 544);
      
      console.log(`Job ${jobId}: Single image completed. isZImage=${isZImage}, dimensions=${projectWidth}x${projectHeight}, is16x9=${is16x9}`);
      
      if (isZImage && is16x9) {
        // Get the scene index from metadata
        const sceneIndex = job.metadata?.sceneIndex;
        
        if (sceneIndex !== undefined && sceneIndex !== null) {
          console.log(`Job ${jobId}: Triggering upscale for single image at scene ${sceneIndex}`);
          
          // Call upscale-image directly for this single image
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          
          // Get the image URL from the project prompts
          const { data: fullProject } = await adminClient
            .from('projects')
            .select('prompts')
            .eq('id', job.project_id)
            .single();
          
          const prompts = (fullProject?.prompts as any[]) || [];
          const imageUrl = prompts[sceneIndex]?.imageUrl;
          
          if (imageUrl) {
            console.log(`Job ${jobId}: Upscaling image at index ${sceneIndex}: ${imageUrl.substring(0, 50)}...`);
            
            // Create a mini upscale job for tracking
            const { data: upscaleJob } = await adminClient
              .from('generation_jobs')
              .insert({
                project_id: job.project_id,
                user_id: job.user_id,
                job_type: 'upscale',
                status: 'processing',
                progress: 0,
                total: 1,
                metadata: {
                  singleImage: true,
                  sceneIndex,
                  imageModel
                }
              })
              .select()
              .single();
            
            if (upscaleJob) {
              // Build webhook URL
              const webhookUrl = `${supabaseUrl}/functions/v1/replicate-webhook`;
              
              // Call upscale-image function
              try {
                const response = await fetch(`${supabaseUrl}/functions/v1/upscale-image`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${serviceRoleKey}`
                  },
                  body: JSON.stringify({
                    imageUrl,
                    userId: job.user_id, // Required for internal calls
                    async: true, // Use webhook mode
                    webhook_url: webhookUrl
                  })
                });
                
                if (response.ok) {
                  const responseData = await response.json();
                  const predictionId = responseData.predictionId;
                  
                  if (predictionId) {
                    // Create pending_prediction for webhook tracking (like processUpscaleJob)
                    const { error: insertError } = await adminClient
                      .from('pending_predictions')
                      .insert({
                        job_id: upscaleJob.id,
                        prediction_id: predictionId,
                        prediction_type: 'upscale',
                        scene_index: sceneIndex,
                        project_id: job.project_id,
                        user_id: job.user_id,
                        metadata: { 
                          originalImageUrl: imageUrl,
                          sceneIndex
                        },
                        status: 'pending'
                      });
                    
                    if (insertError) {
                      if (insertError.code === '23505') {
                        console.log(`Job ${jobId}: Upscale for scene ${sceneIndex} already in progress (duplicate prevented by DB)`);
                      } else {
                        console.error(`Job ${jobId}: Failed to create upscale prediction:`, insertError);
                      }
                    } else {
                      console.log(`Job ${jobId}: Upscale started for scene ${sceneIndex}, prediction: ${predictionId}`);
                    }
                  } else {
                    throw new Error('No prediction ID returned');
                  }
                } else {
                  const errorText = await response.text();
                  console.error(`Job ${jobId}: Failed to start upscale: ${errorText}`);
                  // Mark upscale job as failed
                  await adminClient
                    .from('generation_jobs')
                    .update({ status: 'failed', error_message: `Failed to start upscale: ${errorText}` })
                    .eq('id', upscaleJob.id);
                }
              } catch (error) {
                console.error(`Job ${jobId}: Error calling upscale-image:`, error);
                await adminClient
                  .from('generation_jobs')
                  .update({ status: 'failed', error_message: String(error) })
                  .eq('id', upscaleJob.id);
              }
            }
          } else {
            console.log(`Job ${jobId}: No image URL found at index ${sceneIndex}`);
          }
        }
      }
    }
  } else if (metadata.semiAutoMode === true) {
    // For other job types in semi-auto, just chain
    await chainNextJobFromWebhook(adminClient, job.project_id, job.user_id, job.job_type, metadata);
  }
}

async function handleScriptCompletion(adminClient: any, prediction: any, output: any) {
  const jobId = prediction.job_id;
  
  console.log("Handling script completion for job:", jobId);
  
  // Parse the script from output
  let script = "";
  if (Array.isArray(output)) {
    script = output.join("");
  } else if (typeof output === "string") {
    script = output;
  } else {
    script = String(output);
  }
  
  console.log("Script generated, length:", script.length);
  
  const wordCount = script.split(/\s+/).length;
  const estimatedDuration = Math.round(wordCount / 2.5);
  
  // Update pending prediction
  await adminClient
    .from('pending_predictions')
    .update({
      status: 'completed',
      result_url: null, // No URL for text
      completed_at: new Date().toISOString(),
      metadata: {
        ...prediction.metadata,
        script,
        wordCount,
        estimatedDuration
      }
    })
    .eq('id', prediction.id);
  
  // Update job with script result
  if (jobId) {
    const { data: job } = await adminClient
      .from('generation_jobs')
      .select('metadata, project_id')
      .eq('id', jobId)
      .single();
    
    const metadata = job?.metadata || {};
    const projectId = job?.project_id;
    
    await adminClient
      .from('generation_jobs')
      .update({
        status: 'completed',
        progress: 1,
        completed_at: new Date().toISOString(),
        metadata: {
          ...metadata,
          script,
          wordCount,
          estimatedDuration
        }
      })
      .eq('id', jobId);
    
    // Also save the script to the project's summary field for easy access
    // This allows the CreateFromScratch page to recover the script
    if (projectId) {
      await adminClient
        .from('projects')
        .update({
          summary: script // Use summary field to store the generated script temporarily
        })
        .eq('id', projectId);
      
      console.log(`Script saved to project ${projectId}`);
    }
    
    console.log(`Script job ${jobId} completed successfully`);
  }
}

async function chainNextJobFromWebhook(
  adminClient: any,
  projectId: string,
  userId: string,
  completedJobType: string,
  metadata: Record<string, any>
) {
  let nextJobType: string | null = null;
  
  if (completedJobType === 'prompts') {
    nextJobType = 'images';
  } else if (completedJobType === 'images') {
    // After images, chain to QA to check image quality
    nextJobType = 'qa';
  } else if (completedJobType === 'qa') {
    // After QA, check if there's a qa_regen job pending/processing
    const { data: qaRegenJobs } = await adminClient
      .from('generation_jobs')
      .select('id, status')
      .eq('project_id', projectId)
      .eq('job_type', 'qa_regen')
      .in('status', ['pending', 'processing'])
      .limit(1);
    
    if (qaRegenJobs && qaRegenJobs.length > 0) {
      console.log(`Webhook: QA regen job ${qaRegenJobs[0].id} is pending/processing, waiting for it to complete`);
      return; // Don't chain to upscale yet - wait for qa_regen to finish
    }
    
    // No qa_regen job, proceed to upscale
    nextJobType = 'upscale';
  } else if (completedJobType === 'qa_regen') {
    nextJobType = 'upscale'; // After QA regen, chain to upscale
  } else if (completedJobType === 'upscale') {
    nextJobType = 'thumbnails'; // After upscale, chain to thumbnails
  }
  
  if (!nextJobType) {
    console.log(`Semi-automatic pipeline completed for project ${projectId}`);
    return;
  }

  console.log(`Webhook: Chaining from ${completedJobType} to ${nextJobType}`);

  // Add random delay to reduce race conditions when multiple webhooks complete simultaneously
  const randomDelay = Math.floor(Math.random() * 2000) + 500; // 500-2500ms
  await new Promise(resolve => setTimeout(resolve, randomDelay));

  // Check if a job of this type already exists and is pending/processing
  // Also check for jobs created in the last 60 seconds to catch recent duplicates
  const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
  const { data: existingJobs } = await adminClient
    .from('generation_jobs')
    .select('id, status, created_at')
    .eq('project_id', projectId)
    .eq('job_type', nextJobType)
    .or(`status.in.(pending,processing),created_at.gte.${oneMinuteAgo}`)
    .limit(5);

  if (existingJobs && existingJobs.length > 0) {
    const activeJob = existingJobs.find((j: any) => j.status === 'pending' || j.status === 'processing');
    if (activeJob) {
      console.log(`Job ${nextJobType} already exists (${activeJob.id}), skipping duplicate creation`);
      return;
    }
    // If recent completed/failed jobs exist (created in last 60s), also skip to avoid duplicates
    const recentJob = existingJobs.find((j: any) => 
      (j.status === 'completed' || j.status === 'failed') && 
      new Date(j.created_at).getTime() > Date.now() - 60000
    );
    if (recentJob) {
      console.log(`Recent ${nextJobType} job found (${recentJob.id}, status: ${recentJob.status}), skipping duplicate creation`);
      return;
    }
  }

  // Get project data
  const { data: project } = await adminClient
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single();

  if (!project) {
    console.error(`Project ${projectId} not found for chaining`);
    return;
  }

  let total = 0;
  let jobMetadata: Record<string, any> = {
    semiAutoMode: true,
    skipExisting: true,
    useWebhook: true,
    started_at: new Date().toISOString(),
  };

  if (nextJobType === 'images') {
    const prompts = (project.prompts as any[]) || [];
    
    // Check for null/undefined prompts - these need to be regenerated first
    const nullPromptIndices = prompts
      .map((p: any, idx: number) => ({ prompt: p, index: idx }))
      .filter((item: any) => !item.prompt || !item.prompt.prompt)
      .map((item: any) => item.index + 1);
    
    if (nullPromptIndices.length > 0) {
      console.log(`Detected ${nullPromptIndices.length} null prompts at indices: ${nullPromptIndices.join(', ')}. Auto-regenerating...`);
      
      // Create a prompts job to regenerate missing prompts
      const { data: promptsJob, error: promptsJobError } = await adminClient
        .from('generation_jobs')
        .insert({
          project_id: projectId,
          user_id: userId,
          job_type: 'prompts',
          status: 'pending',
          progress: 0,
          total: nullPromptIndices.length,
          metadata: {
            semiAutoMode: true,
            skipExisting: true,
            useWebhook: true,
            autoRepairNullPrompts: true,
            started_at: new Date().toISOString()
          }
        })
        .select()
        .single();
      
      if (promptsJobError) {
        console.error(`Error creating auto-repair prompts job:`, promptsJobError);
        return;
      }
      
      console.log(`Created auto-repair prompts job ${promptsJob.id}`);
      
      // Trigger the prompts job
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        
        await fetch(`${supabaseUrl}/functions/v1/start-generation-job`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceRoleKey}`
          },
          body: JSON.stringify({
            jobId: promptsJob.id,
            projectId,
            userId,
            jobType: 'prompts',
            semiAutoMode: true,
            skipExisting: true,
            useWebhook: true
          })
        });
        console.log(`Triggered auto-repair prompts job ${promptsJob.id}`);
      } catch (fetchError) {
        console.error(`Error triggering auto-repair prompts job:`, fetchError);
      }
      
      // Don't chain to images yet - the prompts job will chain when complete
      return;
    }
    
    total = prompts.filter((p: any) => p && p.prompt && !p.imageUrl).length;
    
    if (total === 0) {
      console.log("No images to generate, skipping to QA");
      await chainNextJobFromWebhook(adminClient, projectId, userId, 'images', metadata);
      return;
    }
  } else if (nextJobType === 'qa') {
    const prompts = (project.prompts as any[]) || [];
    
    // CRITICAL: Before chaining to QA, verify ALL images are actually generated
    // Count prompts that have a prompt but no image - these need to be generated first
    const missingImages = prompts.filter((p: any) => p && p.prompt && !p.imageUrl).length;
    const totalWithImages = prompts.filter((p: any) => p && p.imageUrl).length;
    const totalWithPrompts = prompts.filter((p: any) => p && p.prompt).length;
    
    console.log(`chainNextJobFromWebhook -> QA check: ${totalWithImages}/${totalWithPrompts} images generated, ${missingImages} missing`);
    
    if (missingImages > 0) {
      console.log(`BLOCKING QA: ${missingImages} images still missing! Creating images job instead.`);
      
      // Create a new images job to generate the missing images
      const { data: imagesJob, error: imagesJobError } = await adminClient
        .from('generation_jobs')
        .insert({
          project_id: projectId,
          user_id: userId,
          job_type: 'images',
          status: 'pending',
          progress: 0,
          total: Math.min(missingImages, 50),
          metadata: {
            semiAutoMode: true,
            skipExisting: true,
            useWebhook: true,
            isChunkContinuation: true,
            started_at: new Date().toISOString()
          }
        })
        .select()
        .single();
      
      if (imagesJobError) {
        console.error(`Error creating images job for missing images:`, imagesJobError);
        return;
      }
      
      console.log(`Created images job ${imagesJob.id} for ${missingImages} missing images`);
      
      // Start the images job
      EdgeRuntime.waitUntil((async () => {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        try {
          const response = await fetch(`${supabaseUrl}/functions/v1/start-generation-job`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${serviceRoleKey}`
            },
            body: JSON.stringify({
              jobId: imagesJob.id,
              projectId,
              userId,
              jobType: 'images',
              metadata: {
                semiAutoMode: true,
                skipExisting: true,
                useWebhook: true,
                isChunkContinuation: true
              }
            })
          });
          
          if (response.ok) {
            console.log(`Images job ${imagesJob.id} started successfully`);
          } else {
            console.error(`Failed to start images job: ${await response.text()}`);
          }
        } catch (error) {
          console.error("Error starting images job:", error);
        }
      })());
      
      return; // Don't chain to QA yet - images job will chain when complete
    }
    
    total = totalWithImages;
    
    if (total === 0) {
      console.log("No images to check, skipping QA");
      await chainNextJobFromWebhook(adminClient, projectId, userId, 'qa', metadata);
      return;
    }
    
    // Get qaPrompt from metadata or fetch from project preset
    let qaPrompt = metadata.qaPrompt || null;
    if (!qaPrompt && project.preset_id) {
      const { data: preset } = await adminClient
        .from('presets')
        .select('qa_prompt')
        .eq('id', project.preset_id)
        .single();
      
      if (preset?.qa_prompt) {
        qaPrompt = preset.qa_prompt;
        console.log(`Loaded qaPrompt from preset (${qaPrompt.length} chars)`);
      }
    }
    
    jobMetadata = {
      ...jobMetadata,
      qaPrompt
    };
  } else if (nextJobType === 'upscale') {
    const prompts = (project.prompts as any[]) || [];
    const imageModel = project.image_model || 'seedream-4.5';
    const imageWidth = project.image_width || 1920;
    const imageHeight = project.image_height || 1080;
    
    // Check if this is Z-Image 16:9
    const isZImage = imageModel === 'z-image-turbo' || imageModel === 'z-image-turbo-lora';
    const ratio = imageWidth / imageHeight;
    const is16x9 = Math.abs(ratio - (16 / 9)) < 0.1;
    
    if (!isZImage || !is16x9) {
      console.log("Not Z-Image 16:9, skipping upscaling");
      await chainNextJobFromWebhook(adminClient, projectId, userId, 'upscale', metadata);
      return;
    }
    
    total = prompts.filter((p: any) => p && p.imageUrl).length;
    
    if (total === 0) {
      console.log("No images to upscale");
      await chainNextJobFromWebhook(adminClient, projectId, userId, 'upscale', metadata);
      return;
    }
    
    jobMetadata = {
      ...jobMetadata,
      imageModel,
      imageWidth,
      imageHeight
    };
  } else if (nextJobType === 'thumbnails') {
    total = 3;
    
    const thumbnailPresetId = project.thumbnail_preset_id;
    if (!thumbnailPresetId) {
      console.log(`No thumbnail preset. Pipeline complete.`);
      return;
    }

    // Check if the channel has disabled thumbnail generation
    const { data: calendarEntry } = await adminClient
      .from('content_calendar')
      .select('channel_id, channels!inner(thumbnail_preset_enabled)')
      .eq('project_id', projectId)
      .maybeSingle();
    
    if (calendarEntry) {
      const channelData = (calendarEntry as any).channels;
      const thumbnailEnabled = channelData?.thumbnail_preset_enabled !== false;
      
      if (!thumbnailEnabled) {
        console.log(`Thumbnail generation disabled for channel. Pipeline complete.`);
        return;
      }
    }

    const { data: thumbnailPreset } = await adminClient
      .from('thumbnail_presets')
      .select('*')
      .eq('id', thumbnailPresetId)
      .single();

    if (!thumbnailPreset) {
      console.log(`Thumbnail preset not found. Pipeline complete.`);
      return;
    }

    const prompts = (project.prompts as any[]) || [];
    const videoScript = prompts.map((p: any) => p?.text || '').join(' ');

    jobMetadata = {
      ...jobMetadata,
      videoScript,
      videoTitle: project.name || '',
      exampleUrls: thumbnailPreset.example_urls || [],
      characterRefUrl: thumbnailPreset.character_ref_url,
      customPrompt: thumbnailPreset.custom_prompt,
      imageModel: project.image_model || 'seedream-4.5',
      presetName: thumbnailPreset.name
    };
  }

  // Create the next job
  const { data: nextJob, error: jobError } = await adminClient
    .from('generation_jobs')
    .insert({
      project_id: projectId,
      user_id: userId,
      job_type: nextJobType,
      status: 'pending',
      progress: 0,
      total,
      metadata: jobMetadata
    })
    .select()
    .single();

  if (jobError) {
    console.error(`Error creating chained job:`, jobError);
    return;
  }

  console.log(`Created chained job ${nextJob.id} for ${nextJobType}`);

  // Call start-generation-job to process it via HTTP
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    await fetch(`${supabaseUrl}/functions/v1/start-generation-job`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`
      },
      body: JSON.stringify({
        jobId: nextJob.id,
        projectId,
        userId,
        jobType: nextJobType,
        ...jobMetadata
      })
    });
    console.log(`Triggered processing for chained job ${nextJob.id}`);
  } catch (fetchError) {
    console.error(`Error triggering chained job:`, fetchError);
  }
}

// ============================================================================
// NEW: Queue-based generation support
// ============================================================================

/**
 * Update generation_queue item status when a prediction completes
 */
async function updateQueueItemStatus(
  adminClient: any,
  predictionId: string,
  status: 'completed' | 'failed',
  resultUrl: string | null,
  errorMessage?: string
): Promise<void> {
  try {
    const updateData: Record<string, any> = {
      status,
      completed_at: new Date().toISOString(),
    };
    
    if (resultUrl) {
      updateData.result_url = resultUrl;
    }
    
    if (errorMessage) {
      updateData.error_message = errorMessage;
    }

    const { error } = await adminClient
      .from('generation_queue')
      .update(updateData)
      .eq('prediction_id', predictionId);

    if (error) {
      // Not an error if item doesn't exist - might be old system
      if (error.code !== 'PGRST116') {
        console.log(`[Queue] No queue item found for prediction ${predictionId} (using old system)`);
      }
    } else {
      console.log(`[Queue] Updated queue item for prediction ${predictionId} -> ${status}`);
    }
  } catch (error) {
    console.error(`[Queue] Error updating queue item status:`, error);
  }
}

/**
 * Trigger the queue processor to start the next batch
 */
async function triggerQueueProcessing(
  supabaseUrl: string,
  supabaseServiceKey: string
): Promise<void> {
  // Use EdgeRuntime.waitUntil to not block the webhook response
  EdgeRuntime.waitUntil((async () => {
    try {
      // Small delay to batch multiple webhook completions
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const response = await fetch(`${supabaseUrl}/functions/v1/process-generation-queue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ trigger: 'webhook' }),
      });

      if (response.ok) {
        console.log('[Queue] Triggered next batch processing');
      } else {
        // Don't log error if queue is empty or at capacity
        const result = await response.json().catch(() => ({}));
        if (result.message !== 'No pending items' && result.message !== 'Global limit reached') {
          console.error('[Queue] Failed to trigger processing:', result);
        }
      }
    } catch (error) {
      console.error('[Queue] Error triggering queue processing:', error);
    }
  })());
}
