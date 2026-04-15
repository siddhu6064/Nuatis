import DealDetail from '@/components/deals/DealDetail'
import Link from 'next/link'

export default async function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <div className="px-8 py-8 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/deals" className="text-gray-400 hover:text-gray-600 text-sm">
          &larr; Deals
        </Link>
      </div>
      <DealDetail dealId={id} />
    </div>
  )
}
