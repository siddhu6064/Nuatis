import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/server'
import BookingPageClient from './BookingPageClient'

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const supabase = createAdminClient()

  const { data: tenant } = await supabase
    .from('tenants')
    .select('business_name')
    .eq('booking_page_slug', slug)
    .eq('booking_page_enabled', true)
    .maybeSingle()

  const name = tenant?.business_name ?? 'Book an Appointment'
  const url = `https://nuatis.com/book/${slug}`

  return {
    description: `Book an appointment with ${name}`,
    openGraph: {
      title: `Book with ${name}`,
      description: `Schedule an appointment with ${name} online.`,
      url,
      type: 'website',
    },
  }
}

export default function BookingPage() {
  return <BookingPageClient />
}
