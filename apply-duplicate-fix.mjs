#!/usr/bin/env node

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: 'postgresql://postgres.laqgmqyjstisipsbljha:bwzZSFoqMDrqhR71@aws-0-eu-west-3.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

async function applyFix() {
  console.log('🔧 Applying duplicate prediction prevention fix...\n');
  
  const client = await pool.connect();
  
  try {
    // First, clean up any existing duplicates
    console.log('🧹 Cleaning up existing duplicates...');
    const cleanupResult = await client.query(`
      WITH duplicates AS (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY project_id, scene_index, prediction_type 
          ORDER BY created_at DESC
        ) as rn
        FROM pending_predictions
        WHERE status IN ('pending', 'processing', 'starting')
          AND scene_index IS NOT NULL
      )
      DELETE FROM pending_predictions 
      WHERE id IN (SELECT id FROM duplicates WHERE rn > 1)
      RETURNING id;
    `);
    console.log(`   Deleted ${cleanupResult.rowCount} duplicate predictions\n`);
    
    // Create unique index
    console.log('🔒 Creating unique index to prevent future duplicates...');
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_prediction_per_scene
      ON pending_predictions (project_id, scene_index, prediction_type)
      WHERE status IN ('pending', 'processing', 'starting') AND scene_index IS NOT NULL;
    `);
    console.log('   ✅ Unique index created!\n');
    
    console.log('🎉 Fix applied successfully!');
    console.log('   Now the database will reject duplicate predictions at the DB level.');
    
  } catch (error) {
    if (error.message.includes('already exists')) {
      console.log('   ℹ️  Index already exists - fix was already applied.');
    } else {
      console.error('❌ Error:', error.message);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

applyFix();
