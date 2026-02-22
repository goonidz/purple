import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { geminiKey, prompt, imageUrls, modelName, aspectRatio, imageSize } = await req.json();

    if (!geminiKey || !prompt) {
      return new Response(JSON.stringify({ error: 'Missing geminiKey or prompt' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const parts: any[] = [{ text: prompt }];
    for (const url of (imageUrls || [])) {
      const imgRes = await fetch(url);
      if (!imgRes.ok) {
        console.error(`Failed to fetch image ${url}: ${imgRes.status}`);
        continue;
      }
      const buf = new Uint8Array(await imgRes.arrayBuffer());
      // Encode in chunks to avoid stack overflow on large images
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < buf.length; i += chunkSize) {
        const chunk = buf.subarray(i, Math.min(i + chunkSize, buf.length));
        binary += String.fromCharCode(...chunk);
      }
      const base64 = btoa(binary);
      parts.push({ inline_data: { mime_type: 'image/jpeg', data: base64 } });
    }

    const model = modelName || 'gemini-3-pro-image-preview';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const geminiRes = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': geminiKey,
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: {
            aspectRatio: aspectRatio || '16:9',
            ...(imageSize ? { imageSize } : {}),
          },
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
        ],
      }),
    });

    const geminiData = await geminiRes.json();

    const blockReason = geminiData.promptFeedback?.blockReason;
    if (blockReason) {
      return new Response(JSON.stringify({ error: `Gemini blocked: ${blockReason}`, blockReason }), {
        status: 422,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const candidate = geminiData.candidates?.[0];
    if (!candidate?.content?.parts) {
      return new Response(JSON.stringify({
        error: 'Gemini returned no content',
        finishReason: candidate?.finishReason,
        response: JSON.stringify(geminiData).substring(0, 500),
      }), {
        status: 422,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const imagePart = candidate.content.parts.find((p: any) => p.inline_data?.data || p.inlineData?.data);
    if (!imagePart) {
      const textParts = candidate.content.parts.filter((p: any) => p.text).map((p: any) => p.text).join(' ');
      return new Response(JSON.stringify({ error: 'No image in response', text: textParts.substring(0, 300) }), {
        status: 422,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const imageBase64 = imagePart.inline_data?.data || imagePart.inlineData?.data;
    const mimeType = imagePart.inline_data?.mime_type || imagePart.inlineData?.mimeType || 'image/png';

    return new Response(JSON.stringify({ imageBase64, mimeType }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('gemini-image-proxy error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
