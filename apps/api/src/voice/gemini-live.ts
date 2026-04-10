import { GoogleGenAI, Modality, type Blob as GBlob } from '@google/genai'
import { VERTICALS } from '@nuatis/shared'

const DEFAULT_MAYA_PROMPT =
  'You are Maya, a warm and professional AI receptionist. You speak naturally and concisely. Do not narrate your actions or thinking. When you receive the signal [call connected], immediately say this greeting word for word: "Hello! Thank you for calling. This is Maya. How can I help you today?" After the greeting, stop and wait silently for the caller to speak. Do not say anything else until the caller responds. When asked to book an appointment, collect name, date, time, and reason. Say goodbye warmly when the caller ends the call. Speak English by default. If the caller speaks in another language such as Hindi or Telugu, switch to that language naturally and continue in it for the rest of the call.'

const FAREWELL_PHRASES = [
  'bye',
  'goodbye',
  'have a great day',
  'have a good day',
  'thank you, bye',
  'thanks, bye',
  'talk to you soon',
  'take care',
  // Telugu
  'సెలవు',
  'బై',
  'ధన్యవాదాలు',
  'వీడ్కోలు',
  // Hindi
  'अलविदा',
  'बाय',
  'धन्यवाद',
  'नमस्ते',
  // Spanish
  'adiós',
  'adios',
  'hasta luego',
  'hasta pronto',
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
  onTurnComplete(cb: () => void): void
  onSetupComplete(cb: () => void): void
  sendGreeting(text: string): void
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
  let turnCompleteCallback: (() => void) | null = null
  let setupCompleteCallback: (() => void) | null = null
  let closeCallback: ((code: number) => void) | null = null
  const pendingAudio: Buffer[] = []

  // Farewell / silence-fallback state
  let turnTextAccum = ''
  let silenceTimer: ReturnType<typeof setTimeout> | null = null
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let lastAudioTime = Date.now()
  let lastGeminiAudioTime: number = Date.now()
  let firstInboundLogged = false
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
      const elapsed = Date.now() - lastGeminiAudioTime
      console.info(`[gemini-live] silence check — elapsed=${elapsed}ms hungUp=${hungUp}`)
      if (elapsed >= 3000) {
        triggerHangup('3s silence after turnComplete')
      }
    }, 3000)
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
          console.info('[gemini-live] setupComplete received')
          if (setupCompleteCallback) setupCompleteCallback()
        }

        const parts = msg.serverContent?.modelTurn?.parts ?? []
        for (const part of parts) {
          if (part.inlineData?.data) {
            const decoded = Buffer.from(part.inlineData.data, 'base64')
            lastGeminiAudioTime = Date.now()
            console.info(
              `[gemini-live] audio part decoded: ${decoded.length}b mime=${part.inlineData.mimeType ?? 'unknown'}`
            )
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
          if (turnCompleteCallback) turnCompleteCallback()
          const text = turnTextAccum.trim()
          console.info(`[gemini-live] turnComplete — accumulated text: "${text}"`)
          if (text && containsFarewell(text)) {
            triggerHangup(`farewell detected in: "${text}"`)
          } else {
            console.info('[gemini-live] turnComplete — arming silence fallback')
            if (hungUp) return
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
      if (hungUp) return
      lastAudioTime = Date.now()
      if (!firstInboundLogged) {
        firstInboundLogged = true
        console.info('[gemini-live] first inbound audio — lastAudioTime reset')
      }
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

    onTurnComplete(cb: () => void): void {
      turnCompleteCallback = cb
    },

    onSetupComplete(cb: () => void): void {
      setupCompleteCallback = cb
    },

    sendGreeting(text: string): void {
      console.info('[gemini-live] sending greeting')
      session.sendClientContent({
        turns: [{ role: 'user', parts: [{ text }] }],
        turnComplete: true,
      })
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
