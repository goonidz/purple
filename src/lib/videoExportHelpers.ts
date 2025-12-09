export interface GeneratedPrompt {
  scene: string;
  prompt: string;
  text: string;
  startTime: number;
  endTime: number;
  duration: number;
  imageUrl?: string;
}

export type ExportFormat = "premiere-xml" | "edl" | "csv";
export type ExportMode = "with-images" | "urls-only";

interface ExportOptions {
  format: ExportFormat;
  mode: ExportMode;
  projectName: string;
  framerate?: number;
  width?: number;
  height?: number;
  audioUrl?: string;
}

export function formatTimecode(seconds: number, framerate: number = 25): string {
  const totalFrames = Math.round(seconds * framerate);
  const frames = totalFrames % framerate;
  const totalSeconds = Math.floor(totalFrames / framerate);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
}

export function generatePremiereXML(
  prompts: GeneratedPrompt[],
  options: ExportOptions
): string {
  const { projectName, framerate = 25, width = 1920, height = 1080, mode, audioUrl } = options;
  
  const clipItems = prompts.map((prompt, index) => {
    // First image always starts at frame 0, others use leur timecode réel
    const startFrame = index === 0 ? 0 : Math.round(prompt.startTime * framerate);
    
    // For end frame: extend to the start of next scene, or use scene's end if last
    const nextPrompt = prompts[index + 1];
    const endFrame = nextPrompt 
      ? Math.round(nextPrompt.startTime * framerate)
      : Math.round(prompt.endTime * framerate);
    
    const duration = endFrame - startFrame;
    
    const filename = `clip_${(index + 1).toString().padStart(3, '0')}_img.jpg`;
    // Use file://localhost/ format as required by FCP XML spec for DaVinci Resolve compatibility
    const imagePath = `file://localhost/${filename}`;
    
    return `      <clipitem id="clipitem-${index + 1}">
        <name>Scene ${index + 1}</name>
        <duration>${duration}</duration>
        <rate>
          <timebase>${framerate}</timebase>
        </rate>
        <start>${startFrame}</start>
        <end>${endFrame}</end>
        <in>0</in>
        <out>${duration}</out>
        <stillframe>TRUE</stillframe>
        <file id="file-${index + 1}">
          <name>${filename}</name>
          <pathurl>${imagePath}</pathurl>
          <duration>${duration}</duration>
          <width>${width}</width>
          <height>${height}</height>
          <media>
            <video>
              <stillframe>TRUE</stillframe>
              <duration>${duration}</duration>
              <samplecharacteristics>
                <width>${width}</width>
                <height>${height}</height>
              </samplecharacteristics>
            </video>
          </media>
        </file>
        <sourcetrack>
          <mediatype>video</mediatype>
        </sourcetrack>
        <comments>
          <mastercomment1>${escapeXml(prompt.text)}</mastercomment1>
          <mastercomment2>${escapeXml(prompt.prompt)}</mastercomment2>
        </comments>
      </clipitem>`;
  }).join('\n');

  // Calculate total sequence duration from the last scene's end time
  const lastEndTime = Math.max(...prompts.map(p => p.endTime));
  const totalDurationFrames = Math.round(lastEndTime * framerate);

  // Generate audio track if audio is provided
  const audioTrack = audioUrl ? `          <audio>
            <numOutputChannels>2</numOutputChannels>
            <format>
              <samplecharacteristics>
                <samplerate>48000</samplerate>
                <sampledepth>16</sampledepth>
              </samplecharacteristics>
            </format>
            <track>
              <clipitem id="audio-clip-1">
                <name>Audio</name>
                <enabled>TRUE</enabled>
                <duration>${totalDurationFrames}</duration>
                <rate>
                  <timebase>${framerate}</timebase>
                </rate>
                <start>0</start>
                <end>${totalDurationFrames}</end>
                <in>0</in>
                <out>${totalDurationFrames}</out>
                <file id="audio-file-1">
                  <name>audio.mp3</name>
                  <pathurl>file://localhost/audio.mp3</pathurl>
                  <duration>${totalDurationFrames}</duration>
                  <samplerate>48000</samplerate>
                  <channelcount>2</channelcount>
                </file>
                <sourcetrack>
                  <mediatype>audio</mediatype>
                  <trackindex>1</trackindex>
                </sourcetrack>
              </clipitem>
            </track>
          </audio>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
  <project>
    <name>${escapeXml(projectName)}</name>
    <children>
      <sequence>
        <name>${escapeXml(projectName)} - Timeline</name>
        <duration>${totalDurationFrames}</duration>
        <rate>
          <timebase>${framerate}</timebase>
        </rate>
        <media>
          <video>
            <format>
              <samplecharacteristics>
                <width>${width}</width>
                <height>${height}</height>
                <pixelaspectratio>Square</pixelaspectratio>
                <rate>
                  <timebase>${framerate}</timebase>
                </rate>
              </samplecharacteristics>
            </format>
            <track>
${clipItems}
            </track>
          </video>
${audioTrack}
        </media>
      </sequence>
    </children>
  </project>
</xmeml>`;
}

export function generateEDL(
  prompts: GeneratedPrompt[],
  options: ExportOptions
): string {
  const { projectName, framerate = 25, mode } = options;
  
  let edl = `TITLE: ${projectName}\nFCM: NON-DROP FRAME\n\n`;
  
  prompts.forEach((prompt, index) => {
    const clipNumber = (index + 1).toString().padStart(3, '0');
    const sourceIn = formatTimecode(0, framerate);
    const sourceOut = formatTimecode(prompt.duration, framerate);
    
    // Use actual scene timecodes for timeline positions
    const recordIn = formatTimecode(prompt.startTime, framerate);
    const recordOut = formatTimecode(prompt.endTime, framerate);
    
    const imagePath = mode === "with-images"
      ? `images/clip_${clipNumber}_img.jpg`
      : prompt.imageUrl || "";
    
    edl += `${clipNumber}  AX       V     C        ${sourceIn} ${sourceOut} ${recordIn} ${recordOut}\n`;
    edl += `* FROM CLIP NAME: clip_${clipNumber}_img.jpg\n`;
    edl += `* FROM FILE: ${imagePath}\n`;
    edl += `* SCENE TEXT: ${prompt.text.substring(0, 100)}${prompt.text.length > 100 ? '...' : ''}\n`;
    edl += `* PROMPT: ${prompt.prompt.substring(0, 200)}${prompt.prompt.length > 200 ? '...' : ''}\n`;
    edl += `\n`;
  });
  
  return edl;
}

export function generateCSV(
  prompts: GeneratedPrompt[],
  options: ExportOptions
): string {
  const { mode, framerate = 25 } = options;
  
  let csv = "Scene Number,Timecode In,Timecode Out,Duration (s),Image Path,Scene Text,Image Prompt\n";
  
  prompts.forEach((prompt, index) => {
    const sceneNum = index + 1;
    const timecodeIn = formatTimecode(prompt.startTime, framerate);
    const timecodeOut = formatTimecode(prompt.endTime, framerate);
    const duration = prompt.duration.toFixed(2);
    
    const imagePath = mode === "with-images"
      ? `images/clip_${sceneNum.toString().padStart(3, '0')}_img.jpg`
      : prompt.imageUrl || "";
    
    csv += `${sceneNum},"${timecodeIn}","${timecodeOut}",${duration},"${imagePath}","${escapeCsv(prompt.text)}","${escapeCsv(prompt.prompt)}"\n`;
  });
  
  return csv;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeCsv(text: string): string {
  return text.replace(/"/g, '""');
}

function formatSrtTimecode(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const milliseconds = Math.floor((seconds % 1) * 1000);
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${milliseconds.toString().padStart(3, '0')}`;
}

export function generateSRT(prompts: GeneratedPrompt[]): string {
  let srt = '';
  
  prompts.forEach((prompt, index) => {
    const sequenceNumber = index + 1;
    
    // Use same logic as XML: extend to next scene's start, or use scene end if last
    const startTime = index === 0 ? 0 : prompt.startTime;
    const nextPrompt = prompts[index + 1];
    const endTime = nextPrompt ? nextPrompt.startTime : prompt.endTime;
    
    const startTimecode = formatSrtTimecode(startTime);
    const endTimecode = formatSrtTimecode(endTime);
    
    srt += `${sequenceNumber}\n`;
    srt += `${startTimecode} --> ${endTimecode}\n`;
    srt += `${prompt.text}\n\n`;
  });
  
  return srt;
}

export async function downloadFile(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Helper function to convert PNG to JPEG
async function convertToJpeg(blob: Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }
      
      // Fill white background (JPEG doesn't support transparency)
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      
      canvas.toBlob((jpegBlob) => {
        URL.revokeObjectURL(url);
        if (jpegBlob) {
          resolve(jpegBlob);
        } else {
          reject(new Error('Failed to convert to JPEG'));
        }
      }, 'image/jpeg', 0.95); // 95% quality
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    
    img.src = url;
  });
}

export async function downloadImagesAsZip(
  prompts: GeneratedPrompt[],
  exportContent: string,
  exportFilename: string,
  audioUrl?: string
): Promise<void> {
  // Dynamically import JSZip
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  
  // Add the export file
  zip.file(exportFilename, exportContent);
  
  // Add SRT subtitle file
  const srtContent = generateSRT(prompts);
  const srtFilename = exportFilename.replace(/\.(xml|edl|csv)$/, '.srt');
  zip.file(srtFilename, srtContent);
  
  // Add audio file at root level (for DaVinci Resolve automatic relinking)
  if (audioUrl) {
    try {
      const audioResponse = await fetch(audioUrl);
      const audioBlob = await audioResponse.blob();
      zip.file('audio.mp3', audioBlob);
    } catch (error) {
      console.error('Failed to download audio file:', error);
    }
  }
  
  // Add each image at root level, converting to JPEG (for DaVinci Resolve automatic relinking)
  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    if (prompt.imageUrl) {
      try {
        const response = await fetch(prompt.imageUrl);
        const blob = await response.blob();
        
        // Convert to JPEG for DaVinci Resolve compatibility
        const jpegBlob = await convertToJpeg(blob);
        
        const filename = `clip_${(i + 1).toString().padStart(3, '0')}_img.jpg`;
        zip.file(filename, jpegBlob);
      } catch (error) {
        console.error(`Failed to download image ${i + 1}:`, error);
      }
    }
  }
  
  // Add README with detailed DaVinci Resolve instructions
  const readme = `INSTRUCTIONS DAVINCI RESOLVE
============================

MÉTHODE RECOMMANDÉE (relinking automatique) :

1. Extraire ce ZIP dans un dossier
2. Ouvrir DaVinci Resolve
3. Aller dans le Media Pool (page Media)
4. Glisser-déposer TOUS les fichiers médias (images + audio) dans le Media Pool
5. Aller dans File > Import > Timeline > Import AAF, EDL, XML...
6. Sélectionner le fichier ${exportFilename}
7. IMPORTANT: Dans la boîte de dialogue d'import, DÉCOCHER "Automatically import source clips into media pool"
8. Cliquer sur OK - les clips seront automatiquement liés !

MÉTHODE ALTERNATIVE (si ça ne fonctionne pas) :

1. Importer le XML normalement
2. Quand DaVinci demande les fichiers manquants, cliquer sur "Oui"
3. Naviguer vers le dossier où vous avez extrait le ZIP
4. Sélectionner un fichier - DaVinci trouvera les autres automatiquement

Fichiers inclus:
- ${exportFilename} (timeline)
- ${srtFilename} (sous-titres)
- audio.mp3 (piste audio)
- clip_XXX_img.jpg (images des scènes)
`;
  zip.file('LISEZ-MOI.txt', readme);
  
  // Generate and download ZIP
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(zipBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${exportFilename.replace(/\.[^.]+$/, '')}_with_images.zip`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Video export functionality
interface SubtitleSettings {
  enabled: boolean;
  fontSize: number;
  fontFamily: string;
  color: string;
  backgroundColor: string;
  opacity: number;
  textShadow: string;
  x: number;
  y: number;
}

interface VideoExportOptions {
  scenes: GeneratedPrompt[];
  audioUrl: string;
  subtitleSettings: SubtitleSettings;
  width?: number;
  height?: number;
  framerate?: number;
  onProgress?: (progress: number) => void;
}

export async function exportToVideo({
  scenes,
  audioUrl,
  subtitleSettings,
  width = 1920,
  height = 1080,
  framerate = 25,
  onProgress,
}: VideoExportOptions): Promise<void> {
  // Create canvas for rendering
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  // Load audio
  const audio = new Audio(audioUrl);
  await new Promise((resolve) => {
    audio.addEventListener("loadedmetadata", resolve);
    audio.load();
  });

  const duration = audio.duration;

  // Load all images
  const imageElements = await Promise.all(
    scenes.map((scene) => {
      return new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = scene.imageUrl!;
      });
    })
  );

  // Create MediaRecorder
  const stream = canvas.captureStream(framerate);
  
  // Add audio track from the audio element
  const audioCtx = new AudioContext();
  const audioSource = audioCtx.createMediaElementSource(audio);
  const dest = audioCtx.createMediaStreamDestination();
  audioSource.connect(dest);
  audioSource.connect(audioCtx.destination);
  
  stream.addTrack(dest.stream.getAudioTracks()[0]);

  const chunks: Blob[] = [];
  const mediaRecorder = new MediaRecorder(stream, {
    mimeType: "video/webm;codecs=vp9",
    videoBitsPerSecond: 5000000,
  });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  // Start recording
  mediaRecorder.start();
  audio.play();

  // Render loop
  const frameTime = 1000 / framerate;
  let currentTime = 0;

  const renderFrame = () => {
    currentTime = audio.currentTime;

    // Find current scene
    const currentSceneIndex = scenes.findIndex(
      (s) => currentTime >= s.startTime && currentTime < s.endTime
    );

    if (currentSceneIndex >= 0) {
      const scene = scenes[currentSceneIndex];
      const img = imageElements[currentSceneIndex];

      // Draw image
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, width, height);
      
      // Calculate image dimensions to fit canvas while maintaining aspect ratio
      const imgAspect = img.width / img.height;
      const canvasAspect = width / height;
      
      let drawWidth, drawHeight, offsetX, offsetY;
      
      if (imgAspect > canvasAspect) {
        drawWidth = width;
        drawHeight = width / imgAspect;
        offsetX = 0;
        offsetY = (height - drawHeight) / 2;
      } else {
        drawHeight = height;
        drawWidth = height * imgAspect;
        offsetX = (width - drawWidth) / 2;
        offsetY = 0;
      }
      
      ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

      // Draw subtitles
      if (subtitleSettings.enabled && scene.text) {
        const x = (width * subtitleSettings.x) / 100;
        const y = (height * subtitleSettings.y) / 100;

        ctx.save();
        
        // Set font
        ctx.font = `${subtitleSettings.fontSize}px ${subtitleSettings.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        // Measure text
        const lines = wrapCanvasText(ctx, scene.text, width * 0.9);
        const lineHeight = subtitleSettings.fontSize * 1.2;
        const totalHeight = lines.length * lineHeight;
        const padding = 8;

        // Draw background
        const maxWidth = Math.max(...lines.map(line => ctx.measureText(line).width));
        ctx.globalAlpha = subtitleSettings.opacity;
        ctx.fillStyle = subtitleSettings.backgroundColor;
        ctx.fillRect(
          x - maxWidth / 2 - padding,
          y - totalHeight / 2 - padding,
          maxWidth + padding * 2,
          totalHeight + padding * 2
        );

        // Draw text with shadow
        ctx.globalAlpha = 1;
        ctx.shadowColor = "rgba(0,0,0,0.8)";
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;
        ctx.fillStyle = subtitleSettings.color;

        lines.forEach((line, i) => {
          ctx.fillText(
            line,
            x,
            y - totalHeight / 2 + i * lineHeight + lineHeight / 2
          );
        });

        ctx.restore();
      }
    }

    // Update progress
    if (onProgress) {
      onProgress((currentTime / duration) * 100);
    }

    // Continue rendering
    if (currentTime < duration && !audio.paused) {
      setTimeout(renderFrame, frameTime);
    } else {
      // Stop recording
      mediaRecorder.stop();
      audio.pause();
      audio.currentTime = 0;
    }
  };

  // Wait for recording to finish
  await new Promise<void>((resolve) => {
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `video-export-${Date.now()}.webm`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      resolve();
    };

    // Start rendering
    renderFrame();
  });
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine + (currentLine ? " " : "") + word;
    const metrics = ctx.measureText(testLine);

    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}
