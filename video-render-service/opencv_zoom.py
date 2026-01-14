import cv2
import numpy as np
import sys
import os

def main():
    if len(sys.argv) < 8:
        print("Usage: python3 opencv_zoom.py <image_path> <frames_dir> <duration> <width> <height> <framerate> <effect_type>")
        sys.exit(1)

    image_path = sys.argv[1]
    frames_dir = sys.argv[2]
    duration = float(sys.argv[3])
    width = int(sys.argv[4])
    height = int(sys.argv[5])
    framerate = float(sys.argv[6])
    effect_type = sys.argv[7]

    if not os.path.exists(image_path):
        print(f"Error: Image not found at {image_path}")
        sys.exit(1)

    if not os.path.exists(frames_dir):
        os.makedirs(frames_dir, exist_ok=True)

    # Load image
    img = cv2.imread(image_path)
    if img is None:
        print(f"Error: Failed to load image at {image_path}")
        sys.exit(1)

    orig_h, orig_w = img.shape[:2]
    
    # Pre-resize/crop to target aspect ratio to avoid black bars
    target_ratio = width / height
    orig_ratio = orig_w / orig_h
    
    if orig_ratio > target_ratio:
        # Image is wider than target
        new_w = int(orig_h * target_ratio)
        start_x = (orig_w - new_w) // 2
        img = img[:, start_x:start_x+new_w]
    elif orig_ratio < target_ratio:
        # Image is taller than target
        new_h = int(orig_w / target_ratio)
        start_y = (orig_h - new_h) // 2
        img = img[start_y:start_y+new_h, :]
    
    # Now resize to target dimensions (base image for zoom)
    img = cv2.resize(img, (width, height), interpolation=cv2.INTER_LANCZOS4)
    h, w = img.shape[:2]

    total_frames = int(duration * framerate)
    
    zoom_amount = 0.08  # 8% zoom
    
    # Map effect types to focus points
    focus_x, focus_y = w / 2, h / 2
    is_zoom_in = True

    if 'zoom_out' in effect_type:
        is_zoom_in = False
    
    if 'left' in effect_type:
        focus_x = w / 4
    elif 'right' in effect_type:
        focus_x = w * 3 / 4
        
    if 'top' in effect_type:
        focus_y = h / 4
    elif 'bottom' in effect_type:
        focus_y = h * 3 / 4

    for i in range(total_frames):
        progress = i / (total_frames - 1) if total_frames > 1 else 0
        
        if is_zoom_in:
            s = 1.0 + (zoom_amount * progress)
        else:
            s = (1.0 + zoom_amount) - (zoom_amount * progress)
            
        # Transformation matrix for scaling around focus point
        M = np.array([
            [s, 0, (1 - s) * focus_x],
            [0, s, (1 - s) * focus_y]
        ], dtype=np.float32)
        
        # Apply warpAffine with Lanczos interpolation
        zoomed = cv2.warpAffine(img, M, (width, height), flags=cv2.INTER_LANCZOS4)
        
        # Save frame
        frame_path = os.path.join(frames_dir, f"frame_{i:05d}.jpg")
        cv2.imwrite(frame_path, zoomed, [int(cv2.IMWRITE_JPEG_QUALITY), 95])

    print(f"Successfully generated {total_frames} frames in {frames_dir}")

if __name__ == "__main__":
    main()
