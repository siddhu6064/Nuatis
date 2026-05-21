'use client'
import { useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

const PRESETS = [
  { label: 'Booking Page', urlPath: '/book' },
  { label: 'Payment Link', urlPath: '/pay' },
  { label: 'Review Request', urlPath: '/review' },
]

export default function QRCodesClient() {
  const [inputUrl, setInputUrl] = useState('')
  const [size, setSize] = useState(256)
  const [qrSrc, setQrSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function buildQrUrl(url: string, s: number) {
    return `${API_URL}/api/qr?url=${encodeURIComponent(url)}&size=${s}`
  }

  function generate() {
    if (!inputUrl.trim()) return
    setLoading(true)
    setQrSrc(buildQrUrl(inputUrl.trim(), size))
  }

  function handleLoad() {
    setLoading(false)
  }
  function handleError() {
    setLoading(false)
  }

  function handleDownload() {
    if (!qrSrc) return
    const a = document.createElement('a')
    a.href = qrSrc
    a.download = 'qrcode.png'
    a.click()
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">QR Codes</h1>
        <p className="text-sm text-ink3 mt-1">Generate QR codes for any URL.</p>
      </div>

      <div className="bg-white border border-border-brand rounded-xl p-6 mb-6">
        {/* Presets */}
        <p className="text-xs font-medium text-ink4 mb-2 uppercase tracking-wide">Quick presets</p>
        <div className="flex gap-2 flex-wrap mb-4">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setInputUrl(`https://app.nuatis.com${p.urlPath}`)}
              className="text-xs px-3 py-1.5 rounded-lg border border-border-brand text-ink3 hover:text-teal-700 hover:border-teal-300 transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* URL input */}
        <label className="block text-sm font-medium text-ink mb-1">URL</label>
        <div className="flex gap-2 mb-4">
          <input
            type="url"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="https://example.com"
            className="flex-1 border border-border-brand rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <button
            type="button"
            onClick={generate}
            disabled={!inputUrl.trim()}
            className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            Generate QR
          </button>
        </div>

        {/* Size slider */}
        <label className="block text-sm font-medium text-ink mb-1">Size: {size}px</label>
        <input
          type="range"
          min={100}
          max={400}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          className="w-full mb-4 accent-teal-600"
        />

        {/* Preview */}
        {qrSrc && (
          <div className="flex flex-col items-center gap-4 mt-2">
            {loading && <p className="text-sm text-ink3">Generating…</p>}
            <img
              src={qrSrc}
              alt="QR code"
              onLoad={handleLoad}
              onError={handleError}
              className={`rounded-lg border border-border-brand ${loading ? 'opacity-0' : 'opacity-100'}`}
              style={{ width: size, height: size }}
            />
            <button
              type="button"
              onClick={handleDownload}
              className="text-sm text-teal-600 hover:text-teal-700 font-medium"
            >
              ↓ Download PNG
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
