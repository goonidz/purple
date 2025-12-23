import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get the Authorization header
    const authHeader = req.headers.get('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized - Bearer token required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract the token from the header
    const providedKey = authHeader.replace('Bearer ', '');
    
    // Verify it's a valid service role key by checking if it's a JWT with service_role
    try {
      const payload = JSON.parse(atob(providedKey.split('.')[1]));
      if (payload.role !== 'service_role') {
        return new Response(
          JSON.stringify({ error: 'Unauthorized - service role key required' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } catch (e) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized - invalid token format' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    // Use the provided service role key
    const supabase = createClient(supabaseUrl, providedKey);

    // Calculate date threshold (7 days ago)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const thresholdTimestamp = Math.floor(sevenDaysAgo.getTime() / 1000); // Unix timestamp in seconds

    console.log(`Cleaning up images older than ${sevenDaysAgo.toISOString()}`);

    // List all folders (project IDs) in the bucket
    const { data: folders, error: listFoldersError } = await supabase.storage
      .from('generated-images')
      .list('', {
        limit: 1000
      });

    if (listFoldersError) {
      throw new Error(`Failed to list folders: ${listFoldersError.message}`);
    }

    if (!folders || folders.length === 0) {
      console.log('No folders found in bucket');
      return new Response(
        JSON.stringify({ message: 'No files to clean up', deleted: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Filter files to delete:
    // 1. Not thumbnails (don't contain "thumb_v" in name)
    // 2. Older than 7 days
    const filesToDelete: string[] = [];
    
    // Recursive function to process folders
    const processFolder = async (folderPath: string) => {
      const { data: items, error: listError } = await supabase.storage
        .from('generated-images')
        .list(folderPath, {
          limit: 1000
        });

      if (listError) {
        console.error(`Error listing ${folderPath}:`, listError.message);
        return;
      }

      if (!items) return;

      for (const item of items) {
        const itemPath = folderPath ? `${folderPath}/${item.name}` : item.name;
        
        // Skip thumbnails (contain "thumb_v" in name)
        if (item.name.includes('thumb_v')) {
          continue;
        }

        // If it's a file (has extension or matches known patterns)
        if (item.name.includes('.') || item.name.includes('scene_') || item.name.match(/^\d+_/)) {
          // Check if file is older than 7 days
          if (item.created_at) {
            const fileTimestamp = Math.floor(new Date(item.created_at).getTime() / 1000);
            if (fileTimestamp < thresholdTimestamp) {
              filesToDelete.push(itemPath);
            }
          }
        } else {
          // It's a subfolder, process recursively
          await processFolder(itemPath);
        }
      }
    };
    
    // Process each folder (project)
    for (const folder of folders) {
      // Skip if it's a file (has extension)
      if (folder.name.includes('.')) {
        continue;
      }

      await processFolder(folder.name);
    }

    console.log(`Found ${filesToDelete.length} files to delete`);

    // Delete files in batches
    let deletedCount = 0;
    let errorCount = 0;
    const BATCH_SIZE = 50;

    for (let i = 0; i < filesToDelete.length; i += BATCH_SIZE) {
      const batch = filesToDelete.slice(i, i + BATCH_SIZE);
      
      const { data: deleted, error: deleteError } = await supabase.storage
        .from('generated-images')
        .remove(batch);

      if (deleteError) {
        console.error(`Error deleting batch: ${deleteError.message}`);
        errorCount += batch.length;
      } else {
        deletedCount += batch.length;
        console.log(`Deleted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} files`);
      }
    }

    console.log(`Cleanup complete: ${deletedCount} deleted, ${errorCount} errors`);

    return new Response(
      JSON.stringify({
        message: 'Cleanup completed',
        deleted: deletedCount,
        errors: errorCount,
        total: filesToDelete.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in cleanup-old-images:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'An unexpected error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
