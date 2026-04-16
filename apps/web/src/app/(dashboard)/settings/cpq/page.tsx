import Link from 'next/link'
import CpqSettingsForm from './CpqSettingsForm'

export default function CpqSettingsPage() {
  return (
    <div className="px-8 py-8 max-w-2xl">
      <h1 className="text-xl font-bold text-gray-900 mb-1">Quote Settings</h1>
      <p className="text-sm text-gray-500 mb-6">Configure discount limits and approval workflows</p>

      <div className="flex items-center gap-1 border-b border-gray-200 mb-6">
        <span className="px-3 py-2 text-sm font-medium text-teal-600 border-b-2 border-teal-600">
          Settings
        </span>
        <Link
          href="/settings/cpq/packages"
          className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
        >
          Packages
        </Link>
      </div>

      <CpqSettingsForm />
    </div>
  )
}
