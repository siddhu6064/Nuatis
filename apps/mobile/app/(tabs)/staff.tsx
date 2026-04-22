import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Modal,
  ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { apiGet } from '../../lib/api'
import { colors } from '../../lib/colors'

interface StaffMember {
  id: string
  name: string
  role: string
  email: string | null
  phone: string | null
  color_hex: string
  is_active: boolean
  availability: Record<string, { enabled?: boolean; start?: string; end?: string }> | null
  notes: string | null
}

interface Shift {
  id: string
  staff_id: string
  date: string
  start_time: string
  end_time: string
  notes: string | null
  staff_name?: string | null
  staff_color?: string | null
}

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const DAY_LABEL: Record<string, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
}

function summarize(av: StaffMember['availability']): string {
  if (!av) return 'No availability set'
  const enabled = DAY_KEYS.filter((d) => av[d]?.enabled)
  if (enabled.length === 0) return 'No availability set'
  const groups: Array<{ days: string[]; start: string; end: string }> = []
  for (const d of enabled) {
    const cur = av[d]!
    const start = cur.start ?? '09:00'
    const end = cur.end ?? '17:00'
    const last = groups[groups.length - 1]
    const lastIdx = last ? DAY_KEYS.indexOf(last.days[last.days.length - 1]! as never) : -1
    const thisIdx = DAY_KEYS.indexOf(d)
    if (last && last.start === start && last.end === end && thisIdx === lastIdx + 1) {
      last.days.push(d)
    } else {
      groups.push({ days: [d], start, end })
    }
  }
  return groups
    .map((g) => {
      const label =
        g.days.length === 1
          ? DAY_LABEL[g.days[0]!]
          : `${DAY_LABEL[g.days[0]!]}–${DAY_LABEL[g.days[g.days.length - 1]!]}`
      return `${label} ${g.start}–${g.end}`
    })
    .join(', ')
}

function todayIso(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function StaffScreen() {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selected, setSelected] = useState<StaffMember | null>(null)

  const fetchAll = useCallback(async () => {
    try {
      const today = todayIso()
      const [staffRes, shiftsRes] = await Promise.all([
        apiGet<{ data: StaffMember[] }>('/api/staff'),
        apiGet<{ data: Shift[] }>(`/api/staff/shifts?start_date=${today}&end_date=${today}`),
      ])
      setStaff(staffRes.data ?? [])
      setShifts(shiftsRes.data ?? [])
    } catch {
      // keep state
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  const sections = useMemo(
    () => [
      { title: 'Roster', data: staff, kind: 'staff' as const },
      {
        title: "Today's Shifts",
        data: [...shifts].sort((a, b) => a.start_time.localeCompare(b.start_time)),
        kind: 'shift' as const,
      },
    ],
    [staff, shifts]
  )

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.blue} />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Staff</Text>
      </View>
      <SectionList
        sections={sections as never}
        keyExtractor={(item: StaffMember | Shift) => item.id}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader}>{(section as { title: string }).title}</Text>
        )}
        renderItem={({ item, section }) => {
          const kind = (section as { kind: 'staff' | 'shift' }).kind
          if (kind === 'staff') {
            const m = item as StaffMember
            return (
              <TouchableOpacity style={styles.row} onPress={() => setSelected(m)}>
                <View style={[styles.dot, { backgroundColor: m.color_hex }]} />
                <View style={styles.rowInfo}>
                  <Text style={styles.name}>{m.name}</Text>
                  <Text style={styles.sub}>{m.role}</Text>
                  {m.email ? <Text style={styles.muted}>{m.email}</Text> : null}
                  {m.phone ? <Text style={styles.muted}>{m.phone}</Text> : null}
                </View>
              </TouchableOpacity>
            )
          }
          const s = item as Shift
          return (
            <View style={styles.row}>
              <View style={[styles.dot, { backgroundColor: s.staff_color ?? colors.blue }]} />
              <View style={styles.rowInfo}>
                <Text style={styles.name}>{s.staff_name ?? '—'}</Text>
                <Text style={styles.sub}>
                  {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                </Text>
                {s.notes ? <Text style={styles.muted}>{s.notes}</Text> : null}
              </View>
            </View>
          )
        }}
        renderSectionFooter={({ section }) => {
          const s = section as { data: unknown[]; kind: 'staff' | 'shift' }
          if (s.data.length > 0) return null
          return (
            <Text style={styles.empty}>
              {s.kind === 'shift'
                ? 'No shifts scheduled today.'
                : 'No team members yet. Add members from the web app.'}
            </Text>
          )
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true)
              void fetchAll()
            }}
          />
        }
      />

      {selected !== null && (
        <Modal visible transparent animationType="slide" onRequestClose={() => setSelected(null)}>
          <View style={styles.modalBackdrop}>
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={() => setSelected(null)}
            />
            <View style={styles.modalSheet}>
              <View style={styles.modalHandle} />
              <ScrollView>
                <View style={styles.modalHeader}>
                  <View style={[styles.dot, { backgroundColor: selected.color_hex }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalTitle}>{selected.name}</Text>
                    <Text style={styles.sub}>{selected.role}</Text>
                  </View>
                </View>

                <View style={styles.fieldGrid}>
                  {selected.email ? (
                    <View style={styles.fieldRow}>
                      <Text style={styles.fieldLabel}>Email</Text>
                      <Text style={styles.fieldValue}>{selected.email}</Text>
                    </View>
                  ) : null}
                  {selected.phone ? (
                    <View style={styles.fieldRow}>
                      <Text style={styles.fieldLabel}>Phone</Text>
                      <Text style={styles.fieldValue}>{selected.phone}</Text>
                    </View>
                  ) : null}
                  <View style={styles.fieldRow}>
                    <Text style={styles.fieldLabel}>Availability</Text>
                    <Text style={styles.fieldValue}>{summarize(selected.availability)}</Text>
                  </View>
                  {selected.notes ? (
                    <View style={styles.fieldRow}>
                      <Text style={styles.fieldLabel}>Notes</Text>
                      <Text style={styles.fieldValue}>{selected.notes}</Text>
                    </View>
                  ) : null}
                </View>

                <Text style={styles.note}>Edit staff details from the web app.</Text>

                <TouchableOpacity onPress={() => setSelected(null)} style={styles.cancelBtn}>
                  <Text style={styles.cancelBtnText}>Close</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  title: { fontSize: 24, fontWeight: '700', color: colors.ink },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: {
    fontSize: 13,
    color: colors.ink4,
    fontStyle: 'italic',
    marginHorizontal: 16,
    marginVertical: 8,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.ink3,
    textTransform: 'uppercase',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    marginHorizontal: 16,
    marginBottom: 6,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 12,
  },
  rowInfo: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600', color: colors.ink },
  sub: { fontSize: 12, color: colors.ink3, marginTop: 2 },
  muted: { fontSize: 11, color: colors.ink4, marginTop: 2 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    maxHeight: '85%',
  },
  modalHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    marginBottom: 12,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.ink },
  fieldGrid: { marginBottom: 16 },
  fieldRow: { flexDirection: 'row', paddingVertical: 6 },
  fieldLabel: { width: 100, fontSize: 13, color: colors.ink4 },
  fieldValue: { flex: 1, fontSize: 13, color: colors.ink },
  note: { fontSize: 12, color: colors.ink4, fontStyle: 'italic', marginBottom: 12 },
  cancelBtn: { paddingVertical: 10, alignItems: 'center' },
  cancelBtnText: { color: colors.ink3, fontSize: 14 },
})
