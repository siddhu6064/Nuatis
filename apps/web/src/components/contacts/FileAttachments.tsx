'use client'

import { useState, useEffect, useCallback } from 'react'

interface Attachment {
  id: string
  original_filename: string
  file_type: string
  file_size: number
  created_at: string
  signed_url: string | null
}

interface Props {
  contactId: string
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const FILE_ICONS: Record<string, string> = {
  'image/jpeg': '\u{1F5BC}',
  'image/png': '\u{1F5BC}',
  'image/gif': '\u{1F5BC}',
  'image/webp': '\u{1F5BC}',
  'application/pdf': '\u{1F4C4}',
  'application/msword': '\u{1F4DD}',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '\u{1F4DD}',
}

export default function FileAttachments({ contactId }: Props) {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchAttachments = useCallback(async () => {
    const res = await fetch(`/api/contacts/${contactId}/attachments`)
    if (res.ok) {
      const data = (await res.json()) as { attachments: Attachment[] }
      setAttachments(data.attachments)
    }
  }, [contactId])

  useEffect(() => {
    setLoading(true)
    void fetchAttachments().finally(() => setLoading(false))
  }, [fetchAttachments])

  const handleUpload = async (file: File) => {
    const allowed = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]
    if (!allowed.includes(file.type)) {
      setError('File type not supported')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('File exceeds 10MB limit')
      return
    }

    setUploading(true)
    setError(null)

    try {
      const buffer = await file.arrayBuffer()
      const base64 = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      )

      const res = await fetch(`/api/contacts/${contactId}/attachments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_data: base64,
          filename: file.name,
          file_type: file.type,
        }),
      })

      if (res.ok) {
        void fetchAttachments()
      } else {
        const data = (await res.json()) as { error?: string }
        setError(data.error ?? 'Upload failed')
      }
    } catch {
      setError('Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) void handleUpload(file)
  }

  const handleDelete = async (id: string) => {
    await fetch(`/api/contacts/${contactId}/attachments/${id}`, { method: 'DELETE' })
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  const isImage = (type: string) => type.startsWith('image/')

  if (loading) return <div className="py-6 text-center text-sm text-gray-400">Loading files...</div>

  return (
    <div>
      {/* Upload zone */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => document.getElementById('file-upload-input')?.click()}
        className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center hover:border-teal-400 transition-colors cursor-pointer mb-4"
      >
        {uploading ? (
          <p className="text-sm text-gray-500">Uploading...</p>
        ) : (
          <>
            <p className="text-sm text-gray-500">Drop files here or click to upload</p>
            <p className="text-[10px] text-gray-400 mt-1">
              JPG, PNG, GIF, WebP, PDF, DOC — max 10MB
            </p>
          </>
        )}
        <input
          id="file-upload-input"
          type="file"
          accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleUpload(file)
          }}
          className="hidden"
        />
      </div>

      {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

      {/* File list */}
      {attachments.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-4">No files attached</p>
      ) : (
        <div className="space-y-2">
          {attachments.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-gray-100 hover:bg-gray-50"
            >
              {isImage(a.file_type) && a.signed_url ? (
                <img
                  src={a.signed_url}
                  alt={a.original_filename}
                  className="w-10 h-10 rounded object-cover shrink-0"
                />
              ) : (
                <span className="text-xl w-10 h-10 flex items-center justify-center shrink-0">
                  {FILE_ICONS[a.file_type] ?? '\u{1F4CE}'}
                </span>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-700 truncate">{a.original_filename}</p>
                <p className="text-[10px] text-gray-400">
                  {formatSize(a.file_size)} &middot;{' '}
                  {new Date(a.created_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </p>
              </div>
              {a.signed_url && (
                <a
                  href={a.signed_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-teal-600 hover:text-teal-700 shrink-0"
                >
                  Download
                </a>
              )}
              <button
                onClick={() => void handleDelete(a.id)}
                className="text-xs text-gray-400 hover:text-red-500 shrink-0"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
