import Link from 'next/link'
import CpqSettingsForm from './CpqSettingsForm'

export default function CpqSettingsPage() {
  return (
    <div className="px-8 py-8 max-w-2xl">
      <h1 className="text-xl font-bold text-ink mb-1">Quote Settings</h1>
      <p className="text-sm text-ink3 mb-6">Configure discount limits and approval workflows</p>

      <div className="flex items-center gap-1 border-b border-border-brand mb-6">
        <span className="px-3 py-2 text-sm font-medium text-teal-600 border-b-2 border-teal-600">
          Settings
        </span>
        <Link href="/settings/cpq/packages" className="px-3 py-2 text-sm text-ink3 hover:text-ink2">
          Packages
        </Link>
      </div>

      <CpqSettingsForm />
    </div>
  )
}
