import { GoogleGenAI, Modality, type Blob as GBlob } from '@google/genai'
import { VERTICALS } from '@nuatis/shared'

const DEFAULT_MAYA_PROMPT =
  "You are Maya, an AI receptionist. Answer calls immediately with a warm greeting. Be concise and natural. Do not narrate your actions or thinking. When the call connects, say hello right away. Detect the caller's language and respond in it. Book appointments when asked. Say goodbye warmly when the caller ends the call."

const FAREWELL_PHRASES = [
  'bye',
  'goodbye',
  'have a great day',
  'have a good day',
  'thank you, bye',
  'thanks, bye',
  'talk to you soon',
  'take care',
]

function containsFarewell(text: string): boolean {
  const lower = text.toLowerCase()
  return FAREWELL_PHRASES.some((phrase) => lower.includes(phrase))
}

async function hangupCall(callControlId: string): Promise<void> {
  const apiKey = process.env['TELNYX_API_KEY']
  if (!apiKey) {
    console.error('[gemini-live] TELNYX_API_KEY not set — cannot hang up')
    return
  }
  const url = `https://api.telnyx.com/v2/calls/${callControlId}/actions/hangup`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    })
    if (res.ok) {
      console.info(`[gemini-live] Hangup sent for call_control_id=${callControlId}`)
    } else {
      const body = await res.text()
      console.error(`[gemini-live] Hangup failed (${res.status}): ${body}`)
    }
  } catch (err) {
    console.error('[gemini-live] Hangup request threw:', err)
  }
}

export interface GeminiLiveSession {
  send(audioChunk: Buffer): void
  onAudio(cb: (chunk: Buffer) => void): void
  sendText(text: string): void
  close(): void
  onClose(cb: (code: number) => void): void
}

export async function createGeminiLiveSession(
  _tenantId: string,
  vertical: string,
  businessName?: string,
  callControlId?: string
): Promise<GeminiLiveSession> {
  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set')
  }

  const template = VERTICALS[vertical]?.system_prompt_template ?? DEFAULT_MAYA_PROMPT
  const systemPrompt = template.replace(/\{\{business_name\}\}/g, businessName ?? 'Nuatis')

  const client = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha' } })

  let audioCallback: ((chunk: Buffer) => void) | null = null
  let closeCallback: ((code: number) => void) | null = null
  const pendingAudio: Buffer[] = []

  // Farewell / silence-fallback state
  let turnTextAccum = ''
  let silenceTimer: ReturnType<typeof setTimeout> | null = null
  let lastAudioTime = Date.now()
  let hungUp = false

  function triggerHangup(reason: string): void {
    if (hungUp) return
    hungUp = true
    if (silenceTimer) {
      clearTimeout(silenceTimer)
      silenceTimer = null
    }
    console.info(`[gemini-live] Hanging up — reason: ${reason}`)
    if (callControlId) {
      hangupCall(callControlId).catch(() => undefined)
    } else {
      console.warn('[gemini-live] No callControlId — cannot hang up via API')
    }
  }

  function armSilenceFallback(): void {
    if (silenceTimer) clearTimeout(silenceTimer)
    silenceTimer = setTimeout(() => {
      const elapsed = Date.now() - lastAudioTime
      if (elapsed >= 5000) {
        triggerHangup('5s silence after turnComplete')
      }
    }, 5000)
  }

  const session = await client.live.connect({
    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Erinome' } },
      },
      thinkingConfig: {
        thinkingBudget: 0,
      },
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
            modelTurn?: {
              parts?: Array<{
                inlineData?: { data?: string; mimeType?: string }
                text?: string
              }>
            }
            turnComplete?: boolean
          }
          turnComplete?: boolean
          setupComplete?: unknown
          toolCall?: unknown
        }

        const isTurnComplete = !!(msg.turnComplete ?? msg.serverContent?.turnComplete)

        console.info(
          `[gemini-live] message keys=${Object.keys(msg).join(',')}, turnComplete=${isTurnComplete}`
        )

        if (msg.setupComplete !== undefined) {
          console.info('[gemini-live] setupComplete received — sending greeting')
          session.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: 'Hello!' }] }],
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
          if (part.text) {
            turnTextAccum += part.text
          }
        }

        if (isTurnComplete) {
          const text = turnTextAccum.trim()
          console.info(`[gemini-live] turnComplete — accumulated text: "${text}"`)
          if (text && containsFarewell(text)) {
            triggerHangup(`farewell detected in: "${text}"`)
          } else {
            armSilenceFallback()
          }
          turnTextAccum = ''
        }
      },
      onerror: (e) => {
        console.error('[gemini-live] WebSocket error:', e)
      },
      onclose: (e) => {
        const closeEvent = e as { code?: number }
        const code = closeEvent.code ?? 1000
        console.info(`[gemini-live] session closed code=${code}`)
        if (silenceTimer) {
          clearTimeout(silenceTimer)
          silenceTimer = null
        }
        if (closeCallback) closeCallback(code)
      },
    },
  })

  // Gemini Live will respond when it receives audio input

  return {
    send(audioChunk: Buffer): void {
      lastAudioTime = Date.now()
      // Reset silence fallback timer whenever inbound audio arrives
      if (silenceTimer) {
        clearTimeout(silenceTimer)
        silenceTimer = null
      }
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

    onClose(cb: (code: number) => void): void {
      closeCallback = cb
    },

    close(): void {
      if (silenceTimer) {
        clearTimeout(silenceTimer)
        silenceTimer = null
      }
      session.close()
    },
  }
}
