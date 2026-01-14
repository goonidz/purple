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
                    '-i', 'color=c=black:s=128x128:r=30:d=0.2,format=yuv420p',
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
                    ENCODER_PRESET = 'p4'
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
            '-preset', 'p4',
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
    
    # Detect encoder on first call (cached for subsequent calls)
    detect_gpu_encoder()
    
    job_input = job.get('input', {})
    
    scenes = job_input.get('scenes', [])
    audio_url = job_input.get('audioUrl', '')
    video_settings = job_input.get('videoSettings', {})
    project_id = job_input.get('projectId', '')
    project_name = job_input.get('projectName', 'video')
    user_id = job_input.get('userId', '')
    effect_type = job_input.get('effectType', 'pan')
    
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
        
        # Download audio
        audio_path = temp_path / 'audio.mp3'
        if not download_file(audio_url, str(audio_path)):
            return {"error": "Failed to download audio"}
        
        # Process each scene
        segment_paths = []
        
        for i, scene in enumerate(scenes):
            print(f"[GPU Handler] Processing scene {i+1}/{len(scenes)}")
            
            # Download image
            image_url = scene.get('imageUrl', '')
            if not image_url:
                return {"error": f"Scene {i} has no image URL"}
            
            # Determine file extension from URL
            ext = '.jpg'
            if '.png' in image_url.lower():
                ext = '.png'
            elif '.webp' in image_url.lower():
                ext = '.webp'
            
            image_path = temp_path / f'image_{i}{ext}'
            if not download_file(image_url, str(image_path)):
                return {"error": f"Failed to download image for scene {i}"}
            
            # Create video segment
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
            
            # Report progress
            progress = int((i + 1) / len(scenes) * 70)  # 0-70% for segments
            runpod.serverless.progress_update(job, progress)
        
        # Concatenate all segments
        print("[GPU Handler] Concatenating segments...")
        concat_path = temp_path / 'concat.mp4'
        if not concatenate_videos(segment_paths, str(concat_path)):
            return {"error": "Failed to concatenate video segments"}
        
        runpod.serverless.progress_update(job, 85)
        
        # Add audio
        print("[GPU Handler] Adding audio...")
        final_path = temp_path / f'{project_name}.mp4'
        if not add_audio(str(concat_path), str(audio_path), str(final_path)):
            return {"error": "Failed to add audio to video"}
        
        runpod.serverless.progress_update(job, 95)
        
        # Get file info
        file_size_mb = os.path.getsize(str(final_path)) / (1024 * 1024)
        
        # Upload to Supabase Storage
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


# RunPod serverless handler
runpod.serverless.start({"handler": handler})
