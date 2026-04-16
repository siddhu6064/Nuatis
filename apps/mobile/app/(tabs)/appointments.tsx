import { useEffect, useState, useCallback } from 'react'
import { View, Text, FlatList, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { apiGet } from '../../lib/api'
import { colors } from '../../lib/colors'
import { cacheAppointments, getCachedAppointments } from '../../lib/offline-cache'

interface Appointment {
  id: string
  title: string
  start_time: string
  end_time: string
  status: string
  contact_id: string | null
  contact_name?: string | null
  contacts?: { full_name?: string }
}

const STATUS_COLORS: Record<string, string> = {
  scheduled: colors.blue,
  completed: colors.green,
  cancelled: colors.red,
  no_show: colors.orange,
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

export default function AppointmentsScreen() {
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [offline, setOffline] = useState(false)

  const fetchAppointments = useCallback(async () => {
    try {
      const res = await apiGet<{ data: Appointment[] } | Appointment[]>(
        '/api/appointments?limit=50'
      )
      const list: Appointment[] = Array.isArray(res)
        ? res
        : ((res as { data: Appointment[] }).data ?? [])
      setAppointments(list)
      await cacheAppointments(list)
      setOffline(false)
    } catch {
      const cached = await getCachedAppointments()
      setAppointments(
        cached.map((c) => ({
          id: c.id,
          title: c.title,
          start_time: c.start_time,
          end_time: c.end_time,
          status: c.status,
          contact_id: c.contact_id,
          contact_name: c.contact_name,
        }))
      )
      setOffline(true)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchAppointments()
  }, [fetchAppointments])

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    fetchAppointments()
  }, [fetchAppointments])

  const renderItem = ({ item }: { item: Appointment }) => {
    const statusColor = STATUS_COLORS[item.status] ?? colors.ink4
    const contactName = item.contacts?.full_name ?? item.contact_name
    return (
      <View style={styles.card}>
        <View style={styles.cardLeft}>
          <Text style={styles.cardDate}>{formatDate(item.start_time)}</Text>
          <Text style={styles.cardTime}>
            {formatTime(item.start_time)} – {formatTime(item.end_time)}
          </Text>
        </View>
        <View style={styles.cardRight}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          {contactName ? <Text style={styles.cardSub}>{contactName}</Text> : null}
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '22' }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>{item.status}</Text>
          </View>
        </View>
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Appointments</Text>
        {offline && <Text style={styles.offlineTag}>Offline</Text>}
      </View>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.blue} />
        </View>
      ) : (
        <FlatList
          data={appointments}
          keyExtractor={(a) => a.id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={appointments.length === 0 ? styles.center : { padding: 16 }}
          ListEmptyComponent={<Text style={styles.empty}>No appointments found</Text>}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  title: { fontSize: 24, fontWeight: '700', color: colors.ink },
  offlineTag: { fontSize: 11, color: colors.orange, fontWeight: '600' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { fontSize: 14, color: colors.ink4, fontStyle: 'italic' },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  cardLeft: { width: 80 },
  cardDate: { fontSize: 12, fontWeight: '600', color: colors.blue },
  cardTime: { fontSize: 11, color: colors.ink3, marginTop: 2 },
  cardRight: { flex: 1 },
  cardTitle: { fontSize: 14, fontWeight: '600', color: colors.ink },
  cardSub: { fontSize: 12, color: colors.ink3, marginTop: 2 },
  statusBadge: {
    alignSelf: 'flex-start',
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginTop: 6,
  },
  statusText: { fontSize: 10, fontWeight: '600', textTransform: 'capitalize' },
})
