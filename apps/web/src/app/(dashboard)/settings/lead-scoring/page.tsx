'use client'

import { useState, useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

// ─── Types ───────────────────────────────────────────────────────────────────

type Category = 'engagement' | 'profile' | 'behavior' | 'decay'

interface ScoringRule {
  id: string
  category: Category
  rule_key: string
  label: string
  description: string
  points: number
  active: boolean
  is_custom: boolean
}

interface RulesByCategory {
  engagement: ScoringRule[]
  profile: ScoringRule[]
  behavior: ScoringRule[]
  decay: ScoringRule[]
}

interface Distribution {
  grade: string
  count: number
  color: string
}

interface DistributionStats {
  distribution: Distribution[]
  total: number
  average: number
  median: number
}

const GRADE_COLORS: Record<string, string> = {
  A: '#16a34a',
  B: '#2563eb',
  C: '#ca8a04',
  D: '#ea580c',
  F: '#dc2626',
}

const CATEGORY_LABELS: Record<Category, string> = {
  engagement: 'Engagement',
  profile: 'Profile',
  behavior: 'Behavior',
  decay: 'Decay',
}

const CATEGORIES: Category[] = ['engagement', 'profile', 'behavior', 'decay']

// ─── Modal ───────────────────────────────────────────────────────────────────

interface AddRuleModalProps {
  onClose: () => void
  onSave: (rule: ScoringRule) => void
  authHeaders: Record<string, string>
}

function AddRuleModal({ onClose, onSave, authHeaders }: AddRuleModalProps) {
  const [category, setCategory] = useState<Category>('engagement')
  const [label, setLabel] = useState('')
  const [points, setPoints] = useState(5)
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ruleKey = label
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!label.trim()) {
      setError('Label is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/settings/lead-scoring/rules', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ category, rule_key: ruleKey, label, points, description }),
      })
      if (res.ok) {
        const data = (await res.json()) as ScoringRule
        onSave(data)
      } else {
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        setError(d.error ?? 'Failed to add rule')
      }
    } catch {
      setError('Failed to add rule')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-5">Add Custom Rule</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Label</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Attended Webinar"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            {ruleKey && (
              <p className="text-xs text-gray-400 mt-1">
                Key: <span className="font-mono">{ruleKey}</span>
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Points</label>
            <input
              type="number"
              value={points}
              onChange={(e) => setPoints(parseInt(e.target.value) || 0)}
              className="w-32 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="When does this rule apply?"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50"
            >
              {saving ? 'Adding...' : 'Add Rule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Rule Row ─────────────────────────────────────────────────────────────────

interface RuleRowProps {
  rule: ScoringRule
  onUpdate: (id: string, patch: Partial<ScoringRule>) => void
  onDelete: (id: string) => void
  authHeaders: Record<string, string>
}

function RuleRow({ rule, onUpdate, onDelete, authHeaders }: RuleRowProps) {
  const [points, setPoints] = useState(rule.points)
  const [deleting, setDeleting] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function savePoints(val: number) {
    try {
      await fetch(`/api/settings/lead-scoring/rules/${rule.id}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ points: val }),
      })
      onUpdate(rule.id, { points: val })
    } catch {
      // silent
    }
  }

  function handlePointsChange(val: number) {
    setPoints(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void savePoints(val), 600)
  }

  async function handleToggle() {
    const next = !rule.active
    onUpdate(rule.id, { active: next })
    try {
      await fetch(`/api/settings/lead-scoring/rules/${rule.id}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ active: next }),
      })
    } catch {
      onUpdate(rule.id, { active: rule.active }) // revert
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await fetch(`/api/settings/lead-scoring/rules/${rule.id}`, {
        method: 'DELETE',
        headers: authHeaders,
      })
      onDelete(rule.id)
    } catch {
      setDeleting(false)
    }
  }

  return (
    <div className="flex items-start gap-4 py-3 border-b border-gray-50 last:border-0">
      {/* Active toggle */}
      <button
        role="switch"
        aria-checked={rule.active}
        onClick={() => void handleToggle()}
        className={`mt-0.5 relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-1 ${
          rule.active ? 'bg-teal-600' : 'bg-gray-200'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
            rule.active ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>

      {/* Label + description */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900">{rule.label}</p>
        {rule.description && <p className="text-xs text-gray-400 mt-0.5">{rule.description}</p>}
      </div>

      {/* Points */}
      <input
        type="number"
        value={points}
        onChange={(e) => handlePointsChange(parseInt(e.target.value) || 0)}
        onBlur={() => void savePoints(points)}
        className="w-20 px-2 py-1 text-sm text-right border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
        title="Points"
      />
      <span className="text-xs text-gray-400 self-center">pts</span>

      {/* Delete (custom rules only) */}
      {rule.is_custom && (
        <button
          onClick={() => void handleDelete()}
          disabled={deleting}
          className="self-center text-gray-300 hover:text-red-400 transition-colors text-lg leading-none disabled:opacity-40"
          title="Delete rule"
        >
          ×
        </button>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LeadScoringSettingsPage() {
  const { data: session } = useSession()
  const token = (session as unknown as Record<string, unknown>)?.accessToken ?? ''
  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token as string}` } : {}),
  }

  const [rules, setRules] = useState<RulesByCategory>({
    engagement: [],
    profile: [],
    behavior: [],
    decay: [],
  })
  const [stats, setStats] = useState<DistributionStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Category>('engagement')
  const [showAddModal, setShowAddModal] = useState(false)
  const [rescoring, setRescoring] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 4000)
  }

  useEffect(() => {
    Promise.all([
      fetch('/api/settings/lead-scoring', { headers: authHeaders }).then((r) =>
        r.ok ? r.json() : null
      ),
      fetch('/api/settings/lead-scoring/distribution', { headers: authHeaders }).then((r) =>
        r.ok ? r.json() : null
      ),
    ])
      .then(([rulesData, distData]: [RulesByCategory | null, DistributionStats | null]) => {
        if (rulesData) setRules(rulesData)
        if (distData) setStats(distData)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function handleUpdate(id: string, patch: Partial<ScoringRule>) {
    setRules((prev) => {
      const next = { ...prev }
      for (const cat of CATEGORIES) {
        next[cat] = next[cat].map((r) => (r.id === id ? { ...r, ...patch } : r))
      }
      return next
    })
  }

  function handleDelete(id: string) {
    setRules((prev) => {
      const next = { ...prev }
      for (const cat of CATEGORIES) {
        next[cat] = next[cat].filter((r) => r.id !== id)
      }
      return next
    })
  }

  function handleAddRule(rule: ScoringRule) {
    setRules((prev) => ({
      ...prev,
      [rule.category]: [...prev[rule.category], rule],
    }))
    setShowAddModal(false)
  }

  async function handleRescoreAll() {
    if (!window.confirm('This will recalculate lead scores for all contacts. Continue?')) return

    setRescoring(true)
    try {
      const res = await fetch('/api/settings/lead-scoring/rescore-all', {
        method: 'POST',
        headers: authHeaders,
      })
      if (res.ok) {
        const d = (await res.json()) as { count?: number }
        showToast('success', `Re-scored ${d.count ?? 'all'} contacts successfully.`)
        // Refresh distribution
        const distRes = await fetch('/api/settings/lead-scoring/distribution', {
          headers: authHeaders,
        })
        if (distRes.ok) {
          const distData = (await distRes.json()) as DistributionStats
          setStats(distData)
        }
      } else {
        showToast('error', 'Re-score failed. Please try again.')
      }
    } catch {
      showToast('error', 'Re-score failed. Please try again.')
    } finally {
      setRescoring(false)
    }
  }

  if (loading) {
    return (
      <div className="px-8 py-8 max-w-3xl">
        <p className="text-sm text-gray-400">Loading lead scoring settings...</p>
      </div>
    )
  }

  const chartData: Distribution[] = stats?.distribution?.length
    ? stats.distribution
    : ['A', 'B', 'C', 'D', 'F'].map((g) => ({
        grade: g,
        count: 0,
        color: GRADE_COLORS[g] ?? '#6b7280',
      }))

  const activeRules = rules[activeTab]

  return (
    <div className="px-8 py-8 max-w-3xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900 mb-1">Lead Scoring</h1>
        <p className="text-sm text-gray-500">
          Configure how contacts are scored and graded automatically.
        </p>
      </div>

      {/* Score Distribution */}
      <div className="rounded-xl border border-gray-100 bg-white p-6 space-y-4">
        <p className="text-sm font-semibold text-gray-900">Score Distribution</p>

        {/* Summary stats */}
        {stats && (
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-lg font-bold text-gray-900">{stats.total.toLocaleString()}</p>
              <p className="text-xs text-gray-500 mt-0.5">Total Contacts</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-lg font-bold text-gray-900">
                {typeof stats.average === 'number' ? stats.average.toFixed(1) : '—'}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">Average Score</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-lg font-bold text-gray-900">
                {typeof stats.median === 'number' ? stats.median : '—'}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">Median Score</p>
            </div>
          </div>
        )}

        {/* Bar chart */}
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <XAxis dataKey="grade" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {chartData.map((entry) => (
                  <rect key={entry.grade} fill={entry.color ?? GRADE_COLORS[entry.grade]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Grade legend */}
        <div className="flex items-center gap-4 flex-wrap">
          {(['A', 'B', 'C', 'D', 'F'] as const).map((g) => (
            <span key={g} className="flex items-center gap-1.5 text-xs text-gray-500">
              <span
                className="inline-block w-3 h-3 rounded-sm"
                style={{ backgroundColor: GRADE_COLORS[g] }}
              />
              Grade {g}
            </span>
          ))}
        </div>
      </div>

      {/* Rules Editor */}
      <div className="rounded-xl border border-gray-100 bg-white p-6 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-900">Scoring Rules</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-3 py-1.5 text-xs font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
          >
            + Add Custom Rule
          </button>
        </div>

        {/* Category tabs */}
        <div className="flex items-center gap-1 border-b border-gray-100">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveTab(cat)}
              className={`px-3 py-2 text-sm transition-colors border-b-2 -mb-px ${
                activeTab === cat
                  ? 'border-teal-600 text-teal-700 font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              {CATEGORY_LABELS[cat]}
              {rules[cat].length > 0 && (
                <span className="ml-1.5 text-xs text-gray-400">({rules[cat].length})</span>
              )}
            </button>
          ))}
        </div>

        {/* Rules list */}
        {activeRules.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No rules in this category yet.</p>
        ) : (
          <div>
            {activeRules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
                authHeaders={authHeaders}
              />
            ))}
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <p
          className={`text-sm px-3 py-2 rounded-lg ${
            toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
          }`}
        >
          {toast.msg}
        </p>
      )}

      {/* Re-score All */}
      <div className="rounded-xl border border-gray-100 bg-white p-6 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-900">Re-score All Contacts</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Recalculate scores and grades for every contact based on the current rules.
          </p>
        </div>
        <button
          onClick={() => void handleRescoreAll()}
          disabled={rescoring}
          className="px-4 py-2 text-sm font-medium bg-white text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {rescoring ? 'Re-scoring...' : 'Re-score All'}
        </button>
      </div>

      {/* Add Rule Modal */}
      {showAddModal && (
        <AddRuleModal
          onClose={() => setShowAddModal(false)}
          onSave={handleAddRule}
          authHeaders={authHeaders}
        />
      )}
    </div>
  )
}
