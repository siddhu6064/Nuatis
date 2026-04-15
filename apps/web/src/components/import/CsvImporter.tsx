'use client'

import { useState, useCallback, useEffect } from 'react'

type Step = 1 | 2 | 3 | 4

interface ParseResult {
  headers: string[]
  preview_rows: Record<string, string>[]
  total_rows: number
  suggested_mapping: Record<string, string | null>
}

interface ImportResult {
  imported: number
  skipped: number
  errors: Array<{ row: number; field: string; message: string }>
  job_id?: string
}

interface ImportJob {
  id: string
  filename: string
  row_count: number
  imported_count: number
  skipped_count: number
  error_count: number
  status: string
  errors: Array<{ row: number; field: string; message: string }>
  created_at: string
  creator: { full_name: string } | null
}

const FIELD_OPTIONS = [
  { value: 'skip', label: 'Skip' },
  { value: 'name', label: 'Name' },
  { value: 'phone', label: 'Phone' },
  { value: 'email', label: 'Email' },
  { value: 'tags', label: 'Tags' },
  { value: 'notes', label: 'Notes' },
  { value: 'source', label: 'Source' },
]

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  processing: 'bg-blue-100 text-blue-700',
  complete: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
}

export default function CsvImporter() {
  const [step, setStep] = useState<Step>(1)
  const [csvText, setCsvText] = useState('')
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [jobs, setJobs] = useState<ImportJob[]>([])
  const [expandedJob, setExpandedJob] = useState<string | null>(null)

  // Fetch import history
  const fetchJobs = useCallback(async () => {
    const res = await fetch('/api/import/contacts/jobs')
    if (res.ok) {
      const data = (await res.json()) as { jobs: ImportJob[] }
      setJobs(data.jobs)
    }
  }, [])

  useEffect(() => {
    void fetchJobs()
  }, [fetchJobs])

  // Step 1: Upload
  const handleFileRead = async (text: string) => {
    setCsvText(text)
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/import/contacts/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: text }),
      })

      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? 'Failed to parse CSV')
      }

      const data = (await res.json()) as ParseResult
      setParseResult(data)

      // Init mapping from suggestions
      const m: Record<string, string> = {}
      for (const [header, suggested] of Object.entries(data.suggested_mapping)) {
        m[header] = suggested ?? 'skip'
      }
      setMapping(m)
      setStep(2)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse CSV')
    } finally {
      setLoading(false)
    }
  }

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) void readFile(file)
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void readFile(file)
  }

  const readFile = async (file: File) => {
    if (!file.name.endsWith('.csv')) {
      setError('Please select a CSV file')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('File exceeds 5MB limit')
      return
    }
    setError(null)
    const text = await file.text()
    void handleFileRead(text)
  }

  // Step 2: mapping validation
  const mappedFields = new Set(Object.values(mapping).filter((v) => v !== 'skip'))
  const hasRequired =
    mappedFields.has('name') || mappedFields.has('phone') || mappedFields.has('email')

  // Step 3: Import
  const handleImport = async () => {
    if (!parseResult) return
    setLoading(true)
    setError(null)

    try {
      // Parse client-side to get all rows
      const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(Boolean)
      const headers = lines[0]?.split(',').map((h) => h.replace(/^"|"$/g, '').trim()) ?? []
      const rows: Record<string, string>[] = []
      for (let i = 1; i < lines.length; i++) {
        const vals = lines[i]!.split(',').map((v) => v.replace(/^"|"$/g, '').trim())
        const row: Record<string, string> = {}
        headers.forEach((h, j) => {
          row[h] = vals[j] ?? ''
        })
        rows.push(row)
      }

      const res = await fetch('/api/import/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows,
          mapping,
          options: { skip_duplicates: skipDuplicates, update_existing: false },
        }),
      })

      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? 'Import failed')
      }

      const result = (await res.json()) as ImportResult
      setImportResult(result)
      setStep(4)
      void fetchJobs()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setLoading(false)
    }
  }

  const reset = () => {
    setStep(1)
    setCsvText('')
    setParseResult(null)
    setMapping({})
    setImportResult(null)
    setError(null)
  }

  return (
    <div>
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                s === step
                  ? 'bg-teal-600 text-white'
                  : s < step
                    ? 'bg-teal-100 text-teal-700'
                    : 'bg-gray-100 text-gray-400'
              }`}
            >
              {s < step ? '\u2713' : s}
            </div>
            {s < 4 && <div className="w-8 h-px bg-gray-200" />}
          </div>
        ))}
        <span className="text-xs text-gray-400 ml-2">
          {step === 1 && 'Upload'}
          {step === 2 && 'Map columns'}
          {step === 3 && 'Confirm'}
          {step === 4 && 'Results'}
        </span>
      </div>

      {error && (
        <div className="mb-4 px-4 py-2 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>
      )}

      {/* Step 1: Upload */}
      {step === 1 && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleFileDrop}
          className="border-2 border-dashed border-gray-300 rounded-xl p-12 text-center hover:border-teal-400 transition-colors cursor-pointer"
          onClick={() => document.getElementById('csv-file-input')?.click()}
        >
          {loading ? (
            <p className="text-sm text-gray-500">Parsing CSV...</p>
          ) : (
            <>
              <p className="text-3xl mb-3">{'\u{1F4C4}'}</p>
              <p className="text-sm font-medium text-gray-700">
                Drop your CSV file here or click to browse
              </p>
              <p className="text-xs text-gray-400 mt-1">.csv files only, max 5MB</p>
            </>
          )}
          <input
            id="csv-file-input"
            type="file"
            accept=".csv"
            onChange={handleFileInput}
            className="hidden"
          />
        </div>
      )}

      {/* Step 2: Map columns */}
      {step === 2 && parseResult && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            Map CSV columns to contact fields
          </h3>

          <div className="space-y-2 mb-4">
            {parseResult.headers.map((header) => (
              <div key={header} className="flex items-center gap-3">
                <span className="text-sm text-gray-600 w-40 truncate font-mono">{header}</span>
                <span className="text-gray-300">{'\u2192'}</span>
                <select
                  value={mapping[header] ?? 'skip'}
                  onChange={(e) => setMapping({ ...mapping, [header]: e.target.value })}
                  className="text-sm border border-gray-200 rounded px-2 py-1.5"
                >
                  {FIELD_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {!hasRequired && (
            <p className="text-xs text-amber-600 mb-3">
              At least Name, Phone, or Email must be mapped
            </p>
          )}

          {/* Preview */}
          <div className="overflow-x-auto mb-4">
            <table className="text-xs border border-gray-200 rounded">
              <thead>
                <tr className="bg-gray-50">
                  {parseResult.headers.map((h) => (
                    <th key={h} className="px-3 py-1.5 text-left text-gray-500 font-medium">
                      {mapping[h] !== 'skip' ? (
                        mapping[h]
                      ) : (
                        <span className="text-gray-300">skip</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parseResult.preview_rows.slice(0, 3).map((row, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    {parseResult.headers.map((h) => (
                      <td key={h} className="px-3 py-1.5 text-gray-600">
                        {row[h] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <label className="flex items-center gap-2 text-xs text-gray-600 mb-4 cursor-pointer">
            <input
              type="checkbox"
              checked={skipDuplicates}
              onChange={(e) => setSkipDuplicates(e.target.checked)}
              className="rounded border-gray-300 text-teal-600 focus:ring-teal-500 w-3.5 h-3.5"
            />
            Skip duplicate contacts (matched by phone or email)
          </label>

          <div className="flex items-center gap-2">
            <button onClick={() => setStep(1)} className="px-4 py-2 text-sm text-gray-500">
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={!hasRequired}
              className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Confirm */}
      {step === 3 && parseResult && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            Ready to import {parseResult.total_rows} contacts
          </h3>
          <div className="bg-gray-50 rounded-lg p-4 mb-4 text-sm text-gray-600 space-y-1">
            {Object.entries(mapping)
              .filter(([, v]) => v !== 'skip')
              .map(([csv, field]) => (
                <div key={csv}>
                  <span className="font-mono text-gray-500">{csv}</span> {'\u2192'}{' '}
                  <span className="font-medium">{field}</span>
                </div>
              ))}
          </div>
          {skipDuplicates && (
            <p className="text-xs text-gray-500 mb-4">
              Duplicates (matching phone or email) will be skipped.
            </p>
          )}
          {parseResult.total_rows > 100 && (
            <p className="text-xs text-amber-600 mb-4">
              Large import ({parseResult.total_rows} rows) will be processed in the background.
            </p>
          )}

          <div className="flex items-center gap-2">
            <button onClick={() => setStep(2)} className="px-4 py-2 text-sm text-gray-500">
              Back
            </button>
            <button
              onClick={() => void handleImport()}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50"
            >
              {loading ? 'Importing...' : 'Import'}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Results */}
      {step === 4 && importResult && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-2xl">{'\u2713'}</span>
            <h3 className="text-sm font-semibold text-gray-700">
              {importResult.job_id ? 'Import queued' : 'Import complete'}
            </h3>
          </div>

          {!importResult.job_id && (
            <div className="bg-gray-50 rounded-lg p-4 mb-4 text-sm space-y-1">
              <p className="text-green-700">{importResult.imported} contacts imported</p>
              {importResult.skipped > 0 && (
                <p className="text-amber-600">{importResult.skipped} skipped (duplicates)</p>
              )}
              {importResult.errors.length > 0 && (
                <div>
                  <p className="text-red-600">{importResult.errors.length} errors</p>
                  <div className="mt-2 max-h-40 overflow-y-auto text-xs space-y-1">
                    {importResult.errors.map((err, i) => (
                      <div key={i} className="text-red-500">
                        Row {err.row}: {err.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {importResult.job_id && (
            <p className="text-sm text-gray-500 mb-4">
              Your import is being processed in the background. We&apos;ll notify you when it&apos;s
              complete.
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={reset}
              className="px-4 py-2 text-sm font-medium text-teal-600 hover:text-teal-700"
            >
              Import another file
            </button>
          </div>
        </div>
      )}

      {/* Import history */}
      <div className="mt-10">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Import History</h3>
        {jobs.length === 0 ? (
          <p className="text-xs text-gray-400">No imports yet</p>
        ) : (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">File</th>
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">Date</th>
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">Rows</th>
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">Imported</th>
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">Skipped</th>
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">Errors</th>
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr
                    key={job.id}
                    className="border-b border-gray-100 last:border-0 hover:bg-gray-50 cursor-pointer"
                    onClick={() => setExpandedJob(expandedJob === job.id ? null : job.id)}
                  >
                    <td className="px-3 py-2 text-gray-700">{job.filename}</td>
                    <td className="px-3 py-2 text-gray-500">
                      {new Date(job.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{job.row_count}</td>
                    <td className="px-3 py-2 text-green-600">{job.imported_count}</td>
                    <td className="px-3 py-2 text-amber-600">{job.skipped_count}</td>
                    <td className="px-3 py-2 text-red-600">{job.error_count}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_BADGE[job.status] ?? ''}`}
                      >
                        {job.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
