import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Calendar } from 'react-native-calendars'
import type { DateData } from 'react-native-calendars'
import { router } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { apiGet } from '../../lib/api'
import { colors } from '../../lib/colors'
import { cacheAppointments, getCachedAppointments } from '../../lib/offline-cache'

// ── Types ─────────────────────────────────────────────────────────────────────

type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'completed'
  | 'no_show'
  | 'canceled'
  | 'rescheduled'
  | string

interface Appointment {
  id: string
  title: string
  start_time: string
  end_time: string
  status: AppointmentStatus
  contact_id: string | null
  contact_name?: string | null
  contacts?: { full_name?: string; phone?: string; email?: string } | null
  staff_members?: { id: string; name: string; color_hex: string } | null
}

// ── Status colors ─────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  scheduled: '#0d9488',
  confirmed: '#0d9488',
  completed: '#16a34a',
  no_show: '#f43f5e',
  canceled: '#9ca3af',
  rescheduled: '#f59e0b',
}

const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  completed: 'Completed',
  no_show: 'No Show',
  canceled: 'Canceled',
  rescheduled: 'Rescheduled',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AppointmentsScreen() {
  const [allAppointments, setAllAppointments] = useState<Appointment[]>([])
  const [selectedDate, setSelectedDate] = useState<string>(todayStr())
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [offline, setOffline] = useState(false)

  const fetchAppointments = useCallback(async () => {
    try {
      const res = await apiGet<{ data: Appointment[] } | Appointment[]>('/api/appointments')
      const list: Appointment[] = Array.isArray(res)
        ? res
        : ((res as { data: Appointment[] }).data ?? [])
      setAllAppointments(list)
      await cacheAppointments(
        list.map((a) => ({
          id: a.id,
          contact_id: a.contact_id,
          contact_name: a.contact_name ?? undefined,
          title: a.title,
          start_time: a.start_time,
          end_time: a.end_time,
          status: a.status,
          contacts: a.contacts ? { full_name: a.contacts.full_name } : undefined,
        }))
      )
      setOffline(false)
    } catch {
      const cached = await getCachedAppointments()
      setAllAppointments(
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

  // Push notification → refetch on new booking
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const type = notification.request.content.data?.type
      if (type === 'new_booking') {
        fetchAppointments()
      }
    })
    return () => sub.remove()
  }, [fetchAppointments])

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    fetchAppointments()
  }, [fetchAppointments])

  // ── Derived data ──────────────────────────────────────────────────────────────

  const markedDates = useMemo(() => {
    const marks: Record<
      string,
      {
        dots: { key: string; color: string; selectedDotColor: string }[]
        selected?: boolean
        selectedColor?: string
      }
    > = {}

    for (const appt of allAppointments) {
      const d = appt.start_time.slice(0, 10)
      if (!marks[d]) {
        marks[d] = { dots: [{ key: 'appt', color: '#0d9488', selectedDotColor: '#ffffff' }] }
      }
    }

    const existing = marks[selectedDate] ?? {}
    marks[selectedDate] = {
      ...existing,
      dots: existing.dots ?? [],
      selected: true,
      selectedColor: '#0d9488',
    }

    return marks
  }, [allAppointments, selectedDate])

  const dayAppointments = useMemo(
    () => allAppointments.filter((a) => a.start_time.slice(0, 10) === selectedDate),
    [allAppointments, selectedDate]
  )

  // ── Row render ────────────────────────────────────────────────────────────────

  const renderItem = useCallback(({ item }: { item: Appointment }) => {
    const statusColor = STATUS_COLOR[item.status] ?? '#9ca3af'
    const statusLabel = STATUS_LABEL[item.status] ?? item.status
    const contactName = item.contacts?.full_name ?? item.contact_name ?? null

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() =>
          router.push({
            pathname: '/(tabs)/appointments/[id]',
            params: { id: item.id, data: JSON.stringify(item) },
          })
        }
        activeOpacity={0.7}
      >
        <View style={styles.cardTimeCol}>
          <Text style={styles.cardTime}>{formatTime(item.start_time)}</Text>
          <Text style={styles.cardTimeSep}>–</Text>
          <Text style={styles.cardTime}>{formatTime(item.end_time)}</Text>
        </View>

        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {contactName ?? item.title}
          </Text>
          <Text style={styles.cardType} numberOfLines={1}>
            {item.title}
          </Text>
          {item.staff_members && (
            <View style={styles.staffRow}>
              <View style={[styles.staffDot, { backgroundColor: item.staff_members.color_hex }]} />
              <Text style={styles.staffName}>{item.staff_members.name}</Text>
            </View>
          )}
        </View>

        <View style={[styles.statusBadge, { backgroundColor: statusColor + '22' }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </TouchableOpacity>
    )
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Appointments</Text>
        {offline && <Text style={styles.offlineTag}>Offline</Text>}
      </View>

      <Calendar
        current={selectedDate}
        onDayPress={(day: DateData) => setSelectedDate(day.dateString)}
        markedDates={markedDates}
        markingType="multi-dot"
        theme={{
          todayTextColor: '#0d9488',
          arrowColor: '#0d9488',
          selectedDayBackgroundColor: '#0d9488',
          selectedDayTextColor: '#ffffff',
          dotColor: '#0d9488',
          monthTextColor: '#1a1814',
          dayTextColor: '#1a1814',
          textDisabledColor: '#9ca3af',
          calendarBackground: '#ffffff',
          textSectionTitleColor: '#7a7468',
        }}
        style={styles.calendar}
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.teal} />
        </View>
      ) : (
        <FlatList
          data={dayAppointments}
          keyExtractor={(a) => a.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />
          }
          contentContainerStyle={dayAppointments.length === 0 ? styles.center : styles.listContent}
          ListEmptyComponent={<Text style={styles.empty}>No appointments for this day</Text>}
        />
      )}
    </SafeAreaView>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

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
  calendar: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { fontSize: 14, color: colors.ink4, fontStyle: 'italic' },
  listContent: { padding: 16, gap: 8 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  cardTimeCol: { width: 64, alignItems: 'center' },
  cardTime: { fontSize: 11, fontWeight: '600', color: colors.ink3 },
  cardTimeSep: { fontSize: 10, color: colors.ink4 },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 14, fontWeight: '600', color: colors.ink },
  cardType: { fontSize: 12, color: colors.ink3, marginTop: 1 },
  staffRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  staffDot: { width: 8, height: 8, borderRadius: 4 },
  staffName: { fontSize: 11, color: colors.ink3 },
  statusBadge: {
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 3,
    alignSelf: 'center',
  },
  statusText: { fontSize: 10, fontWeight: '600' },
})
