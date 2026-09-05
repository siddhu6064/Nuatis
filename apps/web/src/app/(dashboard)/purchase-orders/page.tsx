import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth/authjs'
import PurchaseOrdersPage from '@/components/purchase-orders/PurchaseOrdersPage'

export default async function PurchaseOrdersRoute() {
  const session = await auth()
  const modules = (session?.user?.modules as Record<string, boolean> | undefined) ?? {}
  if (modules['crm'] === false) redirect('/dashboard')

  return <PurchaseOrdersPage />
}
