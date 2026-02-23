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
  jobType: 'transcription' | 'prompts' | 'images' | 'thumbnails' | 'thumbnails_v2' | 'test_images' | 'single_prompt' | 'single_image' | 'script_generation' | 'audio_generation' | 'upscale';
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
        } else if (jobType === 'images' && metadata.sceneIndices && Array.isArray(metadata.sceneIndices)) {
          // Manual regeneration of specific scenes - allow multiple as long as different scenes
          const requestedScenes = new Set(metadata.sceneIndices as number[]);
          const conflictingJob = activeJobs.find((j: any) => {
            const jobScenes = j.metadata?.sceneIndices;
            if (jobScenes && Array.isArray(jobScenes)) {
              // Check if any scene overlaps
              return jobScenes.some((s: number) => requestedScenes.has(s));
            }
            // If no sceneIndices, it's a full batch - don't allow individual regens during batch
            return true;
          });
          if (conflictingJob) {
            const conflictScenes = conflictingJob.metadata?.sceneIndices;
            return new Response(
              JSON.stringify({ 
                error: conflictScenes 
                  ? "Ces scènes sont déjà en cours de génération"
                  : "Une génération batch est en cours, veuillez attendre",
                existingJobId: conflictingJob.id 
              }),
              { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          // Allow - different scenes being generated
        } else if (jobType === 'upscale' && metadata.sceneIndices && Array.isArray(metadata.sceneIndices)) {
          // Manual upscale of specific scenes - allow multiple as long as different scenes
          const requestedScenes = new Set(metadata.sceneIndices as number[]);
          const conflictingJob = activeJobs.find((j: any) => {
            const jobScenes = j.metadata?.sceneIndices;
            if (jobScenes && Array.isArray(jobScenes)) {
              return jobScenes.some((s: number) => requestedScenes.has(s));
            }
            return true;
          });
          if (conflictingJob) {
            return new Response(
              JSON.stringify({ 
                error: "Ces scènes sont déjà en cours d'upscaling",
                existingJobId: conflictingJob.id 
              }),
              { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
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
    const isStandalone = metadata.standalone === true && (jobType === 'thumbnails' || jobType === 'thumbnails_v2');
    
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
        // If sceneIndices is provided, only count those specific scenes
        const sceneIndices = metadata.sceneIndices as number[] | undefined;
        if (sceneIndices && sceneIndices.length > 0) {
          total = sceneIndices.length;
        } else {
          total = metadata.skipExisting 
            ? prompts.filter((p: any) => p && !p.imageUrl).length
            : prompts.length;
        }
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
    } else if (jobType === 'thumbnails_v2') {
      total = metadata.numThumbnails || 3;
    } else if (jobType === 'script_generation') {
      total = 1; // Single script generation
    } else if (jobType === 'audio_generation') {
      total = 1; // Single audio generation
    } else if (jobType === 'upscale') {
      // Count images that need upscaling
      // If sceneIndices is provided, only count those specific scenes
      const sceneIndices = metadata.sceneIndices as number[] | undefined;
      if (sceneIndices && sceneIndices.length > 0) {
        total = sceneIndices.length;
      } else {
        const prompts = (project?.prompts as any[]) || [];
        total = prompts.filter((p: any) => p && p.imageUrl).length;
      }
    } else if (jobType === 'qa') {
      // Count images to check for quality
      const prompts = (project?.prompts as any[]) || [];
      total = prompts.filter((p: any) => p && p.imageUrl).length;
    } else if (jobType === 'qa_regen') {
      // Count rejected images to regenerate
      const prompts = (project?.prompts as any[]) || [];
      total = prompts.filter((p: any) => p && p.qa_status === 'REJECT' && p.qa_regeneration_prompt).length;
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
    } else if (jobType === 'single_qa') {
      await processSingleQAJob(jobId, projectId, userId, metadata, authHeader, adminClient);
    } else if (jobType === 'thumbnails') {
      // VPS Worker mode: reset to pending so VPS image-worker picks it up
      await adminClient
        .from('generation_jobs')
        .update({ status: 'pending' })
        .eq('id', jobId);
      console.log(`[thumbnails] Job ${jobId} reset to pending for VPS worker`);
      throw new Error('WEBHOOK_MODE_ACTIVE');
    } else if (jobType === 'thumbnails_v2') {
      await adminClient
        .from('generation_jobs')
        .update({ status: 'pending' })
        .eq('id', jobId);
      console.log(`[thumbnails_v2] Job ${jobId} reset to pending for VPS worker`);
      throw new Error('WEBHOOK_MODE_ACTIVE');
    } else if (jobType === 'script_generation') {
      await processScriptGenerationJob(jobId, projectId, userId, metadata, authHeader, adminClient);
    } else if (jobType === 'audio_generation' && metadata?.provider === 'gemini_tts') {
      await adminClient
        .from('generation_jobs')
        .update({ status: 'pending' })
        .eq('id', jobId);
      console.log(`[audio_generation/gemini_tts] Job ${jobId} reset to pending for VPS worker`);
      throw new Error('WEBHOOK_MODE_ACTIVE');
    } else if (jobType === 'audio_generation') {
      await processAudioGenerationJob(jobId, projectId, userId, metadata, authHeader, adminClient);
    } else if (jobType === 'upscale') {
      await processUpscaleJob(jobId, projectId, userId, metadata, authHeader, adminClient);
    } else if (jobType === 'qa') {
      await processQAJob(jobId, projectId, userId, metadata, authHeader, adminClient);
    } else if (jobType === 'qa_regen') {
      await processQARegenJob(jobId, projectId, userId, metadata, authHeader, adminClient);
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
    
    // Check if this is webhook mode or parent job mode - job should stay in processing, not fail
    if (errorMessage === 'WEBHOOK_MODE_ACTIVE' || errorMessage === 'PARENT_JOB_ACTIVE') {
      console.log(`Job ${jobId} is in ${errorMessage} mode - staying in processing status`);
      // Don't mark as completed or failed - child jobs will handle completion
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
      
      // For child jobs (single_prompt, single_image), notify the parent so it can detect completion
      if (currentJobType === 'single_prompt' || currentJobType === 'single_image') {
        try {
          const { data: failedJob } = await adminClient
            .from('generation_jobs')
            .select('parent_job_id')
            .eq('id', jobId)
            .single();
          
          if (failedJob?.parent_job_id) {
            const [{ count: completedCount }, { count: failedCount }] = await Promise.all([
              adminClient.from('generation_jobs').select('id', { count: 'exact', head: true })
                .eq('parent_job_id', failedJob.parent_job_id).eq('status', 'completed'),
              adminClient.from('generation_jobs').select('id', { count: 'exact', head: true })
                .eq('parent_job_id', failedJob.parent_job_id).eq('status', 'failed'),
            ]);
            
            const { data: parentJob } = await adminClient
              .from('generation_jobs')
              .select('total')
              .eq('id', failedJob.parent_job_id)
              .single();
            
            if (parentJob) {
              const doneCount = (completedCount || 0) + (failedCount || 0);
              console.log(`[${currentJobType}] Failed job parent update: ${completedCount} completed + ${failedCount} failed = ${doneCount}/${parentJob.total}`);
              
              await adminClient.from('generation_jobs')
                .update({ progress: completedCount || 0 })
                .eq('id', failedJob.parent_job_id);
              
              if (doneCount >= parentJob.total) {
                console.log(`[${currentJobType}] All children done (${failedCount} failed). Marking parent as completed.`);
                await adminClient.from('generation_jobs')
                  .update({ status: 'completed', completed_at: new Date().toISOString() })
                  .eq('id', failedJob.parent_job_id);
              }
            }
          }
        } catch (parentErr) {
          console.error(`Failed to update parent after child failure:`, parentErr);
        }
      }
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
    // After images, chain to QA for quality check
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
      console.log(`QA regen job ${qaRegenJobs[0].id} is pending/processing, waiting for it to complete before upscaling`);
      return; // Don't chain to upscale yet - wait for qa_regen to finish
    }
    
    // No qa_regen job, proceed to upscale
    nextJobType = 'upscale';
  } else if (completedJobType === 'qa_regen') {
    // After QA regen, chain to upscale
    nextJobType = 'upscale';
  } else if (completedJobType === 'upscale') {
    // After upscale, chain to thumbnails
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
  } else if (nextJobType === 'qa') {
    const prompts = (project.prompts as any[]) || [];
    
    // CRITICAL: Before chaining to QA, verify ALL images are actually generated
    // Count prompts that have a prompt but no image - these need to be generated first
    const missingImages = prompts.filter((p: any) => p && p.prompt && !p.imageUrl).length;
    const totalWithImages = prompts.filter((p: any) => p && p.imageUrl).length;
    const totalWithPrompts = prompts.filter((p: any) => p && p.prompt).length;
    
    console.log(`chainNextJob -> QA check: ${totalWithImages}/${totalWithPrompts} images generated, ${missingImages} missing`);
    
    if (missingImages > 0) {
      console.log(`BLOCKING QA: ${missingImages} images still missing! Queue system will handle completion.`);
      
      // With queue system, jobs stay in processing until webhook completes them
      // Don't create additional jobs - the webhook will handle completion and chaining
      return;
    }
    
    total = totalWithImages;
    
    if (total === 0) {
      console.log("No images to QA check, skipping to next step");
      await chainNextJob(projectId, userId, 'qa', authHeader, adminClient);
      return;
    }
    
    // Fetch qaPrompt from project preset if available
    const presetId = project.preset_id;
    if (presetId) {
      const { data: preset } = await adminClient
        .from('presets')
        .select('qa_prompt')
        .eq('id', presetId)
        .single();
      
      if (preset?.qa_prompt) {
        jobMetadata.qaPrompt = preset.qa_prompt;
        console.log(`Loaded qaPrompt from preset (${preset.qa_prompt.length} chars)`);
      }
    }
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
      console.log("Not Z-Image 16:9, skipping upscale");
      await chainNextJob(projectId, userId, 'upscale', authHeader, adminClient);
      return;
    }
    
    total = prompts.filter((p: any) => p && p.imageUrl).length;
    
    if (total === 0) {
      console.log("No images to upscale, skipping to next step");
      await chainNextJob(projectId, userId, 'upscale', authHeader, adminClient);
      return;
    }
    
    jobMetadata = {
      ...jobMetadata,
      imageModel,
      imageWidth,
      imageHeight
    };
  } else if (nextJobType === 'thumbnails') {
    total = 3; // Always 3 thumbnails
    
    // For thumbnails, we need to fetch the thumbnail preset data
    const thumbnailPresetId = project.thumbnail_preset_id;
    
    if (!thumbnailPresetId) {
      console.log(`No thumbnail preset selected for project ${projectId}. Skipping thumbnails.`);
      console.log(`Semi-automatic pipeline completed for project ${projectId} (without thumbnails)`);
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
        console.log(`Thumbnail generation disabled for channel. Skipping thumbnails.`);
        console.log(`Semi-automatic pipeline completed for project ${projectId} (without thumbnails)`);
        return;
      }
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
      // VPS Worker mode: reset to pending so VPS image-worker picks it up
      await adminClient
        .from('generation_jobs')
        .update({ status: 'pending' })
        .eq('id', jobId);
      console.log(`[thumbnails] Chained job ${jobId} reset to pending for VPS worker`);
      throw new Error('WEBHOOK_MODE_ACTIVE');
    } else if (jobType === 'qa') {
      await processQAJob(jobId, projectId, userId, metadata, authHeader, adminClient);
    } else if (jobType === 'qa_regen') {
      await processQARegenJob(jobId, projectId, userId, metadata, authHeader, adminClient);
    } else if (jobType === 'upscale') {
      await processUpscaleJob(jobId, projectId, userId, metadata, authHeader, adminClient);
    } else {
      console.log(`Unknown job type for chained job: ${jobType}`);
      throw new Error(`Unknown job type: ${jobType}`);
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
  const visualContinuityEnabled = project.visual_continuity_enabled || false;

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
        totalGlobal: scenes.length,
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
    
  } else if (!visualContinuityEnabled) {
    // ========================================================================
    // NEW JOB-BASED PARALLEL ARCHITECTURE (no continuity)
    // Create individual single_prompt jobs and process them in parallel
    // ========================================================================
    console.log(`[processPromptsJob] Using JOB-BASED parallel architecture (no continuity)`);
    
    // CLEANUP: Reset stuck single_prompt jobs (processing for > 2 minutes)
    const TWO_MINUTES_AGO = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: stuckJobs } = await adminClient
      .from('generation_jobs')
      .select('id, scene_index')
      .eq('project_id', projectId)
      .eq('job_type', 'single_prompt')
      .eq('status', 'processing')
      .lt('updated_at', TWO_MINUTES_AGO);
    
    if (stuckJobs && stuckJobs.length > 0) {
      console.log(`[processPromptsJob] CLEANUP: Found ${stuckJobs.length} stuck single_prompt jobs, resetting to pending`);
      const stuckIds = stuckJobs.map((j: any) => j.id);
      await adminClient
        .from('generation_jobs')
        .update({ status: 'pending', updated_at: new Date().toISOString() })
        .in('id', stuckIds);
      console.log(`[processPromptsJob] CLEANUP: Reset ${stuckIds.length} jobs (scenes: ${stuckJobs.map((j: any) => j.scene_index + 1).join(', ')})`);
    }
    
    // Check for existing pending/processing jobs for this project
    const { data: existingJobs } = await adminClient
      .from('generation_jobs')
      .select('id, scene_index, status, parent_job_id')
      .eq('project_id', projectId)
      .eq('job_type', 'single_prompt')
      .in('status', ['pending', 'processing']);
    
    // Reassign orphaned jobs (from old parents) to this new parent
    const orphanedJobs = (existingJobs || []).filter((j: any) => j.parent_job_id !== jobId);
    if (orphanedJobs.length > 0) {
      const orphanIds = orphanedJobs.map((j: any) => j.id);
      await adminClient
        .from('generation_jobs')
        .update({ parent_job_id: jobId })
        .in('id', orphanIds);
      console.log(`[processPromptsJob] Reassigned ${orphanedJobs.length} orphaned jobs to this parent`);
    }
    
    const existingSceneIndices = new Set((existingJobs || []).map((j: any) => j.scene_index));
    
    // Filter out scenes that already have jobs
    const scenesToCreate = allScenesToProcess.filter(({ index }: any) => !existingSceneIndices.has(index));
    
    if (scenesToCreate.length === 0 && existingJobs && existingJobs.length > 0) {
      console.log(`[processPromptsJob] All ${allScenesToProcess.length} scenes already have jobs (pending for VPS worker)`);
      // VPS Worker mode: jobs stay pending, VPS image-worker picks them up
      throw new Error('WEBHOOK_MODE_ACTIVE');
    }
    
    console.log(`[processPromptsJob] Creating ${scenesToCreate.length} individual single_prompt jobs (${existingSceneIndices.size} already exist)`);
    
    // Create individual jobs only for scenes that don't already have jobs
    const individualJobs = scenesToCreate.map(({ scene, index }: any) => ({
      project_id: projectId,
      user_id: userId,
      job_type: 'single_prompt',
      status: 'pending',
      scene_index: index,
      total: 1,
      progress: 0,
      parent_job_id: jobId,
      metadata: {
        sceneIndex: index,
        sceneText: scene.text,
        startTime: scene.startTime,
        endTime: scene.endTime,
        summary,
        examplePrompts: filteredExamples,
        customSystemPrompt,
        totalScenes: scenes.length
      }
    }));
    
    let createdJobsCount = 0;
    if (individualJobs.length > 0) {
      const { data: createdJobs, error: jobsError } = await adminClient
        .from('generation_jobs')
        .insert(individualJobs)
        .select('id, scene_index');
      
      if (jobsError) {
        throw new Error(`Failed to create individual prompt jobs: ${jobsError.message}`);
      }
      
      createdJobsCount = createdJobs?.length || 0;
      console.log(`[processPromptsJob] Created ${createdJobsCount} individual single_prompt jobs`);
    }
    
    // Update parent job total to reflect all scenes that need prompts
    await adminClient
      .from('generation_jobs')
      .update({ 
        total: allScenesToProcess.length,
        metadata: {
          ...metadata,
          totalGlobal: scenes.length,
          totalMissing: allScenesToProcess.length,
          useJobBasedParallel: true
        }
      })
      .eq('id', jobId);
    
    // VPS Worker mode: jobs stay pending, VPS image-worker picks them up
    console.log(`[processPromptsJob] Created ${createdJobsCount} prompt jobs (pending for VPS worker)`);
    throw new Error('WEBHOOK_MODE_ACTIVE');
    
  } else {
    // PARALLEL processing with continuity (original behavior - uses pre-analyzed continuity data)
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

  // Save prompts to legacy JSON
  await adminClient
    .from('projects')
    .update({ prompts: newPrompts })
    .eq('id', projectId);

  // ROBUST ARCHITECTURE: Save each generated prompt to project_scenes table
  const scenesToUpsert = newPrompts.map((p: any, index: number) => ({
    project_id: projectId,
    scene_index: index,
    prompt: p.prompt,
    image_url: p.imageUrl || null,
    continuity_group_id: p.continuityGroupId || null,
    updated_at: new Date().toISOString()
  }));

  if (scenesToUpsert.length > 0) {
    const { error: upsertError } = await adminClient
      .from('project_scenes')
      .upsert(scenesToUpsert, { onConflict: 'project_id,scene_index' });
    
    if (upsertError) {
      console.error(`[processPromptsJob] Error upserting to project_scenes:`, upsertError.message);
    } else {
      console.log(`[processPromptsJob] Successfully synced ${scenesToUpsert.length} scenes to project_scenes table`);
    }
  }

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
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  
  // Get project data
  const { data: project } = await adminClient
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single();

  if (!project) throw new Error("Project not found");

  // If project is missing settings but has preset_id, copy from preset to project
  if (project.preset_id) {
    const needsLoraFromPreset = !project.lora_url || project.lora_url === '';
    const needsStyleRefFromPreset = !project.style_reference_url || project.style_reference_url === '' || project.style_reference_url === '[]';
    
    if (needsLoraFromPreset || needsStyleRefFromPreset) {
      const { data: preset } = await adminClient
        .from('presets')
        .select('lora_url, lora_steps, style_reference_url')
        .eq('id', project.preset_id)
        .single();
      
      const updateData: any = {};
      
      if (needsLoraFromPreset && preset?.lora_url) {
        updateData.lora_url = preset.lora_url;
        updateData.lora_steps = preset.lora_steps || 10;
        project.lora_url = preset.lora_url;
        project.lora_steps = preset.lora_steps || 10;
        console.log(`[processImagesJob] Copied LoRA from preset to project: ${preset.lora_url}, steps: ${project.lora_steps}`);
      }
      
      if (needsStyleRefFromPreset && preset?.style_reference_url) {
        updateData.style_reference_url = preset.style_reference_url;
        project.style_reference_url = preset.style_reference_url;
        console.log(`[processImagesJob] Copied style_reference_url from preset to project`);
      }
      
      if (Object.keys(updateData).length > 0) {
        await adminClient
          .from('projects')
          .update(updateData)
          .eq('id', projectId);
      }
    }
  }

  const prompts = (project.prompts as any[]) || [];
  
  // Enrich prompts with project_scenes data (source of truth for prompt text and image URLs)
  // This fixes desync where image-worker updates project_scenes but not projects.prompts JSON
  const { data: dbScenes } = await adminClient
    .from('project_scenes')
    .select('scene_index, prompt, image_url, upscaled_url')
    .eq('project_id', projectId);
  
  if (dbScenes && dbScenes.length > 0) {
    const sceneMap = new Map(dbScenes.map((s: any) => [s.scene_index, s]));
    let enrichedCount = 0;
    
    for (const [idx, scene] of sceneMap as any) {
      if (idx >= prompts.length) continue;
      if (!prompts[idx]) prompts[idx] = {};
      
      if (!prompts[idx].prompt && scene.prompt) {
        prompts[idx].prompt = scene.prompt;
        enrichedCount++;
      }
      if (scene.image_url && !prompts[idx].imageUrl) {
        prompts[idx].imageUrl = scene.image_url;
      }
      if (scene.upscaled_url && !prompts[idx].upscaledUrl) {
        prompts[idx].upscaledUrl = scene.upscaled_url;
      }
    }
    
    if (enrichedCount > 0) {
      console.log(`[processImagesJob] Enriched ${enrichedCount} prompts from project_scenes`);
      await adminClient.from('projects').update({ prompts }).eq('id', projectId);
    }
  }
  
  let imageWidth = project.image_width || 1920;
  let imageHeight = project.image_height || 1080;
  const imageModel = project.image_model || 'seedream-4.5';
  const visualContinuityEnabled = project.visual_continuity_enabled || false;
  
  console.log(`[processImagesJob] Project config: model=${imageModel}, lora_url=${project.lora_url || 'NONE'}, lora_steps=${project.lora_steps || 10}, style_ref=${project.style_reference_url ? 'SET' : 'NONE'}`);
  
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

  // Filter prompts that need images
  const skipExisting = metadata.skipExisting !== false;
  
  // ========================================================================
  // SIMPLE ARCHITECTURE: 1 JOB PER IMAGE
  // ========================================================================
  // Create individual jobs for each image with global concurrency control
  // ========================================================================
  if (true) {
    console.log(`[processImagesJob] Using SIMPLE architecture (1 job per image) for project ${projectId}`);
    
    // Get prompts that need images
    // If sceneIndices is provided, only process those specific scenes
    const sceneIndices = metadata.sceneIndices as number[] | undefined;
    const promptsToProcess = prompts
      .map((prompt: any, index: number) => ({ prompt, index }))
      .filter(({ prompt, index }: any) => {
        // If sceneIndices is specified, only include those scenes
        if (sceneIndices && sceneIndices.length > 0) {
          if (!sceneIndices.includes(index)) return false;
        }
        return prompt && prompt.prompt && (!skipExisting || !prompt.imageUrl);
      });
    
    if (promptsToProcess.length === 0) {
      console.log("[processImagesJob] No images to generate (all have images)");
      await adminClient
        .from('generation_jobs')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', jobId);
      return;
    }
    
    const totalImages = promptsToProcess.length;
    const isSingleRegen = sceneIndices && sceneIndices.length === 1;
    console.log(`[processImagesJob] Creating ${totalImages} individual jobs (1 per image)${isSingleRegen ? ' [SINGLE REGEN]' : ''}`);
    
    // Mark parent job as the coordinator
    await adminClient
      .from('generation_jobs')
      .update({
        total: totalImages,
        status: 'processing',
        metadata: {
          ...metadata,
          isParentJob: true,
          childJobsCount: totalImages,
          total_scenes: isSingleRegen ? totalImages : prompts.length // For single regen, don't show full count
        },
      })
      .eq('id', jobId);
    
    // Create individual jobs for each image
    const individualJobs = promptsToProcess.map(({ prompt, index }: any) => ({
      project_id: projectId,
      user_id: userId,
      job_type: 'single_image',
      status: 'pending',
      progress: 0,
      total: 1,
      parent_job_id: jobId,
      scene_index: index,
      metadata: {
        prompt: prompt.prompt,
        model: imageModel,
        width: imageWidth,
        height: imageHeight,
        styleRefs: styleReferenceUrls,
        loraUrl: project.lora_url || null,
        loraSteps: project.lora_steps || 10,
        useWebhook: true,
      },
    }));
    
    console.log(`[processImagesJob] Jobs metadata includes loraUrl: ${project.lora_url || 'NONE'}`);
    
    const { data: createdJobs, error: jobsError } = await adminClient
      .from('generation_jobs')
      .insert(individualJobs)
      .select('id, scene_index');
    
    if (jobsError) {
      throw new Error(`Failed to create individual jobs: ${jobsError.message}`);
    }
    
    console.log(`[processImagesJob] Created ${createdJobs.length} individual jobs (pending for VPS worker)`);
    
    // VPS Worker mode: jobs are left as 'pending' and the VPS image-worker will
    // pick them up, generate images, run QA, upscale, and update the DB directly.
    // No Edge Function concurrency limit or webhook needed.
    
    console.log(`[processImagesJob] Parent job ${jobId} stays in processing until all children complete`);
    throw new Error('WEBHOOK_MODE_ACTIVE');
  }
  
  // ========================================================================
  // LEGACY SYSTEM (unchanged for backward compatibility)
  // ========================================================================
  
  // CHUNK SETTINGS - optimized for speed while avoiding timeout
  const FIRST_CHUNK_SIZE = 30; // First chunk (was 20)
  const SUBSEQUENT_CHUNK_SIZE = 50; // Subsequent chunks
  const isFirstChunk = !metadata.isChunkContinuation;
  const CHUNK_SIZE = isFirstChunk ? FIRST_CHUNK_SIZE : SUBSEQUENT_CHUNK_SIZE;
  
  // FIRST: Clean up stuck predictions (pending/processing for > 5 minutes)
  // This allows scenes with stuck predictions to be retried
  const FIVE_MINUTES_AGO = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  
  const { data: stuckPredictions } = await adminClient
    .from('pending_predictions')
    .select('id, scene_index')
    .eq('project_id', projectId)
    .eq('prediction_type', 'scene_image')
    .in('status', ['pending', 'processing', 'starting'])
    .lt('created_at', FIVE_MINUTES_AGO);
  
  if (stuckPredictions && stuckPredictions.length > 0) {
    console.log(`CLEANUP: Found ${stuckPredictions.length} stuck predictions older than 5 minutes, marking as failed`);
    const stuckIds = stuckPredictions.map((p: any) => p.id);
    await adminClient
      .from('pending_predictions')
      .update({ 
        status: 'failed', 
        error_message: 'Timeout - cleaned up automatically',
        completed_at: new Date().toISOString()
      })
      .in('id', stuckIds);
    console.log(`CLEANUP: Marked ${stuckIds.length} stuck predictions as failed (scenes: ${stuckPredictions.slice(0, 5).map((p: any) => p.scene_index + 1).join(', ')}...)`);
  }
  
  // NOW check for active predictions (after cleanup)
  // This prevents creating new predictions for scenes that are REALLY still being processed
  const { data: activePredictions } = await adminClient
    .from('pending_predictions')
    .select('scene_index')
    .eq('project_id', projectId)
    .eq('prediction_type', 'scene_image')
    .in('status', ['pending', 'processing', 'starting']);
  
  const scenesWithActivePredictions = new Set(
    (activePredictions || []).map((p: any) => p.scene_index)
  );
  
  if (scenesWithActivePredictions.size > 0) {
    console.log(`DUPLICATE PREVENTION: ${scenesWithActivePredictions.size} scenes already have active predictions: [${Array.from(scenesWithActivePredictions).slice(0, 10).join(', ')}${scenesWithActivePredictions.size > 10 ? '...' : ''}]`);
  }
  
  const allPromptsToProcess = prompts
    .map((prompt: any, index: number) => ({ prompt, index }))
    .filter(({ prompt, index }: any) => 
      prompt && 
      (!skipExisting || !prompt.imageUrl) &&
      !scenesWithActivePredictions.has(index) // Skip scenes with active predictions
    );

  if (allPromptsToProcess.length === 0) {
    console.log("No images to generate (all have images or active predictions)");
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
        totalGlobal: prompts.length,
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

      // IMPORTANT: In continuity mode we don't rely on Replicate webhooks to chain chunks.
      // So we must explicitly create & start the next chunk if images are still missing.
      const { data: projectAfterContinuity } = await adminClient
        .from('projects')
        .select('prompts')
        .eq('id', projectId)
        .single();

      const promptsAfterContinuity = (projectAfterContinuity?.prompts as any[]) || [];
      const missingCountAfterContinuity = promptsAfterContinuity.filter((p: any) => p?.prompt && !p?.imageUrl).length;

      console.log(`[processImagesJob] Continuity chunk complete. Project has ${missingCountAfterContinuity} images still missing`);

      if (missingCountAfterContinuity > 0) {
        // Prevent duplicate pending/processing images jobs
        const { data: existingChunkJobs } = await adminClient
          .from('generation_jobs')
          .select('id')
          .eq('project_id', projectId)
          .eq('job_type', 'images')
          .in('status', ['pending', 'processing'])
          .limit(1);

        const existingChunkJob = existingChunkJobs?.[0];
        if (existingChunkJob) {
          console.log(`[processImagesJob] Next chunk job ${existingChunkJob.id} already exists, skipping creation`);
          return;
        }

        const { data: nextChunkJob, error: chunkError } = await adminClient
          .from('generation_jobs')
          .insert({
            project_id: projectId,
            user_id: userId,
            job_type: 'images',
            status: 'pending',
            progress: 0,
            total: Math.min(missingCountAfterContinuity, SUBSEQUENT_CHUNK_SIZE),
            metadata: {
              ...metadata,
              skipExisting: true,
              isChunkContinuation: true
            }
          })
          .select()
          .single();

        if (chunkError) {
          console.error(`[processImagesJob] Error creating next continuity chunk job:`, chunkError);
        } else {
          console.log(`[processImagesJob] Created next continuity chunk job ${nextChunkJob.id} (${Math.min(missingCountAfterContinuity, SUBSEQUENT_CHUNK_SIZE)} images)`);
          EdgeRuntime.waitUntil(
            processJob(
              nextChunkJob.id,
              projectId,
              'images',
              userId,
              { ...metadata, skipExisting: true, isChunkContinuation: true },
              authHeader
            )
          );
        }

        return;
      }
      
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
    // Check if job was cancelled before processing batch
    const { data: jobStatus } = await adminClient
      .from('generation_jobs')
      .select('status')
      .eq('id', jobId)
      .single();
    
    if (jobStatus?.status === 'cancelled') {
      console.log(`Job ${jobId} was cancelled, stopping image generation`);
      return;
    }
    
    const batch = promptsToProcess.slice(batchStart, batchStart + BATCH_SIZE);
    console.log(`Processing batch ${Math.floor(batchStart / BATCH_SIZE) + 1}/${Math.ceil(promptsToProcess.length / BATCH_SIZE)} (${batch.length} images)`);
    
    for (let i = 0; i < batch.length; i++) {
      // Check if job was cancelled before each image request
      const { data: currentJobStatus } = await adminClient
        .from('generation_jobs')
        .select('status')
        .eq('id', jobId)
        .single();
      
      if (currentJobStatus?.status === 'cancelled') {
        console.log(`Job ${jobId} was cancelled, stopping image generation`);
        return;
      }
      
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
        
        // Add LoRA parameters for z-image-turbo-lora model
        if (imageModel === 'z-image-turbo-lora') {
          if (project.lora_url) {
            requestBody.lora_url = project.lora_url;
            console.log(`[processImagesJob] Adding LoRA to request: ${project.lora_url}, steps: ${project.lora_steps}`);
          }
          if (project.lora_steps) {
            requestBody.lora_steps = project.lora_steps;
          }
        }

        let lastError = '';
        let success = false;
        
        for (let retry = 0; retry <= MAX_RETRIES; retry++) {
          // Check if job was cancelled before retry attempt
          const { data: retryJobStatus } = await adminClient
            .from('generation_jobs')
            .select('status')
            .eq('id', jobId)
            .single();
          
          if (retryJobStatus?.status === 'cancelled') {
            console.log(`Job ${jobId} was cancelled, stopping retry attempts for scene ${index + 1}`);
            return;
          }
          
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
                
                // IMPORTANT: keep job.total in sync with the number of tracked predictions.
                // This prevents webhook completion from waiting forever if the Edge Function
                // is interrupted before reaching the end-of-chunk "total" update.
                if (startedCount === 1 || startedCount % 5 === 0) {
                  await adminClient
                    .from('generation_jobs')
                    .update({ total: startedCount })
                    .eq('id', jobId);
                }
                success = true;
                break;
              } else if (insertError.code === '23505') {
                // Unique constraint violation - prediction already exists for this scene
                // This is OK - another process already created it, skip this scene
                console.log(`Scene ${index + 1}: Prediction already exists (duplicate prevented by DB), skipping`);
                success = true; // Consider it a success - scene is being processed
                break;
              } else {
                console.error(`Scene ${index + 1}: Insert error: ${insertError.message}`);
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

  // If no predictions were started, check if there are still images to generate
  if (startedCount === 0) {
    // Re-check how many images are actually missing
    const { data: projectCheck } = await adminClient
      .from('projects')
      .select('prompts')
      .eq('id', projectId)
      .single();
    
    const promptsCheck = (projectCheck?.prompts as any[]) || [];
    const stillMissingCount = promptsCheck.filter((p: any) => p?.prompt && !p?.imageUrl).length;
    
    if (stillMissingCount > 0) {
      // Images are still missing but we couldn't create predictions
      // This might be because duplicates were blocked - mark job as completed and let check-stuck-jobs handle it
      console.log(`No new predictions started but ${stillMissingCount} images still missing. Marking job completed to allow retry.`);
      await adminClient
        .from('generation_jobs')
        .update({ 
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        .eq('id', jobId);
      
      // Trigger check-stuck-jobs to clean up and retry
      EdgeRuntime.waitUntil((async () => {
        await new Promise(resolve => setTimeout(resolve, 5000));
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        try {
          await fetch(`${supabaseUrl}/functions/v1/check-stuck-jobs`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ projectId }),
          });
        } catch (e) {
          console.error('Failed to trigger check-stuck-jobs:', e);
        }
      })());
      return;
    }
    
    // No images missing - job is done
    await adminClient
      .from('generation_jobs')
      .update({ 
        status: 'completed',
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

/**
 * Start a single image generation job
 * Called for individual jobs in the new simple architecture
 */
async function startSingleImageJob(
  jobId: string,
  adminClient: any,
  supabaseUrl: string,
  supabaseServiceKey: string
): Promise<void> {
  console.log(`[startSingleImageJob] Starting job ${jobId}`);
  
  // Get job details
  const { data: job, error: jobError } = await adminClient
    .from('generation_jobs')
    .select('project_id, scene_index, metadata, user_id')
    .eq('id', jobId)
    .single();
  
  if (jobError || !job) {
    console.error(`[startSingleImageJob] Job ${jobId} not found`);
    return;
  }
  
  const { project_id, scene_index, metadata, user_id } = job;
  
  // Mark as processing
  await adminClient
    .from('generation_jobs')
    .update({ status: 'processing' })
    .eq('id', jobId);
  
  console.log(`[startSingleImageJob] Calling Replicate for scene ${scene_index}`);
  
  // Call generate-image-seedream
  try {
    const requestBody: any = {
      prompt: metadata.prompt,
      model: metadata.model,
      width: metadata.width,
      height: metadata.height,
      image_urls: metadata.styleRefs || [],
      async: true,
      webhook_url: `${supabaseUrl}/functions/v1/replicate-webhook`,
      userId: user_id,
      projectId: project_id,
      sceneIndex: scene_index,
      jobId: jobId,
    };
    
    // Add LoRA from metadata if present
    if (metadata.loraUrl) {
      requestBody.lora_url = metadata.loraUrl;
      requestBody.lora_steps = metadata.loraSteps || 10;
      console.log(`[startSingleImageJob] Adding LoRA to request: ${metadata.loraUrl}, steps: ${requestBody.lora_steps}`);
    }
    
    const response = await fetch(`${supabaseUrl}/functions/v1/generate-image-seedream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify(requestBody),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Replicate API call failed: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json();
    const predictionId = result.predictionId;
    console.log(`[startSingleImageJob] Job ${jobId} started, prediction: ${predictionId}`);
    
    // Create pending_prediction entry for webhook tracking
    await adminClient
      .from('pending_predictions')
      .insert({
        job_id: jobId,
        prediction_id: predictionId,
        prediction_type: 'scene_image',
        scene_index: scene_index,
        project_id: project_id,
        user_id: user_id,
        metadata: {
          singleImageJob: true,
          ...metadata,
        },
        status: 'pending',
      });
    
  } catch (error) {
    console.error(`[startSingleImageJob] Error starting job ${jobId}:`, error);
    await adminClient
      .from('generation_jobs')
      .update({ 
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        completed_at: new Date().toISOString()
      })
      .eq('id', jobId);
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

  // If project has no lora_url but has preset_id, copy LoRA from preset to project
  if ((!project.lora_url || project.lora_url === '') && project.preset_id) {
    const { data: preset } = await adminClient
      .from('presets')
      .select('lora_url, lora_steps')
      .eq('id', project.preset_id)
      .single();
    
    if (preset?.lora_url) {
      await adminClient
        .from('projects')
        .update({ 
          lora_url: preset.lora_url, 
          lora_steps: preset.lora_steps || 10 
        })
        .eq('id', projectId);
      
      project.lora_url = preset.lora_url;
      project.lora_steps = preset.lora_steps || 10;
      console.log(`[processTestImagesJob] Copied LoRA from preset to project: ${preset.lora_url}, steps: ${project.lora_steps}`);
    }
  }
  
  console.log(`[processTestImagesJob] Project config: model=${project.image_model}, lora_url=${project.lora_url || 'NONE'}`);

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
          console.log(`[processTestImagesJob] Adding LoRA to request: ${project.lora_url}, steps: ${project.lora_steps}`);
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
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const internalAuthHeader = `Bearer ${serviceRoleKey}`;
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
            'Authorization': internalAuthHeader,
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
      'Authorization': internalAuthHeader,
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

  // ATOMIC UPDATE: Use RPC to update prompt at specific index without race conditions
  // This prevents lost updates when multiple prompt jobs complete simultaneously
  const { error: rpcError } = await adminClient.rpc('update_prompt_in_array', {
    p_project_id: projectId,
    p_scene_index: sceneIndex,
    p_prompt: newPrompt,
    p_scene_text: scene.text,
    p_start_time: scene.startTime,
    p_end_time: scene.endTime
  });
  
  if (rpcError) {
    // Fallback to non-atomic update if RPC not available
    console.warn(`[processSinglePromptJob] Atomic RPC failed, using fallback: ${rpcError.message}`);
    
    const { data: latestProject } = await adminClient
      .from('projects')
      .select('prompts')
      .eq('id', projectId)
      .single();

    const latestPrompts = (latestProject?.prompts as any[]) || [];
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
      imageUrl: latestPrompts[sceneIndex]?.imageUrl,
      continuityGroupId: visualContinuityEnabled ? continuityGroupId : null
    };

    const { error: updateError } = await adminClient
      .from('projects')
      .update({ prompts: updatedPrompts })
      .eq('id', projectId);

    if (updateError) {
      throw new Error(`Failed to save prompts: ${updateError.message}`);
    }
  } else {
    console.log(`[processSinglePromptJob] Prompt saved atomically for scene ${sceneIndex + 1}`);
  }

  console.log(`Single prompt job: prompts saved for scene ${sceneIndex + 1}`);

  // Also save to project_scenes table for consistency
  const { error: sceneError } = await adminClient
    .from('project_scenes')
    .upsert({
      project_id: projectId,
      scene_index: sceneIndex,
      prompt: newPrompt,
      continuity_group_id: visualContinuityEnabled ? continuityGroupId : null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'project_id,scene_index' });
  
  if (sceneError) {
    console.error(`[processSinglePromptJob] Error upserting to project_scenes:`, sceneError.message);
  }

  // Get job info to check for parent
  const { data: job } = await adminClient
    .from('generation_jobs')
    .select('parent_job_id')
    .eq('id', jobId)
    .single();

  // Mark this job as completed
  await adminClient
    .from('generation_jobs')
    .update({ 
      progress: 1, 
      status: 'completed',
      completed_at: new Date().toISOString()
    })
    .eq('id', jobId);

  // If this job has a parent, update parent progress and check completion
  if (job?.parent_job_id) {
    console.log(`[processSinglePromptJob] Scene ${sceneIndex + 1}: Updating parent job ${job.parent_job_id}`);
    
    // Count completed AND failed sibling jobs (both mean "done processing")
    const [{ count: completedCount }, { count: failedCount }] = await Promise.all([
      adminClient
        .from('generation_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('parent_job_id', job.parent_job_id)
        .eq('job_type', 'single_prompt')
        .eq('status', 'completed'),
      adminClient
        .from('generation_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('parent_job_id', job.parent_job_id)
        .eq('job_type', 'single_prompt')
        .eq('status', 'failed'),
    ]);
    
    // Get parent job total
    const { data: parentJob } = await adminClient
      .from('generation_jobs')
      .select('total, project_id, user_id, metadata')
      .eq('id', job.parent_job_id)
      .single();
    
    if (parentJob) {
      const successCount = completedCount || 0;
      const failCount = failedCount || 0;
      const doneCount = successCount + failCount;
      
      // Update parent progress (show successful completions)
      await adminClient
        .from('generation_jobs')
        .update({ progress: successCount })
        .eq('id', job.parent_job_id);
      
      console.log(`[processSinglePromptJob] Parent progress: ${successCount} completed, ${failCount} failed, ${doneCount}/${parentJob.total} done`);
      
      // Check if all prompts are done (completed + failed = total)
      if (doneCount >= parentJob.total) {
        console.log(`[processSinglePromptJob] All ${parentJob.total} prompts done (${successCount} OK, ${failCount} failed). Marking parent as completed.`);
        
        // Mark parent as completed
        await adminClient
          .from('generation_jobs')
          .update({ 
            status: 'completed',
            completed_at: new Date().toISOString()
          })
          .eq('id', job.parent_job_id);
        
        // Chain to images ONLY if explicitly requested (default: no chaining)
        const shouldChainToImages = parentJob.metadata?.chainToImages === true;
        if (shouldChainToImages) {
          console.log(`[processSinglePromptJob] Chaining to images generation (explicitly requested)...`);
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          
          // Create images job
          fetch(`${supabaseUrl}/functions/v1/start-generation-job`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${serviceRoleKey}`
            },
            body: JSON.stringify({
              projectId: parentJob.project_id,
              userId: parentJob.user_id,
              jobType: 'images'
            })
          }).catch(err => console.error(`[processSinglePromptJob] Error chaining to images:`, err));
        }
      } else {
        // VPS Worker mode: next prompt job will be picked up by VPS worker
        console.log(`[processSinglePromptJob] Prompt completed, VPS worker handles next pending jobs`);
      }
    }
  }
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

  // If project has no lora_url but has preset_id, copy LoRA from preset to project
  if ((!project.lora_url || project.lora_url === '') && project.preset_id) {
    const { data: preset } = await adminClient
      .from('presets')
      .select('lora_url, lora_steps')
      .eq('id', project.preset_id)
      .single();
    
    if (preset?.lora_url) {
      await adminClient
        .from('projects')
        .update({ 
          lora_url: preset.lora_url, 
          lora_steps: preset.lora_steps || 10 
        })
        .eq('id', projectId);
      
      project.lora_url = preset.lora_url;
      project.lora_steps = preset.lora_steps || 10;
      console.log(`[processSingleImageJob] Copied LoRA from preset to project: ${preset.lora_url}, steps: ${project.lora_steps}`);
    }
  }

  const prompts = (project.prompts as any[]) || [];
  let imageWidth = project.image_width || 1920;
  let imageHeight = project.image_height || 1080;
  const imageModel = project.image_model || 'seedream-4.5';
  const visualContinuityEnabled = project.visual_continuity_enabled || false;

  console.log(`[processSingleImageJob] Scene ${sceneIndex + 1}: model=${imageModel}`);
  console.log(`[processSingleImageJob] Scene ${sceneIndex + 1}: lora_url="${project.lora_url}" (type: ${typeof project.lora_url}, truthy: ${!!project.lora_url})`);
  console.log(`[processSingleImageJob] Scene ${sceneIndex + 1}: lora_steps=${project.lora_steps}`);

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

  // Try to get prompt from project.prompts first, fallback to project_scenes
  let prompt = prompts[sceneIndex];
  
  if (!prompt || !prompt.prompt || prompt.prompt === "Erreur lors de la génération") {
    // Fallback: try project_scenes table
    console.log(`[processSingleImageJob] Prompt not found in project.prompts, trying project_scenes...`);
    const { data: sceneData } = await adminClient
      .from('project_scenes')
      .select('prompt')
      .eq('project_id', projectId)
      .eq('scene_index', sceneIndex)
      .single();
    
    if (sceneData?.prompt) {
      prompt = { prompt: sceneData.prompt, text: '' };
      console.log(`[processSingleImageJob] Found prompt in project_scenes: ${sceneData.prompt.substring(0, 50)}...`);
    } else {
      throw new Error(`Prompt at index ${sceneIndex} not found in project.prompts or project_scenes`);
    }
  }
  
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
  console.log(`[processSingleImageJob] LoRA check: imageModel="${imageModel}", project.lora_url="${project.lora_url}"`);
  if (imageModel === 'z-image-turbo-lora') {
    console.log(`[processSingleImageJob] Model is z-image-turbo-lora, checking lora_url...`);
    if (project.lora_url) {
      requestBody.lora_url = project.lora_url;
      requestBody.lora_steps = project.lora_steps || 10;
      console.log(`[processSingleImageJob] ✅ ADDING LoRA to request: ${project.lora_url}, steps: ${requestBody.lora_steps}`);
    } else {
      console.log(`[processSingleImageJob] ⚠️ NO LoRA - project.lora_url is empty/null`);
    }
  } else {
    console.log(`[processSingleImageJob] Model is NOT z-image-turbo-lora, skipping LoRA`);
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

  // Log full requestBody before sending
  console.log(`[processSingleImageJob] Full requestBody:`, JSON.stringify(requestBody, null, 2));

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
    if (insertError.code === '23505') {
      // Unique constraint violation - prediction already exists for this scene
      console.log(`[processSingleImageJob] Scene ${sceneIndex + 1}: Prediction already exists (duplicate prevented by DB)`);
      // The image is already being generated, don't throw error
    } else {
      console.error(`Failed to create pending_prediction:`, insertError);
    }
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
  console.log("Image model:", imageModel || 'seedream-4.5');
  console.log("Text model used:", textModel || 'gemini (default)');

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
  let failedCount = 0;
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
      console.log(`Starting thumbnail ${i + 1} with model ${imageModel || 'seedream-4.5'}, webhook: ${webhookUrl}`);
      const startResponse = await fetch(`${supabaseUrl}/functions/v1/generate-image-seedream`, {
        method: 'POST',
        headers: {
          'Authorization': internalAuthHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...requestBody, userId }),
      });

      if (!startResponse.ok) {
        const errorBody = await startResponse.text();
        console.error(`Failed to start thumbnail ${i + 1}: ${startResponse.status} - ${errorBody}`);
        failedCount++;
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
      failedCount++;
    }
  }

  // Check if any predictions were successfully created
  const { data: createdPredictions } = await adminClient
    .from('pending_predictions')
    .select('id')
    .eq('job_id', jobId);
  
  const successCount = createdPredictions?.length || 0;
  
  if (successCount === 0) {
    // All 3 thumbnail generations failed - mark job as failed
    throw new Error(`Toutes les générations de miniatures ont échoué. Vérifiez votre clé API Replicate.`);
  }

  // Job stays in 'processing' status - the webhook will mark it complete
  // Do NOT mark as completed here - that's the webhook's job
  console.log(`Thumbnail generations started: ${successCount}/3 successful. Waiting for webhooks...`);
  
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
    provider,
    stability,
    similarity,
    style,
    useSpeakerBoost,
    forceElevenLabsTranscription
  } = metadata;
  
  if (!script) {
    throw new Error("Script is required for audio generation");
  }
  
  console.log(`Starting audio generation job ${jobId}, provider: ${provider || 'minimax'}`);
  
  // Call the appropriate TTS function based on provider
  let functionName: string;
  if (provider === 'genaipro') {
    functionName = 'generate-audio-genaipro';
  } else if (provider === 'inworld') {
    functionName = 'generate-audio-inworld';
  } else if (provider === 'elevenlabs') {
    functionName = 'generate-audio-tts';
  } else {
    functionName = 'generate-audio-minimax';
  }
  
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
      stability,
      similarity,
      style,
      useSpeakerBoost,
      forceElevenLabsTranscription,
      projectId,
      jobId,
      userId
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
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  
  // Get project data AND project_scenes (source of truth for images)
  const [projectRes, scenesRes] = await Promise.all([
    adminClient.from('projects').select('*').eq('id', projectId).single(),
    adminClient.from('project_scenes').select('*').eq('project_id', projectId).order('scene_index', { ascending: true })
  ]);

  const project = projectRes.data;
  if (!project) throw new Error("Project not found");

  const promptsJson = (project.prompts as any[]) || [];
  const projectScenes = scenesRes.data || [];
  
  // Merge data: prefer project_scenes for image data, fallback to prompts JSON
  const mergedPrompts = promptsJson.map((prompt: any, index: number) => {
    const sceneData = projectScenes.find((s: any) => s.scene_index === index);
    if (sceneData) {
      return {
        ...prompt,
        imageUrl: sceneData.upscaled_url || sceneData.image_url || prompt?.imageUrl,
        imageWidth: sceneData.image_width || prompt?.imageWidth,
        imageHeight: sceneData.image_height || prompt?.imageHeight,
        isUpscaled: sceneData.is_upscaled ?? prompt?.isUpscaled
      };
    }
    return prompt;
  });
  
  // Also add any scenes from project_scenes that aren't in prompts
  projectScenes.forEach((scene: any) => {
    if (scene.scene_index >= mergedPrompts.length) {
      mergedPrompts[scene.scene_index] = {
        imageUrl: scene.upscaled_url || scene.image_url,
        imageWidth: scene.image_width,
        imageHeight: scene.image_height,
        isUpscaled: scene.is_upscaled
      };
    }
  });

  console.log(`[processUpscaleJob] Merged ${mergedPrompts.length} prompts (${projectScenes.length} from project_scenes)`);
  
  // ========================================================================
  // SIMPLE ARCHITECTURE FOR UPSCALE (1 job per image)
  // ========================================================================
  if (true) {
    console.log(`[processUpscaleJob] Using single_upscale jobs for project ${projectId}`);
    
    // Get images that need upscaling
    // If sceneIndices is provided, only process those specific scenes
    const sceneIndices = metadata.sceneIndices as number[] | undefined;
    console.log(`[processUpscaleJob] sceneIndices from metadata:`, sceneIndices);
    console.log(`[processUpscaleJob] mergedPrompts count: ${mergedPrompts.length}`);
    
    // Debug: log first few prompts to understand data structure
    mergedPrompts.slice(0, 3).forEach((p: any, i: number) => {
      console.log(`[processUpscaleJob] Prompt ${i}: imageUrl=${p?.imageUrl?.substring(0, 50) || 'NONE'}, isUpscaled=${p?.isUpscaled}, width=${p?.imageWidth}, height=${p?.imageHeight}`);
    });
    
    const imagesToUpscale = mergedPrompts
      .map((prompt: any, index: number) => ({ prompt, index }))
      .filter(({ prompt, index }: any) => {
        // If sceneIndices is specified, only include those scenes
        if (sceneIndices && sceneIndices.length > 0) {
          if (!sceneIndices.includes(index)) {
            return false;
          }
        }
        if (!prompt || !prompt.imageUrl) {
          if (sceneIndices?.includes(index)) {
            console.log(`[processUpscaleJob] Scene ${index} excluded: no imageUrl`);
          }
          return false;
        }
        if (prompt.isUpscaled === true) {
          if (sceneIndices?.includes(index)) {
            console.log(`[processUpscaleJob] Scene ${index} excluded: already upscaled`);
          }
          return false;
        }
        const imgWidth = prompt.imageWidth || 0;
        const imgHeight = prompt.imageHeight || 0;
        if (imgWidth >= 1920 && imgHeight >= 1080) {
          if (sceneIndices?.includes(index)) {
            console.log(`[processUpscaleJob] Scene ${index} excluded: already high-res (${imgWidth}x${imgHeight})`);
          }
          return false;
        }
        console.log(`[processUpscaleJob] Scene ${index} INCLUDED for upscale`);
        return true;
      });
    
    console.log(`[processUpscaleJob] imagesToUpscale count: ${imagesToUpscale.length}`);
    
    if (imagesToUpscale.length === 0) {
      console.log("[processUpscaleJob] No images to upscale - marking job as completed");
      await adminClient
        .from('generation_jobs')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', jobId);
      return;
    }
    
    const totalImages = imagesToUpscale.length;
    const isSingleUpscale = sceneIndices && sceneIndices.length === 1;
    console.log(`[processUpscaleJob] Creating ${totalImages} individual single_upscale jobs${isSingleUpscale ? ' [SINGLE]' : ''}`);
    
    // Mark parent job as the coordinator
    await adminClient
      .from('generation_jobs')
      .update({
        total: totalImages,
        status: 'processing',
        metadata: {
          ...metadata,
          isParentJob: true,
          childJobsCount: totalImages,
          total_scenes: isSingleUpscale ? totalImages : mergedPrompts.length
        },
      })
      .eq('id', jobId);
    
    // Create individual single_upscale jobs (same pattern as images)
    const individualJobs = imagesToUpscale.map(({ prompt, index }: any) => ({
      project_id: projectId,
      user_id: userId,
      job_type: 'single_upscale',
      status: 'pending',
      progress: 0,
      total: 1,
      parent_job_id: jobId,
      scene_index: index,
      metadata: {
        imageUrl: prompt.imageUrl,
        scale: 2,
        faceEnhance: false,
        useWebhook: true,
      },
    }));
    
    const { data: createdJobs, error: jobsError } = await adminClient
      .from('generation_jobs')
      .insert(individualJobs)
      .select('id, scene_index');
    
    if (jobsError) {
      throw new Error(`Failed to create upscale jobs: ${jobsError.message}`);
    }
    
    console.log(`[processUpscaleJob] Created ${createdJobs.length} individual single_upscale jobs`);
    
    // Launch pending upscale jobs (respects global concurrency)
    await launchNextPendingUpscaleJobFromQA(adminClient, supabaseUrl, supabaseServiceKey);
    
    // Job stays in 'processing' status until all children complete
    throw new Error('WEBHOOK_MODE_ACTIVE');
  }
  
  // ========================================================================
  // LEGACY SYSTEM (unchanged for backward compatibility)
  // ========================================================================
  
  // CHUNK SETTINGS - optimized for speed while avoiding timeout
  const CHUNK_SIZE = 30; // Process 30 images per chunk (was 20)
  
  // Get images that need upscaling:
  // - Have imageUrl (generated)
  // - Are NOT already upscaled (check isUpscaled flag in prompt OR upscaledIndices from current job run)
  // - Image dimensions are below 1920x1080 (if stored)
  // - No active upscale prediction already in progress
  const alreadyUpscaledIndices = new Set(metadata.upscaledIndices || []);
  
  // CRITICAL: Also check for pending/processing upscale predictions to avoid duplicates
  const { data: activeUpscalePredictions } = await adminClient
    .from('pending_predictions')
    .select('scene_index')
    .eq('project_id', projectId)
    .eq('prediction_type', 'upscale')
    .in('status', ['pending', 'processing', 'starting']);
  
  const scenesWithActiveUpscalePredictions = new Set(
    (activeUpscalePredictions || []).map((p: any) => p.scene_index)
  );
  
  if (scenesWithActiveUpscalePredictions.size > 0) {
    console.log(`UPSCALE DUPLICATE PREVENTION: ${scenesWithActiveUpscalePredictions.size} scenes already have active upscale predictions: [${Array.from(scenesWithActiveUpscalePredictions).slice(0, 10).join(', ')}${scenesWithActiveUpscalePredictions.size > 10 ? '...' : ''}]`);
  }
  
  let skippedHighRes = 0;
  let skippedAlreadyUpscaled = 0;
  let skippedActivePrediction = 0;
  
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
      
      // Skip if there's already an active upscale prediction for this scene
      if (scenesWithActiveUpscalePredictions.has(index)) {
        skippedActivePrediction++;
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
  
  console.log(`Found ${allImagesToUpscale.length} images to upscale (skipped: ${skippedAlreadyUpscaled} already upscaled, ${skippedHighRes} high-res, ${skippedActivePrediction} active predictions)`);

  if (allImagesToUpscale.length === 0) {
    console.log("No images to upscale in this chunk - marking job as completed");
    
    // Mark job as completed to prevent blocking
    await adminClient
      .from('generation_jobs')
      .update({ 
        status: 'completed',
        progress: 0,
        completed_at: new Date().toISOString()
      })
      .eq('id', jobId);
    
    // Check if there are REALLY more images that need upscaling
    // by checking for images without isUpscaled flag (in case webhook miscounted)
    const reallyNeedUpscale = prompts.filter((p: any) => 
      p && p.imageUrl && p.isUpscaled !== true
    ).length;
    
    if (reallyNeedUpscale > 0) {
      console.log(`WARNING: Found ${reallyNeedUpscale} images that still need upscaling but were not detected by filter. Creating continuation job...`);
      
      // Check for existing upscale job to prevent duplicates
      const { data: existingJobs } = await adminClient
        .from('generation_jobs')
        .select('id, status')
        .eq('project_id', projectId)
        .eq('job_type', 'upscale')
        .in('status', ['pending', 'processing'])
        .limit(1);
      
      if (!existingJobs || existingJobs.length === 0) {
        // Create a new upscale chunk job
        const { data: retryJob, error: retryError } = await adminClient
          .from('generation_jobs')
          .insert({
            project_id: projectId,
            user_id: userId,
            job_type: 'upscale',
            status: 'pending',
            progress: 0,
            total: reallyNeedUpscale,
            metadata: {
              ...metadata,
              isChunkContinuation: true,
              upscaledIndices: metadata.upscaledIndices || []
            }
          })
          .select()
          .single();
        
        if (!retryError && retryJob) {
          console.log(`Created retry upscale job ${retryJob.id} for ${reallyNeedUpscale} remaining images`);
          
          // Start the retry job
          EdgeRuntime.waitUntil((async () => {
            const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
            const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            try {
              await fetch(`${supabaseUrl}/functions/v1/start-generation-job`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${serviceRoleKey}`
                },
                body: JSON.stringify({
                  jobId: retryJob.id,
                  projectId,
                  userId,
                  jobType: 'upscale',
                  metadata: {
                    ...metadata,
                    isChunkContinuation: true,
                    upscaledIndices: metadata.upscaledIndices || []
                  }
                })
              });
            } catch (error) {
              console.error('Error starting retry upscale job:', error);
            }
          })());
        }
      } else {
        console.log(`Upscale job already exists (${existingJobs[0].id}), skipping retry creation`);
      }
    }
    
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
            } else if (insertError.code === '23505') {
              // Unique constraint violation - upscale prediction already exists for this scene
              console.log(`Scene ${index + 1}: Upscale prediction already exists (duplicate prevented by DB), skipping`);
              // Don't count as started or failed - it's already being processed
            } else {
              console.error(`Scene ${index + 1}: Upscale insert error: ${insertError.message}`);
              failedCount++;
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

// ========================================================================
// PARALLEL PROMPTS ARCHITECTURE: 1 job per prompt
// ========================================================================
const PROMPTS_MAX_CONCURRENT = 100;

// Launch next pending single_prompt job
async function launchNextPendingPromptJob(adminClient: any): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  // Check current processing count
  const { count: processingCount } = await adminClient
    .from('generation_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'processing')
    .eq('job_type', 'single_prompt');
  
  if ((processingCount || 0) >= PROMPTS_MAX_CONCURRENT) {
    console.log(`[launchNextPendingPromptJob] No capacity (${processingCount}/${PROMPTS_MAX_CONCURRENT} processing)`);
    return;
  }
  
  // Find next pending single_prompt job
  const { data: pendingJobs } = await adminClient
    .from('generation_jobs')
    .select('id, project_id, user_id, scene_index, metadata')
    .eq('status', 'pending')
    .eq('job_type', 'single_prompt')
    .order('scene_index', { ascending: true }) // Process in scene order
    .order('created_at', { ascending: true })
    .limit(1);
  
  if (!pendingJobs || pendingJobs.length === 0) {
    console.log('[launchNextPendingPromptJob] No pending single_prompt jobs');
    return;
  }
  
  const jobToClaim = pendingJobs[0];
  
  // Atomic claim
  const { data: claimed, error: claimError } = await adminClient
    .from('generation_jobs')
    .update({ status: 'processing' })
    .eq('id', jobToClaim.id)
    .eq('status', 'pending')
    .select('id')
    .single();
  
  if (claimError || !claimed) {
    console.log(`[launchNextPendingPromptJob] Job ${jobToClaim.id} already claimed`);
    return;
  }
  
  console.log(`[launchNextPendingPromptJob] Launching single_prompt job ${jobToClaim.id} for scene ${jobToClaim.scene_index + 1}`);
  
  // Launch immediately (fire and forget)
  fetch(`${supabaseUrl}/functions/v1/start-generation-job`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${serviceRoleKey}`
    },
    body: JSON.stringify({
      jobId: jobToClaim.id,
      projectId: jobToClaim.project_id,
      userId: jobToClaim.user_id,
      jobType: 'single_prompt'
    })
  }).catch(err => console.error(`[launchNextPendingPromptJob] Error starting job ${jobToClaim.id}:`, err));
}

// Launch multiple pending prompt jobs up to available capacity
async function launchPendingPromptJobs(adminClient: any, count: number): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  // Check current processing count
  const { count: processingCount } = await adminClient
    .from('generation_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'processing')
    .eq('job_type', 'single_prompt');
  
  const availableSlots = Math.max(0, PROMPTS_MAX_CONCURRENT - (processingCount || 0));
  const jobsToLaunch = Math.min(availableSlots, count);
  
  if (jobsToLaunch === 0) {
    console.log(`[launchPendingPromptJobs] No capacity (${processingCount}/${PROMPTS_MAX_CONCURRENT} processing)`);
    return;
  }
  
  // Find pending jobs
  const { data: pendingJobs } = await adminClient
    .from('generation_jobs')
    .select('id, project_id, user_id, scene_index, metadata')
    .eq('status', 'pending')
    .eq('job_type', 'single_prompt')
    .order('scene_index', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(jobsToLaunch);
  
  if (!pendingJobs || pendingJobs.length === 0) {
    console.log('[launchPendingPromptJobs] No pending single_prompt jobs');
    return;
  }
  
  console.log(`[launchPendingPromptJobs] Launching ${pendingJobs.length} prompt jobs (${processingCount}/${PROMPTS_MAX_CONCURRENT} already processing)`);
  
  // Claim and launch each job
  for (const job of pendingJobs) {
    // Atomic claim
    const { data: claimed, error: claimError } = await adminClient
      .from('generation_jobs')
      .update({ status: 'processing' })
      .eq('id', job.id)
      .eq('status', 'pending')
      .select('id')
      .single();
    
    if (claimError || !claimed) {
      console.log(`[launchPendingPromptJobs] Job ${job.id} already claimed, skipping`);
      continue;
    }
    
    console.log(`[launchPendingPromptJobs] Launching scene ${job.scene_index + 1}`);
    
    // Fire and forget
    fetch(`${supabaseUrl}/functions/v1/start-generation-job`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`
      },
      body: JSON.stringify({
        jobId: job.id,
        projectId: job.project_id,
        userId: job.user_id,
        jobType: 'single_prompt'
      })
    }).catch(err => console.error(`[launchPendingPromptJobs] Error starting job ${job.id}:`, err));
  }
}

// ========================================================================
// NEW SIMPLE ARCHITECTURE: 1 job per QA check
// ========================================================================
const QA_MAX_CONCURRENT = 100;

async function processQAJob(
  jobId: string,
  projectId: string,
  userId: string,
  metadata: Record<string, any>,
  authHeader: string,
  adminClient: any
) {
  console.log(`[processQAJob] Starting QA for project ${projectId} (1 job per QA architecture)`);

  // Get project data
  const { data: project } = await adminClient
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single();

  if (!project) throw new Error("Project not found");

  const prompts = (project.prompts as any[]) || [];
  const qaPrompt = metadata.qaPrompt || null;
  
  // Filter images that need QA (have image but not yet QA checked)
  const imagesToCheck = prompts
    .map((prompt: any, index: number) => ({ prompt, index }))
    .filter(({ prompt }: any) => 
      prompt && 
      prompt.imageUrl && 
      typeof prompt.imageUrl === 'string' && 
      prompt.imageUrl.trim() !== '' &&
      !prompt.qa_checked // Skip already checked
    );

  const totalQA = imagesToCheck.length;
  console.log(`[processQAJob] Found ${totalQA} images to QA check`);

  if (totalQA === 0) {
    console.log("[processQAJob] No images to check");
    await adminClient
      .from('generation_jobs')
      .update({ 
        status: 'completed', 
        progress: 0,
        total: 0,
        completed_at: new Date().toISOString()
      })
      .eq('id', jobId);
    return;
  }

  // Update this job as parent
  await adminClient
    .from('generation_jobs')
    .update({ 
      total: totalQA,
      metadata: { ...metadata, isParentJob: true, childJobsCount: totalQA }
    })
    .eq('id', jobId);

  // Create individual single_qa jobs
  const individualJobs = imagesToCheck.map(({ prompt, index }: any) => ({
    project_id: projectId,
    user_id: userId,
    job_type: 'single_qa',
    status: 'pending',
    progress: 0,
    total: 1,
    parent_job_id: jobId,
    scene_index: index,
    metadata: {
      imageUrl: prompt.imageUrl,
      sourcePrompt: prompt.prompt || '',
      qaPrompt: qaPrompt,
      semiAutoMode: metadata.semiAutoMode || false,
      thumbnailPresetId: metadata.thumbnailPresetId || null
    }
  }));

  const { data: createdJobs, error: insertError } = await adminClient
    .from('generation_jobs')
    .insert(individualJobs)
    .select('id, scene_index');

  if (insertError) {
    console.error('[processQAJob] Error creating single_qa jobs:', insertError);
    throw insertError;
  }

  console.log(`[processQAJob] Created ${createdJobs.length} single_qa jobs`);

  // Check how many single_qa jobs are already processing
  const { count: processingCount } = await adminClient
    .from('generation_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'processing')
    .eq('job_type', 'single_qa');

  const availableSlots = Math.max(0, QA_MAX_CONCURRENT - (processingCount || 0));
  const jobsToStart = createdJobs.slice(0, availableSlots);

  console.log(`[processQAJob] Starting ${jobsToStart.length} single_qa jobs (${processingCount || 0} already processing, max ${QA_MAX_CONCURRENT})`);

  // Start the initial batch
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  for (const job of jobsToStart) {
    // Mark as processing
    await adminClient
      .from('generation_jobs')
      .update({ status: 'processing' })
      .eq('id', job.id);
    
    // Call start-generation-job for single_qa immediately (no setTimeout)
    fetch(`${supabaseUrl}/functions/v1/start-generation-job`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({
        jobId: job.id,
        projectId,
        userId,
        jobType: 'single_qa'
      })
    }).catch(err => console.error(`[processQAJob] Error starting single_qa job ${job.id}:`, err));
  }

  // Keep parent job in 'processing' - webhook will complete it
  console.log(`[processQAJob] Parent job ${jobId} stays in processing, single_qa jobs will complete it`);
  throw new Error('PARENT_JOB_ACTIVE');
}

// Process a single QA check
async function processSingleQAJob(
  jobId: string,
  projectId: string,
  userId: string,
  _metadata: Record<string, any>,
  authHeader: string,
  adminClient: any
) {
  // Get job data from DB (metadata is stored in the job, not passed via HTTP)
  const { data: job, error: jobError } = await adminClient
    .from('generation_jobs')
    .select('scene_index, metadata')
    .eq('id', jobId)
    .single();
  
  if (jobError || !job) {
    console.error(`[processSingleQAJob] Job ${jobId} not found:`, jobError);
    return;
  }
  
  const sceneIndex = job.scene_index;
  const jobMetadata = job.metadata || {};
  
  console.log(`[processSingleQAJob] Processing QA for scene ${sceneIndex} (job ${jobId})`);
  
  const imageUrl = jobMetadata.imageUrl;
  const sourcePrompt = jobMetadata.sourcePrompt || '';
  const qaPrompt = jobMetadata.qaPrompt || null;
  
  if (!imageUrl) {
    console.error(`[processSingleQAJob] No imageUrl for job ${jobId}, metadata:`, jobMetadata);
    await markSingleQACompleted(adminClient, jobId, sceneIndex, 'ERROR', null);
    return;
  }
  
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const maxRetries = 3;
  let qaResult: any = null;
  
  // Retry logic for API errors
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/qa-image-gemini`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader
        },
        body: JSON.stringify({
          imageUrl,
          userId,
          qaPrompt,
          sourcePrompt
        })
      });

      if (response.status === 503 && attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[processSingleQAJob] Scene ${sceneIndex + 1}: 503 error, retrying in ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[processSingleQAJob] QA error for scene ${sceneIndex + 1}: HTTP ${response.status}`, errorText);
        // On 429 / quota exceeded, wait for API-suggested retry delay then retry
        const isRateLimit = response.status === 429 || errorText.includes('429') || errorText.includes('RESOURCE_EXHAUSTED');
        const retryInMatch = errorText.match(/retry in (\d+(?:\.\d+)?)\s*s/i);
        if (isRateLimit && attempt < maxRetries - 1 && retryInMatch) {
          const waitSec = Math.min(parseFloat(retryInMatch[1]) * 1000, 120000);
          console.log(`[processSingleQAJob] Scene ${sceneIndex + 1}: rate limit (429), retrying in ${Math.round(waitSec / 1000)}s`);
          await new Promise(resolve => setTimeout(resolve, waitSec));
          continue;
        }
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
        qaResult = { status: 'ERROR', error: errorText };
        break;
      }

      qaResult = await response.json();
      
      if (qaResult.error || qaResult.status === 'ERROR') {
        console.error(`[processSingleQAJob] QA error for scene ${sceneIndex + 1}:`, qaResult.error);
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
      }
      
      break; // Success
    } catch (error) {
      console.error(`[processSingleQAJob] Exception for scene ${sceneIndex + 1}:`, error);
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      qaResult = { status: 'ERROR' };
    }
  }
  
  if (!qaResult) {
    qaResult = { status: 'ERROR' };
  }
  
  console.log(`[processSingleQAJob] Scene ${sceneIndex + 1}: ${qaResult.status}`);
  
  // Update the prompt with QA result
  await updatePromptWithQAResult(adminClient, projectId, sceneIndex, qaResult);
  
  // Mark this job as completed and handle continuation
  await markSingleQACompleted(adminClient, jobId, sceneIndex, qaResult.status, qaResult);
}

// Update the prompt in the project with QA result
async function updatePromptWithQAResult(
  adminClient: any,
  projectId: string,
  sceneIndex: number,
  qaResult: any
) {
  console.log(`[updatePromptWithQAResult] Updating QA for scene ${sceneIndex + 1} with status: ${qaResult.status}`);
  
  // ROBUST ARCHITECTURE: Update project_scenes table (ATOMIC - preferred)
  const updateData: any = {
    qa_checked: true,
    qa_status: qaResult.status === 'OK' ? 'OK' : (qaResult.status === 'REJECT' ? 'REJECT' : 'OK'),
    qa_explication: qaResult.explication || (qaResult.status === 'ERROR' ? 'QA check failed - assumed OK' : null),
    qa_regeneration_prompt: qaResult.prompt_regeneration || null,
    updated_at: new Date().toISOString()
  };

  const { error: sceneError, data: updatedScene } = await adminClient
    .from('project_scenes')
    .update(updateData)
    .eq('project_id', projectId)
    .eq('scene_index', sceneIndex)
    .select('scene_index, qa_checked, qa_status')
    .single();

  if (sceneError) {
    console.error(`[updatePromptWithQAResult] Error updating project_scenes for scene ${sceneIndex + 1}:`, sceneError.message);
  } else {
    console.log(`[updatePromptWithQAResult] Successfully updated project_scenes for scene ${sceneIndex + 1}: qa_checked=${updatedScene?.qa_checked}, qa_status=${updatedScene?.qa_status}`);
  }

  // FALLBACK: Also update legacy JSON using atomic RPC if available, otherwise best-effort
  try {
    // Try atomic update via RPC first
    const { error: rpcError } = await adminClient.rpc('update_prompt_qa_status', {
      p_project_id: projectId,
      p_scene_index: sceneIndex,
      p_qa_checked: true,
      p_qa_status: qaResult.status === 'OK' ? 'OK' : (qaResult.status === 'REJECT' ? 'REJECT' : 'OK'),
      p_qa_explication: qaResult.explication || null,
      p_qa_regeneration_prompt: qaResult.prompt_regeneration || null
    });
    
    if (rpcError) {
      // RPC doesn't exist yet, fall back to non-atomic update (with warning)
      console.warn(`[updatePromptWithQAResult] RPC not available, using non-atomic fallback for legacy JSON (race condition risk)`);
      
      const { data: project } = await adminClient
        .from('projects')
        .select('prompts')
        .eq('id', projectId)
        .single();
      
      if (!project) return;
      
      const prompts = [...(project.prompts as any[])];
      if (qaResult.status === 'OK') {
        prompts[sceneIndex] = { ...prompts[sceneIndex], qa_checked: true, qa_status: 'OK' };
      } else if (qaResult.status === 'REJECT') {
        prompts[sceneIndex] = {
          ...prompts[sceneIndex],
          qa_checked: true,
          qa_status: 'REJECT',
          qa_explication: qaResult.explication,
          qa_regeneration_prompt: qaResult.prompt_regeneration || null
        };
      } else {
        prompts[sceneIndex] = { ...prompts[sceneIndex], qa_checked: true, qa_status: 'OK', qa_explication: 'QA check failed - assumed OK' };
      }
      
      await adminClient.from('projects').update({ prompts }).eq('id', projectId);
    } else {
      console.log(`[updatePromptWithQAResult] Successfully updated legacy JSON via atomic RPC for scene ${sceneIndex + 1}`);
    }
  } catch (err) {
    console.warn(`[updatePromptWithQAResult] Legacy JSON update failed (ignored):`, err);
  }
}

// Mark a scene as having been regenerated (for UI display - blue badge instead of green)
async function markSceneAsRegenerated(
  adminClient: any,
  projectId: string,
  sceneIndex: number
) {
  console.log(`[markSceneAsRegenerated] Marking scene ${sceneIndex + 1} as regenerated`);
  
  // Update project_scenes
  await adminClient
    .from('project_scenes')
    .update({ was_regenerated: true })
    .eq('project_id', projectId)
    .eq('scene_index', sceneIndex);
  
  // Update legacy JSON
  try {
    const { data: project } = await adminClient
      .from('projects')
      .select('prompts')
      .eq('id', projectId)
      .single();
    
    if (project?.prompts) {
      const prompts = [...(project.prompts as any[])];
      if (prompts[sceneIndex]) {
        prompts[sceneIndex] = { ...prompts[sceneIndex], was_regenerated: true };
        await adminClient.from('projects').update({ prompts }).eq('id', projectId);
      }
    }
  } catch (err) {
    console.warn(`[markSceneAsRegenerated] Legacy JSON update failed (ignored):`, err);
  }
}

// ========================================================================
// ATOMIC PIPELINE: Mark QA completed and trigger next step
// Flow: QA OK -> upscale | QA REJECT -> regen (1x max) -> upscale
// ========================================================================
async function markSingleQACompleted(
  adminClient: any,
  jobId: string,
  sceneIndex: number,
  status: string,
  qaResult: any
) {
  // Get job info including is_regen flag
  const { data: job } = await adminClient
    .from('generation_jobs')
    .select('parent_job_id, project_id, user_id, metadata, is_regen')
    .eq('id', jobId)
    .single();
  
  // Mark this job as completed
  await adminClient
    .from('generation_jobs')
    .update({
      status: 'completed',
      progress: 1,
      completed_at: new Date().toISOString()
    })
    .eq('id', jobId);
  
  console.log(`[markSingleQACompleted] Job ${jobId} (scene ${sceneIndex}) completed with status: ${status}, is_regen: ${job?.is_regen}`);
  
  if (!job?.parent_job_id) return;
  
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  
  // Check if this is a regenerated scene
  const isRegenScene = job.is_regen === true || job.metadata?.is_regen === true;
  
  // ATOMIC PIPELINE: Determine next step based on QA result
  if (status === 'OK' || status === 'ERROR') {
    // QA OK or error (assume OK) -> Create upscale job
    console.log(`[markSingleQACompleted] Scene ${sceneIndex}: QA ${status}, creating upscale job (is_regen: ${isRegenScene})`);
    
    // If this was a regenerated scene, mark it as such
    if (isRegenScene) {
      await markSceneAsRegenerated(adminClient, job.project_id, sceneIndex);
    }
    
    await createSingleUpscaleJobFromQA(adminClient, job.project_id, job.user_id, sceneIndex, job.parent_job_id);
    await launchNextPendingUpscaleJobFromQA(adminClient, supabaseUrl, supabaseServiceKey);
    
  } else if (status === 'REJECT') {
    const isAlreadyRegen = isRegenScene;
    
    if (isAlreadyRegen) {
      // Already regenerated once -> force OK and create upscale
      console.log(`[markSingleQACompleted] Scene ${sceneIndex}: REJECT after regen, forcing OK and upscale`);
      
      // Update prompt to show it was force-accepted AND mark as regenerated
      await updatePromptWithQAResult(adminClient, job.project_id, sceneIndex, {
        status: 'OK',
        explication: 'Forcé OK après régénération (limite 1 regen atteinte)'
      });
      await markSceneAsRegenerated(adminClient, job.project_id, sceneIndex);
      
      await createSingleUpscaleJobFromQA(adminClient, job.project_id, job.user_id, sceneIndex, job.parent_job_id);
      await launchNextPendingUpscaleJobFromQA(adminClient, supabaseUrl, supabaseServiceKey);
      
    } else {
      // First rejection -> regenerate image
      console.log(`[markSingleQACompleted] Scene ${sceneIndex}: REJECT, creating regen job`);
      await createSingleImageRegenJob(adminClient, job.project_id, job.user_id, sceneIndex, job.parent_job_id, qaResult);
      
      // VPS Worker mode: regen job is left as 'pending', the VPS image-worker will pick it up
      console.log(`[markSingleQACompleted] Regen job created as pending for VPS worker (scene ${sceneIndex})`);
    }
  }
  
  // Launch next pending QA job
  await launchNextPendingQAJob(adminClient);
  
  // ATOMIC PIPELINE: Update parent progress metadata so QA bar moves!
  await updateParentProgressMetadata(adminClient, job.parent_job_id);
}

// Universal progress update for atomic pipeline
async function updateParentProgressMetadata(adminClient: any, parentJobId: string) {
  // Get parent job info
  const { data: parentJob } = await adminClient
    .from('generation_jobs')
    .select('total, metadata, project_id')
    .eq('id', parentJobId)
    .single();
  
  if (!parentJob || !parentJob.project_id) return;
  
  const projectId = parentJob.project_id;
  const total = parentJob.total || 0;
  
  // Check if this is a manual regeneration (has sceneIndices)
  const sceneIndices = parentJob.metadata?.sceneIndices as number[] | undefined;
  const isManualRegen = sceneIndices && Array.isArray(sceneIndices) && sceneIndices.length > 0;

  let imgDone = 0;
  let qaDone = 0;
  let upscaleDone = 0;

  if (isManualRegen) {
    // For manual regeneration, only count progress for the specific scenes
    const { data: scenes } = await adminClient
      .from('project_scenes')
      .select('scene_index, image_url, qa_status, upscaled_url')
      .eq('project_id', projectId)
      .in('scene_index', sceneIndices);
    
    if (scenes) {
      imgDone = scenes.filter((s: any) => s.image_url).length;
      qaDone = scenes.filter((s: any) => s.qa_status).length;
      upscaleDone = scenes.filter((s: any) => s.upscaled_url).length;
    }
    console.log(`[updateParentProgressMetadata] Manual regen for scenes ${sceneIndices.join(',')}: images=${imgDone}, qa=${qaDone}, upscale=${upscaleDone}`);
  } else {
    // For full batch, count all scenes
    const { count: imgCount } = await adminClient
      .from('project_scenes')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .not('image_url', 'is', null);
      
    const { count: qaCount } = await adminClient
      .from('project_scenes')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .not('qa_status', 'is', null);
      
    const { count: upscaleCount } = await adminClient
      .from('project_scenes')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .not('upscaled_url', 'is', null);

    imgDone = imgCount || 0;
    qaDone = qaCount || 0;
    upscaleDone = upscaleCount || 0;
  }

  const newMetadata = {
    ...(parentJob.metadata || {}),
    progress_images: imgDone,
    progress_qa: qaDone,
    progress_upscale: upscaleDone,
    total_scenes: total
  };

  await adminClient
    .from('generation_jobs')
    .update({ 
      metadata: newMetadata,
      // Main progress column follows upscale completion
      progress: upscaleDone || 0,
      updated_at: new Date().toISOString()
    })
    .eq('id', parentJobId);
}

// Create upscale job after QA completes (called from start-generation-job)
async function createSingleUpscaleJobFromQA(
  adminClient: any,
  projectId: string,
  userId: string,
  sceneIndex: number,
  parentJobId: string
): Promise<void> {
  console.log(`[createSingleUpscaleJobFromQA] Creating upscale job for scene ${sceneIndex}`);
  
  // Get the image URL from the project
  const { data: project } = await adminClient
    .from('projects')
    .select('prompts, image_model')
    .eq('id', projectId)
    .single();
  
  if (!project) {
    console.error(`[createSingleUpscaleJobFromQA] Project ${projectId} not found`);
    return;
  }
  
  const prompts = (project.prompts as any[]) || [];
  const prompt = prompts[sceneIndex];
  
  if (!prompt?.imageUrl) {
    console.error(`[createSingleUpscaleJobFromQA] No imageUrl for scene ${sceneIndex}`);
    return;
  }
  
  // Check if this image model needs upscaling
  // Seedream models are already high-res (1440x816), Z-Image needs upscaling
  const imageModel = project.image_model || 'seedream-4.5';
  const isSeedream = imageModel.toLowerCase().includes('seedream');
  const needsUpscale = !isSeedream;
  
  if (!needsUpscale) {
    console.log(`[createSingleUpscaleJobFromQA] Seedream model, creating completed upscale job for scene ${sceneIndex}`);
    // Create a completed upscale job so progress tracking works
    await adminClient
      .from('generation_jobs')
      .insert({
        project_id: projectId,
        user_id: userId,
        job_type: 'single_upscale',
        status: 'completed',
        progress: 1,
        total: 1,
        scene_index: sceneIndex,
        parent_job_id: parentJobId,
        completed_at: new Date().toISOString(),
        metadata: {
          imageUrl: prompt.imageUrl,
          skipped: true,
          reason: 'Seedream model already high-res'
        }
      });
    // Update parent progress
    await updateParentProgressAfterUpscale(adminClient, parentJobId, sceneIndex);
    return;
  }
  
  // Create the upscale job
  const { error: insertError } = await adminClient
    .from('generation_jobs')
    .insert({
      project_id: projectId,
      user_id: userId,
      job_type: 'single_upscale',
      status: 'pending',
      progress: 0,
      total: 1,
      scene_index: sceneIndex,
      parent_job_id: parentJobId,
      metadata: {
        imageUrl: prompt.imageUrl,
        semiAutoMode: true
      }
    });
  
  if (insertError) {
    console.error(`[createSingleUpscaleJobFromQA] Error creating upscale job:`, insertError);
  } else {
    console.log(`[createSingleUpscaleJobFromQA] Created upscale job for scene ${sceneIndex}`);
  }
}

// Create regen job after QA rejects image
async function createSingleImageRegenJob(
  adminClient: any,
  projectId: string,
  userId: string,
  sceneIndex: number,
  parentJobId: string,
  qaResult: any
): Promise<void> {
  console.log(`[createSingleImageRegenJob] Creating regen job for scene ${sceneIndex}`);
  
  // Get current project settings including image model, width, height, style references, and LoRA
  const { data: project, error: projectError } = await adminClient
    .from('projects')
    .select('prompts, image_model, image_width, image_height, style_reference_url, lora_url, lora_steps, preset_id')
    .eq('id', projectId)
    .single();
  
  if (projectError) {
    console.error(`[createSingleImageRegenJob] Error fetching project ${projectId}:`, projectError.message);
    return;
  }
  
  if (!project) {
    console.error(`[createSingleImageRegenJob] Project ${projectId} not found`);
    return;
  }
  
  // Load LoRA from preset if not set on project
  let loraUrl = project.lora_url || null;
  let loraSteps = project.lora_steps || 10;
  if ((!loraUrl || loraUrl === '') && project.preset_id) {
    const { data: preset } = await adminClient
      .from('presets')
      .select('lora_url, lora_steps')
      .eq('id', project.preset_id)
      .single();
    if (preset?.lora_url) {
      loraUrl = preset.lora_url;
      loraSteps = preset.lora_steps || 10;
    }
  }
  
  const prompts = (project.prompts as any[]) || [];
  const originalPrompt = prompts[sceneIndex]?.prompt || '';
  
  // Use the QA-suggested prompt if available, otherwise use original
  const newPrompt = qaResult?.prompt_regeneration || originalPrompt;
  
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
  
  // Create the regen job with is_regen = true and FULL project settings
  const { error: insertError } = await adminClient
    .from('generation_jobs')
    .insert({
      project_id: projectId,
      user_id: userId,
      job_type: 'single_image',
      status: 'pending',
      progress: 0,
      total: 1,
      scene_index: sceneIndex,
      parent_job_id: parentJobId,
      is_regen: true,
      metadata: {
        prompt: newPrompt,
        model: project.image_model || 'seedream-4.5',
        width: project.image_width || 1440,
        height: project.image_height || 816,
        styleRefs: styleReferenceUrls,
        loraUrl: loraUrl || null,
        loraSteps: loraSteps || 10,
        is_regen: true,
        original_prompt: originalPrompt,
        qa_rejection_reason: qaResult?.explication || 'QA rejection',
        useWebhook: true
      }
    });
  
  if (insertError) {
    console.error(`[createSingleImageRegenJob] Error creating regen job:`, insertError);
  } else {
    console.log(`[createSingleImageRegenJob] Created regen job for scene ${sceneIndex} with is_regen=true, loraUrl: ${loraUrl || 'NONE'}`);
  }
}

// Launch next pending upscale jobs (called from start-generation-job)
const UPSCALE_MAX_CONCURRENT = 20;

async function launchNextPendingUpscaleJobFromQA(
  adminClient: any,
  supabaseUrl: string,
  supabaseServiceKey: string
): Promise<void> {
  // Check current processing count
  const { count: processingCount } = await adminClient
    .from('generation_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'processing')
    .eq('job_type', 'single_upscale');
  
  if ((processingCount || 0) >= UPSCALE_MAX_CONCURRENT) {
    console.log(`[launchNextPendingUpscaleJobFromQA] No capacity (${processingCount}/${UPSCALE_MAX_CONCURRENT} processing)`);
    return;
  }
  
  // Find ONE pending upscale job (simple and reliable)
  const { data: pendingJobs } = await adminClient
    .from('generation_jobs')
    .select('id, project_id, user_id, scene_index, metadata')
    .eq('status', 'pending')
    .eq('job_type', 'single_upscale')
    .order('created_at', { ascending: true })
    .limit(1);
  
  if (!pendingJobs || pendingJobs.length === 0) {
    console.log('[launchNextPendingUpscaleJobFromQA] No pending upscale jobs');
    return;
  }
  
  const jobToClaim = pendingJobs[0];
  
  // Atomic claim
  const { data: claimed, error: claimError } = await adminClient
    .from('generation_jobs')
    .update({ status: 'processing' })
    .eq('id', jobToClaim.id)
    .eq('status', 'pending')
    .select('id')
    .single();
  
  if (claimError || !claimed) {
    console.log(`[launchNextPendingUpscaleJobFromQA] Job ${jobToClaim.id} already claimed`);
    return;
  }
  
  console.log(`[launchNextPendingUpscaleJobFromQA] Launching upscale job ${jobToClaim.id} for scene ${jobToClaim.scene_index}`);
  
  // Get image URL
  const imageUrl = jobToClaim.metadata?.imageUrl;
  if (!imageUrl) {
    console.error(`[launchNextPendingUpscaleJobFromQA] No imageUrl for job ${jobToClaim.id}`);
    await adminClient
      .from('generation_jobs')
      .update({ status: 'failed', error_message: 'No imageUrl' })
      .eq('id', jobToClaim.id);
    return;
  }
  
  // Call upscale-image Edge Function
  try {
    const webhookUrl = `${supabaseUrl}/functions/v1/replicate-webhook`;
    
    const response = await fetch(`${supabaseUrl}/functions/v1/upscale-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({
        imageUrl,
        userId: jobToClaim.user_id,
        async: true,
        webhook_url: webhookUrl
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[launchNextPendingUpscaleJobFromQA] Upscale API error:`, response.status, errorText);
      await adminClient
        .from('generation_jobs')
        .update({ status: 'failed', error_message: `Upscale failed: ${response.status}` })
        .eq('id', jobToClaim.id);
      return;
    }
    
    const result = await response.json();
    console.log(`[launchNextPendingUpscaleJobFromQA] Started upscale for scene ${jobToClaim.scene_index}, prediction:`, result.predictionId);
    
    // Create pending_prediction entry for webhook tracking
    if (result.predictionId) {
      await adminClient
        .from('pending_predictions')
        .insert({
          job_id: jobToClaim.id,
          prediction_id: result.predictionId,
          prediction_type: 'upscale',
          scene_index: jobToClaim.scene_index,
          project_id: jobToClaim.project_id,
          user_id: jobToClaim.user_id,
          status: 'pending'
        });
    }
  } catch (err) {
    console.error(`[launchNextPendingUpscaleJobFromQA] Error:`, err);
    await adminClient
      .from('generation_jobs')
      .update({ status: 'failed', error_message: err instanceof Error ? err.message : 'Unknown error' })
      .eq('id', jobToClaim.id);
  }
}

// Update parent progress after upscale completes
async function updateParentProgressAfterUpscale(
  adminClient: any,
  parentJobId: string,
  sceneIndex: number
): Promise<void> {
  console.log(`[updateParentProgressAfterUpscale] Scene ${sceneIndex} complete, updating parent ${parentJobId}`);
  
  // Get parent job info
  const { data: parentJob } = await adminClient
    .from('generation_jobs')
    .select('total, project_id, user_id')
    .eq('id', parentJobId)
    .single();
  
  if (!parentJob) return;
  
  // Count completed scenes by counting upscale jobs OR QA jobs that skipped upscale
  // For simplicity, we count unique scene_index values that have upscale completed
  const { data: completedUpscales } = await adminClient
    .from('generation_jobs')
    .select('scene_index')
    .eq('parent_job_id', parentJobId)
    .eq('job_type', 'single_upscale')
    .eq('status', 'completed');
  
  const completedScenes = new Set((completedUpscales || []).map((j: any) => j.scene_index));
  const completedCount = completedScenes.size;
  const total = parentJob.total || 0;
  
  console.log(`[updateParentProgressAfterUpscale] Parent ${parentJobId}: ${completedCount}/${total} scenes complete`);
  
  // Update parent progress
  await adminClient
    .from('generation_jobs')
    .update({ progress: completedCount })
    .eq('id', parentJobId);
  
  // Check if all scenes are complete
  if (completedCount >= total) {
    console.log(`[updateParentProgressAfterUpscale] All ${total} scenes complete! Marking parent as completed`);
    
    await adminClient
      .from('generation_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('id', parentJobId);
  }
}

// Update QA parent job progress
async function updateQAParentProgress(
  adminClient: any,
  parentJobId: string,
  projectId: string,
  userId: string,
  childMetadata: any
) {
  // Count completed child jobs
  const { count: completedCount } = await adminClient
    .from('generation_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('parent_job_id', parentJobId)
    .eq('status', 'completed');
  
  // Get parent job total
  const { data: parentJob } = await adminClient
    .from('generation_jobs')
    .select('total, metadata')
    .eq('id', parentJobId)
    .single();
  
  const total = parentJob?.total || 0;
  const progress = completedCount || 0;
  
  console.log(`[updateQAParentProgress] Parent ${parentJobId}: ${progress}/${total} completed`);
  
  // Update parent progress
  await adminClient
    .from('generation_jobs')
    .update({ progress })
    .eq('id', parentJobId);
  
  // Check if all done
  if (progress >= total) {
    console.log(`[updateQAParentProgress] All QA checks complete for parent ${parentJobId}`);
    
    // Count rejected images
    const { data: project } = await adminClient
      .from('projects')
      .select('prompts')
      .eq('id', projectId)
      .single();
    
    const prompts = (project?.prompts as any[]) || [];
    const rejectCount = prompts.filter((p: any) => p?.qa_status === 'REJECT').length;
    const okCount = prompts.filter((p: any) => p?.qa_status === 'OK').length;
    const errorCount = prompts.filter((p: any) => p?.qa_checked && !p?.qa_status).length;
    
    const hasErrors = errorCount > 0;
    const errorMessage = hasErrors 
      ? `${okCount} OK, ${rejectCount} rejetées, ${errorCount} erreurs`
      : null;
    
    // Mark parent as completed
    await adminClient
      .from('generation_jobs')
      .update({
        status: 'completed',
        error_message: errorMessage,
        completed_at: new Date().toISOString()
      })
      .eq('id', parentJobId);
    
    // Chain to next job if semi-auto mode
    const semiAutoMode = parentJob?.metadata?.semiAutoMode === true;
    if (semiAutoMode) {
      if (rejectCount > 0) {
        console.log(`[updateQAParentProgress] Found ${rejectCount} rejected images, creating qa_regen job`);
        
        // Create qa_regen job
        const { data: regenJob, error: regenJobError } = await adminClient
          .from('generation_jobs')
          .insert({
            project_id: projectId,
            user_id: userId,
            job_type: 'qa_regen',
            status: 'pending',
            progress: 0,
            total: rejectCount,
            metadata: {
              semiAutoMode: true,
              thumbnailPresetId: parentJob?.metadata?.thumbnailPresetId || null,
              qaPrompt: parentJob?.metadata?.qaPrompt || null
            }
          })
          .select()
          .single();
        
        if (!regenJobError && regenJob) {
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          
          // No setTimeout - launch immediately
          fetch(`${supabaseUrl}/functions/v1/start-generation-job`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${serviceRoleKey}`
            },
            body: JSON.stringify({
              jobId: regenJob.id,
              projectId,
              userId,
              jobType: 'qa_regen',
              metadata: { semiAutoMode: true }
            })
          }).catch(err => console.error('[updateQAParentProgress] Error starting qa_regen:', err));
        }
      } else {
        console.log(`[updateQAParentProgress] No rejected images, chaining to upscale`);
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        
        // No setTimeout - launch immediately
        fetch(`${supabaseUrl}/functions/v1/replicate-webhook`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceRoleKey}`
          },
          body: JSON.stringify({
            type: 'chain_next_job',
            projectId,
            userId,
            completedJobType: 'qa'
          })
        }).catch(err => console.error('[updateQAParentProgress] Error chaining:', err));
      }
    }
  }
}

// Launch next pending single_qa job
async function launchNextPendingQAJob(adminClient: any) {
  // Check current processing count
  const { count: processingCount } = await adminClient
    .from('generation_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'processing')
    .eq('job_type', 'single_qa');
  
  if ((processingCount || 0) >= QA_MAX_CONCURRENT) {
    console.log(`[launchNextPendingQAJob] No capacity (${processingCount}/${QA_MAX_CONCURRENT} processing)`);
    return;
  }
  
  // Find next pending single_qa job
  const { data: pendingJobs } = await adminClient
    .from('generation_jobs')
    .select('id, project_id, user_id, scene_index, metadata')
    .eq('status', 'pending')
    .eq('job_type', 'single_qa')
    .order('created_at', { ascending: true })
    .limit(1);
  
  if (!pendingJobs || pendingJobs.length === 0) {
    console.log('[launchNextPendingQAJob] No pending single_qa jobs');
    return;
  }
  
  const jobToClaim = pendingJobs[0];
  
  // Atomic claim
  const { data: claimed, error: claimError } = await adminClient
    .from('generation_jobs')
    .update({ status: 'processing' })
    .eq('id', jobToClaim.id)
    .eq('status', 'pending')
    .select('id')
    .single();
  
  if (claimError || !claimed) {
    console.log(`[launchNextPendingQAJob] Job ${jobToClaim.id} already claimed`);
    return;
  }
  
  console.log(`[launchNextPendingQAJob] Launching single_qa job ${jobToClaim.id} for scene ${jobToClaim.scene_index}`);
  
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  // No setTimeout - launch immediately
  fetch(`${supabaseUrl}/functions/v1/start-generation-job`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceRoleKey}` },
    body: JSON.stringify({ jobId: jobToClaim.id, projectId: jobToClaim.project_id, userId: jobToClaim.user_id, jobType: 'single_qa' })
  }).catch(err => console.error(`[launchNextPendingQAJob] Error starting job ${jobToClaim.id}:`, err));
}

async function processQARegenJob(
  jobId: string,
  projectId: string,
  userId: string,
  metadata: Record<string, any>,
  authHeader: string,
  adminClient: any
) {
  console.log(`[processQARegenJob] Starting regeneration for rejected images in project ${projectId}`);
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';

  // Get project data
  const { data: project } = await adminClient
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single();

  if (!project) throw new Error("Project not found");

  // If project has no lora_url but has preset_id, copy LoRA from preset to project
  if ((!project.lora_url || project.lora_url === '') && project.preset_id) {
    const { data: preset } = await adminClient
      .from('presets')
      .select('lora_url, lora_steps')
      .eq('id', project.preset_id)
      .single();
    
    if (preset?.lora_url) {
      await adminClient
        .from('projects')
        .update({ 
          lora_url: preset.lora_url, 
          lora_steps: preset.lora_steps || 10 
        })
        .eq('id', projectId);
      
      project.lora_url = preset.lora_url;
      project.lora_steps = preset.lora_steps || 10;
      console.log(`[processQARegenJob] Copied LoRA from preset to project: ${preset.lora_url}, steps: ${project.lora_steps}`);
    }
  }

  const prompts = (project.prompts as any[]) || [];
  let imageWidth = project.image_width || 1920;
  let imageHeight = project.image_height || 1080;
  const imageModel = project.image_model || 'seedream-4.5';

  console.log(`[processQARegenJob] Project config: model=${imageModel}, lora_url=${project.lora_url || 'NONE'}, lora_steps=${project.lora_steps || 10}`);
  
  // IMPORTANT: For Z-Image models with 16:9, always generate at 960x544 (will be upscaled later)
  const isZImage = imageModel === 'z-image-turbo' || imageModel === 'z-image-turbo-lora';
  if (isZImage) {
    const ratio = imageWidth / imageHeight;
    const is16x9 = Math.abs(ratio - (16 / 9)) < 0.1;
    if (is16x9) {
      console.log(`[processQARegenJob] Z-Image 16:9 detected - forcing 960x544 for generation (was ${imageWidth}x${imageHeight})`);
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
  
  // Find rejected images
  const rejectedIndices = prompts
    .map((p: any, index: number) => (p && p.qa_status === 'REJECT' && p.qa_regeneration_prompt) ? index : -1)
    .filter((i: number) => i !== -1);

  console.log(`[processQARegenJob] Found ${rejectedIndices.length} rejected images to regenerate`);

  if (rejectedIndices.length === 0) {
    console.log('[processQARegenJob] No rejected images to regenerate');
    await adminClient
      .from('generation_jobs')
      .update({ 
        status: 'completed',
        progress: 0,
        total: 0,
        completed_at: new Date().toISOString()
      })
      .eq('id', jobId);
    return;
  }

  // Update job total
  await adminClient
    .from('generation_jobs')
    .update({ total: rejectedIndices.length })
    .eq('id', jobId);

  // Update prompts: replace with QA suggested prompt, KEEP QA status for history
  const updatedPrompts = [...prompts];
  for (const index of rejectedIndices) {
    const prompt = updatedPrompts[index];
    updatedPrompts[index] = {
      ...prompt,
      prompt: prompt.qa_regeneration_prompt, // Replace with suggested prompt
      qa_regenerated: true, // Mark as regenerated to show blue badge in UI
      // KEEP qa_status, qa_explication, and qa_regeneration_prompt for history
    };
  }

  // Save updated prompts
  const { error: updateError } = await adminClient
    .from('projects')
    .update({ prompts: updatedPrompts })
    .eq('id', projectId);

  if (updateError) {
    console.error('[processQARegenJob] Error updating prompts:', updateError);
    throw updateError;
  }

  console.log('[processQARegenJob] Updated prompts with suggested QA prompts');

  // Build webhook URL for async image generation
  const webhookUrl = `${supabaseUrl}/functions/v1/replicate-webhook`;

  // Generate images for rejected indices using webhook mode
  let startedCount = 0;
  let failCount = 0;

  for (let i = 0; i < rejectedIndices.length; i++) {
    const index = rejectedIndices[i];
    const prompt = updatedPrompts[index];

    try {
      console.log(`[processQARegenJob] Regenerating image ${i + 1}/${rejectedIndices.length} (scene ${index + 1})`);

      const requestBody: any = {
        prompt: prompt.prompt,
        width: imageWidth,
        height: imageHeight,
        model: imageModel,
        async: true,
        webhook_url: webhookUrl,
        userId,
      };

      if (styleReferenceUrls.length > 0) {
        requestBody.image_urls = styleReferenceUrls;
      }
      
      // Add LoRA parameters for z-image-turbo-lora model
      if (imageModel === 'z-image-turbo-lora') {
        if (project.lora_url) {
          requestBody.lora_url = project.lora_url;
          console.log(`[processQARegenJob] Adding LoRA to request: ${project.lora_url}, steps: ${project.lora_steps}`);
        }
        if (project.lora_steps) {
          requestBody.lora_steps = project.lora_steps;
        }
      }

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

      // Create pending_prediction entry for webhook tracking
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
            imageModel,
            imageWidth,
            imageHeight,
            qaRegeneration: true // Mark this as a QA regeneration
          },
          status: 'pending'
        });

      if (insertError) {
        console.error(`[processQARegenJob] Error inserting pending prediction:`, insertError);
        throw insertError;
      }

      startedCount++;
      console.log(`[processQARegenJob] Started prediction ${predictionId} for scene ${index + 1}`);

    } catch (error) {
      failCount++;
      console.error(`[processQARegenJob] Error regenerating scene ${index + 1}:`, error);
    }
  }

  console.log(`[processQARegenJob] Regeneration started: ${startedCount} predictions created, ${failCount} failed`);

  // Update job with final counts
  await adminClient
    .from('generation_jobs')
    .update({ 
      total: startedCount,
      error_message: failCount > 0 ? `${failCount} images failed to start` : null,
    })
    .eq('id', jobId);

  console.log(`[processQARegenJob] Webhook mode active - images will be processed by replicate-webhook`);
  
  // Throw special error to indicate webhook mode (like other jobs)
  throw new Error("WEBHOOK_MODE_ACTIVE");
}
