import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth/authjs'
import OrdersBoard from '@/components/orders/OrdersBoard'

export default async function OrdersPage() {
  const session = await auth()
  const modules = (session?.user?.modules as Record<string, boolean> | undefined) ?? {}
  if (modules['orders'] === false) redirect('/dashboard')

  return <OrdersBoard />
}
