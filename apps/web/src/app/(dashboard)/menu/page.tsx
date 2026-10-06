import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth/authjs'
import MenuManager from '@/components/menu/MenuManager'

/**
 * Menu administration, gated on the `pos` module.
 *
 * `modules['pos'] === false` is an explicit opt-out and redirects. An absent
 * key does NOT redirect: the API is the authority on entitlement — the page
 * surfaces the 402/403 it returns — and failing closed here on a missing key
 * would hide the screen from a tenant the API would have allowed, which is
 * how the sidebar's own `!== false` check already behaves.
 */
export default async function MenuPage() {
  const session = await auth()
  const modules = (session?.user?.modules as Record<string, boolean> | undefined) ?? {}
  if (modules['pos'] === false) redirect('/dashboard')

  return <MenuManager />
}
