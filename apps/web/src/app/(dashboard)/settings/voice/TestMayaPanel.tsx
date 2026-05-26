'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

type PanelState = 'idle' | 'connecting' | 'active' | 'error'

interface Turn {
  role: 'maya' | 'user'
  text: string
}

// API base URL — used to derive the WebSocket proxy URL.
// The server-side proxy at /api/voice/live injects the Gemini API key so
// it never needs to be present in the browser bundle.
const API_BASE = (process.env['NEXT_PUBLIC_API_URL'] ?? '')
  .replace(/^http:/, 'ws:')
  .replace(/^https:/, 'wss:')

function float32ToInt16(buf: Float32Array): Int16Array {
  const out = new Int16Array(buf.length)
  for (let i = 0; i < buf.length; i++) {
    const s = Math.max(-1, Math.min(1, buf[i]!))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

function int16ToFloat32(buf: ArrayBuffer): Float32Array {
  const int16 = new Int16Array(buf)
  const out = new Float32Array(int16.length)
  for (let i = 0; i < int16.length; i++) {
    out[i] = (int16[i] ?? 0) / 0x8000
  }
  return out
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

export default function TestMayaPanel() {
  const [state, setState] = useState<PanelState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<Turn[]>([])
  const [mayaTalking, setMayaTalking] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const captureCtxRef = useRef<AudioContext | null>(null)
  // AudioWorkletNode replaces the deprecated ScriptProcessorNode.
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
  const captureSinkRef = useRef<GainNode | null>(null)
  const sentChunkCountRef = useRef<number>(0)
  const playCtxRef = useRef<AudioContext | null>(null)
  const nextPlayTimeRef = useRef<number>(0)
  const transcriptEndRef = useRef<HTMLDivElement | null>(null)
  const startTimeRef = useRef<number>(0)
  const currentMayaTextRef = useRef<string>('')
  const mayaTalkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const userSpeakingRef = useRef<boolean>(false)
  const mayaRespondingRef = useRef<boolean>(false)

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcript])

  function stopMayaTalkingTimer() {
    if (mayaTalkingTimerRef.current) {
      clearTimeout(mayaTalkingTimerRef.current)
      mayaTalkingTimerRef.current = null
    }
  }

  const cleanup = useCallback(() => {
    stopMayaTalkingTimer()
    if (workletNodeRef.current) {
      workletNodeRef.current.port.onmessage = null
      workletNodeRef.current.disconnect()
      workletNodeRef.current = null
    }
    if (captureSinkRef.current) {
      captureSinkRef.current.disconnect()
      captureSinkRef.current = null
    }
    if (captureCtxRef.current) {
      captureCtxRef.current.close().catch(() => undefined)
      captureCtxRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    if (playCtxRef.current) {
      playCtxRef.current.close().catch(() => undefined)
      playCtxRef.current = null
    }
    sentChunkCountRef.current = 0
    setMayaTalking(false)
  }, [])

  async function scheduleAudio(pcm16Data: string): Promise<void> {
    try {
      const ctx = playCtxRef.current
      if (!ctx) {
        console.warn('[test-maya] dropped Gemini audio chunk — playback context not ready')
        return
      }

      // 1. base64 -> Uint8Array -> ArrayBuffer
      const raw = base64ToArrayBuffer(pcm16Data)
      console.info(
        `[test-maya] audio chunk bytes: ${pcm16Data.length} (b64) -> ${raw.byteLength} (bin)`
      )

      // Int16Array requires an even byteLength. Gemini 24 kHz PCM
      // frames are always even, but defend anyway so a bad chunk
      // can't blow up the playback pipeline.
      if (raw.byteLength % 2 !== 0) {
        console.warn(
          `[test-maya] dropped audio chunk — odd byteLength ${raw.byteLength}, expected multiple of 2`
        )
        return
      }

      // 2. Int16Array -> Float32Array (sample / 32768)
      const float32 = int16ToFloat32(raw)
      if (float32.length === 0) {
        console.warn('[test-maya] dropped audio chunk — empty after decode')
        return
      }

      // 3. AudioBuffer at 24 kHz, 1 channel (Gemini output rate)
      const buf = ctx.createBuffer(1, float32.length, 24000)
      buf.copyToChannel(float32 as Float32Array<ArrayBuffer>, 0)
      console.info(
        `[test-maya] buffer duration: ${buf.duration.toFixed(3)}s sampleRate: ${buf.sampleRate}`
      )

      // 4. Source + connect + (re-)resume the context. Some browsers
      //    auto-suspend an AudioContext that's been silent for a few
      //    seconds; resume() before start() is the safe pattern.
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(ctx.destination)

      if (ctx.state === 'suspended') {
        try {
          await ctx.resume()
        } catch (err) {
          console.warn('[test-maya] resume() before start() failed:', err)
        }
      }

      // 5. Schedule on the playback clock so chunks stitch together
      //    seamlessly even if they arrive faster than realtime.
      const now = ctx.currentTime
      const startAt = Math.max(now, nextPlayTimeRef.current)
      src.start(startAt)
      nextPlayTimeRef.current = startAt + buf.duration

      console.info(
        `[test-maya] scheduled ${buf.duration.toFixed(2)}s of Gemini audio at t=${startAt.toFixed(3)} (ctx.state=${ctx.state})`
      )

      setMayaTalking(true)
      stopMayaTalkingTimer()
      mayaTalkingTimerRef.current = setTimeout(
        () => setMayaTalking(false),
        (buf.duration + 0.3) * 1000
      )
    } catch (err) {
      console.error('[test-maya] audio playback error:', err)
    }
  }

  function handleServerMessage(raw: string) {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(raw) as Record<string, unknown>
    } catch {
      console.warn('[test-maya] received non-JSON WS frame, ignoring')
      return
    }

    console.info('[test-maya] WS message received:', Object.keys(msg).join(','))

    // Tool calls — respond with mock success so Maya continues naturally
    const toolCall = msg['toolCall'] as
      | { functionCalls?: Array<{ id?: string; name?: string }> }
      | undefined
    if (toolCall?.functionCalls?.length) {
      const responses = toolCall.functionCalls.map((fc) => ({
        id: fc.id ?? '',
        name: fc.name ?? '',
        response: { result: 'success', message: 'Simulated in test mode.' },
      }))
      wsRef.current?.send(JSON.stringify({ toolResponse: { functionResponses: responses } }))
      // end_call / escalate_to_human → close gracefully
      const names = toolCall.functionCalls.map((fc) => fc.name ?? '')
      if (names.includes('end_call') || names.includes('escalate_to_human')) {
        setTimeout(() => endTest(), 1200)
      }
      return
    }

    const serverContent = msg['serverContent'] as
      | {
          modelTurn?: {
            parts?: Array<{
              inlineData?: { data?: string; mimeType?: string }
              text?: string
            }>
          }
          turnComplete?: boolean
          interrupted?: boolean
        }
      | undefined

    if (serverContent?.modelTurn?.parts) {
      // Maya is responding — close any open user turn
      if (userSpeakingRef.current) {
        userSpeakingRef.current = false
        setTranscript((prev) => {
          const last = prev[prev.length - 1]
          if (last?.role === 'user' && last.text === '🎙 Speaking…') return prev
          return prev
        })
      }
      mayaRespondingRef.current = true
      let textAccum = ''
      for (const part of serverContent.modelTurn.parts) {
        if (part.inlineData?.data) {
          void scheduleAudio(part.inlineData.data)
        }
        if (part.text) {
          textAccum += part.text
        }
      }
      if (textAccum) {
        currentMayaTextRef.current += textAccum
      }
    }

    if (serverContent?.turnComplete) {
      const text = currentMayaTextRef.current.trim()
      if (text) {
        setTranscript((prev) => [...prev, { role: 'maya', text }])
      }
      currentMayaTextRef.current = ''
      mayaRespondingRef.current = false
      // Ready for next user turn
      userSpeakingRef.current = false
    }
  }

  async function startTest() {
    setState('connecting')
    setError(null)
    setTranscript([])
    currentMayaTextRef.current = ''

    let systemPrompt: string
    let model: string
    try {
      const r = await fetch('/api/voice/test-prompt', { credentials: 'include' })
      if (!r.ok) throw new Error('Failed to load Maya prompt')
      const d = (await r.json()) as { systemPrompt: string; model: string }
      systemPrompt = d.systemPrompt
      model = d.model
    } catch {
      setError('Could not load Maya configuration. Is the API server running?')
      setState('error')
      return
    }

    // Mic access
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
    } catch {
      setError('Could not access microphone. Check your browser permissions.')
      setState('error')
      return
    }
    streamRef.current = stream

    // Playback context (24 kHz — Gemini output rate).
    // Explicit resume() defends against browsers that auto-suspend new
    // AudioContexts even when created in a user-gesture handler.
    const playCtx = new AudioContext({ sampleRate: 24000 })
    playCtxRef.current = playCtx
    nextPlayTimeRef.current = 0
    try {
      await playCtx.resume()
    } catch (err) {
      console.warn('[test-maya] playCtx.resume() failed:', err)
    }
    console.info(
      `[test-maya] playback ctx ready: state=${playCtx.state} rate=${playCtx.sampleRate}`
    )

    // Open WebSocket via server-side proxy — key injected by the API server.
    const ws = new WebSocket(`${API_BASE}/api/voice/live`)
    wsRef.current = ws
    startTimeRef.current = Date.now()

    ws.onopen = () => {
      // 1. Send Gemini Live setup frame.
      const setupMsg = {
        setup: {
          model,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } },
            },
          },
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
        },
      }
      console.info('[test-maya] setup sent:', JSON.stringify(setupMsg))
      ws.send(JSON.stringify(setupMsg))

      // 2. Transition UI to active immediately. The previous build only
      //    flipped to 'active' on a `setupComplete` server message, but
      //    in practice that frame's shape varies across Gemini Live API
      //    versions and the UI would stay stuck on "Initializing Maya…".
      //    The WS is open and the setup frame is enqueued — that's the
      //    user-visible "ready" point.
      setState('active')

      // 3. Start mic capture so audio begins flowing. The capture loop
      //    already guards on ws.readyState === OPEN; any audio sent
      //    before Gemini acks `setupComplete` is harmlessly dropped.
      void startMicCapture(stream)

      // 4. Kick off the conversation with a plain text turn — confirms
      //    end-to-end model wiring before mic audio arrives. The
      //    previous "[call connected]" wording read as a status note
      //    and the model sometimes stayed silent; "Hello" reliably
      //    elicits a spoken greeting.
      const greetMsg = {
        clientContent: {
          turns: [{ role: 'user', parts: [{ text: 'Hello' }] }],
          turnComplete: true,
        },
      }
      ws.send(JSON.stringify(greetMsg))
      console.info('[test-maya] greeting turn sent')
    }

    ws.onmessage = (e) => {
      const raw = typeof e.data === 'string' ? e.data : ''
      console.info('[test-maya] raw WS msg:', raw)
      handleServerMessage(raw)
    }

    ws.onerror = () => {
      setError('WebSocket connection failed. Check your API key and network connection.')
      setState('error')
      cleanup()
    }

    ws.onclose = (e) => {
      if (e.code !== 1000 && state !== 'idle') {
        setError(`Connection closed unexpectedly (code ${e.code}).`)
        setState('error')
      }
      cleanup()
    }
  }

  // Inline AudioWorkletProcessor source. Loaded as a Blob URL so we
  // don't have to ship a second JS file or wire up a public/ asset.
  // The processor forwards each render quantum (typically 128 samples)
  // back to the main thread as a Float32Array. Conversion to PCM16 +
  // base64 + WS.send happens here so audio-thread work stays minimal.
  const CAPTURE_WORKLET_SOURCE = `
    class PCMCaptureProcessor extends AudioWorkletProcessor {
      process(inputs) {
        const input = inputs[0];
        if (!input || !input[0]) return true;
        const ch = input[0];
        const copy = new Float32Array(ch.length);
        copy.set(ch);
        this.port.postMessage(copy, [copy.buffer]);
        return true;
      }
    }
    registerProcessor('pcm-capture', PCMCaptureProcessor);
  `

  async function startMicCapture(stream: MediaStream) {
    // 16 kHz mono — matches what Gemini Live expects on the input side.
    // The browser resamples the device's native rate down to 16 kHz
    // when we set sampleRate on the AudioContext.
    const captureCtx = new AudioContext({ sampleRate: 16000 })
    captureCtxRef.current = captureCtx

    try {
      await captureCtx.resume()
    } catch (err) {
      console.warn('[test-maya] captureCtx.resume() failed:', err)
    }

    const blob = new Blob([CAPTURE_WORKLET_SOURCE], { type: 'application/javascript' })
    const workletUrl = URL.createObjectURL(blob)
    try {
      await captureCtx.audioWorklet.addModule(workletUrl)
    } catch (err) {
      console.error('[test-maya] audioWorklet.addModule failed:', err)
      setError('Audio worklet failed to load — the browser may not support AudioWorklet.')
      setState('error')
      cleanup()
      return
    } finally {
      URL.revokeObjectURL(workletUrl)
    }

    const source = captureCtx.createMediaStreamSource(stream)
    const workletNode = new AudioWorkletNode(captureCtx, 'pcm-capture')
    workletNodeRef.current = workletNode

    // Audio graph: mic → worklet → silent sink → destination. The sink
    // gain is 0 so we don't echo the mic to the speakers, but the node
    // still has to be connected to the destination for the worklet's
    // process() to keep running in most browsers.
    const sink = captureCtx.createGain()
    sink.gain.value = 0
    captureSinkRef.current = sink

    source.connect(workletNode)
    workletNode.connect(sink).connect(captureCtx.destination)

    workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const float32 = e.data
      if (!float32 || float32.length === 0) return
      if (wsRef.current?.readyState !== WebSocket.OPEN) return

      // PCM 16-bit little-endian, 16 kHz, mono — Int16Array is host
      // endian, and every browser we ship to runs on little-endian
      // CPUs (x86 + ARM). No byte-swap needed.
      const int16 = float32ToInt16(float32)
      const b64 = arrayBufferToBase64(int16.buffer as ArrayBuffer)
      wsRef.current.send(
        JSON.stringify({
          realtimeInput: {
            mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: b64 }],
          },
        })
      )

      sentChunkCountRef.current += 1
      if (sentChunkCountRef.current === 1 || sentChunkCountRef.current % 50 === 0) {
        console.info(
          `[test-maya] sent ${sentChunkCountRef.current} mic chunks (last=${int16.length} samples / ${(int16.length / 16).toFixed(0)}ms)`
        )
      }

      // Show user bubble on first audio chunk after Maya finishes
      if (!userSpeakingRef.current && !mayaRespondingRef.current) {
        userSpeakingRef.current = true
        setTranscript((prev) => [...prev, { role: 'user', text: '🎙 Speaking…' }])
      }
    }

    console.info(
      `[test-maya] mic capture started: ctx.state=${captureCtx.state} rate=${captureCtx.sampleRate}`
    )
  }

  function endTest() {
    setState('idle')
    cleanup()
  }

  const isActive = state === 'active'

  return (
    <div className="bg-white rounded-xl border border-orange-200 p-5 mb-8 max-w-xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-base">🎙</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700">
              Test Maya
            </span>
          </div>
          <p className="text-xs text-ink4">Talk to Maya in your browser — no phone call needed</p>
        </div>
      </div>

      {/* State: IDLE */}
      {state === 'idle' && (
        <div className="flex flex-col items-start gap-2">
          <button
            onClick={() => void startTest()}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
                clipRule="evenodd"
              />
            </svg>
            Start Test
          </button>
          <p className="text-[11px] text-ink4">Your browser will request microphone access</p>
        </div>
      )}

      {/* State: CONNECTING */}
      {state === 'connecting' && (
        <div className="flex items-center gap-3 py-2">
          <svg className="w-4 h-4 animate-spin text-orange-500" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <span className="text-sm text-orange-600 font-medium">Initializing Maya…</span>
        </div>
      )}

      {/* State: ACTIVE */}
      {isActive && (
        <div className="space-y-3">
          {/* Status bar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {mayaTalking ? (
                <>
                  {/* Waveform bars */}
                  <div className="flex items-end gap-0.5 h-5">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className="w-1 bg-orange-500 rounded-full"
                        style={{
                          animation: `mayaBar 0.6s ease-in-out ${i * 0.1}s infinite alternate`,
                          height: '100%',
                        }}
                      />
                    ))}
                  </div>
                  <span className="text-xs font-medium text-orange-600">Maya is speaking…</span>
                </>
              ) : (
                <>
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-xs font-medium text-green-700">Maya is listening…</span>
                </>
              )}
            </div>
            <button
              onClick={endTest}
              className="px-3 py-1 text-xs font-medium border border-rose-300 text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
            >
              End Test
            </button>
          </div>

          {/* Transcript */}
          <div className="max-h-48 overflow-y-auto bg-gray-50 rounded-lg p-3 space-y-2 text-sm">
            {transcript.length === 0 ? (
              <p className="text-xs text-ink4 text-center py-4">Conversation will appear here…</p>
            ) : (
              transcript.map((turn, i) =>
                turn.role === 'user' ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[80%] px-3 py-2 rounded-lg text-sm bg-teal-100 text-teal-900">
                      {turn.text}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="flex">
                    <div className="max-w-[80%] px-3 py-2 rounded-lg text-sm bg-white border-l-2 border-orange-400 text-ink shadow-sm">
                      {turn.text}
                    </div>
                  </div>
                )
              )
            )}
            <div ref={transcriptEndRef} />
          </div>
        </div>
      )}

      {/* State: ERROR */}
      {state === 'error' && (
        <div className="space-y-3">
          <div className="px-3 py-2 bg-red-50 rounded-lg">
            <p className="text-xs text-red-600">{error}</p>
          </div>
          <button
            onClick={() => setState('idle')}
            className="px-3 py-1.5 text-xs font-medium border border-border-brand text-ink3 rounded-lg hover:bg-bg transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      <style>{`
        @keyframes mayaBar {
          from { transform: scaleY(0.2); }
          to { transform: scaleY(1); }
        }
      `}</style>
    </div>
  )
}
