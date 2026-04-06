# DepthFlow on RunPod

## 1. Create a Pod

- **GPU:** RTX 3090 or RTX A4000
- **Template:** RunPod Pytorch 2.x
- **Disk:** 20 GB
- **Expose HTTP Port:** `7860`

## 2. Setup & Launch

Open the pod's web terminal and run:

```bash
apt-get update && apt-get install -y libegl1 libgl1 libgles2 libegl-dev
```

Then launch DepthFlow:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh && source $HOME/.local/bin/env && HF_HUB_ENABLE_HF_TRANSFER=0 uvx depthflow gradio
```

When prompted for PyTorch version, type `cuda128` and press Enter.

## 3. Access

Open the pod's proxied URL for port 7860:

```
https://[POD_ID]-7860.proxy.runpod.net
```

Available in the pod's **Connect** tab.

## 4. Notes

- Don't use the **Upscale** button (ncnn-vulkan doesn't work in the container). Upload high-res images directly.
- The depth map is auto-generated when you upload an image.
- Animation presets are in the **Animation** tab (Orbital, Horizontal, Vertical, Zoom, Circle, Dolly).
- Click **Render** to generate the parallax video.
