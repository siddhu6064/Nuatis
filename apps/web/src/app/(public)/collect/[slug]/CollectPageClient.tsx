'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface CollectorInfo {
  id: string
  name: string
  prompt: string
  max_duration_seconds: number
  tenant_name: string | null
}

interface CollectApiResponse {
  valid: boolean
  collector?: CollectorInfo
}

type RecordState = 'loading' | 'idle' | 'recording' | 'preview' | 'submitting' | 'success' | 'error'

export default function CollectPageClient({ slug }: { slug: string }) {
  const [state, setState] = useState<RecordState>('loading')
  const [collector, setCollector] = useState<CollectorInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Video recording
  const liveVideoRef = useRef<HTMLVideoElement>(null)
  const previewVideoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)

  // Timer
  const [timeLeft, setTimeLeft] = useState(30)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Form
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [submitterName, setSubmitterName] = useState<string | null>(null)

  // Load collector info
  useEffect(() => {
    fetch(`/api/video-testimonials/collect/${slug}`)
      .then(r => r.json() as Promise<CollectApiResponse>)
      .then(data => {
        if (!data.valid || !data.collector) {
          setError('This recording link is no longer active.')
          setState('error')
          return
        }
        setCollector(data.collector)
        setTimeLeft(data.collector.max_duration_seconds)
        setState('idle')
      })
      .catch(() => {
        setError('Unable to load recording page.')
        setState('error')
      })
  }, [slug])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
      }
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }, [])

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      streamRef.current = stream

      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream
        await liveVideoRef.current.play()
      }

      // Prefer webm, fallback to mp4
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : MediaRecorder.isTypeSupported('video/webm')
        ? 'video/webm'
        : 'video/mp4'

      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = e => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType })
        setRecordedBlob(blob)
        if (previewVideoRef.current) {
          previewVideoRef.current.src = URL.createObjectURL(blob)
        }
        setState('preview')
      }

      recorder.start(100) // collect data every 100ms
      setState('recording')

      // Countdown timer
      const maxSecs = collector?.max_duration_seconds ?? 30
      setTimeLeft(maxSecs)
      timerRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            stopRecording()
            return 0
          }
          return prev - 1
        })
      }, 1000)
    } catch {
      setError('Camera access denied. Please allow camera access and try again.')
      setState('idle')
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!recordedBlob || !name.trim()) return

    // Client-side size check
    if (recordedBlob.size > 50 * 1024 * 1024) {
      setError('Video is too large (max 50MB). Please record a shorter video.')
      return
    }

    setState('submitting')
    setSubmitterName(name.trim())

    const formData = new FormData()
    const ext = recordedBlob.type.includes('mp4') ? 'mp4' : 'webm'
    formData.append('video', recordedBlob, `recording.${ext}`)
    formData.append('name', name.trim())
    if (email.trim()) formData.append('email', email.trim())

    try {
      const r = await fetch(`/api/video-testimonials/collect/${slug}`, {
        method: 'POST',
        body: formData,
      })

      if (r.ok) {
        setState('success')
      } else {
        const d = await r.json().catch(() => ({})) as { error?: string }
        setError(d.error ?? 'Upload failed. Please try again.')
        setState('preview')
      }
    } catch {
      setError('Network error. Please try again.')
      setState('preview')
    }
  }

  function handleRecordAgain() {
    setRecordedBlob(null)
    setError(null)
    if (previewVideoRef.current) previewVideoRef.current.src = ''
    setTimeLeft(collector?.max_duration_seconds ?? 30)
    setState('idle')
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center max-w-sm">
          <p className="text-gray-500 text-sm">{error ?? 'This page is unavailable.'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center px-4 py-8">
      {/* Business name header */}
      {collector?.tenant_name && (
        <p className="text-gray-400 text-sm mb-6">{collector.tenant_name}</p>
      )}

      <div className="w-full max-w-md">
        {/* ── IDLE ─────────────────────────────────────────────────────── */}
        {state === 'idle' && (
          <div className="text-center">
            <h1 className="text-2xl font-bold text-white mb-4">{collector?.prompt}</h1>
            <p className="text-gray-400 text-sm mb-8">
              You have {collector?.max_duration_seconds ?? 30} seconds
            </p>
            <button
              type="button"
              onClick={() => void startRecording()}
              className="inline-flex items-center gap-3 px-8 py-4 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-full transition-colors text-lg"
            >
              <span className="w-4 h-4 rounded-full bg-white block" />
              Start Recording
            </button>
            {error && (
              <p className="mt-4 text-red-400 text-sm">{error}</p>
            )}
          </div>
        )}

        {/* ── RECORDING ────────────────────────────────────────────────── */}
        {state === 'recording' && (
          <div className="text-center">
            {/* Timer */}
            <div className="text-6xl font-bold text-red-500 mb-4 tabular-nums">
              {timeLeft}
            </div>
            {/* Live feed — mirrored */}
            <div className="relative rounded-2xl overflow-hidden bg-gray-800 aspect-video mb-6">
              <video
                ref={liveVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover scale-x-[-1]"
              />
              {/* Recording indicator */}
              <div className="absolute top-3 left-3 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-white text-xs font-medium">REC</span>
              </div>
            </div>
            <button
              type="button"
              onClick={stopRecording}
              className="px-8 py-3 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-full transition-colors"
            >
              Stop
            </button>
          </div>
        )}

        {/* ── PREVIEW ──────────────────────────────────────────────────── */}
        {state === 'preview' && (
          <div>
            {/* Playback — NOT mirrored */}
            <div className="rounded-2xl overflow-hidden bg-gray-800 aspect-video mb-6">
              <video
                ref={previewVideoRef}
                controls
                playsInline
                className="w-full h-full object-cover"
              />
            </div>

            {error && (
              <p className="mb-4 text-red-400 text-sm text-center">{error}</p>
            )}

            <form onSubmit={e => { void handleSubmit(e) }} className="space-y-3 mb-6">
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your name *"
                required
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 text-white placeholder-gray-500 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Email (optional)"
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 text-white placeholder-gray-500 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <button
                type="submit"
                className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl transition-colors"
              >
                Use this video →
              </button>
            </form>

            <button
              type="button"
              onClick={handleRecordAgain}
              className="w-full py-2.5 text-gray-400 hover:text-white text-sm font-medium transition-colors"
            >
              ↺ Record again
            </button>
          </div>
        )}

        {/* ── SUBMITTING ───────────────────────────────────────────────── */}
        {state === 'submitting' && (
          <div className="text-center">
            <div className="w-16 h-16 border-4 border-gray-700 border-t-red-500 rounded-full animate-spin mx-auto mb-6" />
            <p className="text-white font-medium">Uploading…</p>
            <p className="text-gray-400 text-sm mt-1">Please keep this page open</p>
          </div>
        )}

        {/* ── SUCCESS ──────────────────────────────────────────────────── */}
        {state === 'success' && (
          <div className="text-center">
            <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">
              Thank you{submitterName ? `, ${submitterName.split(' ')[0]}` : ''}!
            </h2>
            <p className="text-gray-400">Your review has been submitted.</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <p className="absolute bottom-4 text-xs text-gray-600">Powered by Nuatis</p>
    </div>
  )
}
