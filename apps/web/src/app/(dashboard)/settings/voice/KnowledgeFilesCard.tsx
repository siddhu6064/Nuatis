'use client'

import { useState, useEffect, useRef } from 'react'

interface KbFile {
  id: string
  file_name: string
  file_size: number
  status: 'pending' | 'processing' | 'ready' | 'error'
  created_at: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const STATUS_CLASSES: Record<KbFile['status'], string> = {
  pending: 'bg-amber-50 text-amber-600',
  processing: 'bg-amber-50 text-amber-600',
  ready: 'bg-green-50 text-green-700',
  error: 'bg-red-50 text-red-600',
}

export default function KnowledgeFilesCard({ initialFiles }: { initialFiles: KbFile[] }) {
  const [files, setFiles] = useState<KbFile[]>(initialFiles)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const hasInFlight = files.some((f) => f.status === 'pending' || f.status === 'processing')

  useEffect(() => {
    if (!hasInFlight) return
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/maya-kb', { credentials: 'include' })
        if (res.ok) {
          const data = (await res.json()) as { files: KbFile[] }
          setFiles(data.files)
        }
      } catch {
        // silent — keep polling
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [hasInFlight])

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    if (file.type !== 'application/pdf') {
      setUploadError('Only PDF files are allowed')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('File too large (max 10MB)')
      return
    }

    setUploading(true)
    setUploadError(null)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/maya-kb/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        setUploadError(data.error ?? 'Upload failed')
        return
      }
      const data = (await res.json()) as { id: string; file_name: string; status: string }
      setFiles((prev) => [
        {
          id: data.id,
          file_name: data.file_name,
          file_size: file.size,
          status: 'pending',
          created_at: new Date().toISOString(),
        },
        ...prev,
      ])
    } catch {
      setUploadError('Network error')
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(fileId: string, fileName: string) {
    if (!confirm(`Delete "${fileName}"? This cannot be undone.`)) return
    setDeletingId(fileId)
    try {
      const res = await fetch(`/api/maya-kb/${fileId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (res.ok) {
        setFiles((prev) => prev.filter((f) => f.id !== fileId))
      }
    } catch {
      // silent
    } finally {
      setDeletingId(null)
    }
  }

  const atMax = files.length >= 5

  return (
    <div className="bg-white rounded-xl border border-border-brand p-6 mt-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-ink">Knowledge Files</h2>
        <button
          type="button"
          onClick={() => !atMax && fileInputRef.current?.click()}
          disabled={uploading || atMax}
          title={atMax ? 'Maximum 5 files reached' : undefined}
          className="px-3 py-1.5 text-sm border border-border-brand rounded-lg hover:bg-bg transition-colors text-ink2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploading ? 'Uploading…' : 'Upload PDF'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={handleUpload}
        />
      </div>

      <p className="text-xs text-ink4 mb-4">
        Upload PDF documents (max 5, 10 MB each). Maya extracts their text and uses it on calls.
      </p>

      {uploadError && (
        <div className="mb-3 px-3 py-2 bg-red-50 text-red-600 text-sm rounded-lg">
          {uploadError}
        </div>
      )}

      {files.length === 0 ? (
        <p className="text-sm text-ink4">No files uploaded yet.</p>
      ) : (
        <div className="space-y-2">
          {files.map((f) => (
            <div
              key={f.id}
              className="flex items-center justify-between py-2 px-3 bg-bg rounded-lg"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-sm text-ink truncate max-w-[200px]">{f.file_name}</span>
                <span className="text-xs text-ink4 shrink-0">{formatBytes(f.file_size)}</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${STATUS_CLASSES[f.status]}`}
                >
                  {f.status}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(f.id, f.file_name)}
                disabled={deletingId === f.id}
                title="Delete"
                className="ml-3 text-ink4 hover:text-red-500 transition-colors shrink-0 disabled:opacity-40"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
