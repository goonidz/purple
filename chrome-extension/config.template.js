// Configuration de l'extension VideoFlow
// INSTRUCTIONS:
// 1. Copiez ce fichier et renommez-le en "config.js"
// 2. Remplacez les valeurs ci-dessous par vos vraies clés Supabase
// 3. Ces valeurs se trouvent dans: Supabase Dashboard → Settings → API

const CONFIG = {
  // URL de votre projet Supabase
  // Format: https://XXXXX.supabase.co
  SUPABASE_URL: 'VOTRE_SUPABASE_URL',
  
  // Clé publique (anon) de votre projet Supabase
  // Note: Cette clé est publique et peut être exposée côté client
  SUPABASE_ANON_KEY: 'VOTRE_SUPABASE_ANON_KEY',
  
  // URL de votre application VideoFlow (page calendrier)
  // Exemple: https://votre-app.com/calendar
  CALENDAR_URL: 'https://VOTRE_URL/calendar'
};

// ⚠️ NE PAS COMMITTER CE FICHIER SUR GIT ⚠️
// Le fichier config.js est dans .gitignore pour protéger vos clés
