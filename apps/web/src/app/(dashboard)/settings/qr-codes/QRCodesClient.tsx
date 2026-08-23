'use client'
import { useState } from 'react'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Slider from '@mui/material/Slider'

const API_URL = ''

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
            <Button
              key={p.label}
              onClick={() => setInputUrl(`https://app.nuatis.com${p.urlPath}`)}
              size="small"
              color="inherit"
              variant="outlined"
            >
              {p.label}
            </Button>
          ))}
        </div>

        {/* URL input */}
        <div className="flex gap-2 mb-4">
          <TextField
            label="URL"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="https://example.com"
            size="small"
            sx={{ flex: 1 }}
          />
          <Button onClick={generate} disabled={!inputUrl.trim()} variant="contained">
            Generate QR
          </Button>
        </div>

        {/* Size slider */}
        <label className="block text-sm font-medium text-ink mb-1">Size: {size}px</label>
        <Slider
          value={size}
          onChange={(_e, value) => setSize(value as number)}
          min={100}
          max={400}
          sx={{ mb: 2 }}
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
            <Button onClick={handleDownload}>↓ Download PNG</Button>
          </div>
        )}
      </div>
    </div>
  )
}
