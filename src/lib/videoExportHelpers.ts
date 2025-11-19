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
}

export function formatTimecode(seconds: number, framerate: number = 25): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const frames = Math.floor((seconds % 1) * framerate);
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
}

export function generatePremiereXML(
  prompts: GeneratedPrompt[],
  options: ExportOptions
): string {
  const { projectName, framerate = 25, width = 1920, height = 1080, mode } = options;
  
  // Calculate sequential timeline positions (no gaps)
  let timelinePosition = 0;
  
  const clipItems = prompts.map((prompt, index) => {
    // Calculate duration based on original timecodes
    const originalStartFrame = Math.floor(prompt.startTime * framerate);
    const originalEndFrame = Math.floor(prompt.endTime * framerate);
    const duration = originalEndFrame - originalStartFrame;
    
    // Use sequential timeline position
    const startFrame = timelinePosition;
    const endFrame = timelinePosition + duration;
    
    // Update position for next clip
    timelinePosition = endFrame;
    
    const imagePath = mode === "with-images" 
      ? `images/clip_${(index + 1).toString().padStart(3, '0')}_img.jpg`
      : prompt.imageUrl || "";
    
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
        <file id="file-${index + 1}">
          <name>clip_${(index + 1).toString().padStart(3, '0')}_img.jpg</name>
          <pathurl>${imagePath}</pathurl>
          <duration>${duration}</duration>
          <width>${width}</width>
          <height>${height}</height>
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

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
  <project>
    <name>${escapeXml(projectName)}</name>
    <children>
      <sequence>
        <name>${escapeXml(projectName)} - Timeline</name>
        <duration>${timelinePosition}</duration>
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
  
  // Calculate sequential timeline positions (no gaps)
  let timelinePosition = 0;
  
  prompts.forEach((prompt, index) => {
    const clipNumber = (index + 1).toString().padStart(3, '0');
    const sourceIn = formatTimecode(0, framerate);
    const sourceOut = formatTimecode(prompt.duration, framerate);
    
    // Use sequential timeline positions instead of original timecodes
    const recordIn = formatTimecode(timelinePosition, framerate);
    timelinePosition += prompt.duration;
    const recordOut = formatTimecode(timelinePosition, framerate);
    
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
  const { mode } = options;
  
  let csv = "Scene Number,Timecode In,Timecode Out,Duration (s),Image Path,Scene Text,Image Prompt\n";
  
  prompts.forEach((prompt, index) => {
    const sceneNum = index + 1;
    const timecodeIn = formatTimecode(prompt.startTime);
    const timecodeOut = formatTimecode(prompt.endTime);
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
  exportFilename: string
): Promise<void> {
  // Dynamically import JSZip
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  
  // Add the export file
  zip.file(exportFilename, exportContent);
  
  // Create images folder
  const imagesFolder = zip.folder('images');
  
  // Download and add each image, converting to JPEG
  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    if (prompt.imageUrl) {
      try {
        const response = await fetch(prompt.imageUrl);
        const blob = await response.blob();
        
        // Convert to JPEG for DaVinci Resolve compatibility
        const jpegBlob = await convertToJpeg(blob);
        
        const filename = `clip_${(i + 1).toString().padStart(3, '0')}_img.jpg`;
        imagesFolder?.file(filename, jpegBlob);
      } catch (error) {
        console.error(`Failed to download image ${i + 1}:`, error);
      }
    }
  }
  
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
