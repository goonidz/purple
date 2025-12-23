import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://laqgmqyjstisipsbljha.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY environment variable is required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const MAX_WIDTH = 1920;
const QUALITY = 85;
// Threshold: only compress if image is larger than 300KB
const SIZE_THRESHOLD = 300 * 1024;

async function compressImage(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status}`);
  }
  
  const buffer = Buffer.from(await response.arrayBuffer());
  const originalSize = buffer.length;
  
  // Skip if already small enough
  if (originalSize < SIZE_THRESHOLD) {
    return { skipped: true, originalSize };
  }
  
  // Compress with sharp
  const compressed = await sharp(buffer)
    .resize(MAX_WIDTH, null, { 
      withoutEnlargement: true,
      fit: 'inside'
    })
    .jpeg({ quality: QUALITY })
    .toBuffer();
  
  const newSize = compressed.length;
  const saved = originalSize - newSize;
  const reduction = ((1 - newSize / originalSize) * 100).toFixed(1);
  
  console.log(`  ${(originalSize / 1024).toFixed(0)}KB → ${(newSize / 1024).toFixed(0)}KB (${reduction}% reduction)`);
  
  return { buffer: compressed, originalSize, newSize, saved, skipped: false };
}

async function uploadToStorage(buffer, filename, userId) {
  const path = `${userId}/thumbnails/examples/${Date.now()}_${filename}`;
  
  const { data, error } = await supabase.storage
    .from('style-references')
    .upload(path, buffer, {
      contentType: 'image/jpeg',
      upsert: true
    });
  
  if (error) throw error;
  
  const { data: urlData } = supabase.storage
    .from('style-references')
    .getPublicUrl(path);
  
  return urlData.publicUrl;
}

async function processPreset(preset) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📁 Processing preset: "${preset.name}"`);
  console.log(`${'='.repeat(60)}`);
  
  const exampleUrls = preset.example_urls || [];
  const newUrls = [];
  let totalSaved = 0;
  let imagesCompressed = 0;
  
  for (let i = 0; i < exampleUrls.length; i++) {
    const url = exampleUrls[i];
    console.log(`\n📷 Image ${i + 1}/${exampleUrls.length}...`);
    
    try {
      const result = await compressImage(url);
      if (result.skipped) {
        console.log(`  ⏭️  Skipped (already small: ${(result.originalSize / 1024).toFixed(0)}KB)`);
        newUrls.push(url);
      } else {
        const filename = `compressed_${i + 1}.jpg`;
        const newUrl = await uploadToStorage(result.buffer, filename, preset.user_id);
        newUrls.push(newUrl);
        totalSaved += result.saved;
        imagesCompressed++;
        console.log(`  ✅ Uploaded`);
      }
    } catch (err) {
      console.error(`  ❌ Error: ${err.message}`);
      newUrls.push(url);
    }
  }
  
  // Also compress character reference if exists
  let newCharacterUrl = preset.character_ref_url;
  if (preset.character_ref_url) {
    console.log(`\n👤 Character reference...`);
    try {
      const result = await compressImage(preset.character_ref_url);
      if (result.skipped) {
        console.log(`  ⏭️  Skipped (already small: ${(result.originalSize / 1024).toFixed(0)}KB)`);
      } else {
        const filename = `character_compressed.jpg`;
        const path = `${preset.user_id}/thumbnails/character/${Date.now()}_${filename}`;
        
        const { error: uploadError } = await supabase.storage
          .from('style-references')
          .upload(path, result.buffer, {
            contentType: 'image/jpeg',
            upsert: true
          });
        
        if (!uploadError) {
          const { data: urlData } = supabase.storage
            .from('style-references')
            .getPublicUrl(path);
          newCharacterUrl = urlData.publicUrl;
          totalSaved += result.saved;
          imagesCompressed++;
          console.log(`  ✅ Compressed`);
        }
      }
    } catch (err) {
      console.error(`  ❌ Error: ${err.message}`);
    }
  }
  
  // Update the preset with new URLs
  if (imagesCompressed > 0) {
    const { error: updateError } = await supabase
      .from('thumbnail_presets')
      .update({
        example_urls: newUrls,
        character_ref_url: newCharacterUrl,
        updated_at: new Date().toISOString()
      })
      .eq('id', preset.id);
    
    if (updateError) {
      console.error('❌ Error updating preset:', updateError);
    } else {
      console.log(`\n💾 Saved! ${imagesCompressed} images compressed, ${(totalSaved / 1024 / 1024).toFixed(2)}MB saved`);
    }
  } else {
    console.log(`\n⏭️  No compression needed for this preset`);
  }
  
  return { imagesCompressed, totalSaved };
}

async function main() {
  console.log(`🔍 Fetching all thumbnail presets...`);
  
  // Get all presets
  const { data: presets, error: presetError } = await supabase
    .from('thumbnail_presets')
    .select('*')
    .order('name');
  
  if (presetError) {
    console.error('❌ Error fetching presets:', presetError);
    process.exit(1);
  }
  
  console.log(`✅ Found ${presets.length} presets`);
  
  let totalImagesCompressed = 0;
  let totalSaved = 0;
  
  for (const preset of presets) {
    const result = await processPreset(preset);
    totalImagesCompressed += result.imagesCompressed;
    totalSaved += result.totalSaved;
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🎉 All done!`);
  console.log(`   Total images compressed: ${totalImagesCompressed}`);
  console.log(`   Total space saved: ${(totalSaved / 1024 / 1024).toFixed(2)}MB`);
  console.log(`${'='.repeat(60)}`);
}

main().catch(console.error);





