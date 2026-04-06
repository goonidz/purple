# How to Add a New TTS Provider

Step-by-step guide based on how Inworld TTS 1.5 was integrated. Follow this pattern for any new TTS provider.

## Files to Modify (in order)

### 1. `image-worker/index.js` — VPS Worker Pipeline

Create a new `process<Provider>TtsPipeline(job)` function. Follow the EdgeTTS/Inworld pattern:

```
async function processNewProviderTtsPipeline(job) {
  const { id: jobId, project_id: projectId, user_id: userId, metadata: meta } = job;
  // 1. Extract config from meta: voice, model, speed, etc.
  // 2. Get API key: await getUserApiKey(userId, '<key_name>')
  // 3. Apply audio tags: applyAudioTags(meta.script || meta.text, meta)
  // 4. Chunk text: chunkTextByChars(text, <MAX_CHARS>)  -- sentence-aware, never cuts mid-sentence
  // 5. For each chunk: call provider API, get audio bytes
  // 6. Upload each chunk to Supabase storage (audio-files bucket)
  // 7. Concatenate via POST http://localhost:3000/concat-audio
  // 8. Optional RVC via applyRVCConversion()
  // 9. Update projects.audio_url
  // 10. Mark job completed with metadata.audioUrl
}
```

Key helpers already available:
- `chunkTextByChars(text, maxChars)` — sentence-aware chunking (used by EdgeTTS, Inworld)
- `chunkTextByCharLimit(text, maxChars)` — similar, used by Kokoro
- `getUserApiKey(userId, keyName)` — fetches from Supabase Vault
- `applyAudioTags(text, meta)` — prepends audio tags if enabled
- `applyRVCConversion(jobId, audioUrl, rvcConfig, meta)` — post-process with RVC
- Concat service: `POST http://localhost:3000/concat-audio` with `{ audioUrls, userId, projectId }`

Then add routing in the main poll loop (~line 4630):
```js
else if (job.metadata?.provider === '<provider>') pipeline = processNewProviderTtsPipeline(job);
```

### 2. `supabase/functions/start-generation-job/index.ts` — Job Routing

Add the provider string to the VPS worker condition (~line 417) so the job is set to `pending` for the worker instead of being processed by an edge function:

```ts
} else if (jobType === 'audio_generation' && (metadata?.provider === '...' || metadata?.provider === '<new_provider>' || ...)) {
```

**Check first**: if the provider is already listed, no change needed.

### 3. `src/pages/CreateFromScratch.tsx` — Main Creation UI

Changes needed:
- **State**: Add state variables for provider-specific settings (voice, model, speed, etc.)
- **Provider dropdown** (~line 3052): Add `<SelectItem value="<provider>">Label</SelectItem>` in the TTS provider `<Select>`
- **Provider type union**: Update the type `"minimax" | "inworld" | "genaipro" | "ai33" | "edgetts" | "kokoro"` everywhere it appears (there are 2-3 instances)
- **Settings section**: Add a `{ttsProvider === "<provider>" && (...)}` block with voice/model/speed UI
- **audioMetadata** (~line 2011): Add an `else if` branch to set `audioMetadata.voice`, `.model`, `.speed`, etc.
- **Preset save** (handleSaveTtsPreset ~line 955): Add provider branch to build `presetData`
- **Preset update** (handleUpdateTtsPreset ~line 1051): Same for `updateData`
- **Preset load** (applyTtsPreset ~line 862): Add branch to restore state from preset fields
- **Second selector** (edit modal ~line 4100): Duplicate the provider option and voice UI there too
- **Display strings**: Update any ternary chains that map provider to display name

### 4. `src/pages/Presets.tsx` — Preset Management Page

- **Provider dropdown** (~line 1152): Add `<SelectItem value="<provider>">Label</SelectItem>`
- **Provider-specific form**: Add a `ttsProvider === "<provider>" ? (...)` branch between the existing kokoro/minimax/generic sections. Include model dropdown, voice input, speed slider, etc.
- The save function already writes `row.model`, `row.voice_id`, `row.speed` generically — just make sure the UI sets `ttsModel`, `ttsVoiceId`, `ttsSpeed` correctly.

### 5. `src/pages/Profile.tsx` — API Key (if needed)

If the provider needs a user API key:
- Add state: `const [newApiKey, setNewApiKey] = useState("")`
- Add to the `Promise.all` that loads keys: `supabase.rpc('get_user_api_key', { key_name: '<key_name>' })`
- Add to `changedKeys` in save handler
- Add input field in the UI

**Check first**: some providers reuse existing keys (e.g., Kokoro uses `replicate`).

### 6. `pipeline-orchestrator/index.js` — Orchestrator (usually no changes)

The orchestrator reads `tts_presets` and builds `audioMetadata` with `provider`, `voice_id`, `model`, `speed`, etc. It already passes all standard fields. Only add code here if the provider needs non-standard fields not already in `audioMetadata`.

## Deployment

```bash
# Push code
git push origin main

# Deploy worker
ssh vps-clean "cd ~/purple && git pull origin main && cd image-worker && pm2 restart image-worker"

# Deploy frontend (clean build recommended)
ssh vps-clean "cd ~/purple && git pull origin main && sudo docker builder prune -af && sudo ./deploy.sh"

# If deploy.sh fails with container name conflict:
ssh vps-clean "docker rm -f videoflow && cd ~/purple && sudo ./deploy.sh"
```

## Checklist

- [ ] Worker pipeline function in `image-worker/index.js`
- [ ] Worker routing in poll loop
- [ ] `start-generation-job` routes provider to VPS worker
- [ ] Provider option in CreateFromScratch (main + edit modal)
- [ ] Provider-specific settings UI (voice, model, speed)
- [ ] audioMetadata includes all provider fields
- [ ] Preset save/load handles provider
- [ ] Presets.tsx has provider-specific form
- [ ] API key field in Profile.tsx (if new key needed)
- [ ] Deploy worker + frontend
