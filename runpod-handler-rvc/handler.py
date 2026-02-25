"""
RunPod Serverless handler for RVC voice conversion via Applio (headless).

Expected input payload:
{
  "audioUrl": "https://...",
  "rvcModelUrl": "https://hf...",
  "rvcIndexUrl": "https://hf...",
  "pitch": -12,
  "indexRate": 0.75,
  "filterRadius": 3,
  "jobId": "uuid",
  "userId": "uuid",
  "projectId": "uuid"
}

Returns:
{
  "audioUrl": "https://..."
}
"""

import os
import sys
import time
import hashlib
import tempfile
import logging
import urllib.request
from pathlib import Path

# Applio must be importable from its root
APPLIO_ROOT = "/workspace/applio"
os.chdir(APPLIO_ROOT)
if APPLIO_ROOT not in sys.path:
    sys.path.insert(0, APPLIO_ROOT)

import runpod
import torch

logging.basicConfig(level=logging.INFO, format="[RVC] %(message)s")
log = logging.getLogger(__name__)

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
MODEL_CACHE_DIR = Path("/tmp/rvc_models")
MODEL_CACHE_DIR.mkdir(parents=True, exist_ok=True)

_voice_converter = None


def get_voice_converter():
    """Lazy-init singleton VoiceConverter (heavy first import)."""
    global _voice_converter
    if _voice_converter is None:
        from rvc.infer.infer import VoiceConverter
        log.info("Initializing Applio VoiceConverter...")
        _voice_converter = VoiceConverter()
        log.info("VoiceConverter ready")
    return _voice_converter


def _url_to_cache_path(url: str, suffix: str) -> Path:
    key = hashlib.md5(url.encode()).hexdigest()
    return MODEL_CACHE_DIR / f"{key}{suffix}"


def _download(url: str, dest: Path) -> Path:
    if dest.exists():
        log.info(f"Cache hit: {dest.name}")
        return dest
    log.info(f"Downloading {url} -> {dest.name} ...")
    tmp = dest.with_suffix(".tmp")
    urllib.request.urlretrieve(url, tmp)
    tmp.rename(dest)
    log.info(f"Downloaded {dest.name} ({dest.stat().st_size / 1024 / 1024:.1f} MB)")
    return dest


def _upload_to_supabase(local_path: Path, storage_path: str) -> str:
    import httpx
    bucket = "audio-files"
    url = f"{SUPABASE_URL}/storage/v1/object/{bucket}/{storage_path}"
    headers = {
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "audio/mpeg",
        "x-upsert": "true",
    }
    with open(local_path, "rb") as f:
        data = f.read()
    resp = httpx.put(url, content=data, headers=headers, timeout=120)
    resp.raise_for_status()
    return f"{SUPABASE_URL}/storage/v1/object/public/{bucket}/{storage_path}"


def _wav_to_mp3(wav_path: Path, mp3_path: Path):
    import subprocess
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(wav_path), "-q:a", "2", str(mp3_path)],
        check=True,
        capture_output=True,
    )


def handler(event):
    t0 = time.time()
    inp = event.get("input", {})

    audio_url = inp["audioUrl"]
    rvc_model_url = inp["rvcModelUrl"]
    rvc_index_url = inp.get("rvcIndexUrl", "")
    pitch = int(inp.get("pitch", 0))
    index_rate = float(inp.get("indexRate", 0.75))
    filter_radius = int(inp.get("filterRadius", 3))
    job_id = inp.get("jobId", "")
    user_id = inp.get("userId", "unknown")
    project_id = inp.get("projectId", "temp")

    log.info(f"Job {job_id}: audio={audio_url[:60]}... pitch={pitch} indexRate={index_rate}")

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)

        # 1. Download source audio
        log.info("Downloading source audio...")
        src_audio = tmp / "source.mp3"
        _download(audio_url, src_audio)

        # 2. Download model + index (with caching)
        model_suffix = Path(rvc_model_url).suffix or ".pth"
        model_path = _download(rvc_model_url, _url_to_cache_path(rvc_model_url, model_suffix))

        index_path = None
        if rvc_index_url:
            idx_suffix = Path(rvc_index_url).suffix or ".index"
            index_path = _download(rvc_index_url, _url_to_cache_path(rvc_index_url, idx_suffix))

        # 3. Run RVC via Applio VoiceConverter
        log.info("Running RVC inference via Applio...")
        output_wav = tmp / "output.wav"

        vc = get_voice_converter()
        vc.convert_audio(
            audio_input_path=str(src_audio),
            audio_output_path=str(output_wav),
            model_path=str(model_path),
            index_path=str(index_path) if index_path else "",
            pitch=pitch,
            f0_method="rmvpe",
            index_rate=index_rate,
            filter_radius=filter_radius,
            volume_envelope=1.0,
            protect=0.33,
            split_audio=False,
            f0_autotune=False,
            f0_autotune_strength=1.0,
            proposed_pitch=False,
            proposed_pitch_threshold=155.0,
            clean_audio=False,
            clean_strength=0.5,
            export_format="WAV",
            embedder_model="contentvec",
            sid=0,
        )

        # 4. Convert WAV -> MP3
        output_mp3 = tmp / "output.mp3"
        _wav_to_mp3(output_wav, output_mp3)
        log.info(f"RVC done in {time.time() - t0:.1f}s")

        # 5. Upload result
        timestamp = int(time.time())
        storage_path = f"{user_id}/{project_id}/{timestamp}_rvc_output.mp3"
        log.info(f"Uploading to Supabase: {storage_path}")
        public_url = _upload_to_supabase(output_mp3, storage_path)

    log.info(f"Total time: {time.time() - t0:.1f}s -> {public_url[:80]}...")
    return {"audioUrl": public_url}


runpod.serverless.start({"handler": handler})
