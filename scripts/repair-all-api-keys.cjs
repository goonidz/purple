require('dotenv').config();
const https = require('https');

const PROJECT_REF = 'laqgmqyjstisipsbljha';

async function executeSQL(sqlQuery, description) {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

  console.log(`\n🚀 ${description}...`);

  if (!accessToken) {
    console.error('❌ SUPABASE_ACCESS_TOKEN not found in .env');
    process.exit(1);
  }

  const postData = JSON.stringify({ query: sqlQuery });

  const options = {
    hostname: 'api.supabase.com',
    path: `/v1/projects/${PROJECT_REF}/database/query`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          console.log(`✅ ${description} - Succès !`);
          resolve();
        } else {
          console.error(`❌ Erreur: ${res.statusCode} - ${data}`);
          if (data.includes('already exists') || data.includes('duplicate')) {
            console.log('✅ Déjà appliqué (OK)');
            resolve();
          } else {
            reject(new Error(`API returned ${res.statusCode}: ${data}`));
          }
        }
      });
    });
    req.on('error', (error) => {
      console.error('❌ Request error:', error.message);
      reject(error);
    });
    req.write(postData);
    req.end();
  });
}

async function repairAllApiKeys() {
  console.log('🔧 Réparation COMPLÈTE des clés API...\n');
  console.log('   Project:', PROJECT_REF);

  // TOUTES les colonnes manquantes
  const addColumns = `
ALTER TABLE public.user_api_keys 
ADD COLUMN IF NOT EXISTS gemini_api_key TEXT,
ADD COLUMN IF NOT EXISTS minimax_api_key TEXT,
ADD COLUMN IF NOT EXISTS kei_api_key TEXT,
ADD COLUMN IF NOT EXISTS apify_api_key TEXT,
ADD COLUMN IF NOT EXISTS inworld_api_key TEXT;
`;

  // Fonction get_user_api_key complète
  const fixGetFunction = `
CREATE OR REPLACE FUNCTION public.get_user_api_key(
  key_name TEXT,
  p_user_id UUID DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  secret_name TEXT;
  secret_value TEXT;
  target_user_id UUID;
BEGIN
  target_user_id := COALESCE(p_user_id, auth.uid());
  
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'User ID is required';
  END IF;

  secret_name := CONCAT('user_api_key_', target_user_id::text, '_', key_name);

  SELECT decrypted_secret INTO secret_value
  FROM vault.decrypted_secrets
  WHERE name = secret_name
  LIMIT 1;

  RETURN secret_value;
END;
$$;
`;

  // Fonction store complète
  const fixStoreFunction = `
CREATE OR REPLACE FUNCTION public.store_user_api_key(
  key_name TEXT,
  key_value TEXT
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  secret_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  secret_id := vault.create_secret(
    key_value,
    CONCAT('user_api_key_', auth.uid()::text, '_', key_name),
    'API key for user: ' || auth.uid()::text
  );

  INSERT INTO public.user_api_keys (
    user_id, 
    eleven_labs_api_key, 
    replicate_api_key, 
    anthropic_api_key, 
    brave_api_key, 
    gemini_api_key,
    minimax_api_key,
    kei_api_key,
    apify_api_key,
    inworld_api_key,
    updated_at
  )
  VALUES (
    auth.uid(),
    CASE WHEN key_name = 'eleven_labs' THEN secret_id::text ELSE NULL END,
    CASE WHEN key_name = 'replicate' THEN secret_id::text ELSE NULL END,
    CASE WHEN key_name = 'anthropic' THEN secret_id::text ELSE NULL END,
    CASE WHEN key_name = 'brave' THEN secret_id::text ELSE NULL END,
    CASE WHEN key_name = 'gemini' THEN secret_id::text ELSE NULL END,
    CASE WHEN key_name = 'minimax' THEN secret_id::text ELSE NULL END,
    CASE WHEN key_name = 'kei' THEN secret_id::text ELSE NULL END,
    CASE WHEN key_name = 'apify' THEN secret_id::text ELSE NULL END,
    CASE WHEN key_name = 'inworld' THEN secret_id::text ELSE NULL END,
    now()
  )
  ON CONFLICT (user_id) 
  DO UPDATE SET
    eleven_labs_api_key = CASE WHEN key_name = 'eleven_labs' THEN secret_id::text ELSE user_api_keys.eleven_labs_api_key END,
    replicate_api_key = CASE WHEN key_name = 'replicate' THEN secret_id::text ELSE user_api_keys.replicate_api_key END,
    anthropic_api_key = CASE WHEN key_name = 'anthropic' THEN secret_id::text ELSE user_api_keys.anthropic_api_key END,
    brave_api_key = CASE WHEN key_name = 'brave' THEN secret_id::text ELSE user_api_keys.brave_api_key END,
    gemini_api_key = CASE WHEN key_name = 'gemini' THEN secret_id::text ELSE user_api_keys.gemini_api_key END,
    minimax_api_key = CASE WHEN key_name = 'minimax' THEN secret_id::text ELSE user_api_keys.minimax_api_key END,
    kei_api_key = CASE WHEN key_name = 'kei' THEN secret_id::text ELSE user_api_keys.kei_api_key END,
    apify_api_key = CASE WHEN key_name = 'apify' THEN secret_id::text ELSE user_api_keys.apify_api_key END,
    inworld_api_key = CASE WHEN key_name = 'inworld' THEN secret_id::text ELSE user_api_keys.inworld_api_key END,
    updated_at = now();

  RETURN secret_id;
END;
$$;
`;

  // Fonction delete complète
  const fixDeleteFunction = `
CREATE OR REPLACE FUNCTION public.delete_user_api_key(key_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  secret_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  secret_name := CONCAT('user_api_key_', auth.uid()::text, '_', key_name);

  PERFORM vault.delete_secret(
    (SELECT id FROM vault.secrets WHERE name = secret_name)
  );

  UPDATE public.user_api_keys
  SET 
    eleven_labs_api_key = CASE WHEN key_name = 'eleven_labs' THEN NULL ELSE eleven_labs_api_key END,
    replicate_api_key = CASE WHEN key_name = 'replicate' THEN NULL ELSE replicate_api_key END,
    anthropic_api_key = CASE WHEN key_name = 'anthropic' THEN NULL ELSE anthropic_api_key END,
    brave_api_key = CASE WHEN key_name = 'brave' THEN NULL ELSE brave_api_key END,
    gemini_api_key = CASE WHEN key_name = 'gemini' THEN NULL ELSE gemini_api_key END,
    minimax_api_key = CASE WHEN key_name = 'minimax' THEN NULL ELSE minimax_api_key END,
    kei_api_key = CASE WHEN key_name = 'kei' THEN NULL ELSE kei_api_key END,
    apify_api_key = CASE WHEN key_name = 'apify' THEN NULL ELSE apify_api_key END,
    inworld_api_key = CASE WHEN key_name = 'inworld' THEN NULL ELSE inworld_api_key END,
    updated_at = now()
  WHERE user_id = auth.uid();

  RETURN TRUE;
END;
$$;
`;

  // QA prompt column
  const addQaPrompt = `
ALTER TABLE public.presets 
ADD COLUMN IF NOT EXISTS qa_prompt TEXT;

COMMENT ON COLUMN public.presets.qa_prompt IS 'Custom QA prompt for Gemini image quality check';
`;

  try {
    await executeSQL(addColumns, 'Ajout des colonnes manquantes (minimax, kei, apify, inworld, gemini)');
    await executeSQL(fixGetFunction, 'Réparation get_user_api_key()');
    await executeSQL(fixStoreFunction, 'Réparation store_user_api_key()');
    await executeSQL(fixDeleteFunction, 'Réparation delete_user_api_key()');
    await executeSQL(addQaPrompt, 'Ajout qa_prompt aux presets');
    
    console.log('\n🎉 TOUTES les migrations appliquées avec succès !');
    console.log('\n📝 Clés API supportées :');
    console.log('   ✅ replicate');
    console.log('   ✅ eleven_labs');
    console.log('   ✅ anthropic');
    console.log('   ✅ brave');
    console.log('   ✅ gemini (nouveau)');
    console.log('   ✅ minimax');
    console.log('   ✅ kei');
    console.log('   ✅ apify');
    console.log('   ✅ inworld');
    console.log('\n💡 Rafraîchis ta page Profil maintenant !');
  } catch (error) {
    console.error('\n❌ Erreur fatale:', error.message);
    process.exit(1);
  }
}

repairAllApiKeys();
