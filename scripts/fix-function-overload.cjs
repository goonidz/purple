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
          if (data.includes('does not exist')) {
            console.log('✅ Fonction déjà supprimée (OK)');
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

async function fixFunctionOverload() {
  console.log('🔧 Correction du conflit de surcharge de fonction...\n');
  console.log('   Project:', PROJECT_REF);

  // SUPPRIMER L'ANCIENNE VERSION (1 paramètre)
  const dropOldFunction = `
DROP FUNCTION IF EXISTS public.get_user_api_key(TEXT);
`;

  // RECRÉER LA NOUVELLE VERSION (2 paramètres avec default)
  const createNewFunction = `
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

  try {
    await executeSQL(dropOldFunction, 'Suppression de l\'ancienne fonction get_user_api_key(TEXT)');
    await executeSQL(createNewFunction, 'Recréation de get_user_api_key(TEXT, UUID)');
    
    console.log('\n🎉 Conflit résolu !');
    console.log('\n💡 Rafraîchis ta page Profil (F5) - Les clés devraient charger SANS erreur !');
  } catch (error) {
    console.error('\n❌ Erreur fatale:', error.message);
    process.exit(1);
  }
}

fixFunctionOverload();
