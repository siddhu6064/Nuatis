import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, router } from 'expo-router'
import { colors } from '../../../lib/colors'

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

// ── Status maps ───────────────────────────────────────────────────────────────

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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AppointmentDetailScreen() {
  const { data } = useLocalSearchParams<{ data: string }>()

  let appt: Appointment | null = null
  try {
    appt = JSON.parse(data ?? '') as Appointment
  } catch {
    // parse failure — show error state below
  }

  if (!appt) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.center}>
          <Text style={styles.errorText}>Could not load appointment details.</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.errorBack}>
            <Text style={styles.backText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  const statusColor = STATUS_COLOR[appt.status] ?? '#9ca3af'
  const statusLabel = STATUS_LABEL[appt.status] ?? appt.status
  const contactName = appt.contacts?.full_name ?? appt.contact_name ?? null

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Appointment</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {/* Status badge */}
        <View style={[styles.statusBadge, { backgroundColor: statusColor + '22' }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>

        <View style={styles.card}>
          {contactName && <Field label="Contact" value={contactName} />}
          <Field label="Type" value={appt.title} />
          <Field label="Date" value={formatDate(appt.start_time)} />
          <Field
            label="Time"
            value={`${formatTime(appt.start_time)} – ${formatTime(appt.end_time)}`}
          />

          {appt.staff_members && (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Staff</Text>
              <View style={styles.staffRow}>
                <View
                  style={[styles.staffDot, { backgroundColor: appt.staff_members.color_hex }]}
                />
                <Text style={styles.fieldValue}>{appt.staff_members.name}</Text>
              </View>
            </View>
          )}
        </View>
      </ScrollView>
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
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.white,
  },
  backBtn: { width: 80 },
  backText: { fontSize: 14, color: colors.teal, fontWeight: '600' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: colors.ink },
  body: { padding: 16, gap: 12 },
  statusBadge: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusText: { fontSize: 12, fontWeight: '700' },
  card: {
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 14,
  },
  field: { gap: 3 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fieldValue: { fontSize: 15, color: colors.ink },
  staffRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  staffDot: { width: 10, height: 10, borderRadius: 5 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  errorText: { fontSize: 14, color: colors.ink3 },
  errorBack: { paddingVertical: 8 },
})
