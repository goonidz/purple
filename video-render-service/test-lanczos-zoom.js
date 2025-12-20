/**
 * Test script for improved FFmpeg zoom with Lanczos interpolation
 * Tests: Lanczos interpolation + reduced upscale (2x instead of 6x)
 * 
 * This script tests if we can get better quality/faster rendering
 * by using Lanczos interpolation instead of default bilinear/bicubic
 * 
 * Usage: node test-lanczos-zoom.js <imagePath> <outputPath> <duration> <width> <height> <framerate> <effectType>
 * Example: node test-lanczos-zoom.js test.jpg output-lanczos.mp4 5 1920 1080 25 zoom_in
 */

const ffmpeg = require('fluent-ffmpeg');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length < 7) {
  console.error('Usage: node test-lanczos-zoom.js <imagePath> <outputPath> <duration> <width> <height> <framerate> <effectType>');
  console.error('Effect types: zoom_in, zoom_out, zoom_in_left, zoom_out_right, zoom_in_top, zoom_out_bottom');
  process.exit(1);
}

const [imagePath, outputPath, duration, width, height, framerate, effectType] = args;
const numDuration = parseFloat(duration);
const numWidth = parseInt(width);
const numHeight = parseInt(height);
const numFramerate = parseInt(framerate);
const totalFrames = Math.ceil(numDuration * numFramerate);

console.log('='.repeat(60));
console.log('TEST: Lanczos interpolation with reduced upscale (2x)');
console.log('='.repeat(60));
console.log(`Input: ${imagePath}`);
console.log(`Output: ${outputPath}`);
console.log(`Duration: ${numDuration}s, Frames: ${totalFrames}`);
console.log(`Size: ${numWidth}x${numHeight}@${numFramerate}fps`);
console.log(`Effect: ${effectType}`);
console.log('='.repeat(60));

// Ken Burns effect parameters (same as production)
const zoomAmount = 0.08; // 8% zoom

// TEST APPROACH: Lanczos + 2x upscale (instead of default + 6x)
const scaleFactor = 2; // Reduced from 6x
const scaledWidth = numWidth * scaleFactor;
const scaledHeight = numHeight * scaleFactor;

let zoomExpr, xExpr, yExpr;

// Same zoom expressions as production
switch (effectType) {
  case 'zoom_in':
    zoomExpr = `1+${zoomAmount}*on/${totalFrames}`;
    xExpr = `(iw-iw/zoom)/2`;
    yExpr = `(ih-ih/zoom)/2`;
    break;
  case 'zoom_out':
    zoomExpr = `${1 + zoomAmount}-${zoomAmount}*on/${totalFrames}`;
    xExpr = `(iw-iw/zoom)/2`;
    yExpr = `(ih-ih/zoom)/2`;
    break;
  case 'zoom_in_left':
    zoomExpr = `1+${zoomAmount}*on/${totalFrames}`;
    xExpr = `(iw-iw/zoom)/4`;
    yExpr = `(ih-ih/zoom)/2`;
    break;
  case 'zoom_out_right':
    zoomExpr = `${1 + zoomAmount}-${zoomAmount}*on/${totalFrames}`;
    xExpr = `(iw-iw/zoom)*3/4`;
    yExpr = `(ih-ih/zoom)/2`;
    break;
  case 'zoom_in_top':
    zoomExpr = `1+${zoomAmount}*on/${totalFrames}`;
    xExpr = `(iw-iw/zoom)/2`;
    yExpr = `(ih-ih/zoom)/4`;
    break;
  case 'zoom_out_bottom':
    zoomExpr = `${1 + zoomAmount}-${zoomAmount}*on/${totalFrames}`;
    xExpr = `(iw-iw/zoom)/2`;
    yExpr = `(ih-ih/zoom)*3/4`;
    break;
  default:
    zoomExpr = `1+${zoomAmount}*on/${totalFrames}`;
    xExpr = `(iw-iw/zoom)/2`;
    yExpr = `(ih-ih/zoom)/2`;
}

// Preprocessing: Scale and crop to fill frame (same as production)
const preprocessFilter = `scale=${numWidth}:${numHeight}:force_original_aspect_ratio=increase,crop=${numWidth}:${numHeight}`;

// KEY DIFFERENCE: Use Lanczos interpolation for upscale
// flags=lanczos tells FFmpeg to use Lanczos algorithm (high quality)
// This should allow us to use only 2x upscale instead of 6x
const upscaleFilter = `scale=${scaledWidth}:${scaledHeight}:flags=lanczos`;

// Zoompan at high resolution
const zoompanFilter = `zoompan=z='${zoomExpr}':x='${xExpr}':y='${yExpr}':d=${totalFrames}:s=${scaledWidth}x${scaledHeight}:fps=${numFramerate}`;

// Scale back down to target resolution (also with Lanczos for quality)
const downscaleFilter = `scale=${numWidth}:${numHeight}:flags=lanczos`;

// Combine all filters
const finalFilter = `${preprocessFilter},${upscaleFilter},${zoompanFilter},${downscaleFilter}`;

console.log('\nFilter chain:');
console.log(`1. Preprocess: ${preprocessFilter}`);
console.log(`2. Upscale (${scaleFactor}x) with Lanczos: ${upscaleFilter}`);
console.log(`3. Zoompan: ${zoompanFilter.substring(0, 80)}...`);
console.log(`4. Downscale with Lanczos: ${downscaleFilter}`);
console.log('\nStarting render...\n');

const startTime = Date.now();

// Render with FFmpeg
const command = ffmpeg()
  .input(imagePath)
  .inputOptions(['-loop', '1'])
  .videoCodec('libx264')
  .outputOptions([
    '-preset', 'medium', // Same as production
    '-crf', '23',
    '-t', numDuration.toString()
  ])
  .videoFilters([finalFilter])
  .output(outputPath)
  .on('start', (cmd) => {
    console.log('FFmpeg command:');
    console.log(cmd);
    console.log('\nRendering...');
  })
  .on('progress', (progress) => {
    if (progress.percent !== undefined) {
      process.stdout.write(`\rProgress: ${Math.round(progress.percent)}%`);
    }
  })
  .on('end', () => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n\n✅ Render completed in ${elapsed}s`);
    console.log(`Output: ${outputPath}`);
    console.log('\n' + '='.repeat(60));
    console.log('COMPARISON NOTES:');
    console.log('='.repeat(60));
    console.log('Current production: 6x upscale (default interpolation)');
    console.log(`This test: ${scaleFactor}x upscale (Lanczos interpolation)`);
    console.log('\nCheck the output video for:');
    console.log('  - Jiggle/stuttering (should be minimal with Lanczos)');
    console.log('  - Overall quality (should be good)');
    console.log('  - Rendering speed (should be ~3x faster than 6x)');
    console.log('='.repeat(60));
  })
  .on('error', (err) => {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  });

command.run();
