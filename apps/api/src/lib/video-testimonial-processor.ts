import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

export async function generateTranscriptAndSentiment(testimonialId: string): Promise<void> {
  const supabase = getSupabase()

  try {
    // 1. Fetch testimonial to get storage_path
    const { data: testimonial, error } = await supabase
      .from('video_testimonials')
      .select('id, storage_path, tenant_id')
      .eq('id', testimonialId)
      .single()

    if (error || !testimonial) {
      console.warn(`[video-processor] testimonial not found: ${testimonialId}`)
      return
    }

    // 2. Download video from Supabase Storage
    const { data: fileData, error: downloadErr } = await supabase.storage
      .from('video-testimonials')
      .download(testimonial.storage_path)

    if (downloadErr || !fileData) {
      console.warn(`[video-processor] failed to download: ${testimonial.storage_path}`)
      return
    }

    // 3. Convert to base64
    const arrayBuffer = await fileData.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')

    // 4. Determine MIME type from storage_path
    const mimeType = testimonial.storage_path.endsWith('.mp4') ? 'video/mp4' : 'video/webm'

    // 5. Send to Gemini
    const apiKey = process.env['GEMINI_API_KEY']
    if (!apiKey) {
      console.warn('[video-processor] GEMINI_API_KEY not set')
      return
    }

    const genai = new GoogleGenAI({ apiKey })
    const response = await genai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64,
              },
            },
            {
              text: 'Transcribe this video. Then classify sentiment as positive, neutral, or negative. Return JSON only: { "transcript": string, "sentiment": "positive"|"neutral"|"negative" }',
            },
          ],
        },
      ],
    })

    const rawText = response.text ?? ''

    // 6. Parse JSON from response
    let transcript: string | null = null
    let sentiment: 'positive' | 'neutral' | 'negative' | null = null

    try {
      // Strip markdown code fences if present
      const cleaned = rawText
        .replace(/^```json\n?/, '')
        .replace(/\n?```$/, '')
        .trim()
      const parsed = JSON.parse(cleaned) as { transcript?: string; sentiment?: string }
      transcript = typeof parsed.transcript === 'string' ? parsed.transcript : null
      const raw = parsed.sentiment
      if (raw === 'positive' || raw === 'neutral' || raw === 'negative') {
        sentiment = raw
      }
    } catch {
      console.warn('[video-processor] failed to parse Gemini response:', rawText.slice(0, 200))
    }

    // 7. UPDATE video_testimonials
    await supabase
      .from('video_testimonials')
      .update({ transcript, sentiment })
      .eq('id', testimonialId)

    console.info(
      `[video-processor] done testimonialId=${testimonialId} sentiment=${sentiment ?? 'unknown'}`
    )
  } catch (err) {
    console.error(`[video-processor] error processing testimonialId=${testimonialId}:`, err)
    // Don't throw — this is a fire-and-forget background job
  }
}
