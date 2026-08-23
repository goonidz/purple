"""RunPod worker for persona.render.v1 manifests.

The worker owns no durable state. It claims one orchestrator job, renders into an
ephemeral directory, uploads the verified MP4 to R2 through multipart requests,
and lets Cloudflare D1 remain the source of truth.
"""

from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import re
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests
import runpod
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

FFMPEG = os.environ.get("FFMPEG_BIN", "ffmpeg")
FFPROBE = os.environ.get("FFPROBE_BIN", "ffprobe")
FPS = 30
WIDTH = 1920
HEIGHT = 1080
MAX_DOWNLOAD_BYTES = 1_500_000_000
SESSION = requests.Session()
SESSION.mount("https://", HTTPAdapter(max_retries=Retry(total=4, connect=4, read=4, backoff_factor=1, status_forcelist=(408, 429, 500, 502, 503, 504), allowed_methods=frozenset(("GET", "POST", "PUT")))))


class RenderError(RuntimeError):
    pass


def run(command: list[str], timeout: int = 7_200) -> None:
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        tail = (result.stderr or result.stdout or "")[-4_000:]
        raise RenderError(f"Command failed ({result.returncode}): {tail}")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def probe(path: Path) -> dict[str, Any]:
    result = subprocess.run(
        [FFPROBE, "-v", "error", "-show_entries", "format=duration,size:stream=codec_type,codec_name,width,height,sample_rate,channels", "-of", "json", str(path)],
        check=True, capture_output=True, text=True, timeout=120,
    )
    return json.loads(result.stdout)


def require_https(value: Any, label: str) -> str:
    if not isinstance(value, str) or urlparse(value).scheme != "https":
        raise RenderError(f"{label} must be an HTTPS URL")
    return value


def validate_manifest(value: Any, expected_job_id: str) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema") != "persona.render.v1":
        raise RenderError("Unsupported render manifest")
    if value.get("job_id") != expected_job_id or value.get("width") != WIDTH or value.get("height") != HEIGHT or value.get("fps") != FPS:
        raise RenderError("Manifest identity or video settings mismatch")
    scenes = value.get("scenes")
    if not isinstance(scenes, list) or not 1 <= len(scenes) <= 100:
        raise RenderError("Manifest must contain 1 to 100 scenes")
    if scenes[0].get("type") == "broll":
        raise RenderError("Opening scene must show the avatar")
    total = 0.0
    for index, scene in enumerate(scenes, 1):
        if not isinstance(scene, dict) or scene.get("type") not in ("avatar_full", "broll", "split_vertical"):
            raise RenderError(f"Scene {index} is invalid")
        if any(field in scene for field in ("text", "on_screen_text", "overlay", "caption", "transition", "effect")):
            raise RenderError(f"Scene {index} contains a forbidden visual effect")
        duration = float(scene.get("duration_seconds", 0))
        if duration < 0.25 or duration > 60 or (scene["type"] != "broll" and duration > 15):
            raise RenderError(f"Scene {index} duration violates policy")
        total += duration
        if scene["type"] in ("avatar_full", "split_vertical"):
            require_https(scene.get("avatar_url"), f"Scene {index} avatar_url")
        if scene["type"] in ("broll", "split_vertical"):
            require_https(scene.get("image_url"), f"Scene {index} image_url")
            if scene.get("motion") not in ("zoom-in", "zoom-out"):
                raise RenderError(f"Scene {index} has invalid motion")
        if scene["type"] == "broll":
            require_https(scene.get("audio_url"), f"Scene {index} audio_url")
        if scene["type"] == "split_vertical" and scene.get("avatar_side") not in ("left", "right"):
            raise RenderError(f"Scene {index} has invalid avatar_side")
    if total > 3_600:
        raise RenderError("Manifest exceeds one hour")
    return value


def extension(url: str, content_type: str | None) -> str:
    suffix = Path(urlparse(url).path).suffix.lower()
    if re.fullmatch(r"\.[a-z0-9]{2,5}", suffix):
        return suffix
    return mimetypes.guess_extension((content_type or "").split(";", 1)[0]) or ".bin"


def download(url: str, directory: Path, stem: str) -> Path:
    with SESSION.get(url, stream=True, timeout=(30, 300), allow_redirects=True) as response:
        response.raise_for_status()
        declared = int(response.headers.get("content-length", "0") or 0)
        if declared > MAX_DOWNLOAD_BYTES:
            raise RenderError(f"Asset {stem} exceeds download limit")
        target = directory / f"{stem}{extension(url, response.headers.get('content-type'))}"
        size = 0
        with target.open("xb") as handle:
            for chunk in response.iter_content(4 * 1024 * 1024):
                if not chunk:
                    continue
                size += len(chunk)
                if size > MAX_DOWNLOAD_BYTES:
                    raise RenderError(f"Asset {stem} exceeds download limit")
                handle.write(chunk)
        if size < 1:
            raise RenderError(f"Asset {stem} is empty")
        return target


def fetch_manifest(url: str, token: str, job_id: str) -> dict[str, Any]:
    response = SESSION.get(require_https(url, "manifest_url"), headers={"Authorization": f"Bearer {token}"}, timeout=(30, 120))
    response.raise_for_status()
    return validate_manifest(response.json(), job_id)


def callback(base: str, job_id: str, token: str, path: str, payload: dict[str, Any]) -> requests.Response:
    response = SESSION.post(
        f"{base}/v1/internal/jobs/{job_id}/{path}",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        data=json.dumps(payload), timeout=(30, 120),
    )
    response.raise_for_status()
    return response


def progress(base: str, job_id: str, token: str, value: int, phase: str) -> None:
    try:
        callback(base, job_id, token, "progress", {"progress": value, "phase": phase})
    except Exception as error:  # reconciliation remains the fallback
        print(f"[progress] callback failed: {error}", flush=True)


def diagnostics() -> dict[str, Any]:
    filters = subprocess.run([FFMPEG, "-hide_banner", "-filters"], capture_output=True, text=True, timeout=30)
    encoders = subprocess.run([FFMPEG, "-hide_banner", "-encoders"], capture_output=True, text=True, timeout=30)
    gpu = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"], capture_output=True, text=True, timeout=30)
    return {
        "success": filters.returncode == 0 and encoders.returncode == 0,
        "libplacebo": "libplacebo" in filters.stdout,
        "h264_nvenc": "h264_nvenc" in encoders.stdout,
        "gpu": gpu.stdout.strip(),
        "ffmpeg": subprocess.run([FFMPEG, "-version"], capture_output=True, text=True, timeout=30).stdout.splitlines()[0],
    }


def nvenc_args() -> list[str]:
    if not diagnostics()["h264_nvenc"]:
        raise RenderError("FFmpeg does not expose h264_nvenc")
    candidates = []
    for path in Path("/dev").glob("nvidia[0-9]*"):
        match = re.fullmatch(r"nvidia(\d+)", path.name)
        if match:
            candidates.append(int(match.group(1)))
    candidates.extend(range(8))
    seen: set[int] = set()
    for gpu_id in candidates:
        if gpu_id in seen:
            continue
        seen.add(gpu_id)
        check = subprocess.run([
            FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=640x360:r=30:d=0.2",
            "-c:v", "h264_nvenc", "-gpu", str(gpu_id), "-f", "null", "-",
        ], capture_output=True, text=True, timeout=60)
        if check.returncode == 0:
            return ["-c:v", "h264_nvenc", "-gpu", str(gpu_id), "-preset", "medium", "-rc", "constqp", "-qp", "20", "-b:v", "0"]
    raise RenderError("NVENC is present but no usable GPU encoder was found")


def zoom_filter(seconds: float, direction: str, width: int, height: int) -> str:
    unit = f"min(t/{max(seconds, 0.001):.8f}\\,1)"
    progress_value = f"(0.55*({unit})+0.45*(0.5-0.5*cos(PI*({unit}))))"
    scale = f"(1.05500000-0.05500000*{progress_value})" if direction == "zoom-out" else f"(1+0.05500000*{progress_value})"
    aspect = width / height
    return (
        f"libplacebo=w={width}:h={height}:"
        f"crop_w='ih*{aspect:.12f}/({scale})':crop_h='ih/({scale})':"
        "crop_x='(iw-cw)/2':crop_y='(ih-ch)/2':"
        f"upscaler=ewa_lanczos:downscaler=ewa_lanczos:fps={FPS},format=yuv420p"
    )


def render_scene(scene: dict[str, Any], files: dict[str, Path], output: Path, encoder: list[str]) -> None:
    duration = float(scene["duration_seconds"])
    common = [FFMPEG, "-y", "-hide_banner", "-loglevel", "error"]
    kind = scene["type"]
    if kind == "broll":
        graph = (
            f"[0:v]{zoom_filter(duration, scene['motion'], WIDTH, HEIGHT)},trim=duration={duration:.8f},setpts=PTS-STARTPTS[v];"
            f"[1:a]aresample=48000,apad,atrim=duration={duration:.8f},asetpts=PTS-STARTPTS[a]"
        )
        command = common + ["-loop", "1", "-framerate", str(FPS), "-i", str(files["image"]), "-i", str(files["audio"]), "-filter_complex", graph, "-map", "[v]", "-map", "[a]"]
    elif kind == "avatar_full":
        graph = (
            f"[0:v]scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,crop={WIDTH}:{HEIGHT},fps={FPS},"
            f"tpad=stop_mode=clone:stop_duration=1,trim=duration={duration:.8f},setpts=PTS-STARTPTS,format=yuv420p[v];"
            f"[0:a]aresample=48000,apad,atrim=duration={duration:.8f},asetpts=PTS-STARTPTS[a]"
        )
        command = common + ["-i", str(files["avatar"]), "-filter_complex", graph, "-map", "[v]", "-map", "[a]"]
    else:
        avatar_side = scene["avatar_side"]
        graph = (
            f"[0:v]scale=960:1080:force_original_aspect_ratio=increase,crop=960:1080,fps={FPS},"
            f"tpad=stop_mode=clone:stop_duration=1,trim=duration={duration:.8f},setpts=PTS-STARTPTS,format=yuv420p[av];"
            f"[1:v]{zoom_filter(duration, scene['motion'], 960, 1080)},trim=duration={duration:.8f},setpts=PTS-STARTPTS[br];"
            f"{'[av][br]' if avatar_side == 'left' else '[br][av]'}hstack=inputs=2,format=yuv420p[v];"
            f"[0:a]aresample=48000,apad,atrim=duration={duration:.8f},asetpts=PTS-STARTPTS[a]"
        )
        command = common + ["-i", str(files["avatar"]), "-loop", "1", "-framerate", str(FPS), "-i", str(files["image"]), "-filter_complex", graph, "-map", "[v]", "-map", "[a]"]
    command += ["-t", f"{duration:.8f}", *encoder, "-pix_fmt", "yuv420p", "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", str(output)]
    run(command)


def upload_output(base: str, job_id: str, token: str, output: Path) -> dict[str, Any]:
    start = callback(base, job_id, token, "uploads/start", {}).json()
    upload_id = start["upload_id"]
    part_size = int(start["part_size"])
    parts = []
    with output.open("rb") as handle:
        part_number = 1
        while True:
            chunk = handle.read(part_size)
            if not chunk:
                break
            response = SESSION.put(
                f"{base}/v1/internal/jobs/{job_id}/uploads/{upload_id}/{part_number}",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/octet-stream", "Content-Length": str(len(chunk))},
                data=chunk, timeout=(30, 300),
            )
            response.raise_for_status()
            parts.append(response.json())
            part_number += 1
    receipt = {"parts": parts, "sha256": sha256(output), "size": output.stat().st_size}
    return callback(base, job_id, token, f"uploads/{upload_id}/complete", receipt).json()


def render(job_input: dict[str, Any], worker_claim_id: str) -> dict[str, Any]:
    job_id = str(job_input.get("job_id", ""))
    token = str(job_input.get("job_token", ""))
    base = require_https(job_input.get("orchestrator_url"), "orchestrator_url").rstrip("/")
    if not re.fullmatch(r"rj_[a-f0-9]{32}", job_id) or len(token) < 32:
        raise RenderError("Invalid job identity")

    claim = callback(base, job_id, token, "claim", {"worker_claim_id": worker_claim_id})
    if claim.status_code != 200:
        raise RenderError("Unable to claim job")
    progress(base, job_id, token, 2, "manifest")
    manifest = fetch_manifest(job_input.get("manifest_url", ""), token, job_id)
    checks = diagnostics()
    if not checks["libplacebo"]:
        raise RenderError("This image lacks libplacebo; refusing a potentially stuttering render")
    encoder = nvenc_args()

    with tempfile.TemporaryDirectory(prefix=f"{job_id}-") as temporary:
        root = Path(temporary)
        assets = root / "assets"
        segments = root / "segments"
        assets.mkdir()
        segments.mkdir()
        scene_files: dict[int, dict[str, Path]] = {}
        work: list[tuple[int, str, str]] = []
        for index, scene in enumerate(manifest["scenes"], 1):
            if scene["type"] in ("avatar_full", "split_vertical"):
                work.append((index, "avatar", scene["avatar_url"]))
            if scene["type"] in ("broll", "split_vertical"):
                work.append((index, "image", scene["image_url"]))
            if scene["type"] == "broll":
                work.append((index, "audio", scene["audio_url"]))
        progress(base, job_id, token, 5, "download")
        with ThreadPoolExecutor(max_workers=min(12, len(work))) as pool:
            futures = {pool.submit(download, url, assets, f"scene-{index:03d}-{role}"): (index, role) for index, role, url in work}
            completed = 0
            for future in as_completed(futures):
                index, role = futures[future]
                scene_files.setdefault(index, {})[role] = future.result()
                completed += 1
                progress(base, job_id, token, 5 + int(20 * completed / len(work)), f"download {completed}/{len(work)}")

        outputs: list[Path] = []
        for index, scene in enumerate(manifest["scenes"], 1):
            output = segments / f"scene-{index:03d}.mkv"
            render_scene(scene, scene_files[index], output, encoder)
            outputs.append(output)
            progress(base, job_id, token, 25 + int(65 * index / len(manifest["scenes"])), f"render {index}/{len(manifest['scenes'])}")

        listing = root / "concat.txt"
        listing.write_text("\n".join(f"file '{path.as_posix()}'" for path in outputs) + "\n", encoding="utf-8")
        final = root / f"{job_id}.mp4"
        run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(listing), "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(final)])
        info = probe(final)
        streams = info.get("streams", [])
        if not any(stream.get("codec_type") == "video" and stream.get("width") == WIDTH and stream.get("height") == HEIGHT for stream in streams):
            raise RenderError("Final video verification failed")
        if not any(stream.get("codec_type") == "audio" for stream in streams):
            raise RenderError("Final audio verification failed")
        progress(base, job_id, token, 95, "upload")
        uploaded = upload_output(base, job_id, token, final)
        return {
            "success": True,
            "job_id": job_id,
            "output_url": uploaded.get("output_url"),
            "output_key": uploaded.get("output_key"),
            "size": final.stat().st_size,
            "sha256": sha256(final),
            "scenes": len(outputs),
            "gpu": checks["gpu"],
        }


def handler(job: dict[str, Any]) -> dict[str, Any]:
    payload = job.get("input") or {}
    if payload.get("action") == "diagnostics":
        return diagnostics()
    worker_claim_id = str(job.get("id") or f"local-{time.time_ns()}")
    try:
        return render(payload, worker_claim_id)
    except Exception as error:
        print(f"[render] failed: {type(error).__name__}: {error}", flush=True)
        return {"success": False, "error": str(error)[:2_000], "error_type": type(error).__name__}


runpod.serverless.start({"handler": handler})
