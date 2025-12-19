const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Configuration
const OLD_USER_ID = 'e622c54f-8a88-403a-bfea-1f29b71c40f9';
const NEW_USER_ID = 'b5ea24ac-499a-4cff-bd6f-a946b0f017fd';

const SUPABASE_URL = 'https://laqgmqyjstisipsbljha.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Dossier des CSV (même dossier que le script)
const CSV_DIR = __dirname;

// Ordre d'import (respecte les dépendances)
const IMPORT_ORDER = [
  // Niveau 1 - Sans dépendances
  'presets',
  'tts_presets',
  'script_presets',
  'thumbnail_presets',
  'title_presets',
  'lora_presets',
  'user_api_keys',
  // Niveau 2 - Dépend de thumbnail_presets
  'projects',
  // Niveau 3 - Dépend de projects
  'content_calendar',
  'generation_jobs',
  'generated_descriptions',
  'generated_tags',
  'generated_titles',
  'generated_thumbnails',
  // Niveau 4 - Dépend de generation_jobs
  'pending_predictions',
];

// Detect delimiter (comma or semicolon)
function detectDelimiter(content) {
  const firstLine = content.split('\n')[0];
  const semicolons = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return semicolons > commas ? ';' : ',';
}

// Parse CSV with multiline support
function parseCSV(content) {
  if (!content.trim()) return [];
  
  const delimiter = detectDelimiter(content);
  console.log(`   Delimiter detected: "${delimiter}"`);
  
  // Parse the entire content handling multiline quoted fields
  const records = [];
  let currentRecord = [];
  let currentField = '';
  let inQuotes = false;
  
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];
    
    if (char === '"') {
      if (!inQuotes) {
        inQuotes = true;
      } else if (nextChar === '"') {
        currentField += '"';
        i++; // Skip escaped quote
      } else {
        inQuotes = false;
      }
    } else if (char === delimiter && !inQuotes) {
      currentRecord.push(currentField);
      currentField = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++; // Skip \r\n
      }
      if (currentField || currentRecord.length > 0) {
        currentRecord.push(currentField);
        if (currentRecord.some(f => f.trim())) {
          records.push(currentRecord);
        }
        currentRecord = [];
        currentField = '';
      }
    } else {
      currentField += char;
    }
  }
  
  // Don't forget last record
  if (currentField || currentRecord.length > 0) {
    currentRecord.push(currentField);
    if (currentRecord.some(f => f.trim())) {
      records.push(currentRecord);
    }
  }
  
  if (records.length === 0) return [];
  
  // First record is headers
  const headers = records[0].map(h => h.trim());
  console.log(`   Columns: ${headers.join(', ')}`);
  
  // Convert to objects
  const rows = [];
  for (let i = 1; i < records.length; i++) {
    const values = records[i];
    if (values.length === headers.length) {
      const row = {};
      headers.forEach((header, idx) => {
        let value = values[idx];
        if (typeof value === 'string') value = value.trim();
        // Handle NULL values
        if (value === 'NULL' || value === '' || value === 'null') {
          value = null;
        }
        // Handle boolean values
        if (value === 'true') value = true;
        if (value === 'false') value = false;
        // Handle numeric values
        if (value !== null && !isNaN(value) && value !== '' && !header.includes('id')) {
          const num = Number(value);
          if (Number.isFinite(num)) value = num;
        }
        // Replace old user_id with new one
        if (header === 'user_id' && value === OLD_USER_ID) {
          value = NEW_USER_ID;
        }
        row[header] = value;
      });
      rows.push(row);
    }
  }
  return rows;
}

async function importTable(supabase, tableName, csvPath) {
  console.log(`\n📦 Importing ${tableName}...`);
  
  if (!fs.existsSync(csvPath)) {
    console.log(`   ⏭️  File not found, skipping: ${csvPath}`);
    return;
  }
  
  const content = fs.readFileSync(csvPath, 'utf-8');
  const rows = parseCSV(content);
  
  if (rows.length === 0) {
    console.log(`   ⏭️  No data to import`);
    return;
  }
  
  console.log(`   Found ${rows.length} rows`);
  
  // Delete existing data first
  const { error: deleteError } = await supabase
    .from(tableName)
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all
  
  if (deleteError) {
    console.log(`   ⚠️  Could not clear table: ${deleteError.message}`);
  }
  
  // Insert in batches of 100
  const batchSize = 100;
  let imported = 0;
  
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase.from(tableName).insert(batch);
    
    if (error) {
      console.log(`   ❌ Error: ${error.message}`);
      console.log(`   First row of failed batch:`, JSON.stringify(batch[0], null, 2).substring(0, 200));
    } else {
      imported += batch.length;
    }
  }
  
  console.log(`   ✅ Imported ${imported}/${rows.length} rows`);
}

async function main() {
  if (!SUPABASE_SERVICE_KEY) {
    console.error('❌ SUPABASE_SERVICE_KEY is required!');
    console.log('\nUsage:');
    console.log('  SUPABASE_SERVICE_KEY=your_service_key node import-script.js');
    console.log('\nGet your service key from:');
    console.log('  Supabase Dashboard → Settings → API → service_role key');
    process.exit(1);
  }
  
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false }
  });
  
  console.log('🚀 Starting CSV Import');
  console.log(`   Old User ID: ${OLD_USER_ID}`);
  console.log(`   New User ID: ${NEW_USER_ID}`);
  
  for (const table of IMPORT_ORDER) {
    // Find CSV file matching pattern: {table_name}-export-{date}_{time}.csv
    const files = fs.readdirSync(CSV_DIR);
    const match = files.find(f => 
      f.startsWith(`${table}-export-`) && f.endsWith('.csv')
    );
    
    if (match) {
      const csvPath = path.join(CSV_DIR, match);
      await importTable(supabase, table, csvPath);
    } else {
      console.log(`\n⏭️  No CSV found for ${table} (looking for ${table}-export-*.csv)`);
    }
  }
  
  console.log('\n✅ Import complete!');
}

main().catch(console.error);

