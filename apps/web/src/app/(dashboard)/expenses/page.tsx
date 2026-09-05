import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth/authjs'
import ExpensesList from '@/components/expenses/ExpensesList'

export default async function ExpensesPage() {
  const session = await auth()
  const modules = (session?.user?.modules as Record<string, boolean> | undefined) ?? {}
  if (modules['expenses'] === false) redirect('/dashboard')

  return <ExpensesList />
}
