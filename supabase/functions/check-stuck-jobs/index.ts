import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const adminClient = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { jobId, projectId } = await req.json();
    
    console.log(`Checking stuck jobs for project: ${projectId}, job: ${jobId || 'all'}`);

    // Find processing jobs that might be stuck
    let jobQuery = adminClient
      .from('generation_jobs')
      .select('*')
      .in('status', ['processing', 'pending'])
      .order('created_at', { ascending: false });

    if (jobId) {
      jobQuery = jobQuery.eq('id', jobId);
    } else if (projectId) {
      jobQuery = jobQuery.eq('project_id', projectId);
    }

    const { data: jobs, error: jobsError } = await jobQuery.limit(10);

    if (jobsError) {
      throw jobsError;
    }

    if (!jobs || jobs.length === 0) {
      return new Response(JSON.stringify({ message: "No processing jobs found" }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results = [];

    for (const job of jobs) {
      console.log(`Checking job ${job.id} (${job.job_type})`);

      // Get all predictions for this job
      const { data: predictions } = await adminClient
        .from('pending_predictions')
        .select('id, status, prediction_id, created_at, error_message')
        .eq('job_id', job.id);

      if (!predictions || predictions.length === 0) {
        // Job has no predictions - might be stuck at startup
        const jobAge = Date.now() - new Date(job.created_at).getTime();
        const STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

        if (jobAge > STUCK_THRESHOLD_MS) {
          console.log(`Job ${job.id} has no predictions and is ${Math.round(jobAge / 60000)} minutes old - marking as failed`);
          
          await adminClient
            .from('generation_jobs')
            .update({
              status: 'failed',
              error_message: 'Job stuck - no predictions created',
              completed_at: new Date().toISOString()
            })
            .eq('id', job.id);

          results.push({ jobId: job.id, action: 'marked_failed', reason: 'no_predictions' });
        } else {
          results.push({ jobId: job.id, action: 'skipped', reason: 'too_recent' });
        }
        continue;
      }

      const completedCount = predictions.filter((p: any) => p.status === 'completed').length;
      const failedCount = predictions.filter((p: any) => p.status === 'failed').length;
      const pendingCount = predictions.filter((p: any) => p.status === 'pending' || p.status === 'starting').length;

      console.log(`Job ${job.id}: ${completedCount} completed, ${failedCount} failed, ${pendingCount} pending out of ${predictions.length}`);

      // Check if any pending predictions are stuck (no webhook received for > 3 minutes)
      const PREDICTION_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes (reduced from 5)
      let timedOutPredictions = 0;

      for (const pred of predictions) {
        if (pred.status === 'pending' || pred.status === 'starting') {
          const predAge = Date.now() - new Date(pred.created_at).getTime();
          
          if (predAge > PREDICTION_TIMEOUT_MS) {
            console.log(`Prediction ${pred.prediction_id} timed out after ${Math.round(predAge / 60000)} minutes`);
            
            // Mark prediction as failed
            await adminClient
              .from('pending_predictions')
              .update({
                status: 'failed',
                error_message: 'Timeout - no webhook received',
                completed_at: new Date().toISOString()
              })
              .eq('id', pred.id);

            timedOutPredictions++;
          }
        }
      }

      // Recalculate counts after timeouts
      const actualFailedCount = failedCount + timedOutPredictions;
      const allDone = (completedCount + actualFailedCount) === predictions.length;

      if (allDone) {
        // All predictions are done - mark job as complete
        const finalStatus = completedCount > 0 ? 'completed' : 'failed';
        const errorMsg = actualFailedCount > 0 ? `${actualFailedCount} générations échouées` : null;

        console.log(`All predictions done for job ${job.id}. Status: ${finalStatus}, completed: ${completedCount}, failed: ${actualFailedCount}`);

        await adminClient
          .from('generation_jobs')
          .update({
            status: finalStatus,
            progress: completedCount,
            error_message: errorMsg,
            completed_at: new Date().toISOString()
          })
          .eq('id', job.id);

        results.push({ 
          jobId: job.id, 
          action: 'completed', 
          status: finalStatus, 
          completed: completedCount, 
          failed: actualFailedCount,
          timedOut: timedOutPredictions
        });

        // For images job, check if there are more images to generate (chunk continuation)
        if (job.job_type === 'images') {
          const { data: project } = await adminClient
            .from('projects')
            .select('prompts')
            .eq('id', job.project_id)
            .single();
          
          const prompts = (project?.prompts as any[]) || [];
          const missingCount = prompts.filter((p: any) => p?.prompt && !p?.imageUrl).length;
          
          if (missingCount > 0) {
            console.log(`Job ${job.id}: ${missingCount} images still missing - creating next chunk`);
            
            // Check for existing chunk job to prevent duplicates
            const { data: existingChunkJob } = await adminClient
              .from('generation_jobs')
              .select('id')
              .eq('project_id', job.project_id)
              .eq('job_type', 'images')
              .in('status', ['pending', 'processing'])
              .single();

            if (!existingChunkJob) {
              // Create next chunk job
              const { data: nextChunkJob } = await adminClient
                .from('generation_jobs')
                .insert({
                  project_id: job.project_id,
                  user_id: job.user_id,
                  job_type: 'images',
                  status: 'pending',
                  progress: 0,
                  total: Math.min(missingCount, 50),
                  metadata: {
                    ...job.metadata,
                    skipExisting: true,
                    isChunkContinuation: true
                  }
                })
                .select()
                .single();
              
              if (nextChunkJob) {
                console.log(`Created next chunk job ${nextChunkJob.id} for ${Math.min(missingCount, 50)} images`);
                
                // Start the next chunk job
                const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
                const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
                
                fetch(`${supabaseUrl}/functions/v1/start-generation-job`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${supabaseServiceKey}`
                  },
                  body: JSON.stringify({
                    jobId: nextChunkJob.id,
                    projectId: job.project_id,
                    userId: job.user_id,
                    jobType: 'images',
                    metadata: {
                      ...job.metadata,
                      skipExisting: true,
                      isChunkContinuation: true
                    }
                  })
                }).catch(err => console.error("Error starting next chunk:", err));
                
                results.push({ 
                  jobId: job.id, 
                  action: 'chunk_continued',
                  nextChunkId: nextChunkJob.id,
                  missingImages: missingCount
                });
                continue; // Don't chain to thumbnails yet
              }
            }
          }
        }
        
        // Chain next job if needed - check both semiAutoMode and semiAutonomous for backwards compatibility
        if (finalStatus === 'completed' && (job.metadata?.semiAutoMode || job.metadata?.semiAutonomous)) {
          console.log(`Job ${job.id} completed - attempting to chain next job`);
          // Call chain function via webhook
          await chainNextJobFromCheck(adminClient, job);
        }
      } else {
        results.push({ 
          jobId: job.id, 
          action: 'still_processing', 
          completed: completedCount, 
          failed: actualFailedCount,
          pending: pendingCount - timedOutPredictions,
          timedOut: timedOutPredictions
        });
      }
    }

    return new Response(JSON.stringify({ 
      message: "Check complete", 
      results 
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("Error checking stuck jobs:", error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function chainNextJobFromCheck(adminClient: any, job: any) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  try {
    const jobType = job.job_type;
    const projectId = job.project_id;
    const userId = job.user_id;

    // Determine next job type
    let nextJobType: string | null = null;
    if (jobType === 'prompts') {
      nextJobType = 'images';
    } else if (jobType === 'images') {
      nextJobType = 'thumbnails';
    }

    if (!nextJobType) {
      console.log(`No next job type after ${jobType}`);
      return;
    }

    // Check if next job already exists
    const { data: existingJob } = await adminClient
      .from('generation_jobs')
      .select('id')
      .eq('project_id', projectId)
      .eq('job_type', nextJobType)
      .in('status', ['pending', 'processing'])
      .single();

    if (existingJob) {
      console.log(`${nextJobType} job already exists for project ${projectId}`);
      return;
    }

    // Call start-generation-job to create the next job
    const response = await fetch(`${supabaseUrl}/functions/v1/start-generation-job`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectId,
        userId,
        jobType: nextJobType,
        metadata: {
          ...job.metadata,
          skipExisting: true,
          autoChained: true
        }
      }),
    });

    if (response.ok) {
      console.log(`Successfully chained ${nextJobType} job for project ${projectId}`);
    } else {
      console.error(`Failed to chain ${nextJobType} job:`, await response.text());
    }
  } catch (error) {
    console.error(`Error chaining next job:`, error);
  }
}
