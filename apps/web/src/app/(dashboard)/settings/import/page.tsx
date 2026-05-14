import CsvImporter from '@/components/import/CsvImporter'

export default function ImportPage() {
  return (
    <div className="px-8 py-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-ink">Import Contacts</h1>
        <p className="text-sm text-ink3 mt-0.5">
          Upload a CSV file to bulk-import contacts into your workspace.
        </p>
      </div>
      <CsvImporter />
    </div>
  )
}
