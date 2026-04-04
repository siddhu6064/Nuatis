import { GoogleGenAI, Modality, type Blob as GBlob } from '@google/genai'
import { VERTICALS } from '@nuatis/shared'

const DEFAULT_MAYA_PROMPT =
  'You are Maya, a friendly AI receptionist. You help callers book appointments, answer questions about the business, and transfer to a human when needed. Be warm, professional, and concise. When the call connects, immediately introduce yourself without waiting for the caller to speak first.'

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
  const systemPrompt =
    template.replace(/\{\{business_name\}\}/g, businessName ?? 'Nuatis') +
    ' When the call connects, immediately introduce yourself without waiting for the caller to speak first.'

  const client = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha' } })

  let audioCallback: ((chunk: Buffer) => void) | null = null
  const pendingAudio: Buffer[] = []

  const session = await client.live.connect({
    model: 'gemini-2.5-flash-native-audio-latest',
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
    },
    callbacks: {
      onopen: () => {
        console.info('[gemini-live] session opened')
      },
      onmessage: (e) => {
        const msg = e as {
          serverContent?: {
            modelTurn?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> }
            turnComplete?: boolean
          }
          setupComplete?: unknown
          toolCall?: unknown
        }
        console.info(
          `[gemini-live] message keys=${Object.keys(msg).join(',')}, turnComplete=${msg.serverContent?.turnComplete}`
        )
        if (msg.setupComplete !== undefined) {
          console.info('[gemini-live] setupComplete received — sending greeting')
          session.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: 'Greet the caller now.' }] }],
            turnComplete: true,
          })
        }
        const parts = msg.serverContent?.modelTurn?.parts ?? []
        for (const part of parts) {
          if (part.inlineData?.data) {
            const decoded = Buffer.from(part.inlineData.data, 'base64')
            console.info(`[gemini-live] audio part decoded: ${decoded.length}b`)
            if (audioCallback) {
              audioCallback(decoded)
            } else {
              pendingAudio.push(decoded)
            }
          }
        }
      },
      onerror: (e) => {
        console.error('[gemini-live] WebSocket error:', e)
      },
      onclose: (e) => {
        console.info('[gemini-live] session closed', e)
      },
    },
  })

  // Gemini Live will respond when it receives audio input

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
      for (const chunk of pendingAudio) cb(chunk)
      pendingAudio.length = 0
    },

    sendText(text: string): void {
      session.sendRealtimeInput({ text })
    },

    close(): void {
      session.close()
    },
  }
}
