import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth/authjs'
import { Suspense } from 'react'
import PipelineContent from './PipelineContent'

export default async function PipelinePage() {
  const session = await auth()
  const modules = (session?.user?.modules as Record<string, boolean> | undefined) ?? {}
  if (modules['pipeline'] === false) redirect('/dashboard')

  return (
    <Suspense fallback={null}>
      <PipelineContent />
    </Suspense>
  )
}
