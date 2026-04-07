const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: "pipeline-orchestrator/.env" });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data } = await sb.from("project_scenes")
    .select("scene_index, animator_code")
    .eq("project_id", "2ae5944f-7124-424f-b455-8ed3f56c9bb4")
    .eq("animator_code_status", "failed")
    .order("scene_index");

  for (const scene of data) {
    const code = scene.animator_code;
    const lines = code.split('\n');
    let inStr = false, strChar = '';

    console.log(`=== Scene ${scene.scene_index} ===`);
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      const wasInStr = inStr;
      
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inStr) {
          if (c === '\\') { i++; continue; }
          if (c === strChar) inStr = false;
          continue;
        }
        if (c === '/' && line[i + 1] === '/') break;
        if (c === '"' || c === "'" || c === '`') {
          inStr = true;
          strChar = c;
        }
      }

      // Show line where we ENTER a string and don't close it
      if (!wasInStr && inStr) {
        console.log(`  L${lineIdx}: Entered unclosed '${strChar}' string: ${line.trim().substring(0, 120)}`);
      }
    }

    if (inStr) {
      console.log(`  ⚠️  Ends in unclosed string (${strChar})`);
    } else {
      console.log(`  ✅ Strings balanced`);
    }
    console.log();
  }
})();
