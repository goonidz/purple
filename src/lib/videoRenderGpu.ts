import { supabase } from "@/integrations/supabase/client";
import type { VideoRenderOptions, VideoRenderResult, JobStatus } from "./videoRender";

/**
 * Render video using RunPod GPU Serverless
 * This is a separate workflow from the VPS rendering
 */
export async function renderVideoGpu(options: VideoRenderOptions): Promise<VideoRenderResult> {
  try {
    // Verify user is authenticated and refresh session if needed
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      throw new Error("User not authenticated");
    }

    // Refresh session to ensure token is valid
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
      // Try to refresh
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        throw new Error("Session expired. Please log in again.");
      }
    }

    const { projectId, framerate = 25, width = 1920, height = 1080, subtitleSettings, effectType = 'pan', renderMethod = 'standard' } = options;

    console.log('[GPU] Calling render-video-gpu Edge Function (Serverless) with:', { projectId, framerate, width, height, effectType, renderMethod });
    console.log('[GPU] User authenticated:', user.id);

    const requestBody = {
      projectId,
      framerate,
      width,
      height,
      subtitleSettings,
      effectType,
      renderMethod,
    };

    const { data, error } = await supabase.functions.invoke('render-video-gpu', {
      body: requestBody,
    });

    console.log('[GPU] Edge Function response:', { data, error });

    if (error) {
      console.error('[GPU] Edge Function error:', error);
      console.error('[GPU] Error details:', JSON.stringify(error, null, 2));
      
      // Check if it's an authentication error
      if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
        throw new Error('Erreur d\'authentification. Veuillez vous reconnecter.');
      }
      
      throw new Error(error.message || 'Failed to invoke GPU Edge Function');
    }

    if (data && data.success) {
      console.log('[GPU] Render video success, returning:', {
        jobId: data.jobId,
        status: data.status,
      });
      return {
        success: true,
        jobId: data.jobId,
        status: data.status || 'pending',
      };
    }

    return {
      success: false,
      error: data?.error || 'Unknown error from GPU Edge Function',
    };
  } catch (error: any) {
    console.error('[GPU] Video render error:', error);
    return {
      success: false,
      error: error.message || 'Failed to render video with GPU',
    };
  }
}

/**
 * Poll GPU Pod job status from DB (gpu_render_jobs)
 */
export async function pollGpuJobStatusFromDb(jobId: string): Promise<JobStatus> {
  try {
    const { data, error } = await supabase
      .from('gpu_render_jobs')
      .select('id,status,progress,video_url,error_message,updated_at')
      .eq('id', jobId)
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'Failed to fetch GPU job status');
    }

    return {
      success: data.status !== 'failed' && data.status !== 'cancelled',
      jobId: data.id,
      status: data.status as any,
      progress: data.progress ?? undefined,
      videoUrl: data.video_url ?? undefined,
      error: data.error_message ?? undefined,
    };
  } catch (error: any) {
    console.error('[GPU] Poll job status error:', error);
    return {
      success: false,
      jobId,
      status: 'failed',
      error: error.message || 'Failed to poll GPU job status',
    };
  }
}

// Backwards-compatible export (serverless path previously used statusUrl polling)
export async function pollGpuJobStatus(_statusUrl: string): Promise<JobStatus> {
  return {
    success: false,
    jobId: '',
    status: 'failed',
    error: 'Deprecated: GPU Pod uses DB polling; call pollGpuJobStatusFromDb(jobId)',
  };
}
