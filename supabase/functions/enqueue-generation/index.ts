import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isInternalServiceCall } from "../_shared/auth.ts";

// Declare EdgeRuntime for background task support
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface QueueItem {
  index: number;
  payload: Record<string, any>;
  priority?: number;
}

interface EnqueueRequest {
  projectId: string;
  jobId: string;
  userId?: string; // Required for service role calls
  generationType: 'scene_image' | 'upscale' | 'thumbnail' | 'qa';
  items: QueueItem[];
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const adminClient = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Get auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if this is a service role key (internal call). Uses the shared
    // helper which accepts ANY valid service-role-equivalent token (legacy
    // SUPABASE_SERVICE_ROLE_KEY JWT, new sb_secret_* keys via
    // SUPABASE_SECRET_KEYS, or extras in SERVICE_KEY_ALLOWLIST).
    const isServiceRoleCall = isInternalServiceCall(req);

    let userId: string;

    if (isServiceRoleCall) {
      // Internal call - get userId from request body
      const bodyClone = req.clone();
      const bodyData = await bodyClone.json();
      if (!bodyData.userId) {
        return new Response(JSON.stringify({ error: 'userId required for internal calls' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      userId = bodyData.userId;
    } else {
      // Normal user call - verify user authentication
      const supabase = createClient(
        supabaseUrl,
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } }
      );

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      userId = user.id;
    }

    const body: EnqueueRequest = await req.json();
    const { projectId, jobId, generationType, items } = body;

    // Validate required fields
    if (!projectId || !jobId || !generationType || !items || !Array.isArray(items)) {
      return new Response(JSON.stringify({ 
        error: 'Missing required fields: projectId, jobId, generationType, items' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (items.length === 0) {
      return new Response(JSON.stringify({ 
        error: 'No items to enqueue',
        queued: 0
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[enqueue-generation] Enqueueing ${items.length} ${generationType} items for project ${projectId}`);

    // Prepare items for insertion
    const queueItems = items.map((item) => ({
      project_id: projectId,
      job_id: jobId,
      user_id: userId,
      generation_type: generationType,
      item_index: item.index,
      payload: item.payload,
      priority: item.priority || 0,
      status: 'pending',
      retry_count: 0,
    }));

    // Insert items into the queue (upsert to handle re-runs)
    const { data: insertedItems, error: insertError } = await adminClient
      .from('generation_queue')
      .upsert(queueItems, {
        onConflict: 'project_id,generation_type,item_index',
        ignoreDuplicates: false, // Update existing items
      })
      .select('id');

    if (insertError) {
      console.error('[enqueue-generation] Error inserting items:', insertError);
      return new Response(JSON.stringify({ 
        error: 'Failed to enqueue items',
        details: insertError.message
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const queuedCount = insertedItems?.length || items.length;
    console.log(`[enqueue-generation] Successfully queued ${queuedCount} items`);

    // Update job metadata with queue info
    await adminClient
      .from('generation_jobs')
      .update({
        total: items.length,
        metadata: {
          useQueue: true,
          queuedAt: new Date().toISOString(),
          generationType,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    // Trigger processing in background
    EdgeRuntime.waitUntil((async () => {
      try {
        // Small delay to ensure DB commits
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const response = await fetch(`${supabaseUrl}/functions/v1/process-generation-queue`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({ trigger: 'enqueue' }),
        });

        if (response.ok) {
          console.log('[enqueue-generation] Triggered process-generation-queue successfully');
        } else {
          console.error('[enqueue-generation] Failed to trigger processing:', await response.text());
        }
      } catch (error) {
        console.error('[enqueue-generation] Error triggering processing:', error);
      }
    })());

    return new Response(JSON.stringify({ 
      success: true,
      queued: queuedCount,
      jobId,
      generationType,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[enqueue-generation] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
