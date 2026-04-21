import { Suspense } from 'react'
import DealsKanban from '@/components/deals/DealsKanban'

export default function DealsPage() {
  return (
    <Suspense fallback={null}>
      <DealsKanban />
    </Suspense>
  )
}
