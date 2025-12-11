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
      console.log(`Prediction ${predictionId} ${status}`);
      
      await adminClient
        .from('pending_predictions')
        .update({
          status: 'failed',
          error_message: `Generation ${status}`,
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

  // Retry logic to handle race conditions when multiple webhooks update simultaneously
  const MAX_RETRIES = 3;
  let updateSuccess = false;
  
  for (let attempt = 0; attempt < MAX_RETRIES && !updateSuccess; attempt++) {
    // Add random delay to reduce collision probability
    if (attempt > 0) {
      const delay = Math.random() * 1000 + 500; // 500-1500ms random delay
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    const { data: project } = await adminClient
      .from('projects')
      .select('prompts')
      .eq('id', prediction.project_id)
      .single();

    if (!project) {
      console.error(`Project ${prediction.project_id} not found`);
      break;
    }

    const prompts = (project.prompts as any[]) || [];
    
    if (!prompts[sceneIndex]) {
      console.error(`Scene index ${sceneIndex} not found in prompts`);
      break;
    }

    // Check if already updated by another webhook
    if (prompts[sceneIndex].imageUrl === imageUrl) {
      console.log(`Scene ${sceneIndex + 1} already has this image URL`);
      updateSuccess = true;
      break;
    }

    const updatedPrompts = [...prompts];
    updatedPrompts[sceneIndex] = { ...updatedPrompts[sceneIndex], imageUrl };

    const { error: updateError } = await adminClient
      .from('projects')
      .update({ prompts: updatedPrompts })
      .eq('id', prediction.project_id);

    if (!updateError) {
      console.log(`Updated scene ${sceneIndex + 1} with image URL (attempt ${attempt + 1})`);
      updateSuccess = true;
    } else {
      console.warn(`Update attempt ${attempt + 1} failed for scene ${sceneIndex + 1}:`, updateError);
    }
  }
  
  if (!updateSuccess) {
    console.error(`Failed to update scene ${sceneIndex + 1} after ${MAX_RETRIES} attempts`);
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

async function checkJobCompletion(adminClient: any, jobId: string) {
  if (!jobId) return;

  // Get all predictions for this job
  const { data: predictions } = await adminClient
    .from('pending_predictions')
    .select('id, status, result_url, prediction_type, thumbnail_index, metadata')
    .eq('job_id', jobId);

  if (!predictions || predictions.length === 0) {
    return;
  }

  const allCompleted = predictions.every((p: any) => p.status === 'completed' || p.status === 'failed');
  
  if (!allCompleted) {
    console.log(`Job ${jobId}: ${predictions.filter((p: any) => p.status === 'completed').length}/${predictions.length} completed`);
    return;
  }

  console.log(`All predictions for job ${jobId} are complete`);

  // Get job info - check if already completed to prevent race conditions
  const { data: job } = await adminClient
    .from('generation_jobs')
    .select('job_type, project_id, user_id, metadata, status')
    .eq('id', jobId)
    .single();

  if (!job) return;

  // IMPORTANT: Prevent duplicate processing if job is already completed
  if (job.status === 'completed') {
    console.log(`Job ${jobId} already marked as completed, skipping duplicate processing`);
    return;
  }

  // Mark job as completed FIRST (atomically) to prevent race conditions
  const { error: updateError, count } = await adminClient
    .from('generation_jobs')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString()
    })
    .eq('id', jobId)
    .eq('status', 'processing'); // Only update if still processing

  // If no rows were updated, another webhook already completed this job
  if (updateError || count === 0) {
    console.log(`Job ${jobId} was already completed by another webhook, skipping`);
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
      // Get preset name from job metadata
      const presetName = job.metadata?.presetName || null;
      
      const { error: saveError } = await adminClient
        .from('generated_thumbnails')
        .insert({
          project_id: job.project_id,
          user_id: job.user_id,
          thumbnail_urls: thumbnailPredictions.map((p: any) => p.result_url),
          prompts: thumbnailPredictions.map((p: any) => p.metadata?.prompt || ''),
          preset_name: presetName,
        });

      if (saveError) {
        console.error("Error saving thumbnails to history:", saveError);
      } else {
        console.log(`Saved ${thumbnailPredictions.length} thumbnails to history (preset: ${presetName || 'none'})`);
      }
    }
  }

  console.log(`Job ${jobId} marked as completed. Success: ${successfulPredictions.length}, Failed: ${failedCount}`);

  // Auto-repair any missing images due to race conditions
  if (job.job_type === 'images') {
    console.log(`Running repair-missing-images for project ${job.project_id}`);
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    try {
      const repairResponse = await fetch(`${supabaseUrl}/functions/v1/repair-missing-images`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceRoleKey}`
        },
        body: JSON.stringify({ projectId: job.project_id })
      });
      
      if (repairResponse.ok) {
        const repairResult = await repairResponse.json();
        console.log(`Repair result: ${repairResult.repaired} images repaired, ${repairResult.stillMissing} still missing`);
      }
    } catch (repairError) {
      console.error("Error calling repair-missing-images:", repairError);
    }
  }

  // Handle semi-auto mode chaining
  const metadata = job.metadata || {};
  if (metadata.semiAutoMode === true) {
    // If there are failed predictions for images job, automatically retry them
    if (failedCount > 0 && job.job_type === 'images') {
      const retryCount = metadata.retryCount || 0;
      const maxRetries = 3;
      
      if (retryCount < maxRetries) {
        console.log(`Job ${jobId}: ${failedCount} failed images - auto-creating retry job (attempt ${retryCount + 1}/${maxRetries})`);
        
        // Create a retry job for failed images
        const { data: retryJob, error: retryError } = await adminClient
          .from('generation_jobs')
          .insert({
            project_id: job.project_id,
            user_id: job.user_id,
            job_type: 'images',
            status: 'pending',
            progress: 0,
            total: failedCount,
            metadata: {
              ...metadata,
              skipExisting: true,
              isRetry: true,
              retryCount: retryCount + 1,
              originalJobId: jobId
            }
          })
          .select()
          .single();
        
        if (retryError) {
          console.error("Error creating retry job:", retryError);
        } else {
          console.log(`Created retry job ${retryJob.id} for ${failedCount} failed images`);
          
          // Use EdgeRuntime.waitUntil to ensure retry starts even after webhook response
          const startRetryJob = async () => {
            const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
            const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
            
            const MAX_START_RETRIES = 5;
            const START_RETRY_DELAYS = [5000, 10000, 20000, 30000, 60000];
            
            for (let attempt = 0; attempt < MAX_START_RETRIES; attempt++) {
              if (attempt > 0) {
                const delay = START_RETRY_DELAYS[attempt - 1] || 60000;
                console.log(`Retry job start attempt ${attempt + 1}/${MAX_START_RETRIES}, waiting ${delay/1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delay));
              }
              
              try {
                const response = await fetch(`${supabaseUrl}/functions/v1/start-generation-job`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${serviceRoleKey}`
                  },
                  body: JSON.stringify({
                    jobId: retryJob.id,
                    projectId: job.project_id,
                    userId: job.user_id,
                    jobType: 'images',
                    skipExisting: true,
                    semiAutoMode: true,
                    useWebhook: true
                  })
                });
                
                if (response.ok) {
                  console.log(`Triggered retry job processing successfully on attempt ${attempt + 1}`);
                  return; // Success, exit
                } else {
                  const errorText = await response.text();
                  console.error(`Retry job trigger attempt ${attempt + 1} failed with status ${response.status}:`, errorText);
                }
              } catch (fetchError) {
                console.error(`Retry job trigger attempt ${attempt + 1} network error:`, fetchError);
              }
            }
            
            // All attempts failed
            console.error(`Failed to start retry job after ${MAX_START_RETRIES} attempts`);
            await adminClient
              .from('generation_jobs')
              .update({
                status: 'failed',
                error_message: `Failed to start after ${MAX_START_RETRIES} attempts - please retry manually`
              })
              .eq('id', retryJob.id);
          };
          
          // Run in background so webhook can respond quickly
          EdgeRuntime.waitUntil(startRetryJob());
        }
      } else {
        console.log(`Job ${jobId}: Max retries (${maxRetries}) reached. ${failedCount} images still failed. Moving to next step.`);
        await chainNextJobFromWebhook(adminClient, job.project_id, job.user_id, job.job_type, metadata);
      }
    } else if (failedCount > 0 && job.job_type === 'thumbnails') {
      // For thumbnails, just log and don't retry (less critical)
      console.log(`Job ${jobId}: ${failedCount} failed thumbnails - not retrying`);
    } else {
      // No failures, chain to next step
      await chainNextJobFromWebhook(adminClient, job.project_id, job.user_id, job.job_type, metadata);
    }
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
    total = prompts.filter((p: any) => p && !p.imageUrl).length;
    
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
