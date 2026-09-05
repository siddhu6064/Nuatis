import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth/authjs'
import ExpenseForm from './ExpenseForm'

export default async function NewExpensePage() {
  const session = await auth()
  const modules = (session?.user?.modules as Record<string, boolean> | undefined) ?? {}
  if (modules['expenses'] === false) redirect('/dashboard')

  return (
    <div className="px-8 py-8 max-w-2xl">
      <h1 className="text-xl font-bold text-ink mb-6">Log Expense</h1>
      <ExpenseForm />
    </div>
  )
}
