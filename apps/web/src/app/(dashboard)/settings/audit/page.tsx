import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'

interface AuditEntry {
  id: string
  action: string
  resource_type: string
  resource_id: string | null
  user_id: string | null
  ip_address: string | null
  created_at: string
}

const ACTION_BADGES: Record<string, { bg: string; text: string }> = {
  create: { bg: 'bg-green-50', text: 'text-green-700' },
  update: { bg: 'bg-blue-50', text: 'text-blue-700' },
  delete: { bg: 'bg-red-50', text: 'text-red-600' },
}

export default async function AuditLogPage() {
  const session = await auth()
  const tenantId = session?.user?.tenantId

  const supabase = createAdminClient()
  const { data: entries } = await supabase
    .from('audit_log')
    .select('id, action, resource_type, resource_id, user_id, ip_address, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(100)
    .returns<AuditEntry[]>()

  const logs = entries ?? []

  return (
    <div className="px-8 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Audit Log</h1>
        <p className="text-sm text-gray-500 mt-0.5">Recent API activity for your account</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100">
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-sm font-medium text-gray-400">No audit entries yet</p>
            <p className="text-xs text-gray-300 mt-1">
              API activity will appear here as you use the platform
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Time</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Action</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Resource</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">ID</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((entry) => {
                const badge = ACTION_BADGES[entry.action] ?? {
                  bg: 'bg-gray-100',
                  text: 'text-gray-600',
                }
                return (
                  <tr
                    key={entry.id}
                    className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50"
                  >
                    <td className="px-6 py-3 text-xs text-gray-500">
                      {new Date(entry.created_at).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true,
                      })}
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badge.bg} ${badge.text}`}
                      >
                        {entry.action}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-700">{entry.resource_type}</td>
                    <td className="px-6 py-3 text-xs text-gray-400 font-mono truncate max-w-[120px]">
                      {entry.resource_id ?? '—'}
                    </td>
                    <td className="px-6 py-3 text-xs text-gray-400">{entry.ip_address ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
