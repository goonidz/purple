"""
RunPod Serverless Handler for GPU Video Rendering
Uses FFmpeg with NVENC (NVIDIA GPU acceleration) for fast video encoding
With automatic fallback to CPU encoding if GPU is unavailable
"""

import runpod
import os
import subprocess
import tempfile
import requests
import json
import time
import re
from pathlib import Path
from typing import Dict, Any, List, Optional

# Supabase configuration (for uploading results)
SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')

# FFmpeg binary (allow overriding in RunPod env)
FFMPEG_BIN = os.environ.get('FFMPEG_BIN', 'ffmpeg')

# Run mode:
# - "" (default): RunPod serverless
# - "pod": print NVENC smoke test + keepalive (debug)
# - "worker": poll Supabase queue + render jobs (Pods)
RUNPOD_MODE = (os.environ.get("RUNPOD_MODE", "") or "").strip().lower()

# Global encoder detection (runs once at startup)
GPU_ENCODER_AVAILABLE = None
ENCODER_NAME = None
ENCODER_PRESET = None
ENCODER_GPU_ID: Optional[int] = None


def _run_diag(cmd: str, timeout: int = 15) -> None:
    """Best-effort: print command output for debugging."""
    try:
        r = subprocess.run(
            ['bash', '-lc', cmd],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        out = (r.stdout or '').strip()
        err = (r.stderr or '').strip()
        if out:
            print(out)
        if err:
            print(err)
    except Exception as e:
        print(f"[GPU Handler] Diagnostic command failed: {e}")


def _is_pod_mode() -> bool:
    """
    This image can run in two contexts:
    - RunPod Serverless (default): runpod.serverless.start(...)
    - RunPod Pod (manual): keep container alive, print NVENC test in logs.
    """
    if RUNPOD_MODE == "pod":
        return True
    return False


def _is_worker_mode() -> bool:
    return RUNPOD_MODE == "worker"


def _nvenc_smoke_test() -> None:
    print("[Pod] Running NVENC smoke test...")
    _run_diag("nvidia-smi || true", timeout=10)
    _run_diag("ls -la /dev/nvidia* /dev/nvidia-caps 2>/dev/null || true", timeout=5)
    _run_diag(f"{FFMPEG_BIN} -hide_banner -encoders 2>/dev/null | grep -i nvenc || true", timeout=10)
    # Minimal encode test (no output file)
    # NOTE: Some NVENC setups reject very small dimensions; use a safe minimum.
    cmd = [
        FFMPEG_BIN,
        "-hide_banner",
        "-loglevel",
        "warning",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=640x360:r=30:d=1,format=yuv420p",
        "-c:v",
        "h264_nvenc",
        "-pix_fmt",
        "yuv420p",
        "-f",
        "null",
        "-",
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if r.returncode == 0:
            print("[Pod] ✅ NVENC OK (h264_nvenc)")
        else:
            print("[Pod] ❌ NVENC FAILED (h264_nvenc)")
            if r.stderr:
                print("[Pod] ffmpeg stderr (tail):")
                print(r.stderr[-2000:])
    except Exception as e:
        print(f"[Pod] NVENC smoke test exception: {e}")

def _discover_nvidia_device_indices() -> List[int]:
    """
    RunPod serverless sometimes maps the assigned GPU to /dev/nvidia4, /dev/nvidia1, etc.
    NVENC's `-gpu N` expects the *same index* as the device node number.
    """
    try:
        ls = subprocess.run(
            ['bash', '-lc', 'ls -1 /dev/nvidia* 2>/dev/null || true'],
            capture_output=True,
            text=True,
            timeout=5,
        )
        paths = [p.strip() for p in (ls.stdout or "").splitlines() if p.strip()]
        idx: List[int] = []
        for p in paths:
            m = re.match(r"^/dev/nvidia(\d+)$", p)
            if m:
                idx.append(int(m.group(1)))
        idx = sorted(set(idx))
        if idx:
            print(f"[GPU Handler] Detected GPU device nodes: {', '.join(str(i) for i in idx)}")
        return idx
    except Exception:
        return []


def detect_gpu_encoder() -> bool:
    """
    Detect if h264_nvenc is available at startup.
    This runs ONCE and caches the result for all subsequent renders.
    """
    global GPU_ENCODER_AVAILABLE, ENCODER_NAME, ENCODER_PRESET, ENCODER_GPU_ID
    
    if GPU_ENCODER_AVAILABLE is not None:
        return GPU_ENCODER_AVAILABLE
    
    print("[GPU Handler] Detecting available encoders...")
    print(f"[GPU Handler] NVIDIA_DRIVER_CAPABILITIES={os.environ.get('NVIDIA_DRIVER_CAPABILITIES')}")
    print(f"[GPU Handler] NVIDIA_VISIBLE_DEVICES={os.environ.get('NVIDIA_VISIBLE_DEVICES')}")
    print(f"[GPU Handler] CUDA_VISIBLE_DEVICES={os.environ.get('CUDA_VISIBLE_DEVICES')}")
    print(f"[GPU Handler] FFMPEG_BIN={FFMPEG_BIN}")
    
    # Wait for GPU to be ready (cold start can delay GPU initialization)
    print("[GPU Handler] Waiting for GPU initialization...")
    time.sleep(2)
    
    # Check if nvidia-smi sees the GPU
    try:
        nvidia_result = subprocess.run(
            ['nvidia-smi', '--query-gpu=name,memory.total', '--format=csv,noheader'],
            capture_output=True, text=True, timeout=10
        )
        if nvidia_result.returncode == 0 and nvidia_result.stdout.strip():
            print(f"[GPU Handler] GPU detected: {nvidia_result.stdout.strip()}")
        else:
            print("[GPU Handler] nvidia-smi failed or no GPU visible")
    except Exception as e:
        print(f"[GPU Handler] nvidia-smi check failed: {e}")

    # Confirm CUDA works from Python (helps distinguish NVENC vs CUDA visibility issues)
    print("[GPU Handler] Checking CUDA visibility from Python (torch)...")
    _run_diag(
        "python3 -c \"import torch; "
        "print('torch', torch.__version__); "
        "print('cuda', torch.version.cuda); "
        "print('is_available', torch.cuda.is_available()); "
        "print('device_count', torch.cuda.device_count()); "
        "print('device_name_0', torch.cuda.get_device_name(0) if torch.cuda.is_available() else None)\"",
        timeout=20,
    )

    # Check presence of NVENC runtime libs and device nodes
    print("[GPU Handler] Checking NVENC/CUDA runtime libraries and /dev nodes...")
    _run_diag("ldconfig -p | egrep -i 'libcuda\\.so|nvidia-encode|nvidia-ml' || true")
    _run_diag("ls -l /dev/nvidia* 2>/dev/null || true")
    
    # First, check if FFmpeg has nvenc support compiled in
    try:
        result = subprocess.run(
            [FFMPEG_BIN, '-hide_banner', '-encoders'],
            capture_output=True, text=True, timeout=10
        )
        has_nvenc_support = 'h264_nvenc' in result.stdout
        
        if not has_nvenc_support:
            print("[GPU Handler] FFmpeg was not compiled with NVENC support")
            GPU_ENCODER_AVAILABLE = False
            ENCODER_NAME = 'libx264'
            ENCODER_PRESET = 'fast'
            return False
            
    except Exception as e:
        print(f"[GPU Handler] Error checking encoders: {e}")
        GPU_ENCODER_AVAILABLE = False
        ENCODER_NAME = 'libx264'
        ENCODER_PRESET = 'fast'
        return False
    
    # Test if NVENC actually works (GPU accessible)
    # IMPORTANT: RunPod workers may expose the GPU as /dev/nvidia4, /dev/nvidia1, etc.
    # In that case, forcing -gpu 0 fails. We must probe the actual indices present.
    max_attempts = 3
    discovered = _discover_nvidia_device_indices()
    # Always include a small fallback range too, but prefer real device node indices.
    candidate_gpu_ids = (discovered + [0, 1, 2, 3, 4, 5, 6, 7])
    # Deduplicate while preserving order
    seen = set()
    candidate_gpu_ids = [x for x in candidate_gpu_ids if not (x in seen or seen.add(x))]
    for attempt in range(max_attempts):
        try:
            print(f"[GPU Handler] Testing NVENC (attempt {attempt + 1}/{max_attempts})...")

            for gpu_id in candidate_gpu_ids:
                print(f"[GPU Handler] NVENC probe: trying -gpu {gpu_id} ...")
                test_cmd = [
                    FFMPEG_BIN, '-y',
                    '-hide_banner',
                    '-loglevel', 'warning',
                    '-f', 'lavfi',
                    # Some NVENC setups reject very small dimensions; use a safe minimum.
                    '-i', 'color=c=black:s=640x360:r=30:d=0.2,format=yuv420p',
                    '-c:v', 'h264_nvenc',
                    '-gpu', str(gpu_id),
                    '-pix_fmt', 'yuv420p',
                    '-f', 'null', '-'
                ]
                result = subprocess.run(test_cmd, capture_output=True, text=True, timeout=30)

                if result.returncode == 0:
                    print(f"[GPU Handler] ✅ NVENC works with -gpu {gpu_id}")
                    GPU_ENCODER_AVAILABLE = True
                    ENCODER_NAME = 'h264_nvenc'
                    # FFmpeg 5.x uses 'fast'/'medium'/'slow', FFmpeg 6+ uses 'p1'-'p7'
                    ENCODER_PRESET = 'fast'
                    ENCODER_GPU_ID = gpu_id
                    return True

                stderr = result.stderr or ""
                # Print short per-gpu failure; full tail printed below.
                if 'OpenEncodeSessionEx failed' in stderr or 'No capable devices found' in stderr:
                    print(f"[GPU Handler] NVENC probe failed on -gpu {gpu_id}: No capable devices")
                else:
                    last_line = ""
                    lines = [l for l in stderr.split('\n') if l.strip()]
                    if lines:
                        last_line = lines[-1]
                    print(f"[GPU Handler] NVENC probe failed on -gpu {gpu_id}: {last_line or 'Unknown error'}")

            # If we get here, all gpu ids failed this attempt
            # Extract the actual error from the last run's stderr (best available signal)
            stderr = (locals().get('stderr') or "")
            if 'Cannot load' in stderr or 'No NVENC' in stderr or 'not found' in stderr:
                error_msg = "NVENC library not available"
            elif 'No capable devices' in stderr:
                error_msg = "No GPU device found"
            elif 'OpenEncodeSessionEx failed' in stderr:
                error_msg = "GPU encoder session failed"
            else:
                error_lines = [l for l in stderr.split('\n') if l.strip() and not l.startswith('  ')]
                error_msg = error_lines[-1] if error_lines else "Unknown error"

            print(f"[GPU Handler] NVENC attempt {attempt + 1} failed: {error_msg}")
            if stderr:
                print("[GPU Handler] NVENC stderr (tail):")
                print(stderr[-2000:])

            if attempt < max_attempts - 1:
                print("[GPU Handler] Retrying in 2 seconds...")
                time.sleep(2)

        except subprocess.TimeoutExpired:
            print(f"[GPU Handler] NVENC test timeout on attempt {attempt + 1}")
            if attempt < max_attempts - 1:
                time.sleep(2)
        except Exception as e:
            print(f"[GPU Handler] NVENC test exception: {e}")
            if attempt < max_attempts - 1:
                time.sleep(2)
    
    # All attempts failed, use CPU fallback
    print("[GPU Handler] ⚠️ NVENC not available, using CPU encoder (libx264)")
    GPU_ENCODER_AVAILABLE = False
    ENCODER_NAME = 'libx264'
    ENCODER_PRESET = 'fast'
    ENCODER_GPU_ID = None
    return False


def download_file(url: str, dest_path: str) -> bool:
    """Download a file from URL to destination path"""
    try:
        print(f"Downloading: {url}")
        response = requests.get(url, stream=True, timeout=120)
        response.raise_for_status()
        
        with open(dest_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        
        print(f"Downloaded to: {dest_path}")
        return True
    except Exception as e:
        print(f"Error downloading {url}: {e}")
        return False


def upload_to_supabase(file_path: str, bucket: str, dest_path: str) -> str:
    """Upload a file to Supabase Storage and return the public URL"""
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise ValueError("Supabase credentials not configured")
    
    headers = {
        'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
        'Content-Type': 'video/mp4',
    }
    
    upload_url = f"{SUPABASE_URL}/storage/v1/object/{bucket}/{dest_path}"
    
    with open(file_path, 'rb') as f:
        response = requests.post(upload_url, headers=headers, data=f)
    
    if response.status_code not in [200, 201]:
        raise Exception(f"Upload failed: {response.status_code} - {response.text}")
    
    # Return public URL
    public_url = f"{SUPABASE_URL}/storage/v1/object/public/{bucket}/{dest_path}"
    return public_url


def get_encoder_args() -> List[str]:
    """Get the appropriate encoder arguments based on detected encoder"""
    if ENCODER_NAME == 'h264_nvenc':
        return [
            '-c:v', 'h264_nvenc',
            # Use probed GPU id when available (important on some RunPod workers)
            *(['-gpu', str(ENCODER_GPU_ID)] if ENCODER_GPU_ID is not None else []),
            # FFmpeg 5.x uses 'fast'/'medium'/'slow', FFmpeg 6+ uses 'p1'-'p7'
            '-preset', 'fast',
            '-tune', 'hq',
            '-b:v', '8M',
            '-maxrate', '12M',
            '-bufsize', '16M',
        ]
    else:
        return [
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '20',
        ]


def create_video_segment(
    image_path: str,
    output_path: str,
    duration: float,
    width: int,
    height: int,
    framerate: int,
    effect_type: str = 'pan'
) -> bool:
    """Create a video segment from an image with the detected encoder"""
    
    # Determine zoom/pan parameters based on effect type
    if effect_type == 'none':
        # Static image, no movement
        filter_complex = f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2"
    elif 'zoom' in effect_type:
        # Ken Burns zoom effect
        zoom_amount = 0.08  # 8% zoom
        if 'zoom_out' in effect_type:
            start_scale = 1.0 + zoom_amount
            end_scale = 1.0
        else:
            start_scale = 1.0
            end_scale = 1.0 + zoom_amount
        
        filter_complex = (
            f"scale=8*{width}:8*{height},"
            f"zoompan=z='if(eq(on,1),{start_scale},{start_scale}+({end_scale}-{start_scale})*on/({framerate}*{duration}))':"
            f"d={int(framerate * duration)}:s={width}x{height}:fps={framerate}"
        )
    else:
        # Pan effect (default)
        filter_complex = (
            f"scale=-2:{int(height * 1.1)},"
            f"crop={width}:{height}:'(iw-{width})*t/{duration}':(ih-{height})/2"
        )
    
    # Build FFmpeg command with detected encoder
    cmd = [
        FFMPEG_BIN, '-y',
        '-loop', '1',
        '-i', image_path,
        '-t', str(duration),
        '-vf', filter_complex,
    ]
    cmd.extend(get_encoder_args())
    cmd.extend([
        '-pix_fmt', 'yuv420p',
        '-r', str(framerate),
        output_path
    ])
    
    print(f"Running FFmpeg ({ENCODER_NAME}): {' '.join(cmd[:15])}...")
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            print(f"FFmpeg error: {result.stderr[-500:]}")
            return False
        return True
    except subprocess.TimeoutExpired:
        print("FFmpeg timeout")
        return False
    except Exception as e:
        print(f"FFmpeg exception: {e}")
        return False


def concatenate_videos(video_paths: List[str], output_path: str) -> bool:
    """Concatenate multiple video segments into one"""
    
    # Create concat file
    concat_file = output_path.replace('.mp4', '_concat.txt')
    with open(concat_file, 'w') as f:
        for vp in video_paths:
            f.write(f"file '{vp}'\n")
    
    # Use stream copy for concatenation (very fast, no re-encoding)
    cmd = [
        FFMPEG_BIN, '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', concat_file,
        '-c', 'copy',
        output_path
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if result.returncode != 0:
            print(f"Concat error: {result.stderr[-500:]}")
            return False
        return True
    except Exception as e:
        print(f"Concat exception: {e}")
        return False
    finally:
        if os.path.exists(concat_file):
            os.remove(concat_file)


def add_audio(video_path: str, audio_path: str, output_path: str) -> bool:
    """Add audio to video (copy video stream, encode audio)"""
    
    cmd = [
        FFMPEG_BIN, '-y',
        '-i', video_path,
        '-i', audio_path,
        '-c:v', 'copy',  # Just copy video, no re-encoding needed
        '-c:a', 'aac',
        '-b:a', '192k',
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-shortest',
        output_path
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if result.returncode != 0:
            print(f"Audio mux error: {result.stderr[-500:]}")
            return False
        return True
    except Exception as e:
        print(f"Audio mux exception: {e}")
        return False


def _supabase_headers() -> Dict[str, str]:
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY for Pod worker")
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def _supabase_rest_url(path: str) -> str:
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    if not base:
        raise RuntimeError("Missing SUPABASE_URL for Pod worker")
    return f"{base}{path}"


def claim_next_gpu_job(worker_id: str) -> Optional[Dict[str, Any]]:
    """
    Calls Postgres RPC claim_gpu_render_job() and returns one job row or None.
    """
    headers = _supabase_headers()
    url = _supabase_rest_url("/rest/v1/rpc/claim_gpu_render_job")
    r = requests.post(url, headers=headers, data=json.dumps({"p_worker_id": worker_id}), timeout=30)
    if r.status_code >= 300:
        raise RuntimeError(f"claim_gpu_render_job failed: {r.status_code} {r.text}")
    rows = r.json()
    if not rows:
        return None
    return rows[0]


def update_gpu_job(job_id: str, patch: Dict[str, Any]) -> None:
    headers = _supabase_headers()
    url = _supabase_rest_url(f"/rest/v1/gpu_render_jobs?id=eq.{job_id}")
    r = requests.patch(url, headers=headers, data=json.dumps(patch), timeout=30)
    if r.status_code >= 300:
        raise RuntimeError(f"update gpu_render_jobs failed: {r.status_code} {r.text}")


def render_video_payload(payload: Dict[str, Any], progress_cb=None) -> Dict[str, Any]:
    """
    Core render pipeline used by both serverless and Pod worker.
    progress_cb: callable(progress:int) -> None
    """
    if progress_cb is None:
        progress_cb = lambda _p: None

    detect_gpu_encoder()

    scenes = payload.get('scenes', [])
    audio_url = payload.get('audioUrl', '')
    video_settings = payload.get('videoSettings', {}) or {}
    project_id = payload.get('projectId', '')
    project_name_raw = payload.get('projectName', 'video')
    # Sanitize project name for URL-safe file paths (replace spaces and special chars)
    project_name = re.sub(r'[^\w\-]', '_', project_name_raw)
    user_id = payload.get('userId', '')
    effect_type = payload.get('effectType', 'pan')

    width = video_settings.get('width', 1920)
    height = video_settings.get('height', 1080)
    framerate = video_settings.get('framerate', 25)

    if not scenes:
        return {"error": "No scenes provided"}
    if not audio_url:
        return {"error": "No audio URL provided"}

    print(f"[GPU Handler] Starting render for project {project_id}")
    print(f"[GPU Handler] {len(scenes)} scenes, {width}x{height} @ {framerate}fps")
    print(f"[GPU Handler] Effect type: {effect_type}")
    print(f"[GPU Handler] Using encoder: {ENCODER_NAME} (GPU: {GPU_ENCODER_AVAILABLE})")

    start_time = time.time()

    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)

        audio_path = temp_path / 'audio.mp3'
        if not download_file(audio_url, str(audio_path)):
            return {"error": "Failed to download audio"}

        segment_paths: List[str] = []

        for i, scene in enumerate(scenes):
            print(f"[GPU Handler] Processing scene {i+1}/{len(scenes)}")

            image_url = scene.get('imageUrl', '')
            if not image_url:
                return {"error": f"Scene {i} has no image URL"}

            ext = '.jpg'
            if '.png' in image_url.lower():
                ext = '.png'
            elif '.webp' in image_url.lower():
                ext = '.webp'

            image_path = temp_path / f'image_{i}{ext}'
            if not download_file(image_url, str(image_path)):
                return {"error": f"Failed to download image for scene {i}"}

            segment_path = temp_path / f'segment_{i}.mp4'
            duration = scene.get('duration', scene.get('endTime', 5) - scene.get('startTime', 0))

            if not create_video_segment(
                str(image_path),
                str(segment_path),
                duration,
                width,
                height,
                framerate,
                effect_type
            ):
                return {"error": f"Failed to create video segment for scene {i}"}

            segment_paths.append(str(segment_path))
            progress = int((i + 1) / len(scenes) * 70)
            progress_cb(progress)

        print("[GPU Handler] Concatenating segments...")
        concat_path = temp_path / 'concat.mp4'
        if not concatenate_videos(segment_paths, str(concat_path)):
            return {"error": "Failed to concatenate video segments"}

        progress_cb(85)

        print("[GPU Handler] Adding audio...")
        final_path = temp_path / f'{project_name}.mp4'
        if not add_audio(str(concat_path), str(audio_path), str(final_path)):
            return {"error": "Failed to add audio to video"}

        progress_cb(95)

        file_size_mb = os.path.getsize(str(final_path)) / (1024 * 1024)

        print("[GPU Handler] Uploading to Supabase...")
        try:
            timestamp = int(time.time())
            dest_path = f"{user_id}/{project_id}/{timestamp}_{project_name}.mp4"
            video_url = upload_to_supabase(str(final_path), 'rendered-videos', dest_path)
        except Exception as e:
            print(f"[GPU Handler] Upload error: {e}")
            return {"error": f"Failed to upload video: {e}"}

        elapsed_time = time.time() - start_time
        print(f"[GPU Handler] ✅ Render complete in {elapsed_time:.1f}s")
        print(f"[GPU Handler] Video URL: {video_url}")

        progress_cb(100)

        return {
            "success": True,
            "videoUrl": video_url,
            "duration": elapsed_time,
            "fileSizeMB": round(file_size_mb, 2),
            "scenesCount": len(scenes),
            "resolution": f"{width}x{height}",
            "framerate": framerate,
            "effectType": effect_type,
            "encoder": ENCODER_NAME,
            "gpuAccelerated": GPU_ENCODER_AVAILABLE,
        }


def handler(job: Dict[str, Any]) -> Dict[str, Any]:
    """
    RunPod handler function
    
    Input format:
    {
        "input": {
            "scenes": [
                {"index": 0, "startTime": 0, "endTime": 5, "duration": 5, "imageUrl": "...", "text": "..."},
                ...
            ],
            "audioUrl": "https://...",
            "videoSettings": {"width": 1920, "height": 1080, "framerate": 25, "format": "mp4"},
            "projectId": "...",
            "projectName": "...",
            "userId": "...",
            "effectType": "pan",
            "renderMethod": "standard"
        }
    }
    """
    
    job_input = job.get('input', {}) or {}

    def _cb(p: int):
        try:
            runpod.serverless.progress_update(job, p)
        except Exception:
            pass

    return render_video_payload(job_input, progress_cb=_cb)


# RunPod serverless handler
if _is_pod_mode():
    # In Pod mode we don't run the serverless worker loop.
    # We keep the container alive so you can connect, and we print a NVENC test in logs.
    _nvenc_smoke_test()
    print("[Pod] Container ready. (RUNPOD_MODE=pod)")
    while True:
        time.sleep(3600)
elif _is_worker_mode():
    # In worker mode (RunPod Pods), we poll Supabase for jobs and render them.
    worker_id = os.environ.get("RUNPOD_POD_ID") or os.environ.get("HOSTNAME") or "worker"
    print(f"[Worker] Starting GPU Pod worker. worker_id={worker_id}")
    while True:
        try:
            claimed = claim_next_gpu_job(worker_id)
            if not claimed:
                time.sleep(2)
                continue

            job_id = claimed["id"]
            payload = claimed.get("payload") or {}
            print(f"[Worker] Claimed gpu_render_job id={job_id}")

            update_gpu_job(job_id, {"status": "processing", "progress": 0})

            def _cb(p: int):
                try:
                    update_gpu_job(job_id, {"progress": p, "status": "processing"})
                except Exception as e:
                    print(f"[Worker] Progress update failed: {e}")

            result = render_video_payload(payload, progress_cb=_cb)

            if result.get("success"):
                update_gpu_job(job_id, {
                    "status": "completed",
                    "progress": 100,
                    "video_url": result.get("videoUrl"),
                    "finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "error_message": None,
                })
            else:
                update_gpu_job(job_id, {
                    "status": "failed",
                    "progress": 100,
                    "error_message": result.get("error") or "Render failed",
                    "finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                })
        except Exception as e:
            print(f"[Worker] Loop error: {e}")
            time.sleep(2)
else:
    runpod.serverless.start({"handler": handler})
