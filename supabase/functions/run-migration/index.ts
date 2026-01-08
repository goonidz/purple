import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

serve(async (req) => {
  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    console.log('🚀 Début de la migration...')

    // Exécuter directement via SQL
    const { data, error } = await supabaseAdmin
      .from('channels')
      .select('id')
      .limit(1)
    
    if (error) {
      console.error('Erreur de connexion:', error)
      return new Response(JSON.stringify({ error: error.message }), {
        headers: { "Content-Type": "application/json" },
        status: 500,
      })
    }

    console.log('✅ Connecté à la base de données')

    // Utiliser l'API raw SQL de Supabase via fetch
    const { data: result, error: sqlError } = await supabaseAdmin.rpc('exec', {
      sql: `
ALTER TABLE channels 
  ADD COLUMN IF NOT EXISTS script_preset_id UUID REFERENCES script_presets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tts_preset_id UUID REFERENCES tts_presets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_preset_id UUID REFERENCES presets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS thumbnail_preset_id UUID REFERENCES thumbnail_presets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS thumbnail_preset_enabled BOOLEAN DEFAULT true;
      `
    })

    if (sqlError) {
      console.error('Erreur SQL:', sqlError)
      // Probablement que exec() n'existe pas, retournons le SQL à exécuter
      return new Response(JSON.stringify({ 
        error: 'RPC exec not found - use SQL Editor',
        sql: `
ALTER TABLE channels 
  ADD COLUMN IF NOT EXISTS script_preset_id UUID REFERENCES script_presets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tts_preset_id UUID REFERENCES tts_presets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_preset_id UUID REFERENCES presets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS thumbnail_preset_id UUID REFERENCES thumbnail_presets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS thumbnail_preset_enabled BOOLEAN DEFAULT true;
        `
      }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      })
    }

    console.log('✅ Migration appliquée!')

    return new Response(JSON.stringify({ 
      success: true,
      message: 'Migration applied successfully',
      result
    }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    })

  } catch (error) {
    console.error('Erreur:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    })
  }
})
