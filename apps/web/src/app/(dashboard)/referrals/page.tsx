import ReferralsClient from './ReferralsClient'

export const metadata = { title: 'Refer & Earn — Nuatis' }

export default async function ReferralsPage() {
  // No server-side data fetch needed — client fetches from API
  return <ReferralsClient />
}
