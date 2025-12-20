/**
 * Test script for Sharp-based zoom/pan effects
 * Alternative to FFmpeg zoompan for better quality without upscale
 * 
 * Usage: node test-sharp-zoom.js <imagePath> <outputPath> <duration> <width> <height> <framerate> <effectType>
 * Example: node test-sharp-zoom.js test.jpg output.mp4 5 1920 1080 25 zoom_in
 */

const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length < 7) {
  console.error('Usage: node test-sharp-zoom.js <imagePath> <outputPath> <duration> <width> <height> <framerate> <effectType>');
  console.error('Effect types: zoom_in, zoom_out, zoom_in_left, zoom_out_right, zoom_in_top, zoom_out_bottom, pan_horizontal, pan_vertical');
  process.exit(1);
}

const [imagePath, outputPath, duration, width, height, framerate, effectType] = args;
const numDuration = parseFloat(duration);
const numWidth = parseInt(width);
const numHeight = parseInt(height);
const numFramerate = parseInt(framerate);
const totalFrames = Math.ceil(numDuration * numFramerate);

console.log(`Testing Sharp-based ${effectType} effect`);
console.log(`Input: ${imagePath}`);
console.log(`Output: ${outputPath}`);
console.log(`Duration: ${numDuration}s, Frames: ${totalFrames}, Size: ${numWidth}x${numHeight}@${numFramerate}fps`);

async function generateFramesWithSharp() {
  const tempDir = path.join(__dirname, 'temp-sharp-test');
  await mkdir(tempDir, { recursive: true });
  const framesDir = path.join(tempDir, 'frames');
  await mkdir(framesDir, { recursive: true });

  // Load original image
  const image = sharp(imagePath);
  const metadata = await image.metadata();
  const origWidth = metadata.width;
  const origHeight = metadata.height;

  console.log(`Original image: ${origWidth}x${origHeight}`);

  // Calculate zoom parameters
  const zoomAmount = 0.08; // 8% zoom for Ken Burns
  const panAmount = 0.15; // 15% pan distance

  // Generate each frame
  for (let frame = 0; frame < totalFrames; frame++) {
    const progress = frame / (totalFrames - 1); // 0 to 1

    let zoom, cropX, cropY, cropWidth, cropHeight;

    if (effectType.startsWith('zoom_')) {
      // Ken Burns zoom effect
      let zoomLevel;
      let focusX, focusY;

      switch (effectType) {
        case 'zoom_in':
          zoomLevel = 1 + zoomAmount * progress; // 1.0 -> 1.08
          focusX = origWidth / 2;
          focusY = origHeight / 2;
          break;
        case 'zoom_out':
          zoomLevel = 1.08 - zoomAmount * progress; // 1.08 -> 1.0
          focusX = origWidth / 2;
          focusY = origHeight / 2;
          break;
        case 'zoom_in_left':
          zoomLevel = 1 + zoomAmount * progress;
          focusX = origWidth / 4;
          focusY = origHeight / 2;
          break;
        case 'zoom_out_right':
          zoomLevel = 1.08 - zoomAmount * progress;
          focusX = origWidth * 3 / 4;
          focusY = origHeight / 2;
          break;
        case 'zoom_in_top':
          zoomLevel = 1 + zoomAmount * progress;
          focusX = origWidth / 2;
          focusY = origHeight / 4;
          break;
        case 'zoom_out_bottom':
          zoomLevel = 1.08 - zoomAmount * progress;
          focusX = origWidth / 2;
          focusY = origHeight * 3 / 4;
          break;
        default:
          zoomLevel = 1 + zoomAmount * progress;
          focusX = origWidth / 2;
          focusY = origHeight / 2;
      }

      // Calculate crop area (zoomed region)
      cropWidth = origWidth / zoomLevel;
      cropHeight = origHeight / zoomLevel;
      cropX = Math.max(0, Math.min(origWidth - cropWidth, focusX - cropWidth / 2));
      cropY = Math.max(0, Math.min(origHeight - cropHeight, focusY - cropHeight / 2));

    } else if (effectType.startsWith('pan_')) {
      // Pan effect (with slight zoom for margin)
      const zoomLevel = 1.3; // 30% zoom to create margin
      cropWidth = origWidth / zoomLevel;
      cropHeight = origHeight / zoomLevel;
      
      // Center position
      const centerX = (origWidth - cropWidth) / 2;
      const centerY = (origHeight - cropHeight) / 2;

      // Triangular wave for back-and-forth pan
      const triangularWave = 1 - Math.abs(2 * progress - 1);

      if (effectType === 'pan_horizontal') {
        // Horizontal pan: left to right and back
        const panOffset = (origWidth - cropWidth) * panAmount * triangularWave;
        cropX = centerX + panOffset;
        cropY = centerY;
      } else {
        // Vertical pan: up to down and back
        const panOffset = (origHeight - cropHeight) * panAmount * triangularWave;
        cropX = centerX;
        cropY = centerY + panOffset;
      }
    } else {
      throw new Error(`Unknown effect type: ${effectType}`);
    }

    // Generate frame using Sharp with Lanczos interpolation (high quality)
    const framePath = path.join(framesDir, `frame_${String(frame).padStart(5, '0')}.png`);
    
    await image
      .extract({
        left: Math.round(cropX),
        top: Math.round(cropY),
        width: Math.round(cropWidth),
        height: Math.round(cropHeight)
      })
      .resize(numWidth, numHeight, {
        kernel: sharp.kernel.lanczos3, // High-quality interpolation
        fit: 'fill'
      })
      .png()
      .toFile(framePath);

    if ((frame + 1) % 25 === 0) {
      console.log(`Generated ${frame + 1}/${totalFrames} frames...`);
    }
  }

  console.log(`All ${totalFrames} frames generated`);

  // Assemble frames into video using FFmpeg
  return new Promise((resolve, reject) => {
    console.log('Assembling video with FFmpeg...');
    
    const framePattern = path.join(framesDir, 'frame_%05d.png');
    
    ffmpeg()
      .input(framePattern)
      .inputOptions(['-framerate', numFramerate.toString()])
      .videoCodec('libx264')
      .outputOptions([
        '-preset', 'medium',
        '-crf', '23',
        '-pix_fmt', 'yuv420p'
      ])
      .output(outputPath)
      .on('start', (cmd) => {
        console.log(`FFmpeg: ${cmd}`);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          process.stdout.write(`\rEncoding: ${Math.round(progress.percent)}%`);
        }
      })
      .on('end', async () => {
        console.log('\nVideo created successfully!');
        
        // Cleanup frames
        console.log('Cleaning up temporary frames...');
        for (let i = 0; i < totalFrames; i++) {
          const framePath = path.join(framesDir, `frame_${String(i).padStart(5, '0')}.png`);
          await unlink(framePath).catch(() => {});
        }
        await fs.promises.rmdir(framesDir).catch(() => {});
        await fs.promises.rmdir(tempDir).catch(() => {});
        
        resolve();
      })
      .on('error', (err) => {
        console.error('FFmpeg error:', err);
        reject(err);
      })
      .run();
  });
}

// Run the test
generateFramesWithSharp()
  .then(() => {
    console.log('Test completed successfully!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
