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
  jobType: 'transcription' | 'prompts' | 'images' | 'thumbnails' | 'test_images' | 'single_prompt' | 'single_image' | 'script_generation' | 'audio_generation';
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

    const body = await req.json();
    const { projectId, jobType, metadata = {}, jobId: existingJobId, userId: bodyUserId } = body as JobRequest & { jobId?: string; userId?: string };

    // Check if this is an internal call from webhook (using service role key)
    const isInternalCall = authHeader === `Bearer ${supabaseServiceKey}`;
    
    let userId: string;
    
    if (isInternalCall) {
      // Internal call from webhook - use userId from body
      if (!bodyUserId) {
        return new Response(JSON.stringify({ error: 'userId required for internal calls' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      userId = bodyUserId;
      console.log(`Internal call for job ${existingJobId || 'new'}, user ${userId}`);
    } else {
      // Normal user call - authenticate
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
      userId = user.id;
    }

    // Allow null projectId for standalone jobs (like standalone thumbnails)
    const isStandaloneRequest = metadata?.standalone === true;
    if ((!projectId && !isStandaloneRequest) || !jobType) {
      return new Response(
        JSON.stringify({ error: "projectId and jobType are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use service role client for admin operations
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // If a jobId is provided, we're resuming an existing job (from webhook chaining)
    if (existingJobId) {
      console.log(`Resuming existing job ${existingJobId} for ${jobType}`);
      
      // Get the job
      const { data: existingJob } = await adminClient
        .from('generation_jobs')
        .select('*')
        .eq('id', existingJobId)
        .single();
      
      if (!existingJob) {
        return new Response(
          JSON.stringify({ error: "Job not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      // Merge metadata from request with job metadata
      const fullMetadata = { ...existingJob.metadata, ...metadata };
      
      // Start the background processing
      EdgeRuntime.waitUntil(processJob(existingJobId, projectId, jobType, existingJob.user_id, fullMetadata, authHeader));

      return new Response(
        JSON.stringify({ 
          jobId: existingJobId, 
          status: 'processing',
          total: existingJob.total 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if there's already an active job of this type for this project
    // For single_prompt and single_image, allow multiple jobs but not for the same scene
    let existingJobQuery = adminClient
      .from('generation_jobs')
      .select('id, status, metadata, created_at, updated_at')
      .eq('project_id', projectId)
      .eq('job_type', jobType)
      .in('status', ['pending', 'processing']);

    const { data: existingJobs } = await existingJobQuery;

    if (existingJobs && existingJobs.length > 0) {
      // Check for stale jobs (no update in last 5 minutes = likely timed out)
      const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
      const now = Date.now();
      
      const staleJobs = existingJobs.filter((job: any) => {
        const updatedAt = new Date(job.updated_at).getTime();
        return (now - updatedAt) > STALE_THRESHOLD_MS;
      });
      
      // Clean up stale jobs - mark them as failed
      if (staleJobs.length > 0) {
        console.log(`Found ${staleJobs.length} stale jobs, cleaning up...`);
        for (const staleJob of staleJobs) {
          await adminClient
            .from('generation_jobs')
            .update({ 
              status: 'failed',
              error_message: 'Job marqué comme échoué (timeout CPU probable)',
              completed_at: new Date().toISOString()
            })
            .eq('id', staleJob.id);
          console.log(`Marked stale job ${staleJob.id} as failed`);
        }
      }
      
      // Filter out stale jobs to check for active ones
      const activeJobs = existingJobs.filter((job: any) => {
        const updatedAt = new Date(job.updated_at).getTime();
        return (now - updatedAt) <= STALE_THRESHOLD_MS;
      });
      
      if (activeJobs.length > 0) {
        // For single jobs, check if the same scene is already being processed
        if (jobType === 'single_prompt' || jobType === 'single_image') {
          const sceneIndex = metadata.sceneIndex;
          const sameSceneJob = activeJobs.find(
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
              existingJobId: activeJobs[0].id 
            }),
            { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    // Check if this is a standalone thumbnail generation (no real project)
    const isStandalone = metadata.standalone === true && jobType === 'thumbnails';
    
    let project: any = null;
    
    // Only lookup project if not standalone
    if (!isStandalone) {
      const { data: projectData, error: projectError } = await adminClient
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .single();

      if (projectError || !projectData) {
        return new Response(
          JSON.stringify({ error: "Project not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      project = projectData;
    }

    // Calculate total based on job type
    let total = 0;
    if (jobType === 'prompts' || jobType === 'images') {
      const scenes = (project?.scenes as any[]) || [];
      const prompts = (project?.prompts as any[]) || [];
      
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
      const scenes = (project?.scenes as any[]) || [];
      total = Math.min(scenes.length, 2); // Test first 2 scenes
    } else if (jobType === 'single_prompt' || jobType === 'single_image') {
      total = 1; // Single item
    } else if (jobType === 'thumbnails') {
      total = 3; // Always generate 3 thumbnails
    } else if (jobType === 'script_generation') {
      total = 1; // Single script generation
    } else if (jobType === 'audio_generation') {
      total = 1; // Single audio generation
    }

    // Create the job record (use null for project_id in standalone mode)
    const { data: job, error: jobError } = await adminClient
      .from('generation_jobs')
      .insert({
        project_id: isStandalone ? null : projectId,
        user_id: userId,
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
    EdgeRuntime.waitUntil(processJob(job.id, projectId, jobType, userId, metadata, authHeader));

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
    } else if (jobType === 'thumbnails') {
      await processThumbnailsJob(jobId, projectId, userId, metadata, authHeader, adminClient);
    } else if (jobType === 'script_generation') {
      await processScriptGenerationJob(jobId, projectId, userId, metadata, authHeader, adminClient);
    } else if (jobType === 'audio_generation') {
      await processAudioGenerationJob(jobId, projectId, userId, metadata, authHeader, adminClient);
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

    // Semi-automatic mode: chain to next job
    if (metadata.semiAutoMode === true) {
      await chainNextJob(projectId, userId, jobType, authHeader, adminClient);
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Check if this is webhook mode - job should stay in processing, not fail
    if (errorMessage === 'WEBHOOK_MODE_ACTIVE') {
      console.log(`Job ${jobId} is in webhook mode - staying in processing status`);
      // Don't mark as completed or failed - webhook will handle it
      return;
    }
    
    const isCpuTimeout = errorMessage.includes('CPU') || errorMessage.includes('timeout') || errorMessage.includes('time limit') || errorMessage.includes('CPU_TIMEOUT_PREEMPTIVE');
    
    console.error(`Job ${jobId} failed:`, error);
    
    // Get current job progress before marking as failed
    const { data: currentJob } = await adminClient
      .from('generation_jobs')
      .select('progress, total, job_type')
      .eq('id', jobId)
      .single();
    
    const progress = currentJob?.progress || 0;
    const total = currentJob?.total || 0;
    const currentJobType = currentJob?.job_type || jobType;
    
    // Check if this is a CPU timeout and there's still work to do
    const hasRemainingWork = progress < total;
    const shouldContinue = isCpuTimeout && hasRemainingWork && (currentJobType === 'images' || currentJobType === 'prompts');
    
    if (shouldContinue) {
      console.log(`CPU timeout detected for job ${jobId}. Progress: ${progress}/${total}. Creating continuation job...`);
      
      // Mark current job as completed (partial success)
      await adminClient
        .from('generation_jobs')
        .update({ 
          status: 'completed',
          error_message: `CPU timeout après ${progress}/${total}. Job de continuation créé automatiquement.`,
          completed_at: new Date().toISOString()
        })
        .eq('id', jobId);
      
      // Create continuation job
      await createContinuationJob(projectId, userId, currentJobType, metadata, authHeader, adminClient);
    } else {
      // Regular failure - no continuation
      await adminClient
        .from('generation_jobs')
        .update({ 
          status: 'failed',
          error_message: errorMessage,
          completed_at: new Date().toISOString()
        })
        .eq('id', jobId);
    }
  }
}

// Create a continuation job to resume work after a timeout
async function createContinuationJob(
  projectId: string,
  userId: string,
  jobType: string,
  originalMetadata: Record<string, any>,
  authHeader: string,
  adminClient: any
) {
  try {
    // Get fresh project data
    const { data: project } = await adminClient
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single();
      
    if (!project) {
      console.error(`Project ${projectId} not found for continuation job`);
      return;
    }
    
    // Calculate remaining work
    let total = 0;
    if (jobType === 'images') {
      const prompts = (project.prompts as any[]) || [];
      total = prompts.filter((p: any) => p && !p.imageUrl).length;
    } else if (jobType === 'prompts') {
      const scenes = (project.scenes as any[]) || [];
      const prompts = (project.prompts as any[]) || [];
      // Count scenes without prompts
      total = scenes.length - prompts.filter((p: any) => p && p.text).length;
    }
    
    if (total <= 0) {
      console.log(`No remaining work for continuation job on project ${projectId}`);
      return;
    }
    
    console.log(`Creating continuation job for ${jobType}: ${total} items remaining`);
    
    // Create continuation job with skipExisting
    const { data: continuationJob, error: jobError } = await adminClient
      .from('generation_jobs')
      .insert({
        project_id: projectId,
        user_id: userId,
        job_type: jobType,
        status: 'pending',
        progress: 0,
        total,
        metadata: {
          ...originalMetadata,
          skipExisting: true,
          isContinuation: true,
          started_at: new Date().toISOString(),
        }
      })
      .select()
      .single();
      
    if (jobError) {
      console.error(`Error creating continuation job:`, jobError);
      return;
    }
    
    console.log(`Created continuation job ${continuationJob.id} for ${jobType}`);
    
    // Start the continuation job
    EdgeRuntime.waitUntil(processChainedJob(
      continuationJob.id, 
      projectId, 
      jobType, 
      userId, 
      { ...originalMetadata, skipExisting: true, isContinuation: true }, 
      authHeader, 
      adminClient
    ));
    
  } catch (error) {
    console.error(`Error creating continuation job:`, error);
  }
}

// Chain to the next job in semi-automatic mode
async function chainNextJob(
  projectId: string,
  userId: string,
  completedJobType: string,
  authHeader: string,
  adminClient: any
) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  
  let nextJobType: string | null = null;
  
  // Determine next job in the pipeline
  if (completedJobType === 'prompts') {
    nextJobType = 'images';
  } else if (completedJobType === 'images') {
    nextJobType = 'thumbnails';
  }
  // After thumbnails, the pipeline is complete
  
  if (!nextJobType) {
    console.log(`Semi-automatic pipeline completed for project ${projectId}`);
    return;
  }
  
  console.log(`Semi-automatic mode: Chaining from ${completedJobType} to ${nextJobType} for project ${projectId}`);
  
  // Get project data for the next job
  const { data: project } = await adminClient
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single();
    
  if (!project) {
    console.error(`Project ${projectId} not found for chaining`);
    return;
  }
  
  // Calculate total and prepare metadata for the next job
  let total = 0;
  let jobMetadata: Record<string, any> = {
    semiAutoMode: true,
    skipExisting: true,
    started_at: new Date().toISOString(),
  };
  
  if (nextJobType === 'images') {
    const prompts = (project.prompts as any[]) || [];
    total = prompts.filter((p: any) => p && !p.imageUrl).length;
  } else if (nextJobType === 'thumbnails') {
    total = 3; // Always 3 thumbnails
    
    // For thumbnails, we need to fetch the thumbnail preset data
    const thumbnailPresetId = project.thumbnail_preset_id;
    
    if (!thumbnailPresetId) {
      console.log(`No thumbnail preset selected for project ${projectId}. Skipping thumbnails.`);
      console.log(`Semi-automatic pipeline completed for project ${projectId} (without thumbnails)`);
      return;
    }
    
    // Fetch the thumbnail preset
    const { data: thumbnailPreset, error: presetError } = await adminClient
      .from('thumbnail_presets')
      .select('*')
      .eq('id', thumbnailPresetId)
      .single();
    
    if (presetError || !thumbnailPreset) {
      console.error(`Thumbnail preset ${thumbnailPresetId} not found. Skipping thumbnails.`);
      console.log(`Semi-automatic pipeline completed for project ${projectId} (without thumbnails)`);
      return;
    }
    
    // Build the video script from prompts
    const prompts = (project.prompts as any[]) || [];
    const videoScript = prompts.map((p: any) => p?.text || '').join(' ');
    
    // Add thumbnail-specific metadata
    jobMetadata = {
      ...jobMetadata,
      videoScript,
      videoTitle: project.name || '',
      exampleUrls: thumbnailPreset.example_urls || [],
      characterRefUrl: thumbnailPreset.character_ref_url,
      customPrompt: thumbnailPreset.custom_prompt,
      imageModel: project.image_model || 'seedream-4.5'
    };
    
    console.log(`Thumbnail preset loaded: ${thumbnailPreset.name}`);
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
    console.error(`Error creating chained job ${nextJobType}:`, jobError);
    return;
  }
  
  console.log(`Created chained job ${nextJob.id} for ${nextJobType}`);
  
  // Start processing the next job
  EdgeRuntime.waitUntil(processChainedJob(nextJob.id, projectId, nextJobType, userId, jobMetadata, authHeader, adminClient));
}

// Process a chained job (similar to processJob but reuses adminClient)
async function processChainedJob(
  jobId: string, 
  projectId: string, 
  jobType: string,
  userId: string,
  metadata: Record<string, any>,
  authHeader: string,
  adminClient: any
) {
  try {
    // Update job status to processing
    await adminClient
      .from('generation_jobs')
      .update({ status: 'processing' })
      .eq('id', jobId);

    console.log(`Chained job ${jobId} started processing`);

    if (jobType === 'images') {
      await processImagesJob(jobId, projectId, userId, metadata, authHeader, adminClient);
    } else if (jobType === 'thumbnails') {
      await processThumbnailsJob(jobId, projectId, userId, metadata, authHeader, adminClient);
    }

    // Mark job as completed
    await adminClient
      .from('generation_jobs')
      .update({ 
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('id', jobId);

    console.log(`Chained job ${jobId} completed successfully`);

    // Continue chaining if semiAutoMode
    if (metadata.semiAutoMode === true) {
      await chainNextJob(projectId, userId, jobType, authHeader, adminClient);
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Check if this is webhook mode - job should stay in processing
    if (errorMessage === 'WEBHOOK_MODE_ACTIVE') {
      console.log(`Chained job ${jobId} is in webhook mode - staying in processing status`);
      return;
    }
    
    const isCpuTimeout = errorMessage.includes('CPU') || errorMessage.includes('timeout') || errorMessage.includes('time limit') || errorMessage.includes('CPU_TIMEOUT_PREEMPTIVE');
    
    console.error(`Chained job ${jobId} failed:`, error);
    
    // Get current job progress
    const { data: currentJob } = await adminClient
      .from('generation_jobs')
      .select('progress, total, job_type')
      .eq('id', jobId)
      .single();
    
    const progress = currentJob?.progress || 0;
    const total = currentJob?.total || 0;
    const currentJobType = currentJob?.job_type || jobType;
    
    const hasRemainingWork = progress < total;
    const shouldContinue = isCpuTimeout && hasRemainingWork && (currentJobType === 'images' || currentJobType === 'prompts');
    
    if (shouldContinue) {
      console.log(`CPU timeout in chained job ${jobId}. Progress: ${progress}/${total}. Creating continuation...`);
      
      await adminClient
        .from('generation_jobs')
        .update({ 
          status: 'completed',
          error_message: `CPU timeout après ${progress}/${total}. Job de continuation créé automatiquement.`,
          completed_at: new Date().toISOString()
        })
        .eq('id', jobId);
      
      await createContinuationJob(projectId, userId, currentJobType, metadata, authHeader, adminClient);
    } else {
      await adminClient
        .from('generation_jobs')
        .update({ 
          status: 'failed',
          error_message: errorMessage,
          completed_at: new Date().toISOString()
        })
        .eq('id', jobId);
    }
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
  
  // SAFEGUARD: Prevent prompt generation if no scenes exist
  if (scenes.length === 0) {
    throw new Error("Project has no scenes. Please generate scenes first before generating prompts.");
  }
  
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

  // Process in batches of 50 (parallel) for faster generation
  const batchSize = 50;
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

  if (promptsToProcess.length === 0) {
    console.log("No images to generate");
    return;
  }

  console.log(`Starting webhook-based image generation for ${promptsToProcess.length} scenes`);

  // Build webhook URL
  const webhookUrl = `${supabaseUrl}/functions/v1/replicate-webhook`;

  // Batch settings - balanced for speed vs reliability
  // When multiple projects run in parallel, this prevents overwhelming Replicate
  const BATCH_SIZE = 4; // Send 4 images at a time (was 5)
  const DELAY_BETWEEN_BATCHES_MS = 4000; // 4 seconds between batches (was 3)
  const DELAY_BETWEEN_REQUESTS_MS = 300; // 300ms between individual requests (was 200)
  const MAX_RETRIES = 3; // Maximum retries for queue full errors
  const BASE_RETRY_DELAY_MS = 10000; // Base delay for exponential backoff (10 seconds)

  let startedCount = 0;
  let failedCount = 0;
  
  // Helper function to delay
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  
  // Process in batches
  for (let batchStart = 0; batchStart < promptsToProcess.length; batchStart += BATCH_SIZE) {
    const batch = promptsToProcess.slice(batchStart, batchStart + BATCH_SIZE);
    console.log(`Processing batch ${Math.floor(batchStart / BATCH_SIZE) + 1}/${Math.ceil(promptsToProcess.length / BATCH_SIZE)} (${batch.length} images)`);
    
    for (let i = 0; i < batch.length; i++) {
      const { prompt, index } = batch[i];
      
      try {
        const requestBody: any = {
          prompt: prompt.prompt,
          width: imageWidth,
          height: imageHeight,
          model: imageModel,
          async: true,
          webhook_url: webhookUrl,
          userId, // Required for internal service role calls
        };

        if (styleReferenceUrls.length > 0) {
          requestBody.image_urls = styleReferenceUrls;
        }

        // Retry logic with exponential backoff
        let lastError = '';
        let success = false;
        
        for (let retry = 0; retry <= MAX_RETRIES; retry++) {
          // Start async generation with webhook
          const startResponse = await fetch(`${supabaseUrl}/functions/v1/generate-image-seedream`, {
            method: 'POST',
            headers: {
              'Authorization': authHeader,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          });

          if (startResponse.ok) {
            const startData = await startResponse.json();
            const predictionId = startData.predictionId;

            if (predictionId) {
              // Save to pending_predictions table
              const { error: insertError } = await adminClient
                .from('pending_predictions')
                .insert({
                  job_id: jobId,
                  prediction_id: predictionId,
                  prediction_type: 'scene_image',
                  scene_index: index,
                  project_id: projectId,
                  user_id: userId,
                  metadata: { prompt: prompt.prompt },
                  status: 'pending'
                });

              if (!insertError) {
                startedCount++;
                console.log(`Scene ${index + 1} generation started: ${predictionId}${retry > 0 ? ` (after ${retry} retries)` : ''}`);
                success = true;
                break;
              }
            }
          }
          
          const errorText = await startResponse.text().catch(() => 'Unknown error');
          lastError = errorText;
          
          // Check if it's a queue full error - apply exponential backoff
          if (errorText.includes('Queue is full') && retry < MAX_RETRIES) {
            const retryDelay = BASE_RETRY_DELAY_MS * Math.pow(2, retry); // 15s, 30s, 60s
            console.log(`Queue full for scene ${index + 1}, retry ${retry + 1}/${MAX_RETRIES} in ${retryDelay / 1000}s...`);
            await delay(retryDelay);
          } else if (retry < MAX_RETRIES) {
            // For other errors, shorter delay
            console.log(`Error for scene ${index + 1}: ${errorText}, retry ${retry + 1}/${MAX_RETRIES} in 5s...`);
            await delay(5000);
          }
        }
        
        if (!success) {
          console.error(`Failed to start generation for scene ${index + 1} after ${MAX_RETRIES} retries: ${lastError}`);
          failedCount++;
          
          // Save as failed prediction so it can be retried later
          await adminClient
            .from('pending_predictions')
            .insert({
              job_id: jobId,
              prediction_id: `failed_${index}_${Date.now()}`,
              prediction_type: 'scene_image',
              scene_index: index,
              project_id: projectId,
              user_id: userId,
              metadata: { prompt: prompt.prompt, error: lastError },
              status: 'failed',
              error_message: `Queue full after ${MAX_RETRIES} retries - will be retried automatically`
            });
        }

        // Small delay between individual requests within a batch
        if (i < batch.length - 1) {
          await delay(DELAY_BETWEEN_REQUESTS_MS);
        }

      } catch (error) {
        console.error(`Error starting generation for scene ${index + 1}:`, error);
        failedCount++;
      }
    }
    
    // Delay between batches to avoid overwhelming Replicate
    if (batchStart + BATCH_SIZE < promptsToProcess.length) {
      console.log(`Batch complete. Waiting ${DELAY_BETWEEN_BATCHES_MS / 1000}s before next batch...`);
      await delay(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  console.log(`Started ${startedCount}/${promptsToProcess.length} image generations (${failedCount} failed to start). Waiting for webhooks...`);

  // Update job total to match actually started generations
  if (startedCount > 0) {
    await adminClient
      .from('generation_jobs')
      .update({ total: startedCount })
      .eq('id', jobId);
  }

  // If no predictions were started, mark job as failed
  if (startedCount === 0) {
    await adminClient
      .from('generation_jobs')
      .update({ 
        status: 'failed',
        error_message: 'Aucune génération démarrée - vérifiez votre quota Replicate',
        completed_at: new Date().toISOString()
      })
      .eq('id', jobId);
    return; // Don't throw, job is already marked
  }

  // Schedule a check for stuck predictions after 10 minutes
  EdgeRuntime.waitUntil((async () => {
    await new Promise(resolve => setTimeout(resolve, 10 * 60 * 1000)); // 10 minutes
    console.log(`Running scheduled stuck check for job ${jobId}`);
    try {
      await fetch(`${supabaseUrl}/functions/v1/check-stuck-jobs`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jobId }),
      });
    } catch (e) {
      console.error(`Failed to check stuck jobs:`, e);
    }
  })());

  // Job stays in 'processing' status - the webhook will mark it complete
  // Throw special marker to prevent the job from being marked complete by processJob
  throw new Error("WEBHOOK_MODE_ACTIVE");
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
        async: true,
        userId, // Required for internal service role calls
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
      const maxWaitMs = 600000; // 10 minutes
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
          body: JSON.stringify({ predictionId, userId }),
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
    async: true,
    userId, // Required for internal service role calls
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
  const maxWaitMs = 600000; // 10 minutes
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
      body: JSON.stringify({ predictionId, userId }),
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

// Process thumbnails job - generates 3 thumbnail variations using webhooks (non-blocking)
async function processThumbnailsJob(
  jobId: string,
  projectId: string,
  userId: string,
  metadata: Record<string, any>,
  authHeader: string,
  adminClient: any
) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const useWebhook = metadata.useWebhook !== false; // Default to webhook mode
  
  // Get required data from metadata
  const {
    videoScript,
    videoTitle,
    exampleUrls,
    characterRefUrl,
    previousPrompts,
    customPrompt,
    userIdea,
    imageModel
  } = metadata;

  if (!videoScript || !videoTitle || !exampleUrls || exampleUrls.length === 0) {
    throw new Error("Missing required thumbnail data in metadata");
  }

  console.log(`Starting thumbnails generation for project ${projectId}, webhook mode: ${useWebhook}`);

  // Use service role key for internal calls
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const internalAuthHeader = `Bearer ${serviceRoleKey}`;

  // Step 1: Generate prompts with Gemini
  const promptsResponse = await fetch(`${supabaseUrl}/functions/v1/generate-thumbnail-prompts`, {
    method: 'POST',
    headers: {
      'Authorization': internalAuthHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      videoScript,
      videoTitle,
      exampleUrls,
      characterRefUrl,
      previousPrompts,
      customPrompt,
      userIdea
    }),
  });

  if (!promptsResponse.ok) {
    const errorText = await promptsResponse.text();
    throw new Error(`Failed to generate prompts: ${errorText}`);
  }

  const promptsData = await promptsResponse.json();
  
  if (promptsData.error) {
    throw new Error(promptsData.error);
  }
  
  if (!promptsData.prompts || promptsData.prompts.length !== 3) {
    throw new Error("Failed to generate 3 prompts");
  }

  const creativePrompts = promptsData.prompts as string[];
  console.log("Generated thumbnail prompts:", creativePrompts.length);

  // Update metadata with generated prompts
  await adminClient
    .from('generation_jobs')
    .update({ 
      metadata: { ...metadata, generatedPrompts: creativePrompts }
    })
    .eq('id', jobId);

  // Build webhook URL
  const webhookUrl = `${supabaseUrl}/functions/v1/replicate-webhook`;

  // Step 2: Start all 3 generations with webhooks (non-blocking)
  for (let i = 0; i < 3; i++) {
    const prompt = creativePrompts[i];
    
    try {
      const requestBody: any = {
        prompt,
        width: 1920,
        height: 1080,
        model: imageModel || 'seedream-4.5',
        async: true,
        webhook_url: webhookUrl,
      };

      // Combine style examples AND character reference
      const allImageRefs: string[] = [];
      if (exampleUrls && Array.isArray(exampleUrls)) {
        allImageRefs.push(...exampleUrls);
      }
      if (characterRefUrl) {
        allImageRefs.push(characterRefUrl);
      }
      if (allImageRefs.length > 0) {
        requestBody.image_urls = allImageRefs;
      }

      // Start async generation with service role key and userId
      const startResponse = await fetch(`${supabaseUrl}/functions/v1/generate-image-seedream`, {
        method: 'POST',
        headers: {
          'Authorization': internalAuthHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...requestBody, userId }),
      });

      if (!startResponse.ok) {
        console.error(`Failed to start thumbnail ${i + 1}: ${startResponse.status}`);
        continue;
      }

      const startData = await startResponse.json();
      const predictionId = startData.predictionId;

      if (!predictionId) {
        console.error(`No prediction ID for thumbnail ${i + 1}`);
        continue;
      }

      // Save to pending_predictions table (use null for standalone mode)
      const { error: insertError } = await adminClient
        .from('pending_predictions')
        .insert({
          job_id: jobId,
          prediction_id: predictionId,
          prediction_type: 'thumbnail',
          thumbnail_index: i,
          project_id: metadata?.standalone ? null : projectId,
          user_id: userId,
          metadata: { prompt },
          status: 'pending'
        });

      if (insertError) {
        console.error(`Error saving prediction ${predictionId}:`, insertError);
      } else {
        console.log(`Thumbnail ${i + 1} started: ${predictionId}`);
      }

    } catch (error) {
      console.error(`Error starting thumbnail ${i + 1}:`, error);
    }
  }

  // Job stays in 'processing' status - the webhook will mark it complete
  // Do NOT mark as completed here - that's the webhook's job
  console.log(`Thumbnail generations started. Waiting for webhooks...`);
  
  // Throw a special marker to prevent the job from being marked complete by processJob
  throw new Error("WEBHOOK_MODE_ACTIVE");
}

async function processScriptGenerationJob(
  jobId: string,
  projectId: string,
  userId: string,
  metadata: Record<string, any>,
  authHeader: string,
  adminClient: any
) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  
  const customPrompt = metadata.customPrompt;
  
  if (!customPrompt) {
    throw new Error("Custom prompt is required for script generation");
  }
  
  console.log(`Starting script generation job ${jobId}`);
  
  const scriptModel = metadata.scriptModel || "claude";
  
  // Call the generate-script function with webhook mode
  const response = await fetch(`${supabaseUrl}/functions/v1/generate-script`, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      customPrompt,
      jobId,
      useWebhook: true,
      scriptModel
    }),
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Script generation failed: ${response.status}`);
  }
  
  const data = await response.json();
  console.log(`Script generation started: ${data.predictionId}`);
  
  // Job stays in 'processing' status - the webhook will mark it complete
  console.log(`Script generation job ${jobId} waiting for webhook...`);
  
  // Throw a special marker to prevent the job from being marked complete by processJob
  throw new Error("WEBHOOK_MODE_ACTIVE");
}

// Process audio generation job - uses MiniMax TTS with background processing
async function processAudioGenerationJob(
  jobId: string,
  projectId: string,
  userId: string,
  metadata: Record<string, any>,
  authHeader: string,
  adminClient: any
) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  
  const {
    script,
    voice,
    model,
    speed,
    pitch,
    volume,
    languageBoost,
    englishNormalization,
    emotion,
    provider
  } = metadata;
  
  if (!script) {
    throw new Error("Script is required for audio generation");
  }
  
  console.log(`Starting audio generation job ${jobId}, provider: ${provider || 'minimax'}`);
  
  // Call the generate-audio-minimax function with jobId for background processing
  const functionName = provider === 'elevenlabs' ? 'generate-audio-tts' : 'generate-audio-minimax';
  
  // Use service role key for internal calls to avoid auth token expiration issues
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  
  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      script,
      voice,
      model,
      speed,
      pitch,
      volume,
      languageBoost,
      englishNormalization,
      emotion,
      projectId,
      jobId, // Pass jobId for background processing mode
      userId // Pass userId for API key retrieval since we're using service role
    }),
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Audio generation failed: ${response.status}`);
  }
  
  const data = await response.json();
  console.log(`Audio generation started for job ${jobId}:`, data);
  
  // For MiniMax with jobId, the function handles everything in background via waitUntil
  // Job stays in 'processing' status - the background process will mark it complete
  console.log(`Audio generation job ${jobId} processing in background...`);
  
  // Throw a special marker to prevent the job from being marked complete by processJob
  throw new Error("WEBHOOK_MODE_ACTIVE");
}
