import { GoogleGenAI, Modality, type Blob as GBlob } from '@google/genai'
import { VERTICALS } from '@nuatis/shared'

const DEFAULT_MAYA_PROMPT =
  'You are Maya, a friendly bilingual AI receptionist. You speak English and Spanish fluently. Always respond in the same language the caller uses. You help callers book appointments, answer questions about the business, and transfer to a human when needed. Be warm, professional, and concise.'

export interface GeminiLiveSession {
  send(audioChunk: Buffer): void
  onAudio(cb: (chunk: Buffer) => void): void
  sendText(text: string): void
  close(): void
}

export async function createGeminiLiveSession(
  _tenantId: string,
  vertical: string,
  businessName?: string
): Promise<GeminiLiveSession> {
  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set')
  }

  const template = VERTICALS[vertical]?.system_prompt_template ?? DEFAULT_MAYA_PROMPT
  const systemPrompt = template.replace(/\{\{business_name\}\}/g, businessName ?? 'this business')

  const client = new GoogleGenAI({ apiKey })

  let audioCallback: ((chunk: Buffer) => void) | null = null

  const session = await client.live.connect({
    model: 'gemini-3.1-flash-live-preview',
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
    },
    callbacks: {
      onopen: () => {
        // connection established
      },
      onmessage: (e) => {
        const msg = e as {
          serverContent?: {
            modelTurn?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> }
          }
        }
        const parts = msg.serverContent?.modelTurn?.parts ?? []
        for (const part of parts) {
          if (part.inlineData?.data) {
            const decoded = Buffer.from(part.inlineData.data, 'base64')
            audioCallback?.(decoded)
          }
        }
      },
      onerror: (e) => {
        console.error('[gemini-live] WebSocket error:', e)
      },
      onclose: () => {
        // connection closed
      },
    },
  })

  return {
    send(audioChunk: Buffer): void {
      const blob: GBlob = {
        data: audioChunk.toString('base64'),
        mimeType: 'audio/pcm;rate=16000',
      }
      session.sendRealtimeInput({ audio: blob })
    },

    onAudio(cb: (chunk: Buffer) => void): void {
      audioCallback = cb
    },

    sendText(text: string): void {
      session.sendRealtimeInput({ text })
    },

    close(): void {
      session.close()
    },
  }
}
