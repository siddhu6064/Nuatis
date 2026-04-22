import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth/authjs'
import { VERTICALS } from '@nuatis/shared'
import InventoryList from '@/components/inventory/InventoryList'

export default async function InventoryPage() {
  const session = await auth()
  const modules = (session?.user?.modules as Record<string, boolean> | undefined) ?? {}
  if (modules['crm'] === false) redirect('/dashboard')

  const vertical = session?.user?.vertical || 'sales_crm'
  const cfg = VERTICALS[vertical]
  const pageTitle = cfg?.inventory_label ?? 'Inventory'

  return <InventoryList pageTitle={pageTitle} />
}
