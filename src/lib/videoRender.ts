import { supabase } from "@/integrations/supabase/client";

export interface SubtitleSettings {
  enabled: boolean;
  fontSize: number;
  fontFamily: string;
  color: string;
  backgroundColor: string;
  opacity: number;
  textShadow: string;
  x: number;
  y: number;
}

export interface VideoRenderOptions {
  projectId: string;
  framerate?: number;
  width?: number;
  height?: number;
  subtitleSettings?: SubtitleSettings;
  effectType?: 'zoom' | 'pan'; // 'zoom' for Ken Burns, 'pan' for pan effects
  renderMethod?: 'standard' | 'lanczos'; // 'standard' = 6x upscale, 'lanczos' = 2x upscale with Lanczos
}

export interface VideoRenderResult {
  success: boolean;
  videoUrl?: string;
  jobId?: string;
  duration?: number;
  error?: string;
  status?: string;
  statusUrl?: string;
}

export interface JobStatus {
  success: boolean;
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number;
  videoUrl?: string;
  duration?: number;
  fileSizeMB?: number;
  steps?: Array<{ message: string; timestamp: string }>;
  currentStep?: string | null;
  error?: string;
}

/**
 * Render video using backend FFmpeg service
 */
export async function renderVideo(options: VideoRenderOptions): Promise<VideoRenderResult> {
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

    console.log('Calling render-video Edge Function with:', { projectId, framerate, width, height, effectType, renderMethod });
    console.log('User authenticated:', user.id);
    console.log('Session valid:', !!session);

    const requestBody = {
      projectId,
      framerate,
      width,
      height,
      subtitleSettings,
      effectType,
      renderMethod,
    };
    
    console.log('Request body keys:', Object.keys(requestBody));
    console.log('Request body effectType:', requestBody.effectType, '(type:', typeof requestBody.effectType, ')');

    const { data, error } = await supabase.functions.invoke('render-video', {
      body: requestBody,
    });

    console.log('Edge Function response:', { data, error });

    if (error) {
      console.error('Edge Function error:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      
      // Check if it's an authentication error
      if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
        throw new Error('Erreur d\'authentification. Veuillez vous reconnecter.');
      }
      
      throw new Error(error.message || 'Failed to invoke Edge Function');
    }

    if (data && data.success) {
      console.log('Render video success, returning:', {
        jobId: data.jobId,
        status: data.status,
        statusUrl: data.statusUrl,
        dbJobId: data.dbJobId,
      });
      return {
        success: true,
        jobId: data.jobId,
        status: data.status || 'pending',
        statusUrl: data.statusUrl,
        // videoUrl and duration will be available after polling
      };
    }

    return {
      success: false,
      error: data?.error || 'Unknown error from Edge Function',
    };
  } catch (error: any) {
    console.error('Video render error:', error);
    return {
      success: false,
      error: error.message || 'Failed to render video',
    };
  }
}

/**
 * Poll job status from FFmpeg service
 */
export async function pollJobStatus(statusUrl: string): Promise<JobStatus> {
  try {
    const response = await fetch(statusUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch job status: ${response.statusText}`);
    }
    
    const data = await response.json();
    return {
      success: data.success !== false,
      jobId: data.jobId,
      status: data.status || 'pending',
      progress: data.progress,
      videoUrl: data.videoUrl,
      duration: data.duration,
      fileSizeMB: data.fileSizeMB,
      steps: data.steps || [],
      currentStep: data.currentStep || null,
      error: data.error,
    };
  } catch (error: any) {
    console.error('Poll job status error:', error);
    return {
      success: false,
      jobId: '',
      status: 'failed',
      error: error.message || 'Failed to poll job status',
    };
  }
}

/**
 * Poll job status until completion or failure
 */
export async function waitForJobCompletion(
  statusUrl: string,
  onProgress?: (progress: number, status?: JobStatus) => void,
  pollInterval: number = 2000
): Promise<JobStatus> {
  return new Promise((resolve) => {
    const poll = async () => {
      const status = await pollJobStatus(statusUrl);
      
      if (onProgress) {
        onProgress(status.progress || 0, status);
      }
      
      if (status.status === 'completed') {
        resolve(status);
        return;
      }
      
      if (status.status === 'failed') {
        resolve(status);
        return;
      }
      
      // Continue polling
      setTimeout(poll, pollInterval);
    };
    
    poll();
  });
}
