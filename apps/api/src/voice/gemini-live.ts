import {
  GoogleGenAI,
  Modality,
  StartSensitivity,
  EndSensitivity,
  ActivityHandling,
  type Blob as GBlob,
} from '@google/genai'
import { VERTICALS } from '@nuatis/shared'
import { FUNCTION_DECLARATIONS, executeToolCall, type ToolCallContext } from './tool-handlers.js'
import { Sentry } from '../lib/sentry.js'
import { getAllKnowledgeEntries } from '../services/embeddings.js'

const DEFAULT_MAYA_PROMPT =
  'You are Maya, a warm and professional AI receptionist. When you receive [call connected], say: "Hello! Thank you for calling. How can I help you today?" Keep all responses to 1-2 sentences maximum. Never ask more than one question at a time. Stop speaking immediately if the caller interrupts you. Wait for the caller to finish before responding. When the caller says goodbye or bye, say a brief farewell and stop talking. LANGUAGE: Always respond in the language the caller is currently speaking. If the caller switches languages mid-conversation, immediately switch to match them. You support English, Spanish, Hindi, and Telugu. Never announce that you are switching languages — just switch naturally. BUSINESS HOURS: You know this business\'s operating hours. When a caller asks to book outside business hours, politely let them know the business is closed at that time and suggest the nearest available time during business hours. If someone calls outside business hours, acknowledge that the office is currently closed but offer to help with booking for the next business day. Always use the get_business_hours tool to confirm hours before telling the caller. ESCALATION: If the caller asks to speak with a human, if you cannot answer their question, or if the caller seems frustrated, use the escalate_to_human tool to transfer the call. Before transferring, say something like "Let me connect you with someone who can help." Never refuse to transfer if the caller asks for a person.'

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

export function containsFarewell(text: string): boolean {
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
  tenantId: string,
  vertical: string,
  businessName?: string,
  callControlId?: string,
  product?: 'maya_only' | 'suite',
  promptSuffix?: string
): Promise<GeminiLiveSession> {
  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set')
  }

  const template = VERTICALS[vertical]?.system_prompt_template ?? DEFAULT_MAYA_PROMPT
  let systemPrompt = template.replace(/\{\{business_name\}\}/g, businessName ?? 'our office')

  // ── Inject knowledge base entries into system prompt (2s timeout) ────────
  try {
    const knowledgeEntries = await Promise.race([
      getAllKnowledgeEntries(tenantId),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
    ])

    if (knowledgeEntries.length > 0) {
      // Group entries by category
      const grouped = new Map<string, Array<{ title: string; content: string }>>()
      for (const entry of knowledgeEntries) {
        const cat = entry.category || 'general'
        if (!grouped.has(cat)) grouped.set(cat, [])
        grouped.get(cat)!.push({ title: entry.title, content: entry.content })
      }

      let section =
        '\n\nKNOWLEDGE BASE — Use the following information to answer caller questions about this business:\n'
      for (const [category, entries] of grouped) {
        section += `\n[${category.charAt(0).toUpperCase() + category.slice(1)}]\n`
        for (const e of entries) {
          section += `- ${e.title}: ${e.content}\n`
        }
      }

      systemPrompt += section
      console.info(
        `[gemini-live] injected ${knowledgeEntries.length} knowledge entries into system prompt for tenant=${tenantId}`
      )
    }
  } catch (err) {
    // Knowledge injection is best-effort — never delay call pickup
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[gemini-live] knowledge injection skipped: ${msg}`)
  }

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
  let firstInboundLogged = false
  let hungUp = false
  let greetingDone = false

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

  const toolContext: ToolCallContext = {
    tenantId,
    vertical,
    callerId: '',
    streamId: '',
    callControlId: callControlId ?? '',
    product: product ?? 'suite',
  }

  function armSilenceFallback(): void {
    if (silenceTimer) clearTimeout(silenceTimer)
    silenceTimer = setTimeout(() => {
      console.info('[gemini-live] silence fallback fired — hanging up')
      triggerHangup('15s silence after turnComplete')
    }, 15000)
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
      realtimeInputConfig: {
        automaticActivityDetection: {
          disabled: false,
          startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
          endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
          prefixPaddingMs: 20,
          silenceDurationMs: 500,
        },
        activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
      },
      systemInstruction: {
        parts: [{ text: systemPrompt + (promptSuffix ?? '') }],
      },
      tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
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
            interrupted?: boolean
          }
          turnComplete?: boolean
          setupComplete?: unknown
          toolCall?: {
            functionCalls?: Array<{
              id?: string
              name?: string
              args?: Record<string, unknown>
            }>
          }
          toolCallCancellation?: { ids?: string[] }
        }

        if (msg.serverContent?.interrupted) {
          console.info('[gemini-live] Maya interrupted by caller')
          if (silenceTimer) {
            clearTimeout(silenceTimer)
            silenceTimer = null
          }
        }

        const isTurnComplete = !!(msg.turnComplete ?? msg.serverContent?.turnComplete)

        console.info(
          `[gemini-live] message keys=${Object.keys(msg).join(',')}, turnComplete=${isTurnComplete}`
        )

        if (msg.setupComplete !== undefined) {
          console.info('[gemini-live] setupComplete received')
          if (setupCompleteCallback) setupCompleteCallback()
        }

        if (msg.toolCallCancellation) {
          console.info(
            `[gemini-live] toolCallCancellation: ${JSON.stringify(msg.toolCallCancellation)}`
          )
        }

        if (msg.toolCall?.functionCalls) {
          console.info(
            `[gemini-live] toolCall received: ${JSON.stringify(msg.toolCall.functionCalls)}`
          )
          for (const fc of msg.toolCall.functionCalls) {
            void (async () => {
              const result = await executeToolCall(fc.name ?? 'unknown', fc.args ?? {}, toolContext)
              session.sendToolResponse({
                functionResponses: [{ id: fc.id, name: fc.name, response: result }],
              })
              console.info(`[gemini-live] toolResponse sent for ${fc.name}`)
            })()
          }
        }

        const parts = msg.serverContent?.modelTurn?.parts ?? []
        for (const part of parts) {
          if (part.inlineData?.data) {
            const decoded = Buffer.from(part.inlineData.data, 'base64')
            if (greetingDone && silenceTimer) {
              clearTimeout(silenceTimer)
              silenceTimer = null
            }
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
          } else if (!greetingDone) {
            greetingDone = true
            console.info('[gemini-live] greeting turn complete — not arming silence fallback')
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
        if (e instanceof Error) Sentry.captureException(e)
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
      if (greetingDone && silenceTimer) {
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
