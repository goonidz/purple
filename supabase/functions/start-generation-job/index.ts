import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Declare EdgeRuntime for Supabase Edge Functions
declare const EdgeRuntime: {
  waitUntil: (promise: Promise<any>) => void;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface JobRequest {
  projectId: string;
  jobType: 'transcription' | 'prompts' | 'images' | 'thumbnails' | 'test_images' | 'single_prompt' | 'single_image';
  metadata?: Record<string, any>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { projectId, jobType, metadata = {} } = await req.json() as JobRequest;

    if (!projectId || !jobType) {
      return new Response(
        JSON.stringify({ error: "projectId and jobType are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use service role client for admin operations
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Check if there's already an active job of this type for this project
    // For single_prompt and single_image, allow multiple jobs but not for the same scene
    let existingJobQuery = adminClient
      .from('generation_jobs')
      .select('id, status, metadata')
      .eq('project_id', projectId)
      .eq('job_type', jobType)
      .in('status', ['pending', 'processing']);

    const { data: existingJobs } = await existingJobQuery;

    if (existingJobs && existingJobs.length > 0) {
      // For single jobs, check if the same scene is already being processed
      if (jobType === 'single_prompt' || jobType === 'single_image') {
        const sceneIndex = metadata.sceneIndex;
        const sameSceneJob = existingJobs.find(
          (j: any) => j.metadata?.sceneIndex === sceneIndex
        );
        if (sameSceneJob) {
          return new Response(
            JSON.stringify({ 
              error: "Cette scène est déjà en cours de génération",
              existingJobId: sameSceneJob.id 
            }),
            { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        // Allow multiple single jobs for different scenes
      } else {
        // For other job types, block if any is running
        return new Response(
          JSON.stringify({ 
            error: "A job of this type is already running for this project",
            existingJobId: existingJobs[0].id 
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Get project data to determine total items
    const { data: project, error: projectError } = await adminClient
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single();

    if (projectError || !project) {
      return new Response(
        JSON.stringify({ error: "Project not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate total based on job type
    let total = 0;
    if (jobType === 'prompts' || jobType === 'images') {
      const scenes = (project.scenes as any[]) || [];
      const prompts = (project.prompts as any[]) || [];
      
      if (jobType === 'prompts') {
        total = scenes.length;
      } else if (jobType === 'images') {
        // Count prompts that need images
        total = metadata.skipExisting 
          ? prompts.filter((p: any) => p && !p.imageUrl).length
          : prompts.length;
      }
    } else if (jobType === 'transcription') {
      total = 1; // Single transcription task
    } else if (jobType === 'test_images') {
      const scenes = (project.scenes as any[]) || [];
      total = Math.min(scenes.length, 2); // Test first 2 scenes
    } else if (jobType === 'single_prompt' || jobType === 'single_image') {
      total = 1; // Single item
    }

    // Create the job record
    const { data: job, error: jobError } = await adminClient
      .from('generation_jobs')
      .insert({
        project_id: projectId,
        user_id: user.id,
        job_type: jobType,
        status: 'pending',
        progress: 0,
        total,
        metadata: {
          ...metadata,
          started_at: new Date().toISOString(),
        }
      })
      .select()
      .single();

    if (jobError) {
      console.error("Error creating job:", jobError);
      return new Response(
        JSON.stringify({ error: "Failed to create job" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Created job ${job.id} for ${jobType} on project ${projectId}`);

    // Start the background processing
    EdgeRuntime.waitUntil(processJob(job.id, projectId, jobType, user.id, metadata, authHeader));

    // Return immediately with job ID
    return new Response(
      JSON.stringify({ 
        jobId: job.id, 
        status: 'pending',
        total 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in start-generation-job:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function processJob(
  jobId: string, 
  projectId: string, 
  jobType: string,
  userId: string,
  metadata: Record<string, any>,
  authHeader: string
) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const adminClient = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Update job status to processing
    await adminClient
      .from('generation_jobs')
      .update({ status: 'processing' })
      .eq('id', jobId);

    console.log(`Job ${jobId} started processing`);

    if (jobType === 'prompts') {
      await processPromptsJob(jobId, projectId, userId, metadata, authHeader, adminClient);
    } else if (jobType === 'images') {
      await processImagesJob(jobId, projectId, userId, metadata, authHeader, adminClient);
    } else if (jobType === 'transcription') {
      await processTranscriptionJob(jobId, projectId, userId, metadata, authHeader, adminClient);
    } else if (jobType === 'test_images') {
      await processTestImagesJob(jobId, projectId, userId, metadata, authHeader, adminClient);
    } else if (jobType === 'single_prompt') {
      await processSinglePromptJob(jobId, projectId, userId, metadata, authHeader, adminClient);
    } else if (jobType === 'single_image') {
      await processSingleImageJob(jobId, projectId, userId, metadata, authHeader, adminClient);
    }

    // Mark job as completed
    await adminClient
      .from('generation_jobs')
      .update({ 
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('id', jobId);

    console.log(`Job ${jobId} completed successfully`);

  } catch (error) {
    console.error(`Job ${jobId} failed:`, error);
    
    await adminClient
      .from('generation_jobs')
      .update({ 
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
        completed_at: new Date().toISOString()
      })
      .eq('id', jobId);
  }
}

async function processPromptsJob(
  jobId: string,
  projectId: string,
  userId: string,
  metadata: Record<string, any>,
  authHeader: string,
  adminClient: any
) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  
  // Get project data
  const { data: project } = await adminClient
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single();

  if (!project) throw new Error("Project not found");

  const scenes = (project.scenes as any[]) || [];
  const existingPrompts = (project.prompts as any[]) || [];
  const examplePrompts = (project.example_prompts as string[]) || [];
  const customSystemPrompt = project.prompt_system_message || undefined;

  // Get or generate summary
  let summary = project.summary;
  if (!summary) {
    const transcriptData = project.transcript_json as any;
    const fullTranscript = transcriptData?.segments?.filter((seg: any) => seg).map((seg: any) => seg.text).join(' ') || '';
    
    const summaryResponse = await fetch(`${supabaseUrl}/functions/v1/generate-summary`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transcript: fullTranscript }),
    });

    if (summaryResponse.ok) {
      const summaryData = await summaryResponse.json();
      summary = summaryData.summary;
      
      await adminClient
        .from('projects')
        .update({ summary })
        .eq('id', projectId);
    }
  }

  const filteredExamples = examplePrompts.filter((p: string) => p.trim() !== "");
  const newPrompts = [...existingPrompts];
  
  // Ensure array has correct length
  while (newPrompts.length < scenes.length) {
    newPrompts.push(null);
  }

  // Process in batches of 10 (parallel)
  const batchSize = 10;
  let progress = 0;

  for (let batchStart = 0; batchStart < scenes.length; batchStart += batchSize) {
    const batch = scenes.slice(batchStart, batchStart + batchSize);
    
    const batchPromises = batch.map(async (scene: any, batchIndex: number) => {
      const sceneIndex = batchStart + batchIndex;
      
      // Skip if prompt already exists
      if (newPrompts[sceneIndex]?.prompt && !metadata.regenerate) {
        return;
      }

      // Get previous prompts for context
      const previousPrompts = newPrompts
        .slice(Math.max(0, sceneIndex - 3), sceneIndex)
        .filter((p: any) => p?.prompt && p.prompt !== "Erreur lors de la génération")
        .map((p: any) => p.prompt);

      try {
        const response = await fetch(`${supabaseUrl}/functions/v1/generate-prompts`, {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            scene: scene.text,
            summary,
            examplePrompts: filteredExamples,
            sceneIndex: sceneIndex + 1,
            totalScenes: scenes.length,
            startTime: scene.startTime,
            endTime: scene.endTime,
            customSystemPrompt,
            previousPrompts
          }),
        });

        if (response.ok) {
          const data = await response.json();
          newPrompts[sceneIndex] = {
            scene: `Scène ${sceneIndex + 1}`,
            prompt: data.prompt,
            text: scene.text,
            startTime: scene.startTime,
            endTime: scene.endTime,
            duration: scene.endTime - scene.startTime,
            imageUrl: newPrompts[sceneIndex]?.imageUrl // Preserve existing image
          };
        }
      } catch (error) {
        console.error(`Error generating prompt for scene ${sceneIndex + 1}:`, error);
      }
    });

    await Promise.all(batchPromises);

    // Update progress
    progress = Math.min(batchStart + batchSize, scenes.length);
    
    await adminClient
      .from('generation_jobs')
      .update({ progress })
      .eq('id', jobId);

    // Save prompts after each batch
    await adminClient
      .from('projects')
      .update({ prompts: newPrompts })
      .eq('id', projectId);
  }
}

async function processImagesJob(
  jobId: string,
  projectId: string,
  userId: string,
  metadata: Record<string, any>,
  authHeader: string,
  adminClient: any
) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  
  // Get project data
  const { data: project } = await adminClient
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single();

  if (!project) throw new Error("Project not found");

  const prompts = (project.prompts as any[]) || [];
  const imageWidth = project.image_width || 1920;
  const imageHeight = project.image_height || 1080;
  const imageModel = project.image_model || 'seedream-4.5';
  
  // Parse style references
  let styleReferenceUrls: string[] = [];
  if (project.style_reference_url) {
    try {
      styleReferenceUrls = JSON.parse(project.style_reference_url);
    } catch {
      if (project.style_reference_url) {
        styleReferenceUrls = [project.style_reference_url];
      }
    }
  }

  // Filter prompts that need images
  const skipExisting = metadata.skipExisting !== false;
  const promptsToProcess = prompts
    .map((prompt: any, index: number) => ({ prompt, index }))
    .filter(({ prompt }: any) => prompt && (!skipExisting || !prompt.imageUrl));

  let progress = 0;
  const updatedPrompts = [...prompts];

  // Process in batches of 20 for images (to respect rate limits)
  const batchSize = 20;

  for (let batchStart = 0; batchStart < promptsToProcess.length; batchStart += batchSize) {
    const batch = promptsToProcess.slice(batchStart, batchStart + batchSize);

    const batchPromises = batch.map(async ({ prompt, index }: any) => {
      try {
        const requestBody: any = {
          prompt: prompt.prompt,
          width: imageWidth,
          height: imageHeight,
          model: imageModel,
          async: true
        };

        if (styleReferenceUrls.length > 0) {
          requestBody.image_urls = styleReferenceUrls;
        }

        // Start async generation
        const startResponse = await fetch(`${supabaseUrl}/functions/v1/generate-image-seedream`, {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (!startResponse.ok) {
          throw new Error(`Failed to start generation: ${startResponse.status}`);
        }

        const startData = await startResponse.json();
        const predictionId = startData.predictionId;

        if (!predictionId) {
          throw new Error("No prediction ID returned");
        }

        // Poll for completion
        let imageUrl = null;
        const maxWaitMs = 300000; // 5 minutes
        const pollIntervalMs = 3000;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitMs) {
          await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

          const statusResponse = await fetch(`${supabaseUrl}/functions/v1/generate-image-seedream`, {
            method: 'POST',
            headers: {
              'Authorization': authHeader,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ predictionId }),
          });

          if (!statusResponse.ok) continue;

          const statusData = await statusResponse.json();

          if (statusData.status === 'succeeded') {
            const output = Array.isArray(statusData.output) ? statusData.output[0] : statusData.output;
            if (output) {
              // Download and upload to Supabase storage
              const imageResponse = await fetch(output);
              if (imageResponse.ok) {
                const blob = await imageResponse.blob();
                const timestamp = Date.now();
                const filename = `${projectId}/scene_${index + 1}_${timestamp}.jpg`;

                const { error: uploadError } = await adminClient.storage
                  .from('generated-images')
                  .upload(filename, blob, {
                    contentType: 'image/jpeg',
                    upsert: true
                  });

                if (!uploadError) {
                  const { data: { publicUrl } } = adminClient.storage
                    .from('generated-images')
                    .getPublicUrl(filename);
                  
                  imageUrl = publicUrl;
                }
              }
            }
            break;
          }

          if (statusData.status === 'failed' || statusData.status === 'canceled') {
            throw new Error(`Generation ${statusData.status}`);
          }
        }

        if (imageUrl) {
          updatedPrompts[index] = { ...updatedPrompts[index], imageUrl };
        }

      } catch (error) {
        console.error(`Error generating image for scene ${index + 1}:`, error);
      }
    });

    await Promise.all(batchPromises);

    // Update progress
    progress = Math.min(batchStart + batchSize, promptsToProcess.length);
    
    await adminClient
      .from('generation_jobs')
      .update({ progress })
      .eq('id', jobId);

    // Save prompts after each batch
    await adminClient
      .from('projects')
      .update({ prompts: updatedPrompts })
      .eq('id', projectId);
  }
}

async function processTranscriptionJob(
  jobId: string,
  projectId: string,
  userId: string,
  metadata: Record<string, any>,
  authHeader: string,
  adminClient: any
) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const audioUrl = metadata.audioUrl;

  if (!audioUrl) {
    throw new Error("Audio URL is required for transcription");
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/transcribe-audio`, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ audioUrl }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Transcription failed: ${errorText}`);
  }

  const transcriptData = await response.json();

  // Save transcript to project
  await adminClient
    .from('projects')
    .update({ 
      transcript_json: transcriptData,
      audio_url: audioUrl
    })
    .eq('id', projectId);

  // Update progress
  await adminClient
    .from('generation_jobs')
    .update({ progress: 1 })
    .eq('id', jobId);
}

async function processTestImagesJob(
  jobId: string,
  projectId: string,
  userId: string,
  metadata: Record<string, any>,
  authHeader: string,
  adminClient: any
) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  
  // Get project data
  const { data: project } = await adminClient
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single();

  if (!project) throw new Error("Project not found");

  const scenes = (project.scenes as any[]) || [];
  const transcriptData = project.transcript_json as any;
  const examplePrompts = (project.example_prompts as string[]) || [];
  const customSystemPrompt = project.prompt_system_message || undefined;
  const imageWidth = project.image_width || 1920;
  const imageHeight = project.image_height || 1080;
  const imageModel = project.image_model || 'seedream-4.5';
  
  // Parse style references
  let styleReferenceUrls: string[] = [];
  if (project.style_reference_url) {
    try {
      styleReferenceUrls = JSON.parse(project.style_reference_url);
    } catch {
      if (project.style_reference_url) {
        styleReferenceUrls = [project.style_reference_url];
      }
    }
  }

  const scenesToTest = scenes.slice(0, 2);
  const sceneCount = scenesToTest.length;

  if (sceneCount === 0) {
    throw new Error("No scenes to test");
  }

  // Step 1: Generate summary if needed
  let summary = project.summary;
  if (!summary) {
    const fullTranscript = transcriptData?.segments?.filter((seg: any) => seg).map((seg: any) => seg.text).join(' ') || '';
    
    const summaryResponse = await fetch(`${supabaseUrl}/functions/v1/generate-summary`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transcript: fullTranscript }),
    });

    if (summaryResponse.ok) {
      const summaryData = await summaryResponse.json();
      summary = summaryData.summary;
      
      await adminClient
        .from('projects')
        .update({ summary })
        .eq('id', projectId);
    }
  }

  const filteredExamples = examplePrompts.filter((p: string) => p.trim() !== "");

  interface TestPrompt {
    index: number;
    scene: string;
    prompt: string;
    text: string;
    startTime: number;
    endTime: number;
    duration: number;
    imageUrl?: string;
  }

  // Step 2: Generate prompts for first 2 scenes IN PARALLEL
  const promptPromises = scenesToTest.map(async (scene: any, i: number): Promise<TestPrompt> => {
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/generate-prompts`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scene: scene.text,
          summary,
          examplePrompts: filteredExamples,
          sceneIndex: i + 1,
          totalScenes: scenes.length,
          startTime: scene.startTime,
          endTime: scene.endTime,
          customSystemPrompt,
          previousPrompts: []
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return {
          index: i,
          scene: `Scène ${i + 1}`,
          prompt: data.prompt,
          text: scene.text,
          startTime: scene.startTime,
          endTime: scene.endTime,
          duration: scene.endTime - scene.startTime
        };
      } else {
        return {
          index: i,
          scene: `Scène ${i + 1}`,
          prompt: "Erreur lors de la génération",
          text: scene.text,
          startTime: scene.startTime,
          endTime: scene.endTime,
          duration: scene.endTime - scene.startTime
        };
      }
    } catch (error) {
      console.error(`Error generating prompt for scene ${i + 1}:`, error);
      return {
        index: i,
        scene: `Scène ${i + 1}`,
        prompt: "Erreur lors de la génération",
        text: scene.text,
        startTime: scene.startTime,
        endTime: scene.endTime,
        duration: scene.endTime - scene.startTime
      };
    }
  });

  const promptResults = await Promise.all(promptPromises);
  const prompts: TestPrompt[] = promptResults.sort((a, b) => a.index - b.index);

  // Save prompts to project
  await adminClient
    .from('projects')
    .update({ prompts })
    .eq('id', projectId);

  // Update progress (halfway done)
  await adminClient
    .from('generation_jobs')
    .update({ progress: 1 })
    .eq('id', jobId);

  // Step 3: Generate images for the prompts IN PARALLEL
  const validPrompts = prompts.filter(p => p.prompt && p.prompt !== "Erreur lors de la génération");

  const imagePromises = validPrompts.map(async (prompt: any) => {
    const i = prompt.index;
    try {
      const requestBody: any = {
        prompt: prompt.prompt,
        width: imageWidth,
        height: imageHeight,
        model: imageModel,
        async: true
      };

      if (styleReferenceUrls.length > 0) {
        requestBody.image_urls = styleReferenceUrls;
      }

      // Start async generation
      const startResponse = await fetch(`${supabaseUrl}/functions/v1/generate-image-seedream`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!startResponse.ok) {
        throw new Error(`Failed to start generation: ${startResponse.status}`);
      }

      const startData = await startResponse.json();
      const predictionId = startData.predictionId;

      if (!predictionId) {
        throw new Error("No prediction ID returned");
      }

      // Poll for completion
      let imageUrl = null;
      const maxWaitMs = 300000; // 5 minutes
      const pollIntervalMs = 3000;
      const startTime = Date.now();

      while (Date.now() - startTime < maxWaitMs) {
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

        const statusResponse = await fetch(`${supabaseUrl}/functions/v1/generate-image-seedream`, {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ predictionId }),
        });

        if (!statusResponse.ok) continue;

        const statusData = await statusResponse.json();

        if (statusData.status === 'succeeded') {
          const output = Array.isArray(statusData.output) ? statusData.output[0] : statusData.output;
          if (output) {
            // Download and upload to Supabase storage
            const imageResponse = await fetch(output);
            if (imageResponse.ok) {
              const blob = await imageResponse.blob();
              const timestamp = Date.now();
              const filename = `${projectId}/scene_${i + 1}_${timestamp}.jpg`;

              const { error: uploadError } = await adminClient.storage
                .from('generated-images')
                .upload(filename, blob, {
                  contentType: 'image/jpeg',
                  upsert: true
                });

              if (!uploadError) {
                const { data: { publicUrl } } = adminClient.storage
                  .from('generated-images')
                  .getPublicUrl(filename);
                
                imageUrl = publicUrl;
              }
            }
          }
          break;
        }

        if (statusData.status === 'failed' || statusData.status === 'canceled') {
          throw new Error(`Generation ${statusData.status}`);
        }
      }

      return { index: i, imageUrl };
    } catch (error) {
      console.error(`Error generating image for scene ${i + 1}:`, error);
      return { index: i, imageUrl: null };
    }
  });

  const imageResults = await Promise.all(imagePromises);

  // Update prompts with image URLs
  for (const result of imageResults) {
    if (result.imageUrl) {
      prompts[result.index] = { ...prompts[result.index], imageUrl: result.imageUrl };
    }
  }

  // Save final prompts to project
  await adminClient
    .from('projects')
    .update({ prompts })
    .eq('id', projectId);

  // Update progress to complete
  await adminClient
    .from('generation_jobs')
    .update({ progress: sceneCount })
    .eq('id', jobId);
}

async function processSinglePromptJob(
  jobId: string,
  projectId: string,
  userId: string,
  metadata: Record<string, any>,
  authHeader: string,
  adminClient: any
) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const sceneIndex = metadata.sceneIndex as number;

  if (sceneIndex === undefined || sceneIndex === null) {
    throw new Error("sceneIndex is required in metadata");
  }

  // Get project data
  const { data: project } = await adminClient
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single();

  if (!project) throw new Error("Project not found");

  const scenes = (project.scenes as any[]) || [];
  const existingPrompts = (project.prompts as any[]) || [];
  const examplePrompts = (project.example_prompts as string[]) || [];
  const customSystemPrompt = project.prompt_system_message || undefined;

  if (sceneIndex >= scenes.length) {
    throw new Error(`Scene index ${sceneIndex} out of bounds`);
  }

  const scene = scenes[sceneIndex];

  // Get or generate summary
  let summary = project.summary;
  if (!summary) {
    const transcriptData = project.transcript_json as any;
    const fullTranscript = transcriptData?.segments?.filter((seg: any) => seg).map((seg: any) => seg.text).join(' ') || '';
    
    const summaryResponse = await fetch(`${supabaseUrl}/functions/v1/generate-summary`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transcript: fullTranscript }),
    });

    if (summaryResponse.ok) {
      const summaryData = await summaryResponse.json();
      summary = summaryData.summary;
      
      await adminClient
        .from('projects')
        .update({ summary })
        .eq('id', projectId);
    }
  }

  const filteredExamples = examplePrompts.filter((p: string) => p.trim() !== "");

  // Get previous prompts for context
  const previousPrompts = existingPrompts
    .slice(Math.max(0, sceneIndex - 3), sceneIndex)
    .filter((p: any) => p?.prompt && p.prompt !== "Erreur lors de la génération")
    .map((p: any) => p.prompt);

  // Generate the prompt
  const response = await fetch(`${supabaseUrl}/functions/v1/generate-prompts`, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      scene: scene.text,
      summary,
      examplePrompts: filteredExamples,
      sceneIndex: sceneIndex + 1,
      totalScenes: scenes.length,
      startTime: scene.startTime,
      endTime: scene.endTime,
      customSystemPrompt,
      previousPrompts
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to generate prompt: ${response.status}`);
  }

  const data = await response.json();
  const newPrompt = data.prompt;
  
  if (!newPrompt) {
    throw new Error("No prompt returned from generate-prompts");
  }

  console.log(`Single prompt job: received prompt for scene ${sceneIndex + 1}`);

  // Re-fetch project to get latest prompts (avoid race conditions)
  const { data: latestProject, error: refetchError } = await adminClient
    .from('projects')
    .select('prompts')
    .eq('id', projectId)
    .single();

  if (refetchError) {
    throw new Error(`Failed to refetch project: ${refetchError.message}`);
  }

  const latestPrompts = (latestProject.prompts as any[]) || [];

  // Update the prompts array
  const updatedPrompts = [...latestPrompts];
  while (updatedPrompts.length <= sceneIndex) {
    updatedPrompts.push(null);
  }

  updatedPrompts[sceneIndex] = {
    scene: `Scène ${sceneIndex + 1}`,
    prompt: newPrompt,
    text: scene.text,
    startTime: scene.startTime,
    endTime: scene.endTime,
    duration: scene.endTime - scene.startTime,
    imageUrl: latestPrompts[sceneIndex]?.imageUrl // Preserve existing image
  };

  // Save prompts to project with explicit await
  const { data: updateResult, error: updateError } = await adminClient
    .from('projects')
    .update({ prompts: updatedPrompts })
    .eq('id', projectId)
    .select('id');

  if (updateError) {
    throw new Error(`Failed to save prompts: ${updateError.message}`);
  }

  if (!updateResult || updateResult.length === 0) {
    throw new Error("Update returned no result - project may not exist");
  }

  console.log(`Single prompt job: prompts saved for scene ${sceneIndex + 1}`);

  // Update progress
  await adminClient
    .from('generation_jobs')
    .update({ progress: 1 })
    .eq('id', jobId);
}

async function processSingleImageJob(
  jobId: string,
  projectId: string,
  userId: string,
  metadata: Record<string, any>,
  authHeader: string,
  adminClient: any
) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const sceneIndex = metadata.sceneIndex as number;

  if (sceneIndex === undefined || sceneIndex === null) {
    throw new Error("sceneIndex is required in metadata");
  }

  // Get project data
  const { data: project } = await adminClient
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single();

  if (!project) throw new Error("Project not found");

  const prompts = (project.prompts as any[]) || [];
  const imageWidth = project.image_width || 1920;
  const imageHeight = project.image_height || 1080;
  const imageModel = project.image_model || 'seedream-4.5';

  if (sceneIndex >= prompts.length || !prompts[sceneIndex]) {
    throw new Error(`Prompt at index ${sceneIndex} not found`);
  }

  const prompt = prompts[sceneIndex];
  if (!prompt.prompt || prompt.prompt === "Erreur lors de la génération") {
    throw new Error("No valid prompt for this scene");
  }

  // Parse style references
  let styleReferenceUrls: string[] = [];
  if (project.style_reference_url) {
    try {
      styleReferenceUrls = JSON.parse(project.style_reference_url);
    } catch {
      if (project.style_reference_url) {
        styleReferenceUrls = [project.style_reference_url];
      }
    }
  }

  const requestBody: any = {
    prompt: prompt.prompt,
    width: imageWidth,
    height: imageHeight,
    model: imageModel,
    async: true
  };

  if (styleReferenceUrls.length > 0) {
    requestBody.image_urls = styleReferenceUrls;
  }

  // Start async generation
  const startResponse = await fetch(`${supabaseUrl}/functions/v1/generate-image-seedream`, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!startResponse.ok) {
    throw new Error(`Failed to start generation: ${startResponse.status}`);
  }

  const startData = await startResponse.json();
  const predictionId = startData.predictionId;

  if (!predictionId) {
    throw new Error("No prediction ID returned");
  }

  // Poll for completion
  let imageUrl = null;
  const maxWaitMs = 300000; // 5 minutes
  const pollIntervalMs = 3000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

    const statusResponse = await fetch(`${supabaseUrl}/functions/v1/generate-image-seedream`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ predictionId }),
    });

    if (!statusResponse.ok) continue;

    const statusData = await statusResponse.json();

    if (statusData.status === 'succeeded') {
      const output = Array.isArray(statusData.output) ? statusData.output[0] : statusData.output;
      if (output) {
        // Download and upload to Supabase storage
        const imageResponse = await fetch(output);
        if (imageResponse.ok) {
          const blob = await imageResponse.blob();
          const timestamp = Date.now();
          const filename = `${projectId}/scene_${sceneIndex + 1}_${timestamp}.jpg`;

          const { error: uploadError } = await adminClient.storage
            .from('generated-images')
            .upload(filename, blob, {
              contentType: 'image/jpeg',
              upsert: true
            });

          if (!uploadError) {
            const { data: { publicUrl } } = adminClient.storage
              .from('generated-images')
              .getPublicUrl(filename);
            
            imageUrl = publicUrl;
          }
        }
      }
      break;
    }

    if (statusData.status === 'failed' || statusData.status === 'canceled') {
      throw new Error(`Generation ${statusData.status}`);
    }
  }

  if (!imageUrl) {
    throw new Error("Image generation timed out or failed");
  }

  // Update the prompts array with the new image
  const updatedPrompts = [...prompts];
  updatedPrompts[sceneIndex] = { ...updatedPrompts[sceneIndex], imageUrl };

  // Save prompts to project
  await adminClient
    .from('projects')
    .update({ prompts: updatedPrompts })
    .eq('id', projectId);

  // Update progress
  await adminClient
    .from('generation_jobs')
    .update({ progress: 1 })
    .eq('id', jobId);
}
