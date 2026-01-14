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

    console.log('[GPU] Calling render-video-gpu Edge Function with:', { projectId, framerate, width, height, effectType, renderMethod });
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
        statusUrl: data.statusUrl,
      });
      return {
        success: true,
        jobId: data.jobId,
        status: data.status || 'pending',
        statusUrl: data.statusUrl,
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
 * Poll RunPod job status
 */
export async function pollGpuJobStatus(statusUrl: string): Promise<JobStatus> {
  try {
    const response = await fetch(statusUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch GPU job status: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Map RunPod status to our status format
    let status: 'pending' | 'processing' | 'completed' | 'failed' = 'pending';
    if (data.status === 'IN_QUEUE') status = 'pending';
    else if (data.status === 'IN_PROGRESS') status = 'processing';
    else if (data.status === 'COMPLETED') status = 'completed';
    else if (data.status === 'FAILED' || data.status === 'CANCELLED') status = 'failed';
    
    return {
      success: data.status !== 'FAILED' && data.status !== 'CANCELLED',
      jobId: data.id || '',
      status,
      progress: data.progress,
      videoUrl: data.output?.videoUrl,
      duration: data.output?.duration,
      fileSizeMB: data.output?.fileSizeMB,
      steps: data.output?.steps || [],
      currentStep: data.output?.currentStep || null,
      error: data.error,
    };
  } catch (error: any) {
    console.error('[GPU] Poll job status error:', error);
    return {
      success: false,
      jobId: '',
      status: 'failed',
      error: error.message || 'Failed to poll GPU job status',
    };
  }
}
