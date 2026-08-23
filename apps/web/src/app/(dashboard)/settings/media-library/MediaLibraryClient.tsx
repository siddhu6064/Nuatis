'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'

interface MediaFile {
  id: string
  file_name: string
  file_size: number
  mime_type: string
  public_url: string | null
  created_at: string
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function MediaLibraryClient() {
  const [files, setFiles] = useState<MediaFile[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function fetchFiles() {
    setLoading(true)
    try {
      const res = await fetch('/api/media')
      if (!res.ok) throw new Error('Failed to load media files')
      const data = (await res.json()) as { files: MediaFile[] }
      setFiles(data.files)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchFiles()
  }, [])

  function handleUploadClick() {
    fileInputRef.current?.click()
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      const res = await fetch('/api/media/upload', {
        method: 'POST',
        headers: {
          'Content-Type': file.type,
          'X-File-Name': file.name,
        },
        body: file,
      })
      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        throw new Error(err.error ?? 'Upload failed')
      }
      const newFile = (await res.json()) as MediaFile
      setFiles((prev) => [newFile, ...prev])
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
      // Reset input so the same file can be re-uploaded if needed
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleCopy(file: MediaFile) {
    if (!file.public_url) return
    try {
      await navigator.clipboard.writeText(file.public_url)
      setCopiedId(file.id)
      setTimeout(() => setCopiedId((prev) => (prev === file.id ? null : prev)), 2000)
    } catch {
      // Fallback for environments without clipboard API
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/media/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        throw new Error(err.error ?? 'Delete failed')
      }
      setFiles((prev) => prev.filter((f) => f.id !== id))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="px-8 py-8 max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">Media Library</h1>
          <p className="text-sm text-ink3 mt-0.5">
            Upload and manage images for use in campaigns and proposals
          </p>
        </div>
        <Button onClick={handleUploadClick} disabled={uploading} variant="contained">
          {uploading ? 'Uploading…' : '+ Upload Image'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-sm text-ink4 py-12 text-center">Loading media…</div>
      ) : files.length === 0 ? (
        <div className="rounded-xl border border-border-brand bg-white px-5 py-16 text-center text-sm text-ink4">
          Upload images to use in email campaigns and proposals.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {files.map((file) => (
            <div
              key={file.id}
              className="group relative rounded-xl border border-border-brand bg-white overflow-hidden"
            >
              {/* Thumbnail */}
              <button
                onClick={() => handleCopy(file)}
                className="block w-full aspect-video bg-bg2 overflow-hidden focus:outline-none"
                title={copiedId === file.id ? 'Copied!' : 'Click to copy URL'}
              >
                {file.public_url ? (
                  <Image
                    src={file.public_url}
                    alt={file.file_name}
                    width={200}
                    height={200}
                    className="w-full h-full object-cover transition-opacity group-hover:opacity-90"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-ink4 text-xs">
                    No preview
                  </div>
                )}

                {/* Copied overlay */}
                {copiedId === file.id && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <span className="text-white text-sm font-medium">Copied!</span>
                  </div>
                )}
              </button>

              {/* Delete button — visible on hover */}
              <IconButton
                onClick={() => handleDelete(file.id)}
                disabled={deletingId === file.id}
                title="Delete image"
                size="small"
                sx={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  zIndex: 10,
                  bgcolor: 'rgba(255,255,255,0.9)',
                  color: 'error.main',
                  boxShadow: 1,
                  opacity: 0,
                  transition: 'opacity 0.15s',
                  '.group:hover &': { opacity: 1 },
                  '&:hover': { bgcolor: '#fef2f2' },
                }}
              >
                {deletingId === file.id ? '…' : '×'}
              </IconButton>

              {/* File info */}
              <div className="px-3 py-2">
                <p className="text-xs font-medium text-ink truncate" title={file.file_name}>
                  {file.file_name}
                </p>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-xs text-ink4">{formatFileSize(file.file_size)}</span>
                  <span className="text-xs text-ink4">{formatDate(file.created_at)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
