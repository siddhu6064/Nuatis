'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Stage {
  id: string
  name: string
  color: string
  position: number
  probability: number
}

interface Pipeline {
  id: string
  name: string
  is_default: boolean
  type: string
}

interface PipelineDetail extends Pipeline {
  stages: Stage[]
}

interface KanbanContact {
  id: string
  full_name: string
  phone?: string | null
  last_contacted?: string | null
  pipeline_stage?: string | null
}

function toTitle(slug: string): string {
  return slug
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function KanbanColumn({ stage, contacts }: { stage: Stage; contacts: KanbanContact[] }) {
  return (
    <div className="flex-none w-[220px] flex flex-col rounded-lg border border-border-brand bg-white overflow-hidden">
      <div className="bg-[#f2f0eb] px-3 py-2.5 flex items-center gap-2 border-b border-border-brand">
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: stage.color }}
        />
        <span className="text-[13px] font-semibold text-ink flex-1 truncate">{stage.name}</span>
        <span className="font-mono text-[10px] text-ink3 bg-white border border-border-brand rounded px-1.5 py-0.5 shrink-0">
          {contacts.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[120px] max-h-[60vh]">
        {contacts.length === 0 ? (
          <p className="text-[12px] text-ink4 text-center py-4">No contacts</p>
        ) : (
          contacts.map((c) => (
            <Link
              key={c.id}
              href={`/contacts/${c.id}`}
              className="block bg-[#f9f8f5] border border-border-brand rounded-lg px-3 py-2.5 hover:border-teal-300 transition-colors"
            >
              <p className="text-[14px] font-medium text-ink truncate">{c.full_name}</p>
              {c.phone && (
                <p className="font-mono text-[11px] text-ink3 mt-0.5 truncate">{c.phone}</p>
              )}
              {c.last_contacted && (
                <p className="font-mono text-[10px] text-ink4 mt-0.5">
                  {fmtDate(c.last_contacted)}
                </p>
              )}
            </Link>
          ))
        )}
      </div>
    </div>
  )
}

export default function PipelinesContent({ vertical }: { vertical: string }) {
  const [pipeline, setPipeline] = useState<PipelineDetail | null>(null)
  const [contacts, setContacts] = useState<KanbanContact[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    async function init() {
      try {
        const plRes = await fetch('/api/pipelines?type=contacts')
        if (!plRes.ok) throw new Error('Failed to load pipelines')

        const rawPl = (await plRes.json()) as Pipeline[] | { pipelines?: Pipeline[] } | null
        const allPipelines: Pipeline[] = Array.isArray(rawPl)
          ? rawPl
          : ((rawPl as { pipelines?: Pipeline[] })?.pipelines ?? [])

        const verticalLabel = toTitle(vertical)
        const match =
          allPipelines.find(
            (p) => !p.is_default && p.name.toLowerCase().includes(verticalLabel.toLowerCase())
          ) ??
          allPipelines.find((p) => p.is_default) ??
          allPipelines[0]

        if (!match) {
          setLoading(false)
          return
        }

        const detailRes = await fetch(`/api/pipelines/${match.id}`)
        if (!detailRes.ok) throw new Error('Failed to load pipeline detail')
        const detail = (await detailRes.json()) as PipelineDetail
        setPipeline(detail)

        try {
          const cRes = await fetch(`/api/contacts?pipeline_id=${match.id}&limit=200`)
          if (cRes.ok) {
            const cRaw = (await cRes.json()) as
              | { contacts?: KanbanContact[] }
              | KanbanContact[]
              | null
            const cList: KanbanContact[] = Array.isArray(cRaw)
              ? cRaw
              : ((cRaw as { contacts?: KanbanContact[] })?.contacts ?? [])
            setContacts(cList)
          }
        } catch {
          /* non-fatal */
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load pipeline')
      } finally {
        setLoading(false)
      }
    }
    void init()
  }, [vertical])

  if (loading) {
    return (
      <div className="px-8 py-8">
        <p className="text-sm text-ink4">Loading pipeline...</p>
      </div>
    )
  }

  if (loadError || !pipeline) {
    return (
      <div className="px-8 py-8 max-w-2xl">
        <div className="bg-white rounded-xl border border-dashed border-border-brand p-8 text-center">
          <p className="text-sm text-ink4">
            {loadError ?? 'No pipeline configured for this vertical yet.'}
          </p>
        </div>
      </div>
    )
  }

  const stages = [...pipeline.stages].sort((a, b) => a.position - b.position)

  function contactsForStage(stage: Stage): KanbanContact[] {
    return contacts.filter((c) => c.pipeline_stage === stage.name)
  }

  return (
    <div className="px-8 py-8 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-ink">{pipeline.name}</h2>
          <p className="text-sm text-ink3 mt-0.5">
            {contacts.length} contact{contacts.length !== 1 ? 's' : ''} in pipeline
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Link
            href="/contacts/new"
            className="px-4 py-2 text-sm font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
          >
            + Add Contact
          </Link>
          <Link
            href="/settings/pipelines/manage"
            className="text-sm text-ink3 hover:text-ink flex items-center gap-1"
          >
            ⚙ Manage
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto pb-4 -mx-1 px-1">
        {stages.length === 0 ? (
          <p className="text-sm text-ink4">No stages defined for this pipeline.</p>
        ) : (
          <div className="flex gap-3" style={{ minWidth: `${stages.length * 236}px` }}>
            {stages.map((stage) => (
              <KanbanColumn key={stage.id} stage={stage} contacts={contactsForStage(stage)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
