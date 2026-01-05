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
  jobType: 'transcription' | 'prompts' | 'images' | 'thumbnails' | 'test_images' | 'single_prompt' | 'single_image' | 'script_generation' | 'audio_generation' | 'upscale';
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
    } else if (jobType === 'upscale') {
      // Count images that need upscaling (Z-Image 16:9 images)
      const prompts = (project?.prompts as any[]) || [];
      total = prompts.filter((p: any) => p && p.imageUrl).length;
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

    let promptsChunkResult: { remainingAfterChunk: number; nextChunkStart: number } | null = null;

    if (jobType === 'prompts') {
      promptsChunkResult = await processPromptsJob(jobId, projectId, userId, metadata, authHeader, adminClient);
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
    } else if (jobType === 'upscale') {
      await processUpscaleJob(jobId, projectId, userId, metadata, authHeader, adminClient);
    }

    // Handle prompts chunk continuation
    if (jobType === 'prompts' && promptsChunkResult && promptsChunkResult.remainingAfterChunk > 0) {
      console.log(`Prompts chunk complete. ${promptsChunkResult.remainingAfterChunk} prompts remaining. Creating next chunk job.`);
      
      // Mark current job as completed
      await adminClient
        .from('generation_jobs')
        .update({ 
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        .eq('id', jobId);

      // Create next chunk job - no chunkStart needed, it will re-filter from DB
      const { data: nextChunkJob, error: chunkError } = await adminClient
        .from('generation_jobs')
        .insert({
          project_id: projectId,
          user_id: userId,
          job_type: 'prompts',
          status: 'pending',
          progress: 0,
          total: Math.min(promptsChunkResult.remainingAfterChunk, 50),
          metadata: {
            ...metadata,
            isChunkContinuation: true
          }
        })
        .select()
        .single();
      
      if (chunkError) {
        console.error("Error creating next prompts chunk job:", chunkError);
      } else {
        console.log(`Created next prompts chunk job ${nextChunkJob.id}`);
        
        // Start next chunk job in background
        EdgeRuntime.waitUntil(processJob(
          nextChunkJob.id,
          projectId,
          'prompts',
          userId,
          { ...metadata, isChunkContinuation: true },
          authHeader
        ));
      }
      
      return; // Don't proceed to semi-auto chaining yet
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

    // Semi-automatic mode: chain to next job (only when all chunks are done)
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
    const shouldContinue = isCpuTimeout && hasRemainingWork && currentJobType === 'images';

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
  
  // Get project data first to check completion status
  const { data: project } = await adminClient
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single();
    
  if (!project) {
    console.error(`Project ${projectId} not found for chaining`);
    return;
  }
  
  // Determine next job in the pipeline
  if (completedJobType === 'prompts') {
    // CRITICAL: Check that ALL prompts are generated before chaining to images
    const scenes = (project.scenes as any[]) || [];
    const prompts = (project.prompts as any[]) || [];
    const missingPrompts = scenes.filter((_, index) => {
      const prompt = prompts[index];
      return !prompt?.prompt || prompt.prompt === "Erreur lors de la génération";
    });
    
    if (missingPrompts.length > 0) {
      console.log(`BLOCKING CHAIN: ${missingPrompts.length} prompts still missing. Not chaining to images yet.`);
      return;
    }
    
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
): Promise<{ remainingAfterChunk: number; nextChunkStart: number }> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  
  // CHUNK SETTINGS - consistent 50 prompts per chunk
  const CHUNK_SIZE = 50;
  
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
  // #region agent log
  console.log(`[DEBUG-A] processPromptsJob START: project.visual_continuity_enabled = ${project.visual_continuity_enabled}`);
  // #endregion
  const visualContinuityEnabled = project.visual_continuity_enabled || false;
  // #region agent log
  console.log(`[DEBUG-A] processPromptsJob: visualContinuityEnabled DEFINED = ${visualContinuityEnabled}`);
  // #endregion

  // Get or generate summary (only on first chunk)
  let summary = project.summary;
  if (!summary && (metadata.chunkStart || 0) === 0) {
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

  // Filter scenes that need prompts - ALWAYS get fresh list based on current DB state
  const skipExisting = metadata.skipExisting !== false;
  const allScenesToProcess = scenes
    .map((scene: any, index: number) => ({ scene, index }))
    .filter(({ index }: any) => {
      const existingPrompt = existingPrompts[index];
      return !skipExisting || !existingPrompt?.prompt || metadata.regenerate;
    });

  if (allScenesToProcess.length === 0) {
    console.log("No prompts to generate - all scenes have prompts");
    return { remainingAfterChunk: 0, nextChunkStart: 0 };
  }

  // Take next chunk from the filtered list (always start from index 0 since list is fresh)
  // The list already only contains scenes that need prompts
  const scenesToProcess = allScenesToProcess.slice(0, CHUNK_SIZE);
  const remainingAfterThisChunk = allScenesToProcess.length - scenesToProcess.length;
  
  console.log(`CHUNK MODE: Processing ${scenesToProcess.length} prompts. ${remainingAfterThisChunk} remaining after this chunk. Total missing: ${allScenesToProcess.length}`);

  // Update job metadata with chunk info
  await adminClient
    .from('generation_jobs')
    .update({
      total: scenesToProcess.length,
      metadata: {
        ...metadata,
        chunkSize: scenesToProcess.length,
        totalMissing: allScenesToProcess.length,
        remainingAfterChunk: remainingAfterThisChunk
      }
    })
    .eq('id', jobId);

  const filteredExamples = examplePrompts.filter((p: string) => p.trim() !== "");
  const newPrompts = [...existingPrompts];
  
  // Ensure array has correct length
  while (newPrompts.length < scenes.length) {
    newPrompts.push(null);
  }

  // NOUVEAU: Si continuité activée, analyser toutes les continuités d'abord pour calculer les groupes
  let continuityDataMap = new Map<number, any>(); // Stocke les données complètes de continuité
  let groupMap = new Map<number, number>(); // sceneIndex -> groupId
  
  // Check if we have enough existing prompts for continuity analysis
  const hasEnoughExistingPrompts = existingPrompts.filter((p: any) => p?.prompt).length >= scenesToProcess.length - 1;
  
  if (visualContinuityEnabled && hasEnoughExistingPrompts) {
    console.log(`[processPromptsJob] Analyzing continuities for all scenes (using existing prompts)...`);
    
    // Analyser toutes les continuités en parallèle (utiliser existingPrompts pour les scènes précédentes)
    const continuityPromises = scenesToProcess
      .filter(({ index }: any) => index > 0) // Skip first scene
      .map(async ({ scene, index }: any) => {
        // Utiliser existingPrompts pour la scène précédente (qui a déjà un prompt)
        const previousScene = existingPrompts[index - 1];
        if (!previousScene?.text || !previousScene?.prompt) {
          return { index, hasContinuity: false, data: null };
        }
        
        try {
          const continuityResponse = await fetch(`${supabaseUrl}/functions/v1/analyze-scene-continuity`, {
            method: 'POST',
            headers: {
              'Authorization': authHeader,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              currentSceneText: scene.text,
              previousSceneText: previousScene.text,
              previousPrompt: previousScene.prompt
            }),
          });
          
          if (continuityResponse.ok) {
            const data = await continuityResponse.json();
            return {
              index,
              hasContinuity: data.hasContinuity && data.confidence >= 0.7,
              data: data // Stocker les données complètes
            };
          }
        } catch (error) {
          console.error(`[processPromptsJob] Error analyzing continuity for scene ${index + 1}:`, error);
        }
        return { index, hasContinuity: false, data: null };
      });
    
    const continuityResults = await Promise.all(continuityPromises);
    continuityResults.forEach(r => {
      continuityDataMap.set(r.index, r.data); // Stocker les données complètes
    });
    
    // Calculer les groupes en tenant compte des groupes existants
    let currentGroupId = 0;
    const existingGroupIds = existingPrompts
      .map((p: any) => p?.continuityGroupId)
      .filter((id: any) => id !== null && id !== undefined) as number[];
    const maxExistingGroupId = existingGroupIds.length > 0 ? Math.max(...existingGroupIds) : 0;
    
    for (const { index } of scenesToProcess) {
      if (index === 0) {
        // Première scène : nouveau groupe ou groupe existant si déjà assigné
        if (existingPrompts[0]?.continuityGroupId) {
          groupMap.set(index, existingPrompts[0].continuityGroupId);
          currentGroupId = existingPrompts[0].continuityGroupId;
        } else {
          currentGroupId = maxExistingGroupId + 1;
          groupMap.set(index, currentGroupId);
        }
      } else {
        const continuityData = continuityDataMap.get(index);
        const hasContinuity = continuityData?.hasContinuity && continuityData?.confidence >= 0.7;
        
        if (hasContinuity) {
          // Continuité : utiliser le même groupe que la scène précédente
          const previousGroupId = groupMap.get(index - 1) || existingPrompts[index - 1]?.continuityGroupId;
          if (previousGroupId) {
            groupMap.set(index, previousGroupId);
          } else {
            // Pas de groupe précédent, créer nouveau
            currentGroupId = maxExistingGroupId + 1;
            groupMap.set(index, currentGroupId);
          }
        } else {
          // Pas de continuité : nouveau groupe
          currentGroupId = Math.max(currentGroupId, maxExistingGroupId) + 1;
          groupMap.set(index, currentGroupId);
        }
      }
    }
    
    const groupValues = Array.from(groupMap.values());
    const maxGroupId = groupValues.length > 0 ? Math.max(...groupValues) : 0;
    console.log(`[processPromptsJob] Calculated ${maxGroupId} continuity groups`);
    console.log(`[processPromptsJob] Group mapping:`, Array.from(groupMap.entries()).map(([idx, gid]) => `Scene ${idx + 1} → G${gid}`).join(', '));
  } else if (visualContinuityEnabled) {
    // Not enough existing prompts - need sequential generation for continuity
    console.log(`[processPromptsJob] Continuity enabled but no existing prompts - using SEQUENTIAL generation`);
  }

  // Determine if we should process sequentially (for continuity with no existing prompts)
  const shouldProcessSequentially = visualContinuityEnabled && !hasEnoughExistingPrompts;

  // Process chunk
  let progress = 0;
  
  if (shouldProcessSequentially) {
    // SEQUENTIAL processing for continuity when no existing prompts
    console.log(`[processPromptsJob] Processing ${scenesToProcess.length} prompts SEQUENTIALLY for continuity analysis`);
    
    let currentGroupId = 1;
    
    for (const { scene, index } of scenesToProcess) {
      // Get previous prompts for context
      const previousPrompts = newPrompts
        .slice(Math.max(0, index - 3), index)
        .filter((p: any) => p?.prompt && p.prompt !== "Erreur lors de la génération")
        .map((p: any) => p.prompt);

      // Get previous and next scene texts for temporal/narrative context
      const previousSceneTexts = scenes
        .slice(Math.max(0, index - 5), index)
        .map((s: any) => s.text);

      const nextSceneTexts = scenes
        .slice(index + 1, Math.min(scenes.length, index + 6))
        .map((s: any) => s.text);

      // Analyze continuity with previous prompt (now available because sequential)
      let hasContinuity = false;
      let continuityData = null;
      
      if (index > 0) {
        const previousScene = newPrompts[index - 1];
        if (previousScene?.text && previousScene?.prompt) {
          try {
            console.log(`[processPromptsJob] Scene ${index + 1}: Analyzing continuity with previous prompt...`);
            const continuityResponse = await fetch(`${supabaseUrl}/functions/v1/analyze-scene-continuity`, {
              method: 'POST',
              headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                currentSceneText: scene.text,
                previousSceneText: previousScene.text,
                previousPrompt: previousScene.prompt
              }),
            });
            
            if (continuityResponse.ok) {
              continuityData = await continuityResponse.json();
              hasContinuity = continuityData.hasContinuity && continuityData.confidence >= 0.7;
              console.log(`[processPromptsJob] Scene ${index + 1}: Continuity ${hasContinuity ? 'DETECTED' : 'NOT detected'} (confidence: ${continuityData.confidence})`);
            }
          } catch (error) {
            console.error(`[processPromptsJob] Scene ${index + 1}: Error analyzing continuity:`, error);
          }
        }
      }

      // Calculate group ID (only if visual continuity is enabled)
      let groupId: number | null = null;
      if (visualContinuityEnabled) {
        if (index === 0) {
          groupId = 1;
          currentGroupId = 1;
        } else if (hasContinuity) {
          // Same group as previous scene
          groupId = newPrompts[index - 1]?.continuityGroupId || currentGroupId;
        } else {
          // New group
          currentGroupId++;
          groupId = currentGroupId;
        }
        groupMap.set(index, groupId);
      }

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
            sceneIndex: index + 1,
            totalScenes: scenes.length,
            startTime: scene.startTime,
            endTime: scene.endTime,
            customSystemPrompt,
            previousPrompts,
            previousSceneTexts,
            nextSceneTexts,
            // Continuity parameters
            hasContinuity,
            previousPrompt: hasContinuity ? newPrompts[index - 1]?.prompt : null,
            continuityElements: hasContinuity ? continuityData : null
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const finalGroupId = visualContinuityEnabled ? groupId : null;
          newPrompts[index] = {
            scene: `Scène ${index + 1}`,
            prompt: data.prompt,
            text: scene.text,
            startTime: scene.startTime,
            endTime: scene.endTime,
            duration: scene.endTime - scene.startTime,
            imageUrl: newPrompts[index]?.imageUrl,
            continuityGroupId: finalGroupId
          };
          if (finalGroupId) {
            console.log(`[processPromptsJob] Scene ${index + 1}: Generated prompt, assigned to group ${finalGroupId}`);
          } else {
            console.log(`[processPromptsJob] Scene ${index + 1}: Generated prompt (no continuity group)`);
          }
        } else {
          console.error(`[processPromptsJob] Scene ${index + 1}: Failed to generate prompt - ${response.status}`);
        }
      } catch (error) {
        console.error(`Error generating prompt for scene ${index + 1}:`, error);
      }

      // Update progress after each prompt
      progress++;
      await adminClient
        .from('generation_jobs')
        .update({ progress })
        .eq('id', jobId);
    }
    
    const groupValues = Array.from(groupMap.values());
    const maxGroupId = groupValues.length > 0 ? Math.max(...groupValues) : 0;
    console.log(`[processPromptsJob] Sequential processing complete. Created ${maxGroupId} continuity groups`);
    
  } else {
    // PARALLEL processing (original behavior)
    const batchPromises = scenesToProcess.map(async ({ scene, index }: any) => {
      // Get previous prompts for context
      const previousPrompts = newPrompts
        .slice(Math.max(0, index - 3), index)
        .filter((p: any) => p?.prompt && p.prompt !== "Erreur lors de la génération")
        .map((p: any) => p.prompt);

      // Get previous and next scene texts for temporal/narrative context
      const previousSceneTexts = scenes
        .slice(Math.max(0, index - 5), index)
        .map((s: any) => s.text);

      const nextSceneTexts = scenes
        .slice(index + 1, Math.min(scenes.length, index + 6))
        .map((s: any) => s.text);

      // Utiliser les résultats de l'analyse préalable si disponible
      let hasContinuity = false;
      let continuityData = null;
      
      if (visualContinuityEnabled && index > 0) {
        const continuityDataFull = continuityDataMap.get(index);
        if (continuityDataFull) {
          hasContinuity = continuityDataFull.hasContinuity && continuityDataFull.confidence >= 0.7;
          continuityData = continuityDataFull;
          console.log(`[processPromptsJob] Scene ${index + 1}: Using pre-analyzed continuity: ${hasContinuity ? 'DETECTED' : 'NOT detected'}`);
        }
      }

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
            sceneIndex: index + 1,
            totalScenes: scenes.length,
            startTime: scene.startTime,
            endTime: scene.endTime,
            customSystemPrompt,
            previousPrompts,
            previousSceneTexts,
            nextSceneTexts,
            // Continuity parameters
            hasContinuity,
            previousPrompt: hasContinuity ? existingPrompts[index - 1]?.prompt : null,
            continuityElements: hasContinuity ? continuityData : null
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const groupId = visualContinuityEnabled ? (groupMap.get(index) || null) : null;
          newPrompts[index] = {
            scene: `Scène ${index + 1}`,
            prompt: data.prompt,
            text: scene.text,
            startTime: scene.startTime,
            endTime: scene.endTime,
            duration: scene.endTime - scene.startTime,
            imageUrl: newPrompts[index]?.imageUrl,
            continuityGroupId: groupId
          };
          if (groupId) {
            console.log(`[processPromptsJob] Scene ${index + 1}: Assigned to continuity group ${groupId}`);
          }
        }
      } catch (error) {
        console.error(`Error generating prompt for scene ${index + 1}:`, error);
      }
    });

    await Promise.all(batchPromises);
    
    // Update progress after parallel batch
    progress = scenesToProcess.length;
    
    await adminClient
      .from('generation_jobs')
      .update({ progress })
      .eq('id', jobId);
  }

  // Save prompts
  await adminClient
    .from('projects')
    .update({ prompts: newPrompts })
    .eq('id', projectId);

  console.log(`CHUNK COMPLETE: Generated ${progress} prompts. ${remainingAfterThisChunk} remaining for next chunks.`);

  return { 
    remainingAfterChunk: remainingAfterThisChunk, 
    nextChunkStart: 0 // Not used anymore - each chunk re-filters from DB
  };
}

// ========== VISUAL CONTINUITY FUNCTIONS ==========

/**
 * Analyze continuity for all consecutive scene pairs in parallel
 */
async function analyzeAllContinuities(
  prompts: any[],
  supabaseUrl: string,
  authHeader: string
): Promise<Map<number, { hasContinuity: boolean; modifiedPromptSuffix?: string; confidence?: number }>> {
  console.log(`[analyzeAllContinuities] Starting analysis for ${prompts.length} scenes`);
  const continuityMap = new Map<number, { hasContinuity: boolean; modifiedPromptSuffix?: string; confidence?: number }>();
  
  // Scene 0 has no previous scene
  continuityMap.set(0, { hasContinuity: false });
  console.log(`[analyzeAllContinuities] Scene 0: No previous scene (hasContinuity: false)`);
  
  if (prompts.length <= 1) {
    console.log(`[analyzeAllContinuities] Only 1 scene, no pairs to analyze`);
    return continuityMap;
  }
  
  console.log(`[analyzeAllContinuities] Analyzing ${prompts.length - 1} pairs in parallel...`);
  
  // Analyze all pairs in parallel
  const analysisPromises = prompts.slice(1).map(async (prompt, i) => {
    const index = i + 1; // Because we skipped the first one
    const previousScene = prompts[index - 1];
    
    console.log(`[analyzeAllContinuities] Scene ${index + 1}: Checking continuity with scene ${index}`);
    
    if (!previousScene?.text || !prompt?.text || !previousScene?.prompt) {
      console.log(`[analyzeAllContinuities] Scene ${index + 1}: Missing data (prevText: ${!!previousScene?.text}, currText: ${!!prompt?.text}, prevPrompt: ${!!previousScene?.prompt})`);
      return { index, hasContinuity: false };
    }
    
    try {
      console.log(`[analyzeAllContinuities] Scene ${index + 1}: Calling analyze-scene-continuity API...`);
      const response = await fetch(`${supabaseUrl}/functions/v1/analyze-scene-continuity`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentSceneText: prompt.text,
          previousSceneText: previousScene.text,
          previousPrompt: previousScene.prompt
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        const hasContinuity = data.hasContinuity && data.confidence >= 0.7;
        console.log(`[analyzeAllContinuities] Scene ${index + 1}: hasContinuity=${hasContinuity}, confidence=${data.confidence}, reason="${data.reasoning?.substring(0, 50)}..."`);
        return {
          index,
          hasContinuity,
          modifiedPromptSuffix: data.modifiedPromptSuffix,
          confidence: data.confidence
        };
      } else {
        const errorText = await response.text();
        console.error(`[analyzeAllContinuities] Scene ${index + 1}: API failed with status ${response.status}: ${errorText.substring(0, 100)}`);
        return { index, hasContinuity: false };
      }
    } catch (error) {
      console.error(`[analyzeAllContinuities] Scene ${index + 1}: Exception:`, error);
      return { index, hasContinuity: false };
    }
  });
  
  const results = await Promise.all(analysisPromises);
  results.forEach(r => {
    continuityMap.set(r.index, {
      hasContinuity: r.hasContinuity,
      modifiedPromptSuffix: r.modifiedPromptSuffix,
      confidence: r.confidence
    });
  });
  
  const continuityCount = results.filter(r => r.hasContinuity).length;
  console.log(`[analyzeAllContinuities] ✅ Analysis complete: ${results.length} pairs analyzed, ${continuityCount} with continuity (${Math.round(continuityCount / results.length * 100)}%)`);
  
  // Log detailed results
  results.forEach(r => {
    if (r.hasContinuity) {
      console.log(`[analyzeAllContinuities]   → Scene ${r.index + 1}: CONTINUITY (confidence: ${r.confidence})`);
    }
  });
  
  return continuityMap;
}

/**
 * Build groups of consecutive scenes with continuity
 */
function buildContinuityGroups(
  promptsToProcess: Array<{prompt: any, index: number}>,
  continuityMap: Map<number, { hasContinuity: boolean }>
): Array<Array<{prompt: any, index: number}>> {
  console.log(`[buildContinuityGroups] Building groups from ${promptsToProcess.length} scenes to process`);
  const groups: Array<Array<{prompt: any, index: number}>> = [];
  let currentGroup: Array<{prompt: any, index: number}> = [];
  
  for (const item of promptsToProcess) {
    const continuity = continuityMap.get(item.index);
    const hasContinuityWithPrevious = continuity?.hasContinuity || false;
    
    if (hasContinuityWithPrevious && currentGroup.length > 0) {
      // Continue in current group
      console.log(`[buildContinuityGroups] Scene ${item.index + 1}: Adding to current group (continuity with scene ${item.index})`);
      currentGroup.push(item);
    } else {
      // Start new group
      if (currentGroup.length > 0) {
        console.log(`[buildContinuityGroups] Closing group with ${currentGroup.length} scenes: [${currentGroup.map(i => i.index + 1).join(', ')}]`);
        groups.push(currentGroup);
      }
      console.log(`[buildContinuityGroups] Starting new group with scene ${item.index + 1} (no continuity with previous)`);
      currentGroup = [item];
    }
  }
  
  // Add last group
  if (currentGroup.length > 0) {
    console.log(`[buildContinuityGroups] Closing final group with ${currentGroup.length} scenes: [${currentGroup.map(i => i.index + 1).join(', ')}]`);
    groups.push(currentGroup);
  }
  
  console.log(`[buildContinuityGroups] ✅ Built ${groups.length} groups:`, groups.map((g, i) => `Group ${i + 1}[${g.map(item => item.index + 1).join(', ')}]`).join(', '));
  
  return groups;
}

/**
 * Generate an image and wait for the result via polling
 */
async function generateImageAndWait(
  requestBody: any,
  supabaseUrl: string,
  authHeader: string,
  maxWaitMs: number = 300000 // 5 minutes
): Promise<string | null> {
  const pollIntervalMs = 3000; // Poll every 3 seconds
  
  try {
    // Start generation
    const startResponse = await fetch(`${supabaseUrl}/functions/v1/generate-image-seedream`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    
    if (!startResponse.ok) {
      const errorText = await startResponse.text();
      console.error(`[generateImageAndWait] Failed to start: ${startResponse.status} - ${errorText}`);
      return null;
    }
    
    const startData = await startResponse.json();
    const predictionId = startData.predictionId;
    
    if (!predictionId) {
      console.error(`[generateImageAndWait] No predictionId returned`);
      return null;
    }
    
    console.log(`[generateImageAndWait] Started prediction ${predictionId}, polling for result...`);
    
    // Poll for completion
    const startTime = Date.now();
    let attempts = 0;
    
    while (Date.now() - startTime < maxWaitMs) {
      attempts++;
      
      const statusResponse = await fetch(`${supabaseUrl}/functions/v1/generate-image-seedream`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ predictionId }),
      });
      
      if (statusResponse.ok) {
        const data = await statusResponse.json();
        
        if (data.status === 'succeeded' && data.output) {
          const imageUrl = Array.isArray(data.output) ? data.output[0] : data.output;
          console.log(`[generateImageAndWait] Image generated after ${attempts} attempts`);
          return imageUrl;
        }
        
        if (data.status === 'failed') {
          console.error(`[generateImageAndWait] Generation failed: ${data.error || 'Unknown error'}`);
          return null;
        }
        
        // Still processing
        if (attempts % 10 === 0) {
          console.log(`[generateImageAndWait] Still processing... (attempt ${attempts}, status: ${data.status})`);
        }
      } else {
        console.error(`[generateImageAndWait] Status check failed: ${statusResponse.status}`);
      }
      
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
    
    console.error(`[generateImageAndWait] Timeout after ${maxWaitMs}ms`);
    return null;
    
  } catch (error) {
    console.error(`[generateImageAndWait] Error:`, error);
    return null;
  }
}

/**
 * Generate images for a group sequentially (waiting for each to complete)
 */
async function generateGroupSequentially(
  group: Array<{prompt: any, index: number}>,
  prompts: any[],
  continuityData: Map<number, { hasContinuity: boolean; modifiedPromptSuffix?: string }>,
  styleReferenceUrls: string[],
  imageWidth: number,
  imageHeight: number,
  imageModel: string,
  supabaseUrl: string,
  authHeader: string,
  userId: string,
  projectId: string,
  jobId: string,
  adminClient: any
): Promise<void> {
  console.log(`[generateGroupSequentially] Processing group with ${group.length} scenes`);
  
  for (const { prompt, index } of group) {
    const previousScene = prompts[index - 1];
    const continuity = continuityData.get(index);
    
    let finalImageUrls = [...styleReferenceUrls];
    let finalPrompt = prompt.prompt;
    
    // If continuity detected and previous image available
    // Note: The prompt is already adapted for continuity during generation (in processPromptsJob)
    if (continuity?.hasContinuity && previousScene?.imageUrl) {
      console.log(`[generateGroupSequentially] Scene ${index + 1}: ✅ Using continuity mode`);
      console.log(`[generateGroupSequentially] Scene ${index + 1}:   Previous image: ${previousScene.imageUrl.substring(0, 80)}...`);
      console.log(`[generateGroupSequentially] Scene ${index + 1}:   Prompt already adapted for image modification during generation`);
      finalImageUrls = [previousScene.imageUrl, ...styleReferenceUrls];
      // Prompt is already adapted during generation, no need to modify it here
    } else {
      const reason = !continuity?.hasContinuity ? 'no continuity detected' : 'no previous image available';
      console.log(`[generateGroupSequentially] Scene ${index + 1}: ⚪ Normal generation (${reason})`);
    }
    
    const requestBody: any = {
      prompt: finalPrompt,
      width: imageWidth,
      height: imageHeight,
      model: imageModel,
      async: true,
      userId,
    };
    
    if (finalImageUrls.length > 0) {
      requestBody.image_urls = finalImageUrls;
    }
    
    // Generate and wait for result
    const imageUrl = await generateImageAndWait(requestBody, supabaseUrl, authHeader);
    
    if (imageUrl) {
      // Update prompts array - preserve all existing properties including continuityGroupId
      prompts[index] = {
        ...prompts[index],
        imageUrl: imageUrl
      };
      
      // Save to database
      await adminClient
        .from('projects')
        .update({ prompts })
        .eq('id', projectId);
      
      // Update job progress
      await adminClient
        .from('generation_jobs')
        .update({ progress: index + 1 })
        .eq('id', jobId);
      
      console.log(`[generateGroupSequentially] Scene ${index + 1}: Image saved`);
    } else {
      console.error(`[generateGroupSequentially] Scene ${index + 1}: Failed to generate image`);
    }
  }
  
  console.log(`[generateGroupSequentially] Group complete`);
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
  
  // CHUNK SETTINGS - optimized for speed while avoiding timeout
  const FIRST_CHUNK_SIZE = 30; // First chunk (was 20)
  const SUBSEQUENT_CHUNK_SIZE = 50; // Subsequent chunks
  const isFirstChunk = !metadata.isChunkContinuation;
  const CHUNK_SIZE = isFirstChunk ? FIRST_CHUNK_SIZE : SUBSEQUENT_CHUNK_SIZE;
  
  // Get project data
  const { data: project } = await adminClient
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single();

  if (!project) throw new Error("Project not found");

  const prompts = (project.prompts as any[]) || [];
  let imageWidth = project.image_width || 1920;
  let imageHeight = project.image_height || 1080;
  const imageModel = project.image_model || 'seedream-4.5';
  const visualContinuityEnabled = project.visual_continuity_enabled || false;
  
  // IMPORTANT: For Z-Image models with 16:9, always generate at 960x544 (will be upscaled later)
  const isZImage = imageModel === 'z-image-turbo' || imageModel === 'z-image-turbo-lora';
  if (isZImage) {
    const ratio = imageWidth / imageHeight;
    const is16x9 = Math.abs(ratio - (16 / 9)) < 0.1;
    if (is16x9) {
      console.log(`Z-Image 16:9 detected - forcing 960x544 for generation (was ${imageWidth}x${imageHeight})`);
      imageWidth = 960;
      imageHeight = 544;
    }
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

  // Filter prompts that need images - ALWAYS re-filter from DB to get fresh state
  const skipExisting = metadata.skipExisting !== false;
  const allPromptsToProcess = prompts
    .map((prompt: any, index: number) => ({ prompt, index }))
    .filter(({ prompt }: any) => prompt && (!skipExisting || !prompt.imageUrl));

  if (allPromptsToProcess.length === 0) {
    console.log("No images to generate");
    return;
  }

  // Take the next chunk from the filtered list (always start from 0 since list is fresh)
  // The list already only contains prompts that need images at this moment
  const promptsToProcess = allPromptsToProcess.slice(0, CHUNK_SIZE);
  const remainingAfterThisChunk = allPromptsToProcess.length - promptsToProcess.length;
  
  console.log(`CHUNK MODE: Processing ${promptsToProcess.length} images out of ${allPromptsToProcess.length} missing (${remainingAfterThisChunk} remaining after this chunk)`);

  // Update job metadata with chunk info and image model
  await adminClient
    .from('generation_jobs')
    .update({
      total: promptsToProcess.length,
      metadata: {
        ...metadata,
        chunkSize: promptsToProcess.length,
        totalImages: allPromptsToProcess.length,
        remainingAfterChunk: remainingAfterThisChunk,
        imageModel, // Store for upscaling detection
        imageWidth,
        imageHeight
      }
    })
    .eq('id', jobId);

  // ========== VISUAL CONTINUITY MODE ==========
  if (visualContinuityEnabled && imageModel === 'seedream-4.5' && promptsToProcess.length > 0) {
    console.log(`[processImagesJob] Visual continuity enabled - using group-based generation`);
    
    try {
      // Step 1: Analyze all continuities in parallel
      console.log(`[processImagesJob] Analyzing continuity for ${prompts.length} scenes...`);
      const continuityData = await analyzeAllContinuities(prompts, supabaseUrl, authHeader);
      
      // Step 2: Build continuity groups
      const groups = buildContinuityGroups(promptsToProcess, continuityData);
      console.log(`[processImagesJob] Built ${groups.length} continuity groups:`, groups.map(g => `[${g.map(i => i.index + 1).join(', ')}]`).join(', '));
      
      // Step 3: Generate groups in parallel, sequentially within each group
      await Promise.all(groups.map(group => 
        generateGroupSequentially(
          group,
          prompts,
          continuityData,
          styleReferenceUrls,
          imageWidth,
          imageHeight,
          imageModel,
          supabaseUrl,
          authHeader,
          userId,
          projectId,
          jobId,
          adminClient
        )
      ));
      
      console.log(`[processImagesJob] All continuity groups completed`);
      
      // Update final progress
      await adminClient
        .from('generation_jobs')
        .update({ progress: promptsToProcess.length })
        .eq('id', jobId);
      
      return; // Skip normal flow
    } catch (continuityError) {
      console.error(`[processImagesJob] Continuity mode failed, falling back to normal generation:`, continuityError);
      // Fall through to normal generation
    }
  }

  // ========== NORMAL MODE (existing flow unchanged) ==========
  // Build webhook URL
  const webhookUrl = `${supabaseUrl}/functions/v1/replicate-webhook`;

  // Batch settings for sending requests - optimized for speed
  const BATCH_SIZE = 10; // More parallel requests
  const DELAY_BETWEEN_BATCHES_MS = 500; // 0.5s between batches (was 4s)
  const DELAY_BETWEEN_REQUESTS_MS = 50; // 50ms between requests (was 300ms)
  const MAX_RETRIES = 3;
  const BASE_RETRY_DELAY_MS = 10000;

  let startedCount = 0;
  let failedCount = 0;
  
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
          userId,
        };

        // Visual continuity logic: use previous scene's image as reference if continuity detected
        let finalImageUrls = [...styleReferenceUrls];
        let finalPrompt = prompt.prompt;
        
        if (visualContinuityEnabled && imageModel === 'seedream-4.5' && index > 0) {
          const previousScene = prompts[index - 1];
          
          if (previousScene?.imageUrl && previousScene?.prompt && previousScene?.text) {
            try {
              console.log(`[processImagesJob] Checking continuity for scene ${index + 1} (previous: scene ${index})`);
              
              const continuityResponse = await fetch(`${supabaseUrl}/functions/v1/analyze-scene-continuity`, {
                method: 'POST',
                headers: {
                  'Authorization': authHeader,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  currentSceneText: prompt.text || '',
                  previousSceneText: previousScene.text || '',
                  previousPrompt: previousScene.prompt || ''
                }),
              });
              
              if (continuityResponse.ok) {
                const continuityData = await continuityResponse.json();
                
                if (continuityData.hasContinuity && continuityData.confidence >= 0.7) {
                  console.log(`[processImagesJob] Continuity detected (confidence: ${continuityData.confidence}) - using previous image as reference`);
                  console.log(`[processImagesJob] Note: Prompt should already be adapted for continuity (generated in processPromptsJob)`);
                  
                  // Add previous scene's image as first reference (most important)
                  finalImageUrls = [previousScene.imageUrl, ...styleReferenceUrls];
                  
                  // Prompt is already adapted during generation, no need to modify it here
                } else {
                  console.log(`[processImagesJob] No continuity detected (confidence: ${continuityData.confidence}) - normal generation`);
                }
              } else {
                console.error(`[processImagesJob] Failed to analyze continuity: ${continuityResponse.status}`);
              }
            } catch (continuityError) {
              console.error(`[processImagesJob] Error checking continuity:`, continuityError);
              // Continue with normal generation if continuity check fails
            }
          }
        }

        if (finalImageUrls.length > 0) {
          requestBody.image_urls = finalImageUrls;
        }
        
        requestBody.prompt = finalPrompt;
        
        if (imageModel === 'z-image-turbo-lora') {
          if (project.lora_url) {
            requestBody.lora_url = project.lora_url;
          }
          if (project.lora_steps) {
            requestBody.lora_steps = project.lora_steps;
          }
        }

        let lastError = '';
        let success = false;
        
        for (let retry = 0; retry <= MAX_RETRIES; retry++) {
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
              const { error: insertError } = await adminClient
                .from('pending_predictions')
                .insert({
                  job_id: jobId,
                  prediction_id: predictionId,
                  prediction_type: 'scene_image',
                  scene_index: index,
                  project_id: projectId,
                  user_id: userId,
                  metadata: { 
                    prompt: prompt.prompt,
                    imageModel, // Store image model for upscaling detection
                    imageWidth,
                    imageHeight
                  },
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
          
          if (errorText.includes('Queue is full') && retry < MAX_RETRIES) {
            const retryDelay = BASE_RETRY_DELAY_MS * Math.pow(2, retry);
            console.log(`Queue full for scene ${index + 1}, retry ${retry + 1}/${MAX_RETRIES} in ${retryDelay / 1000}s...`);
            await delay(retryDelay);
          } else if (retry < MAX_RETRIES) {
            console.log(`Error for scene ${index + 1}: ${errorText}, retry ${retry + 1}/${MAX_RETRIES} in 5s...`);
            await delay(5000);
          }
        }
        
        if (!success) {
          console.error(`Failed to start generation for scene ${index + 1} after ${MAX_RETRIES} retries: ${lastError}`);
          failedCount++;
          
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

        if (i < batch.length - 1) {
          await delay(DELAY_BETWEEN_REQUESTS_MS);
        }

      } catch (error) {
        console.error(`Error starting generation for scene ${index + 1}:`, error);
        failedCount++;
      }
    }
    
    if (batchStart + BATCH_SIZE < promptsToProcess.length) {
      console.log(`Batch complete. Waiting ${DELAY_BETWEEN_BATCHES_MS / 1000}s before next batch...`);
      await delay(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  console.log(`CHUNK COMPLETE: Started ${startedCount}/${promptsToProcess.length} image generations (${failedCount} failed to start). ${remainingAfterThisChunk} images remaining for next chunks.`);

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
    return;
  }

  // Schedule a check for stuck predictions after 5 minutes
  EdgeRuntime.waitUntil((async () => {
    await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
    console.log(`Running scheduled stuck check for job ${jobId}`);
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/check-stuck-jobs`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jobId }),
      });

      if (!res.ok) {
        console.error(`check-stuck-jobs failed (${res.status}):`, await res.text());
      } else {
        console.log(`check-stuck-jobs executed successfully for job ${jobId}`);
      }
    } catch (e) {
      console.error(`Failed to check stuck jobs:`, e);
    }
  })());

  // Job stays in 'processing' status - the webhook will mark it complete and trigger next chunk
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
  let imageWidth = project.image_width || 1920;
  let imageHeight = project.image_height || 1080;
  const imageModel = project.image_model || 'seedream-4.5';
  
  // IMPORTANT: For Z-Image models with 16:9, always generate at 960x544 (will be upscaled later)
  const isZImage = imageModel === 'z-image-turbo' || imageModel === 'z-image-turbo-lora';
  if (isZImage) {
    const ratio = imageWidth / imageHeight;
    const is16x9 = Math.abs(ratio - (16 / 9)) < 0.1;
    if (is16x9) {
      console.log(`Z-Image 16:9 detected - forcing 960x544 for generation (was ${imageWidth}x${imageHeight})`);
      imageWidth = 960;
      imageHeight = 544;
    }
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
      
      // Add LoRA parameters for z-image-turbo-lora model
      if (imageModel === 'z-image-turbo-lora') {
        if (project.lora_url) {
          requestBody.lora_url = project.lora_url;
        }
        if (project.lora_steps) {
          requestBody.lora_steps = project.lora_steps;
        }
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
  const visualContinuityEnabled = project.visual_continuity_enabled || false;

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

  // Get previous and next scene texts for temporal/narrative context
  const previousSceneTexts = scenes
    .slice(Math.max(0, sceneIndex - 5), sceneIndex)
    .map((s: any) => s.text);

  const nextSceneTexts = scenes
    .slice(sceneIndex + 1, Math.min(scenes.length, sceneIndex + 6))
    .map((s: any) => s.text);

  // NOUVEAU: Analyser continuité si option activée et calculer le groupe
  let hasContinuity = false;
  let continuityData = null;
  let continuityGroupId = null;
  
  if (visualContinuityEnabled && sceneIndex > 0) {
    const previousScene = existingPrompts[sceneIndex - 1];
    
    if (previousScene?.text && previousScene?.prompt) {
      try {
        console.log(`[processSinglePromptJob] Analyzing continuity for scene ${sceneIndex + 1} before prompt generation...`);
        const continuityResponse = await fetch(`${supabaseUrl}/functions/v1/analyze-scene-continuity`, {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            currentSceneText: scene.text,
            previousSceneText: previousScene.text,
            previousPrompt: previousScene.prompt
          }),
        });
        
        if (continuityResponse.ok) {
          continuityData = await continuityResponse.json();
          hasContinuity = continuityData.hasContinuity && continuityData.confidence >= 0.7;
          console.log(`[processSinglePromptJob] Scene ${sceneIndex + 1}: Continuity ${hasContinuity ? 'DETECTED' : 'NOT detected'} (confidence: ${continuityData.confidence})`);
          console.log(`[processSinglePromptJob] Scene ${sceneIndex + 1}: Previous prompt available: ${!!previousScene?.prompt}`);
          
          // Calculer le groupId : si continuité, utiliser le même groupe que la scène précédente, sinon nouveau groupe
          if (hasContinuity && previousScene?.continuityGroupId !== null && previousScene?.continuityGroupId !== undefined) {
            continuityGroupId = previousScene.continuityGroupId;
            console.log(`[processSinglePromptJob] Scene ${sceneIndex + 1}: Assigned to existing group ${continuityGroupId}`);
          } else {
            // Trouver le prochain groupId disponible
            const existingGroupIds = existingPrompts
              .map((p: any) => p?.continuityGroupId)
              .filter((id: any) => id !== null && id !== undefined) as number[];
            continuityGroupId = existingGroupIds.length > 0 ? Math.max(...existingGroupIds) + 1 : 1;
            console.log(`[processSinglePromptJob] Scene ${sceneIndex + 1}: Assigned to new group ${continuityGroupId}`);
          }
        } else {
          console.error(`[processSinglePromptJob] Scene ${sceneIndex + 1}: Continuity analysis failed: ${continuityResponse.status}`);
        }
      } catch (error) {
        console.error(`[processSinglePromptJob] Scene ${sceneIndex + 1}: Error analyzing continuity:`, error);
      }
    } else {
      console.log(`[processSinglePromptJob] Scene ${sceneIndex + 1}: No previous scene data available for continuity check`);
      // Nouveau groupe si pas de scène précédente
      const existingGroupIds = existingPrompts
        .map((p: any) => p?.continuityGroupId)
        .filter((id: any) => id !== null && id !== undefined) as number[];
      continuityGroupId = existingGroupIds.length > 0 ? Math.max(...existingGroupIds) + 1 : 1;
    }
  } else if (visualContinuityEnabled && sceneIndex === 0) {
    // Première scène = groupe 1
    continuityGroupId = 1;
  }

  // Generate the prompt
  const previousPromptForGeneration = hasContinuity && existingPrompts[sceneIndex - 1]?.prompt 
    ? existingPrompts[sceneIndex - 1].prompt 
    : null;
  
  console.log(`[processSinglePromptJob] Scene ${sceneIndex + 1}: Sending to generate-prompts:`);
  console.log(`[processSinglePromptJob] Scene ${sceneIndex + 1}:   hasContinuity: ${hasContinuity}`);
  console.log(`[processSinglePromptJob] Scene ${sceneIndex + 1}:   previousPrompt: ${previousPromptForGeneration ? previousPromptForGeneration.substring(0, 100) + '...' : 'null'}`);
  console.log(`[processSinglePromptJob] Scene ${sceneIndex + 1}:   continuityElements: ${continuityData ? 'present' : 'null'}`);
  
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
          previousPrompts,
          previousSceneTexts,
          nextSceneTexts,
          // NOUVEAU: Paramètres de continuité
          hasContinuity,
          previousPrompt: previousPromptForGeneration,
          continuityElements: hasContinuity ? continuityData : null
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
    imageUrl: latestPrompts[sceneIndex]?.imageUrl, // Preserve existing image
    continuityGroupId: visualContinuityEnabled ? continuityGroupId : null // NOUVEAU: Stocker l'ID du groupe
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
  let imageWidth = project.image_width || 1920;
  let imageHeight = project.image_height || 1080;
  const imageModel = project.image_model || 'seedream-4.5';
  const visualContinuityEnabled = project.visual_continuity_enabled || false;

  // IMPORTANT: For Z-Image models with 16:9, always generate at 960x544 (will be upscaled later)
  const isZImage = imageModel === 'z-image-turbo' || imageModel === 'z-image-turbo-lora';
  if (isZImage) {
    const ratio = imageWidth / imageHeight;
    const is16x9 = Math.abs(ratio - (16 / 9)) < 0.1;
    if (is16x9) {
      console.log(`Z-Image 16:9 detected - forcing 960x544 for generation (was ${imageWidth}x${imageHeight})`);
      imageWidth = 960;
      imageHeight = 544;
    }
  }

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
  
  console.log(`[processSingleImageJob] Scene ${sceneIndex + 1}: Configuration check:`);
  console.log(`  - imageModel: ${imageModel}`);
  console.log(`  - visualContinuityEnabled: ${visualContinuityEnabled}`);
  console.log(`  - styleReferenceUrls count: ${styleReferenceUrls.length}`);
  console.log(`  - styleReferenceUrls: ${styleReferenceUrls.length > 0 ? styleReferenceUrls.join(', ').substring(0, 100) + '...' : 'NONE'}`);

  // Build webhook URL - use async webhook mode like processImagesJob
  const webhookUrl = `${supabaseUrl}/functions/v1/replicate-webhook`;

  // Visual continuity logic: use previous scene's image as reference if continuity detected
  let finalImageUrls = [...styleReferenceUrls];
  let finalPrompt = prompt.prompt;
  
  if (visualContinuityEnabled && imageModel === 'seedream-4.5' && sceneIndex > 0) {
    const previousScene = prompts[sceneIndex - 1];
    
    if (previousScene?.imageUrl && previousScene?.prompt && previousScene?.text) {
      try {
        console.log(`[processSingleImageJob] Checking continuity for scene ${sceneIndex + 1} (previous: scene ${sceneIndex})`);
        
        const continuityResponse = await fetch(`${supabaseUrl}/functions/v1/analyze-scene-continuity`, {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            currentSceneText: prompt.text || '',
            previousSceneText: previousScene.text || '',
            previousPrompt: previousScene.prompt || ''
          }),
        });
        
        if (continuityResponse.ok) {
          const continuityData = await continuityResponse.json();
          
          if (continuityData.hasContinuity && continuityData.confidence >= 0.7) {
            console.log(`[processSingleImageJob] Continuity detected (confidence: ${continuityData.confidence}) - using previous image as reference`);
            console.log(`[processSingleImageJob] Note: Prompt should already be adapted for continuity (if regenerated via processPromptsJob)`);
            
            // Add previous scene's image as first reference (most important)
            finalImageUrls = [previousScene.imageUrl, ...styleReferenceUrls];
            
            // Prompt should already be adapted during generation, but if it wasn't regenerated, keep original
          } else {
            console.log(`[processSingleImageJob] No continuity detected (confidence: ${continuityData.confidence}) - normal generation`);
          }
        } else {
          console.error(`[processSingleImageJob] Failed to analyze continuity: ${continuityResponse.status}`);
        }
      } catch (continuityError) {
        console.error(`[processSingleImageJob] Error checking continuity:`, continuityError);
        // Continue with normal generation if continuity check fails
      }
    }
  }

  const requestBody: any = {
    prompt: finalPrompt,
    width: imageWidth,
    height: imageHeight,
    model: imageModel,
    async: true,
    webhook_url: webhookUrl, // Use webhook mode
    userId,
  };

  console.log(`[processSingleImageJob] Scene ${sceneIndex + 1}: Final image URLs to send: ${finalImageUrls.length}`);
  if (finalImageUrls.length > 0) {
    requestBody.image_urls = finalImageUrls;
    console.log(`  - URLs: ${finalImageUrls.map(u => u.substring(0, 60) + '...').join(', ')}`);
  } else {
    console.log(`  - NO IMAGE REFERENCES - generating without style reference`);
  }
  
  // Add LoRA parameters for z-image-turbo-lora model
  if (imageModel === 'z-image-turbo-lora') {
    if (project.lora_url) {
      requestBody.lora_url = project.lora_url;
    }
    if (project.lora_steps) {
      requestBody.lora_steps = project.lora_steps;
    }
  }

  // Update job metadata with image model info (for upscaling detection in webhook)
  await adminClient
    .from('generation_jobs')
    .update({
      metadata: {
        ...metadata,
        imageModel,
        imageWidth,
        imageHeight,
        sceneIndex
      }
    })
    .eq('id', jobId);

  // Start async generation with webhook
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

  // Create pending_prediction entry for webhook tracking (like processImagesJob)
  const { error: insertError } = await adminClient
    .from('pending_predictions')
    .insert({
      job_id: jobId,
      prediction_id: predictionId,
      prediction_type: 'scene_image',
      scene_index: sceneIndex,
      project_id: projectId,
      user_id: userId,
      metadata: { 
        prompt: prompt.prompt,
        imageModel,
        imageWidth,
        imageHeight
      },
      status: 'pending'
    });

  if (insertError) {
    console.error(`Failed to create pending_prediction:`, insertError);
  }

  console.log(`[processSingleImageJob] Single image generation started for scene ${sceneIndex + 1}`);
  console.log(`[processSingleImageJob] Job ID: ${jobId}`);
  console.log(`[processSingleImageJob] Prediction ID: ${predictionId}`);
  console.log(`[processSingleImageJob] Webhook URL: ${webhookUrl}`);
  console.log(`[processSingleImageJob] Job will remain in 'processing' status until webhook completes it`);

  // Throw to keep job in processing status - webhook will handle completion and upscale
  throw new Error("WEBHOOK_MODE_ACTIVE");
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
    imageModel,
    textModel
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
      userIdea,
      textModel,
      userId  // Pass userId for internal calls to fetch Replicate API key
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

// Process upscale job - upscales Z-Image generated images using Real-ESRGAN
async function processUpscaleJob(
  jobId: string,
  projectId: string,
  userId: string,
  metadata: Record<string, any>,
  authHeader: string,
  adminClient: any
) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  
  // CHUNK SETTINGS - optimized for speed while avoiding timeout
  const CHUNK_SIZE = 30; // Process 30 images per chunk (was 20)
  
  // Get project data
  const { data: project } = await adminClient
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single();

  if (!project) throw new Error("Project not found");

  const prompts = (project.prompts as any[]) || [];
  
  // Get images that need upscaling:
  // - Have imageUrl (generated)
  // - Are NOT already upscaled (check isUpscaled flag in prompt OR upscaledIndices from current job run)
  // - Image dimensions are below 1920x1080 (if stored)
  const alreadyUpscaledIndices = new Set(metadata.upscaledIndices || []);
  
  let skippedHighRes = 0;
  let skippedAlreadyUpscaled = 0;
  
  const allImagesToUpscale = prompts
    .map((prompt: any, index: number) => ({ prompt, index }))
    .filter(({ prompt, index }: any) => {
      // Must have an image URL
      if (!prompt || !prompt.imageUrl) return false;
      
      // Skip if already marked as upscaled in the prompt
      if (prompt.isUpscaled === true) {
        skippedAlreadyUpscaled++;
        return false;
      }
      
      // Skip if upscaled in this job run (chunk continuation)
      if (alreadyUpscaledIndices.has(index)) {
        skippedAlreadyUpscaled++;
        return false;
      }
      
      // Skip if image dimensions are already >= 1920x1080 (high res)
      const imgWidth = prompt.imageWidth || 0;
      const imgHeight = prompt.imageHeight || 0;
      if (imgWidth >= 1920 && imgHeight >= 1080) {
        console.log(`Skipping scene ${index + 1}: already high-res (${imgWidth}x${imgHeight})`);
        skippedHighRes++;
        return false;
      }
      
      return true;
    });
  
  console.log(`Found ${allImagesToUpscale.length} images to upscale (skipped: ${skippedAlreadyUpscaled} already upscaled, ${skippedHighRes} high-res)`);

  if (allImagesToUpscale.length === 0) {
    console.log("No images to upscale");
    return;
  }

  // Take only CHUNK_SIZE images for this chunk
  const imagesToUpscale = allImagesToUpscale.slice(0, CHUNK_SIZE);
  const remainingAfterChunk = allImagesToUpscale.length - imagesToUpscale.length;
  
  console.log(`CHUNK MODE: Processing ${imagesToUpscale.length} upscales out of ${allImagesToUpscale.length} remaining (${remainingAfterChunk} after this chunk)`);

  // Get current job to preserve total if it's already set (for chunk continuation)
  const { data: currentJob } = await adminClient
    .from('generation_jobs')
    .select('total')
    .eq('id', jobId)
    .single();
  
  // Calculate total global: if this is a continuation, use existing total, otherwise use all images
  const totalGlobal = metadata.isChunkContinuation && currentJob?.total 
    ? currentJob.total 
    : allImagesToUpscale.length;
  
  // Update job metadata with chunk info - keep total global, don't change it
  const { error: updateError } = await adminClient
    .from('generation_jobs')
    .update({
      total: totalGlobal, // Keep total global, not chunk size
      metadata: {
        ...metadata,
        chunkSize: imagesToUpscale.length,
        totalToUpscale: allImagesToUpscale.length,
        remainingAfterChunk,
        isChunkContinuation: metadata.isChunkContinuation || false,
        totalGlobal // Store for reference
      }
    })
    .eq('id', jobId);
  
  if (updateError) {
    console.error(`Failed to update job ${jobId} with chunk info:`, updateError);
  } else {
    console.log(`Job ${jobId}: Updated total=${totalGlobal}, chunkSize=${imagesToUpscale.length}, remaining=${remainingAfterChunk}`)
  }

  // Build webhook URL
  const webhookUrl = `${supabaseUrl}/functions/v1/replicate-webhook`;

  // Use service role key for internal calls
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const internalAuthHeader = `Bearer ${serviceRoleKey}`;

  // Batch settings for sending requests (within the chunk) - optimized for speed
  const BATCH_SIZE = 10; // More parallel requests
  const DELAY_BETWEEN_BATCHES_MS = 500; // 0.5s between batches (was 2s)
  const DELAY_BETWEEN_REQUESTS_MS = 50; // 50ms between requests (was 300ms)

  let startedCount = 0;
  let failedCount = 0;
  
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  
  // Process in batches (within the chunk)
  for (let batchStart = 0; batchStart < imagesToUpscale.length; batchStart += BATCH_SIZE) {
    // Check if job was cancelled before processing batch
    const { data: jobStatus } = await adminClient
      .from('generation_jobs')
      .select('status')
      .eq('id', jobId)
      .single();
    
    if (jobStatus?.status === 'cancelled') {
      console.log(`Job ${jobId} was cancelled, stopping upscale processing`);
      return;
    }
    
    const batch = imagesToUpscale.slice(batchStart, batchStart + BATCH_SIZE);
    console.log(`Processing upscale batch ${Math.floor(batchStart / BATCH_SIZE) + 1}/${Math.ceil(imagesToUpscale.length / BATCH_SIZE)} (${batch.length} images)`);
    
    for (let i = 0; i < batch.length; i++) {
      // Check if job was cancelled before each request
      const { data: currentJobStatus } = await adminClient
        .from('generation_jobs')
        .select('status')
        .eq('id', jobId)
        .single();
      
      if (currentJobStatus?.status === 'cancelled') {
        console.log(`Job ${jobId} was cancelled, stopping upscale processing`);
        return;
      }
      
      const { prompt, index } = batch[i];
      
      try {
        const requestBody = {
          imageUrl: prompt.imageUrl,
          scale: 2,
          faceEnhance: false,
          async: true,
          webhook_url: webhookUrl,
          userId,
        };

        const startResponse = await fetch(`${supabaseUrl}/functions/v1/upscale-image`, {
          method: 'POST',
          headers: {
            'Authorization': internalAuthHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (startResponse.ok) {
          const startData = await startResponse.json();
          const predictionId = startData.predictionId;

          if (predictionId) {
            const { error: insertError } = await adminClient
              .from('pending_predictions')
              .insert({
                job_id: jobId,
                prediction_id: predictionId,
                prediction_type: 'upscale',
                scene_index: index,
                project_id: projectId,
                user_id: userId,
                metadata: { 
                  originalImageUrl: prompt.imageUrl,
                  sceneIndex: index
                },
                status: 'pending'
              });

            if (!insertError) {
              startedCount++;
              console.log(`Scene ${index + 1} upscale started: ${predictionId}`);
            }
          }
        } else {
          const errorText = await startResponse.text().catch(() => 'Unknown error');
          console.error(`Failed to start upscale for scene ${index + 1}: ${errorText}`);
          failedCount++;
        }

        if (i < batch.length - 1) {
          await delay(DELAY_BETWEEN_REQUESTS_MS);
        }

      } catch (error) {
        console.error(`Error starting upscale for scene ${index + 1}:`, error);
        failedCount++;
      }
    }
    
    if (batchStart + BATCH_SIZE < imagesToUpscale.length) {
      console.log(`Batch complete. Waiting ${DELAY_BETWEEN_BATCHES_MS / 1000}s before next batch...`);
      await delay(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  console.log(`Upscale job: Started ${startedCount}/${imagesToUpscale.length} upscales (${failedCount} failed to start)`);

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
        error_message: 'Aucun upscale démarré - vérifiez votre quota Replicate',
        completed_at: new Date().toISOString()
      })
      .eq('id', jobId);
    return;
  }

  // Job stays in 'processing' status - the webhook will mark it complete
  throw new Error("WEBHOOK_MODE_ACTIVE");
}
