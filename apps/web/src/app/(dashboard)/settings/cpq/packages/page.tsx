import PackageManager from './PackageManager'

export default function PackagesPage() {
  return (
    <div className="px-8 py-8 max-w-3xl">
      <h1 className="text-xl font-bold text-gray-900 mb-1">Service Packages</h1>
      <p className="text-sm text-gray-500 mb-6">
        Bundle services together with discounted pricing for your quotes
      </p>
      <PackageManager />
    </div>
  )
}
