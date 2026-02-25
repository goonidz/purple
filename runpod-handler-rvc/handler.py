"""
RunPod Serverless handler for RVC (Retrieval-based Voice Conversion).

Expected input payload:
{
  "audioUrl": "https://...",          # Source audio URL (EdgeTTS output)
  "rvcModelUrl": "https://hf...",     # HuggingFace .pth model URL
  "rvcIndexUrl": "https://hf...",     # HuggingFace .index file URL (optional)
  "pitch": -12,                       # Semitone shift (int, default 0)
  "indexRate": 0.75,                  # Index influence 0-1 (default 0.75)
  "filterRadius": 3,                  # Median filter radius (default 3)
  "jobId": "uuid",                    # generation_jobs row ID
  "userId": "uuid",
  "projectId": "uuid"
}

Returns:
{
  "audioUrl": "https://..."           # Supabase Storage URL of converted audio
}
"""

import os
import time
import hashlib
import tempfile
import logging
import urllib.request
from pathlib import Path

import runpod
import torch

logging.basicConfig(level=logging.INFO, format="[RVC] %(message)s")
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
MODEL_CACHE_DIR = Path("/tmp/rvc_models")
MODEL_CACHE_DIR.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
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
    """Upload file via Supabase REST Storage API, return public URL."""
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
    public_url = f"{SUPABASE_URL}/storage/v1/object/public/{bucket}/{storage_path}"
    return public_url


def _update_job(job_id: str, payload: dict):
    """Update generation_jobs row via Supabase REST API."""
    if not job_id:
        return
    import httpx
    url = f"{SUPABASE_URL}/rest/v1/generation_jobs?id=eq.{job_id}"
    headers = {
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "apikey": SUPABASE_SERVICE_KEY,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    httpx.patch(url, json=payload, headers=headers, timeout=30)


# ---------------------------------------------------------------------------
# RVC inference
# ---------------------------------------------------------------------------
def run_rvc_inference(
    audio_path: Path,
    model_path: Path,
    index_path: Path | None,
    pitch: int,
    index_rate: float,
    filter_radius: int,
    output_path: Path,
):
    """Run RVC inference using rvc-python's RVCInference class."""
    from rvc_python.infer import RVCInference

    device = "cuda:0" if torch.cuda.is_available() else "cpu:0"
    log.info(f"Running RVC via rvc-python (pitch={pitch}, indexRate={index_rate}, device={device})")

    rvc = RVCInference(
        device=device,
        model_path=str(model_path),
        index_path=str(index_path) if index_path else "",
        version="v2",
    )
    rvc.set_params(
        f0up_key=pitch,
        f0method="rmvpe",
        index_rate=index_rate,
        filter_radius=filter_radius,
        rms_mix_rate=0.25,
        protect=0.33,
    )

    wav_output = output_path.with_suffix(".wav")
    rvc.infer_file(str(audio_path), str(wav_output))
    log.info("RVC inference complete, converting WAV -> MP3")
    _wav_to_mp3(wav_output, output_path)
    rvc.unload_model()


def _wav_to_mp3(wav_path: Path, mp3_path: Path):
    import subprocess
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(wav_path), "-q:a", "2", str(mp3_path)],
        check=True,
        capture_output=True,
    )


# ---------------------------------------------------------------------------
# Main handler
# ---------------------------------------------------------------------------
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

        # 3. Run RVC
        log.info("Running RVC inference...")
        output_mp3 = tmp / "output.mp3"
        run_rvc_inference(src_audio, model_path, index_path, pitch, index_rate, filter_radius, output_mp3)

        log.info(f"RVC done in {time.time() - t0:.1f}s")

        # 4. Upload result
        timestamp = int(time.time())
        storage_path = f"{user_id}/{project_id}/{timestamp}_rvc_output.mp3"
        log.info(f"Uploading to Supabase: {storage_path}")
        public_url = _upload_to_supabase(output_mp3, storage_path)

    log.info(f"Total time: {time.time() - t0:.1f}s -> {public_url[:80]}...")
    return {"audioUrl": public_url}


runpod.serverless.start({"handler": handler})
