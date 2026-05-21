import { Suspense } from 'react'
import CollectPageClient from './CollectPageClient'

export default function CollectPage({ params }: { params: { slug: string } }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <CollectPageClient slug={params.slug} />
    </Suspense>
  )
}
