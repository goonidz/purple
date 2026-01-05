import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CheckStatusRequest {
  taskId: string;
  jobId: string;
  projectId: string;
  sceneIndex: number;
}

Deno.serve(async (req) => {
  console.log('[check-animation-status] Function invoked, method:', req.method);
  
  if (req.method === "OPTIONS") {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('[check-animation-status] Starting request processing...');
    
    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.log('[check-animation-status] No authorization header');
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
    if (!supabaseServiceKey) {
      console.error('[check-animation-status] CRITICAL: SUPABASE_SERVICE_ROLE_KEY is not set!');
      return new Response(JSON.stringify({ 
        error: 'Server configuration error: Service key not available' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Authenticate user
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

    let body: CheckStatusRequest;
    try {
      body = await req.json();
    } catch (parseError: any) {
      return new Response(JSON.stringify({ 
        error: 'Invalid JSON in request body',
        details: parseError.message 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    const { taskId, jobId, projectId, sceneIndex } = body;

    if (!taskId || !projectId || sceneIndex === undefined) {
      return new Response(JSON.stringify({ 
        error: 'taskId, projectId, and sceneIndex are required' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // jobId is optional - job tracking may have failed

    // Get user's Kie.ai API key from Vault
    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);

    let keiApiKey: string;
    try {
      const { data: keiApiKeyData, error: keiKeyError } = await supabaseService
        .rpc('get_user_api_key_for_service', {
          target_user_id: user.id,
          key_name: 'kei'
        });

      if (keiKeyError || !keiApiKeyData || keiApiKeyData.trim() === '') {
        return new Response(JSON.stringify({ 
          error: "Clé API Kie.ai non configurée" 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      keiApiKey = keiApiKeyData;
    } catch (keyError: any) {
      return new Response(JSON.stringify({ 
        error: "Erreur lors de la récupération de la clé API",
        details: keyError.message
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check status with Kie.ai - use recordInfo endpoint
    console.log(`[check-animation-status] Checking status for task ${taskId}...`);
    
    const statusResponse = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${keiApiKey}`,
        'Content-Type': 'application/json',
      },
    });
    
    console.log(`[check-animation-status] Status response code: ${statusResponse.status}`);

    if (!statusResponse.ok) {
      const errorText = await statusResponse.text();
      console.error(`[check-animation-status] Kie.ai API error: ${errorText}`);
      return new Response(JSON.stringify({ 
        error: `Kie.ai API error: ${statusResponse.status} - ${errorText}` 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const statusData = await statusResponse.json();
    
    console.log(`[check-animation-status] Full Kie.ai response:`, JSON.stringify(statusData, null, 2));
    console.log(`[check-animation-status] Response code:`, statusData.code);
    console.log(`[check-animation-status] Response data:`, statusData.data);
    console.log(`[check-animation-status] Response data.state:`, statusData.data?.state);
    console.log(`[check-animation-status] Response data.resultJson:`, statusData.data?.resultJson);
    
    if (statusData.code !== 200 || !statusData.data) {
      console.error(`[check-animation-status] Invalid response structure:`, statusData);
      return new Response(JSON.stringify({ 
        error: `Kie.ai API error: ${statusData.message || statusData.msg || 'Invalid response'}` 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Kie.ai uses 'state' - possible values: waiting, success, fail
    const rawState = statusData.data.state;
    const finalStatus = rawState?.toLowerCase() || rawState || 'unknown';
    console.log(`[check-animation-status] Task ${taskId} raw state: "${rawState}", normalized: "${finalStatus}"`);
    
    // Check if state is success
    const isSuccess = finalStatus === 'success';
    const isFailed = finalStatus === 'fail' || finalStatus === 'failed';
    console.log(`[check-animation-status] isSuccess: ${isSuccess}, isFailed: ${isFailed}`);

    // Get job metadata (only if jobId exists)
    let metadata: any = {};
    if (jobId) {
      const { data: job } = await supabaseService
        .from('generation_jobs')
        .select('metadata')
        .eq('id', jobId)
        .single();
      metadata = (job?.metadata as any) || {};

      // Update job with current status
      await supabaseService
        .from('generation_jobs')
        .update({ 
          metadata: {
            ...metadata,
            kieApiStatus: finalStatus,
            lastChecked: new Date().toISOString()
          }
        })
        .eq('id', jobId);
    }

    // If completed, extract video URL and update project
    // Kie.ai uses 'success' for completed tasks
    if (isSuccess) {
      console.log(`[check-animation-status] Task completed! Raw data:`, JSON.stringify(statusData.data, null, 2));
      
      let videoUrl: string | null = null;
      
      // Kie.ai stores video URLs in 'resultJson' as a JSON string containing 'resultUrls' array
      if (statusData.data.resultJson) {
        try {
          const resultData = typeof statusData.data.resultJson === 'string' 
            ? JSON.parse(statusData.data.resultJson) 
            : statusData.data.resultJson;
          
          console.log(`[check-animation-status] Parsed resultJson:`, JSON.stringify(resultData, null, 2));
          
          if (resultData.resultUrls && Array.isArray(resultData.resultUrls) && resultData.resultUrls.length > 0) {
            videoUrl = resultData.resultUrls[0];
            console.log(`[check-animation-status] Found videoUrl in resultUrls: ${videoUrl}`);
          }
        } catch (parseError) {
          console.error(`[check-animation-status] Error parsing resultJson:`, parseError);
        }
      }
      
      // Fallback to other possible locations
      if (!videoUrl && statusData.data.result?.outputUrl) {
        videoUrl = statusData.data.result.outputUrl;
        console.log(`[check-animation-status] Found videoUrl in result.outputUrl: ${videoUrl}`);
      }
      
      if (!videoUrl) {
        console.error(`[check-animation-status] No videoUrl found in response. Available fields:`, Object.keys(statusData.data));
      }

      if (videoUrl) {
        console.log(`[check-animation-status] Animation completed! Video URL: ${videoUrl}`);

        // Update project prompts with videoUrl
        const { data: project } = await supabaseService
          .from('projects')
          .select('prompts')
          .eq('id', projectId)
          .single();

        if (project) {
          const prompts = (project.prompts as any[]) || [];
          if (sceneIndex < prompts.length) {
            prompts[sceneIndex] = {
              ...prompts[sceneIndex],
              videoUrl: videoUrl
            };

            console.log(`[check-animation-status] Updating project ${projectId}, scene ${sceneIndex} with videoUrl: ${videoUrl}`);
            
            const { error: updateError } = await supabaseService
              .from('projects')
              .update({ prompts })
              .eq('id', projectId);
            
            if (updateError) {
              console.error(`[check-animation-status] Error updating project:`, updateError);
            } else {
              console.log(`[check-animation-status] Project updated successfully`);
            }
          } else {
            console.error(`[check-animation-status] Scene index ${sceneIndex} out of bounds (prompts length: ${prompts.length})`);
          }
        } else {
          console.error(`[check-animation-status] Project ${projectId} not found`);
        }

        // Mark job as completed (only if jobId exists)
        if (jobId) {
          await supabaseService
            .from('generation_jobs')
            .update({ 
              status: 'completed',
              progress: 100,
              completed_at: new Date().toISOString(),
              metadata: {
                ...metadata,
                kieApiStatus: finalStatus,
                videoUrl
              }
            })
            .eq('id', jobId);
        }

        return new Response(JSON.stringify({
          success: true,
          status: finalStatus,
          videoUrl,
          completed: true
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else if (isFailed) {
      const errorMsg = statusData.data?.failMsg || statusData.error || statusData.msg || 'Unknown error';
      
      if (jobId) {
        await supabaseService
          .from('generation_jobs')
          .update({ 
            status: 'failed',
            error_message: `Animation failed: ${errorMsg}`,
            metadata: {
              ...metadata,
              kieApiStatus: finalStatus
            }
          })
          .eq('id', jobId);
      }

      return new Response(JSON.stringify({ 
        error: `Animation failed: ${errorMsg}`,
        status: finalStatus,
        completed: true
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Still processing - include debug info
    return new Response(JSON.stringify({
      success: true,
      status: finalStatus,
      completed: false,
      debug: {
        rawState: statusData.data?.state,
        hasResultJson: !!statusData.data?.resultJson,
        resultJson: statusData.data?.resultJson,
        kieResponse: statusData
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[check-animation-status] Unhandled error:', error);
    console.error('[check-animation-status] Error stack:', error.stack);
    
    return new Response(JSON.stringify({ 
      error: error.message || 'Internal server error',
      details: error.stack ? error.stack.substring(0, 500) : 'No stack trace',
      type: error.name || 'UnknownError'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
