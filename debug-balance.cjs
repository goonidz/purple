const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: "pipeline-orchestrator/.env" });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data } = await sb.from("project_scenes")
    .select("scene_index, animator_code")
    .eq("project_id", "2ae5944f-7124-424f-b455-8ed3f56c9bb4")
    .eq("animator_code_status", "failed")
    .order("scene_index")
    .limit(1);

  if (!data || !data.length) { console.log("No failed scenes"); return; }
  const code = data[0].animator_code;
  const lines = code.split('\n');

  // Track balance line by line, showing where it goes wrong
  let braces = 0, parens = 0;
  let inStr = false, strChar = '';
  let inLineComment = false;
  let inBlockComment = false;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const prevBraces = braces;
    const prevParens = parens;
    inLineComment = false;

    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      const next = line[i + 1] || '';

      if (inBlockComment) {
        if (c === '*' && next === '/') { inBlockComment = false; i++; }
        continue;
      }
      if (inLineComment) continue;
      if (inStr) {
        if (c === '\\') { i++; continue; } // skip escaped char
        if (c === strChar) inStr = false;
        continue;
      }
      if (c === '/' && next === '/') { inLineComment = true; continue; }
      if (c === '/' && next === '*') { inBlockComment = true; i++; continue; }
      if (c === '"' || c === "'" || c === '`') { inStr = true; strChar = c; continue; }
      if (c === '{') braces++;
      else if (c === '}') braces--;
      else if (c === '(') parens++;
      else if (c === ')') parens--;
    }

    const bDelta = braces - prevBraces;
    const pDelta = parens - prevParens;
    // Only show lines where balance changes significantly or is unusual
    if (bDelta !== 0 || pDelta !== 0) {
      const trimmed = line.trim().substring(0, 100);
      if (braces < 0 || parens < 0 || lineIdx === lines.length - 1 || Math.abs(bDelta) > 1 || Math.abs(pDelta) > 1) {
        console.log(`L${lineIdx}: B=${braces}(${bDelta > 0 ? '+' : ''}${bDelta}) P=${parens}(${pDelta > 0 ? '+' : ''}${pDelta}) | ${trimmed}`);
      }
    }
  }

  console.log(`\nFinal: braces=${braces} parens=${parens}`);
  
  if (inStr) console.log("⚠️  STILL IN STRING at end! strChar:", strChar);
  if (inBlockComment) console.log("⚠️  STILL IN BLOCK COMMENT at end!");

  // Find template literals with ${} to check for issues
  let templateLitCount = 0;
  const templateLitLines = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('${')) {
      templateLitCount++;
      templateLitLines.push(i);
    }
  }
  console.log(`\nTemplate literal lines (${templateLitCount}):`, templateLitLines.map(i => `L${i}`).join(', '));
})();
