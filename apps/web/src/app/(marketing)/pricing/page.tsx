import type { Metadata } from 'next'
import PricingClient from './PricingClient'

export const metadata: Metadata = {
  title: 'Pricing — Nuatis',
  description:
    'Simple, transparent pricing for Nuatis. Maya AI receptionist + CRM + automation. 7-day free trial on every plan.',
}

export default function PricingPage() {
  return <PricingClient />
}
