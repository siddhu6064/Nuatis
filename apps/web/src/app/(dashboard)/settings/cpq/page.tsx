import CpqSettingsForm from './CpqSettingsForm'

export default function CpqSettingsPage() {
  return (
    <div className="px-8 py-8 max-w-2xl">
      <h1 className="text-xl font-bold text-gray-900 mb-1">Quote Settings</h1>
      <p className="text-sm text-gray-500 mb-6">Configure discount limits and approval workflows</p>
      <CpqSettingsForm />
    </div>
  )
}
