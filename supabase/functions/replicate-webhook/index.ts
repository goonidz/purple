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

  // Use atomic database function to prevent race conditions
  // This uses FOR UPDATE row locking to ensure only one update at a time
  const { data: result, error: rpcError } = await adminClient.rpc('update_scene_image_url', {
    p_project_id: prediction.project_id,
    p_scene_index: sceneIndex,
    p_image_url: imageUrl
  });

  if (rpcError) {
    console.error(`Failed to update scene ${sceneIndex + 1} via RPC:`, rpcError);
  } else if (result === true) {
    console.log(`Updated scene ${sceneIndex + 1} with image URL (atomic)`);
  } else {
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

  // Use atomic database function to update scene image with upscaled version
  const { data: result, error: rpcError } = await adminClient.rpc('update_scene_image_url', {
    p_project_id: prediction.project_id,
    p_scene_index: sceneIndex,
    p_image_url: imageUrl
  });

  if (rpcError) {
    console.error(`Failed to update scene ${sceneIndex + 1} with upscaled image via RPC:`, rpcError);
  } else if (result === true) {
    console.log(`Updated scene ${sceneIndex + 1} with upscaled image (atomic)`);
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
    
    console.log(`Job ${jobId} complete. Checking project - ${missingCount} images still missing`);
    
    if (missingCount > 0) {
      // More images need to be generated - create next chunk job
      console.log(`Job ${jobId}: Creating next chunk for ${missingCount} remaining images`);
      
      // Check for existing chunk job to prevent duplicates
      const { data: existingChunkJob } = await adminClient
        .from('generation_jobs')
        .select('id')
        .eq('project_id', job.project_id)
        .eq('job_type', 'images')
        .in('status', ['pending', 'processing'])
        .single();

      if (existingChunkJob) {
        console.log(`Job ${jobId}: Next chunk job ${existingChunkJob.id} already exists, skipping`);
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
    
    // All images are done (missingCount === 0) - check if upscaling is needed
    // Get full project data to check image model and aspect ratio
    const { data: fullProject } = await adminClient
      .from('projects')
      .select('image_model, image_width, image_height, prompts')
      .eq('id', job.project_id)
      .single();
    
    const imageModel = fullProject?.image_model || '';
    const isZImage = imageModel === 'z-image-turbo' || imageModel === 'z-image-turbo-lora';
    const imageWidth = fullProject?.image_width || 1920;
    const imageHeight = fullProject?.image_height || 1080;
    
    // More robust 16:9 detection: check ratio OR exact dimensions (960x544 is the base for upscaling)
    const ratio = imageWidth / imageHeight;
    const is16x9 = Math.abs(ratio - (16 / 9)) < 0.1 || (imageWidth === 960 && imageHeight === 544);
    
    console.log(`Job ${jobId}: Checking upscale need - model: ${imageModel}, isZImage: ${isZImage}, dimensions: ${imageWidth}x${imageHeight}, is16x9: ${is16x9}`);
    
    // Check if upscaling is needed (Z-Image 16:9) - works in both manual and semi-auto mode
    if (isZImage && is16x9) {
      // Check if there's already an upscale job
      const { data: existingUpscaleJob } = await adminClient
        .from('generation_jobs')
        .select('id')
        .eq('project_id', job.project_id)
        .eq('job_type', 'upscale')
        .in('status', ['pending', 'processing', 'completed'])
        .single();
      
      if (!existingUpscaleJob) {
        // Create upscale job
        const projectPrompts = (fullProject?.prompts as any[]) || [];
        const imagesWithUrl = projectPrompts.filter((p: any) => p && p.imageUrl).length;
        
        console.log(`Job ${jobId}: Z-Image 16:9 detected. Creating upscale job for ${imagesWithUrl} images.`);
        
        const { data: upscaleJob, error: upscaleError } = await adminClient
          .from('generation_jobs')
          .insert({
            project_id: job.project_id,
            user_id: job.user_id,
            job_type: 'upscale',
            status: 'pending',
            progress: 0,
            total: imagesWithUrl,
            metadata: {
              ...metadata,
              imageModel,
              skipExisting: false // Always upscale all images
            }
          })
          .select()
          .single();
        
        if (upscaleError) {
          console.error("Error creating upscale job:", upscaleError);
        } else {
          console.log(`Created upscale job ${upscaleJob.id}`);
          
          // Start upscale job in background
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
                  jobId: upscaleJob.id,
                  projectId: job.project_id,
                  userId: job.user_id,
                  jobType: 'upscale',
                  metadata: {
                    ...metadata,
                    imageModel
                  }
                })
              });
              
              if (response.ok) {
                console.log(`Upscale job ${upscaleJob.id} started successfully`);
              } else {
                console.error(`Failed to start upscale job: ${await response.text()}`);
              }
            } catch (error) {
              console.error("Error starting upscale job:", error);
            }
          })());
          
          return; // Don't proceed to thumbnails yet - wait for upscale to complete
        }
      } else {
        console.log(`Job ${jobId}: Upscale job already exists (${existingUpscaleJob.id}), skipping`);
      }
    }
    
    // Proceed to semi-auto chaining if enabled (thumbnails)
    if (metadata.semiAutoMode === true) {
      console.log(`Job ${jobId}: All images generated. Chaining to thumbnails.`);
      await chainNextJobFromWebhook(adminClient, job.project_id, job.user_id, job.job_type, metadata);
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
      
      // Count images that still need upscaling
      const remainingToUpscale = prompts
        .map((prompt: any, index: number) => ({ prompt, index }))
        .filter(({ prompt, index }: any) => prompt && prompt.imageUrl && !allUpscaledIndices.includes(index));
      
      console.log(`Job ${jobId}: Upscale chunk complete. ${justUpscaledIndices.length} upscaled this chunk, ${remainingToUpscale.length} remaining`);
      
      if (remainingToUpscale.length > 0) {
        // More images to upscale - create next chunk job
        console.log(`Job ${jobId}: Creating next upscale chunk for ${remainingToUpscale.length} images`);
        
        // Check for existing upscale chunk job to prevent duplicates
        const { data: existingChunkJob } = await adminClient
          .from('generation_jobs')
          .select('id')
          .eq('project_id', job.project_id)
          .eq('job_type', 'upscale')
          .in('status', ['pending', 'processing'])
          .single();

        if (existingChunkJob) {
          console.log(`Job ${jobId}: Next upscale chunk job ${existingChunkJob.id} already exists, skipping`);
        } else {
          // Calculate total global: original total from first job or sum of all images
          const totalGlobal = job.total || (allUpscaledIndices.length + remainingToUpscale.length);
          
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
      
      // All upscales done - update project dimensions
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
      }
      
      // Chain to thumbnails if semi-auto mode
      if (metadata.semiAutoMode === true) {
        console.log(`Job ${jobId}: Upscale complete. Chaining to thumbnails.`);
        await chainNextJobFromWebhook(adminClient, job.project_id, job.user_id, 'images', metadata);
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
                    await adminClient
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
                    
                    console.log(`Job ${jobId}: Upscale started for scene ${sceneIndex}, prediction: ${predictionId}`);
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
    nextJobType = 'thumbnails';
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
      console.log("No images to generate, skipping to thumbnails");
      await chainNextJobFromWebhook(adminClient, projectId, userId, 'images', metadata);
      return;
    }
  } else if (nextJobType === 'thumbnails') {
    total = 3;
    
    const thumbnailPresetId = project.thumbnail_preset_id;
    if (!thumbnailPresetId) {
      console.log(`No thumbnail preset. Pipeline complete.`);
      return;
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
