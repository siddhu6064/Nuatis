import { PlatformIncidentDetail } from '@/components/admin-console/PlatformIncidentDetail'

export default async function PlatformIncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <PlatformIncidentDetail incidentId={id} />
}
