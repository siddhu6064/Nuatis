import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import { getVertical } from '@nuatis/shared'
import type { PipelineStageConfig } from '@nuatis/shared'
import Link from 'next/link'
import StageSelector from './StageSelector'

interface Contact {
  id: string
  full_name: string
  email: string | null
  pipeline_stage: string | null
}

export default async function PipelinePage() {
  const session = await auth()
  const tenantId = session?.user?.tenantId
  const vertical = session?.user?.vertical ?? 'sales_crm'

  // Fall back to sales_crm if the vertical slug is somehow unrecognised
  let config
  try {
    config = getVertical(vertical)
  } catch {
    config = getVertical('sales_crm')
  }
  const stages: PipelineStageConfig[] = [...config.pipeline_stages].sort(
    (a, b) => a.position - b.position
  )
  const defaultStage = stages.find((s) => s.is_default)?.name ?? stages[0]?.name ?? ''

  const supabase = createAdminClient()
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, full_name, email, pipeline_stage')
    .eq('tenant_id', tenantId)
    .returns<Contact[]>()

  // Group contacts by stage; null/unset pipeline_stage → default stage
  const grouped = new Map<string, Contact[]>()
  for (const stage of stages) grouped.set(stage.name, [])
  for (const contact of contacts ?? []) {
    const stage = contact.pipeline_stage ?? defaultStage
    if (grouped.has(stage)) {
      grouped.get(stage)!.push(contact)
    } else {
      // stage value in DB doesn't match config (e.g. after vertical change) → default
      grouped.get(defaultStage)!.push(contact)
    }
  }

  const totalContacts = contacts?.length ?? 0

  return (
    <div className="px-8 py-8 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Pipeline</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {config.label} · {totalContacts} contact{totalContacts !== 1 ? 's' : ''}
          </p>
        </div>
        <Link
          href="/contacts/new"
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
        >
          <span className="text-base leading-none">+</span>
          Add Contact
        </Link>
      </div>

      {/* Kanban board */}
      <div className="overflow-x-auto flex-1">
        <div className="flex gap-4 h-full pb-4" style={{ minWidth: `${stages.length * 272}px` }}>
          {stages.map((stage) => {
            const cards = grouped.get(stage.name) ?? []
            return (
              <div key={stage.name} className="w-64 shrink-0 flex flex-col">
                {/* Column header */}
                <div className="flex items-center gap-2 mb-3">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: stage.color }}
                  />
                  <span className="text-xs font-semibold text-gray-700 truncate">{stage.name}</span>
                  <span className="ml-auto text-xs font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
                    {cards.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex flex-col gap-2 flex-1">
                  {cards.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center">
                      <p className="text-xs text-gray-300">No contacts</p>
                    </div>
                  ) : (
                    cards.map((contact) => (
                      <div
                        key={contact.id}
                        className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm"
                      >
                        {/* Avatar + name */}
                        <div className="flex items-center gap-2.5 mb-1">
                          <div className="w-6 h-6 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
                            <span className="text-teal-700 text-[10px] font-bold">
                              {contact.full_name?.charAt(0)?.toUpperCase() ?? '?'}
                            </span>
                          </div>
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {contact.full_name}
                          </p>
                        </div>

                        {/* Email */}
                        {contact.email && (
                          <p className="text-xs text-gray-400 truncate mb-2">{contact.email}</p>
                        )}

                        {/* Stage badge */}
                        <div className="flex items-center gap-1 mb-1">
                          <span
                            className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: stage.color }}
                          />
                          <span className="text-[11px] text-gray-500">{stage.name}</span>
                        </div>

                        {/* Stage selector */}
                        <StageSelector
                          contactId={contact.id}
                          stages={stages}
                          currentStage={contact.pipeline_stage ?? defaultStage}
                        />
                      </div>
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
