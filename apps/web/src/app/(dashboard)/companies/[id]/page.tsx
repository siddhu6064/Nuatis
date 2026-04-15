import CompanyDetail from '@/components/companies/CompanyDetail'
import Link from 'next/link'

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <div className="px-8 py-8 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/companies" className="text-gray-400 hover:text-gray-600 text-sm">
          &larr; Companies
        </Link>
      </div>
      <CompanyDetail companyId={id} />
    </div>
  )
}
