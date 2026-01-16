import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Declare EdgeRuntime for background task support
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Global concurrency settings
const MAX_GLOBAL_CONCURRENT = 50;  // Max items processing globally
const BATCH_SIZE = 10;              // Max items to claim per invocation
const DELAY_BETWEEN_REQUESTS_MS = 50; // Small delay between API calls

interface QueueItem {
  id: string;
  project_id: string;
  job_id: string;
  user_id: string;
  generation_type: string;
  item_index: number;
  payload: Record<string, any>;
  status: string;
  prediction_id: string | null;
  retry_count: number;
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
    // Verify this is a service role call (internal only)
    const authHeader = req.headers.get('Authorization');
    const expectedHeader = `Bearer ${supabaseServiceKey}`;
    
    if (authHeader !== expectedHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized - internal use only' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const trigger = body.trigger || 'manual';
    
    console.log(`[process-queue] Triggered by: ${trigger}`);

    // Step 1: Check global concurrency
    const { count: processingCount, error: countError } = await adminClient
      .from('generation_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'processing');

    if (countError) {
      console.error('[process-queue] Error counting processing items:', countError);
      throw new Error('Failed to check processing count');
    }

    const currentProcessing = processingCount || 0;
    const slotsAvailable = MAX_GLOBAL_CONCURRENT - currentProcessing;

    console.log(`[process-queue] Current processing: ${currentProcessing}, slots available: ${slotsAvailable}`);

    if (slotsAvailable <= 0) {
      console.log('[process-queue] Global limit reached, waiting for webhooks');
      return new Response(JSON.stringify({ 
        message: 'Global limit reached',
        processing: currentProcessing,
        maxConcurrent: MAX_GLOBAL_CONCURRENT,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 2: Claim items atomically
    const claimLimit = Math.min(BATCH_SIZE, slotsAvailable);
    
    const { data: claimedItems, error: claimError } = await adminClient
      .rpc('claim_queue_items', { p_limit: claimLimit });

    if (claimError) {
      console.error('[process-queue] Error claiming items:', claimError);
      throw new Error('Failed to claim queue items');
    }

    if (!claimedItems || claimedItems.length === 0) {
      console.log('[process-queue] No pending items to process');
      return new Response(JSON.stringify({ 
        message: 'No pending items',
        processing: currentProcessing,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[process-queue] Claimed ${claimedItems.length} items for processing`);

    // Step 3: Process each claimed item
    const webhookUrl = `${supabaseUrl}/functions/v1/replicate-webhook`;
    let successCount = 0;
    let failCount = 0;

    for (const item of claimedItems as QueueItem[]) {
      try {
        const predictionId = await processQueueItem(
          item,
          webhookUrl,
          supabaseUrl,
          supabaseServiceKey,
          adminClient
        );

        if (predictionId) {
          // Update queue item with prediction ID
          await adminClient
            .from('generation_queue')
            .update({ prediction_id: predictionId })
            .eq('id', item.id);
          
          successCount++;
          console.log(`[process-queue] Item ${item.id} started, prediction: ${predictionId}`);
        } else {
          throw new Error('No prediction ID returned');
        }

        // Small delay between requests to avoid rate limiting
        if (claimedItems.indexOf(item) < claimedItems.length - 1) {
          await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS_MS));
        }

      } catch (error) {
        console.error(`[process-queue] Error processing item ${item.id}:`, error);
        
        // Mark as failed or pending for retry
        const shouldRetry = item.retry_count < 3;
        await adminClient
          .from('generation_queue')
          .update({
            status: shouldRetry ? 'pending' : 'failed',
            error_message: error instanceof Error ? error.message : 'Unknown error',
            started_at: null,
            retry_count: item.retry_count + 1,
          })
          .eq('id', item.id);
        
        failCount++;
      }
    }

    // Step 4: Update job progress for all affected jobs
    const jobIds = [...new Set(claimedItems.map((item: QueueItem) => item.job_id))];
    for (const jobId of jobIds) {
      await updateJobProgress(adminClient, jobId);
    }

    console.log(`[process-queue] Batch complete: ${successCount} started, ${failCount} failed`);

    // Step 5: Check if there are more pending items and trigger another batch
    const { count: pendingCount } = await adminClient
      .from('generation_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');

    if (pendingCount && pendingCount > 0 && successCount > 0) {
      console.log(`[process-queue] ${pendingCount} items still pending, scheduling next batch`);
      
      // Trigger next batch in background with small delay
      EdgeRuntime.waitUntil((async () => {
        await new Promise(resolve => setTimeout(resolve, 500));
        try {
          await fetch(`${supabaseUrl}/functions/v1/process-generation-queue`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({ trigger: 'continuation' }),
          });
        } catch (error) {
          console.error('[process-queue] Error triggering next batch:', error);
        }
      })());
    }

    return new Response(JSON.stringify({ 
      success: true,
      started: successCount,
      failed: failCount,
      pendingRemaining: pendingCount || 0,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[process-queue] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Process a single queue item by calling the appropriate generation function
 */
async function processQueueItem(
  item: QueueItem,
  webhookUrl: string,
  supabaseUrl: string,
  supabaseServiceKey: string,
  adminClient: any
): Promise<string | null> {
  const { generation_type, payload, user_id, project_id, item_index, job_id } = item;

  console.log(`[process-queue] Processing ${generation_type} for project ${project_id}, index ${item_index}`);

  // Build the request based on generation type
  let endpoint: string;
  let requestBody: Record<string, any>;

  switch (generation_type) {
    case 'scene_image':
      endpoint = `${supabaseUrl}/functions/v1/generate-image-seedream`;
      requestBody = {
        prompt: payload.prompt,
        model: payload.model || 'seedream-4.5',
        width: payload.width,
        height: payload.height,
        image_urls: payload.styleRefs || [],
        async: true,
        webhook_url: webhookUrl,
        userId: user_id,
        // Pass metadata for webhook to use
        projectId: project_id,
        sceneIndex: item_index,
        jobId: job_id,
        queueItemId: item.id,
      };
      break;

    case 'upscale':
      endpoint = `${supabaseUrl}/functions/v1/upscale-image`;
      requestBody = {
        imageUrl: payload.imageUrl,
        scale: payload.scale || 2,
        faceEnhance: payload.faceEnhance || false,
        async: true,
        webhook_url: webhookUrl,
        userId: user_id,
        // Pass metadata for webhook
        projectId: project_id,
        sceneIndex: item_index,
        jobId: job_id,
        queueItemId: item.id,
      };
      break;

    case 'thumbnail':
      endpoint = `${supabaseUrl}/functions/v1/generate-image-seedream`;
      requestBody = {
        prompt: payload.prompt,
        model: payload.model || 'seedream-4.5',
        width: payload.width || 1280,
        height: payload.height || 720,
        image_urls: payload.exampleUrls || [],
        async: true,
        webhook_url: webhookUrl,
        userId: user_id,
        // Pass metadata for webhook
        projectId: project_id,
        thumbnailIndex: item_index,
        jobId: job_id,
        queueItemId: item.id,
      };
      break;

    default:
      throw new Error(`Unknown generation type: ${generation_type}`);
  }

  // Make the API call
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseServiceKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API call failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  
  if (result.predictionId) {
    // Also create a pending_prediction entry for backward compatibility
    // This allows the existing webhook to work with both old and new systems
    await adminClient
      .from('pending_predictions')
      .upsert({
        job_id: job_id,
        prediction_id: result.predictionId,
        prediction_type: generation_type,
        scene_index: generation_type === 'scene_image' || generation_type === 'upscale' ? item_index : null,
        thumbnail_index: generation_type === 'thumbnail' ? item_index : null,
        project_id: project_id,
        user_id: user_id,
        metadata: {
          queueItemId: item.id,
          ...payload,
        },
        status: 'pending',
      }, {
        onConflict: 'prediction_id',
        ignoreDuplicates: true,
      });

    return result.predictionId;
  }

  return null;
}

/**
 * Update job progress based on queue item statuses
 */
async function updateJobProgress(adminClient: any, jobId: string): Promise<void> {
  try {
    // Count completed items for this job
    const { count: completedCount } = await adminClient
      .from('generation_queue')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .eq('status', 'completed');

    const { count: totalCount } = await adminClient
      .from('generation_queue')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', jobId);

    // Update job progress
    await adminClient
      .from('generation_jobs')
      .update({
        progress: completedCount || 0,
        total: totalCount || 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);

  } catch (error) {
    console.error(`[process-queue] Error updating job progress for ${jobId}:`, error);
  }
}
