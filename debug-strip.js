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

  // Validate BEFORE strip
  function countBalances(text) {
    let braces = 0, parens = 0, brackets = 0;
    let inStr = false, strChar = '';
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inStr) { if (c === strChar && text[i - 1] !== '\\') inStr = false; continue; }
      if (c === '"' || c === "'" || c === '`') { inStr = true; strChar = c; continue; }
      if (c === '{') braces++;
      else if (c === '}') braces--;
      else if (c === '(') parens++;
      else if (c === ')') parens--;
      else if (c === '[') brackets++;
      else if (c === ']') brackets--;
    }
    return { braces, parens, brackets };
  }

  const before = countBalances(code);
  console.log("BEFORE stripSharedDeclarations:");
  console.log("  braces:", before.braces, "parens:", before.parens, "brackets:", before.brackets);
  console.log("  total lines:", code.split('\n').length);

  // Run stripSharedDeclarations (same logic as in claude-generator.js)
  const SHARED = ['BG', 'ACCENT', 'ACCENT_DIM', 'TEXT_PRIMARY', 'TEXT_DIM', 'RED', 'RED_DIM', 'WHITE', 'WHITE_DIM', 'useFade', 'Grid', 'GRID_STYLE'];
  const declPattern = new RegExp(
    `^\\s*(?:const|let|var)\\s+(${SHARED.join('|')})\\s*[=:]|` +
    `^\\s*function\\s+(${SHARED.join('|')})\\s*[(<]`
  );
  const lines = code.split('\n');
  const result = [];
  let stripping = false;
  let braceDepth = 0, parenDepth = 0;
  let strippedRanges = [];
  let stripStart = -1;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    if (!stripping && declPattern.test(line)) {
      stripping = true;
      stripStart = lineIdx;
      braceDepth = 0;
      parenDepth = 0;
      for (const ch of line) {
        if (ch === '{') braceDepth++;
        else if (ch === '}') braceDepth--;
        else if (ch === '(') parenDepth++;
        else if (ch === ')') parenDepth--;
      }
      if (braceDepth <= 0 && parenDepth <= 0) {
        strippedRanges.push({ from: stripStart, to: lineIdx, matched: line.trim().substring(0, 60) });
        stripping = false;
      }
      continue;
    }
    if (stripping) {
      for (const ch of line) {
        if (ch === '{') braceDepth++;
        else if (ch === '}') braceDepth--;
        else if (ch === '(') parenDepth++;
        else if (ch === ')') parenDepth--;
      }
      if (braceDepth <= 0 && parenDepth <= 0) {
        strippedRanges.push({ from: stripStart, to: lineIdx, matched: lines[stripStart].trim().substring(0, 60) });
        stripping = false;
      }
      continue;
    }
    result.push(line);
  }

  if (stripping) {
    console.log("\n⚠️  STILL STRIPPING AT END! braceDepth:", braceDepth, "parenDepth:", parenDepth);
    console.log("   Strip started at line", stripStart, ":", lines[stripStart].trim().substring(0, 80));
  }

  const stripped = result.join('\n');
  const after = countBalances(stripped);

  console.log("\nStripped ranges:");
  strippedRanges.forEach(r => console.log(`  Lines ${r.from}-${r.to}: ${r.matched}`));
  
  console.log("\nAFTER stripSharedDeclarations:");
  console.log("  remaining lines:", result.length, "(stripped", lines.length - result.length, ")");
  console.log("  braces:", after.braces, "parens:", after.parens, "brackets:", after.brackets);

  // Show which lines contain the problematic declarations
  console.log("\nLines matching SHARED pattern:");
  lines.forEach((line, i) => {
    if (declPattern.test(line)) {
      console.log(`  Line ${i}: ${line.trim().substring(0, 100)}`);
    }
  });
})();
