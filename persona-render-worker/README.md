# RunPod persona render worker

This handler runs inside the existing FFmpeg/CUDA base image but is isolated from every existing endpoint. The RunPod endpoint must pin both the image digest and this handler's Git commit URL.

Contract: `persona.render.v1`, 1920×1080 at 30 fps. Supported layouts are avatar full-screen, B-roll, and left/right vertical split. B-roll motion uses the established `libplacebo` floating-point crop with EWA Lanczos; ordinary `zoompan` is deliberately rejected.

The worker writes only to an ephemeral temporary directory and uploads the final file to Cloudflare R2 in bounded multipart chunks.
