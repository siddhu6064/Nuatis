import { GoogleGenAI } from '@google/genai'

/**
 * Transcribe a phone call recording using Gemini 2.0 Flash.
 * Downloads the MP3 from the URL, sends to Gemini for transcription.
 * Returns plain text transcript with speaker labels.
 */
export async function transcribeRecording(
  recordingUrl: string,
  _languageCode?: string
): Promise<string> {
  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) {
    console.warn('[transcription] GEMINI_API_KEY not set — skipping')
    return ''
  }

  try {
    // Download the recording
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)
    const audioRes = await fetch(recordingUrl, { signal: controller.signal })
    clearTimeout(timeout)

    if (!audioRes.ok) {
      console.error(`[transcription] failed to download recording: ${audioRes.status}`)
      return ''
    }

    const audioBuffer = Buffer.from(await audioRes.arrayBuffer())
    const base64Audio = audioBuffer.toString('base64')

    // Send to Gemini for transcription
    const client = new GoogleGenAI({ apiKey })

    const result = await client.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'audio/mpeg',
                data: base64Audio,
              },
            },
            {
              text: 'Transcribe this phone call audio. Include speaker labels (Caller and Maya). Return the transcript as plain text with speaker labels on each line. Format: "Speaker: text"',
            },
          ],
        },
      ],
    })

    const transcript = result.text ?? ''
    const wordCount = transcript.split(/\s+/).length

    console.info(`[transcription] transcribed ${wordCount} words for recording`)
    return transcript
  } catch (err) {
    console.error('[transcription] error:', err)
    return ''
  }
}
