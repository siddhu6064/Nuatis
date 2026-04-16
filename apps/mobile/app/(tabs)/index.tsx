import { useEffect, useState, useCallback } from 'react'
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { apiGet } from '../../lib/api'
import { useAuth } from '../../lib/auth-context'
import { colors } from '../../lib/colors'

interface DashboardData {
  todayAppointments: Array<{
    id: string
    title: string
    start_time: string
    contacts?: { full_name?: string }
  }>
  overdueTasks: Array<{
    id: string
    title: string
    due_date: string
    priority: string
    contacts?: { full_name?: string }
  }>
  recentActivity: Array<{
    id: string
    type: string
    body: string
    created_at: string
    contacts?: { full_name?: string }
  }>
  stats: { contactsCount: number; appointmentsThisWeek: number; openDealsValue: number }
}

export default function Dashboard() {
  const { user, logout } = useAuth()
  const [data, setData] = useState<DashboardData | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const res = await apiGet<DashboardData>('/api/insights/dashboard')
      setData(res)
    } catch (e) {
      console.error('[dashboard]', e)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await fetchData()
    setRefreshing(false)
  }, [fetchData])

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Hi, {user?.name?.split(' ')[0] || 'there'}</Text>
            <Text style={styles.date}>
              {new Date().toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </Text>
          </View>
          <TouchableOpacity onPress={logout}>
            <Text style={styles.logoutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.statsRow}>
          <StatCard label="Contacts" value={data?.stats.contactsCount ?? '-'} />
          <StatCard label="This Week" value={data?.stats.appointmentsThisWeek ?? '-'} />
          <StatCard
            label="Pipeline"
            value={
              data?.stats.openDealsValue ? `$${Math.round(data.stats.openDealsValue / 1000)}k` : '-'
            }
          />
        </View>

        <Section title="Today's Appointments">
          {data?.todayAppointments.length === 0 ? (
            <Text style={styles.empty}>No appointments today</Text>
          ) : (
            data?.todayAppointments.map((a) => (
              <View key={a.id} style={styles.card}>
                <Text style={styles.cardTime}>
                  {new Date(a.start_time).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </Text>
                <Text style={styles.cardTitle}>{a.title}</Text>
                {a.contacts?.full_name && (
                  <Text style={styles.cardSub}>{a.contacts.full_name}</Text>
                )}
              </View>
            ))
          )}
        </Section>

        <Section title="Overdue Tasks">
          {data?.overdueTasks.length === 0 ? (
            <Text style={styles.empty}>No overdue tasks</Text>
          ) : (
            data?.overdueTasks.map((t) => (
              <View key={t.id} style={[styles.card, styles.cardWarning]}>
                <Text style={styles.cardTitle}>{t.title}</Text>
                <Text style={styles.cardSub}>Due {new Date(t.due_date).toLocaleDateString()}</Text>
              </View>
            ))
          )}
        </Section>

        <Section title="Recent Activity">
          {data?.recentActivity.map((a) => (
            <View key={a.id} style={styles.card}>
              <Text style={styles.cardType}>{a.type}</Text>
              <Text style={styles.cardTitle}>{a.body}</Text>
              <Text style={styles.cardSub}>{new Date(a.created_at).toLocaleString()}</Text>
            </View>
          ))}
        </Section>
      </ScrollView>
    </SafeAreaView>
  )
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 8,
  },
  greeting: { fontSize: 24, fontWeight: '700', color: colors.ink },
  date: { fontSize: 14, color: colors.ink3, marginTop: 2 },
  logoutText: { color: colors.blue, fontSize: 14 },
  statsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 16 },
  stat: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statValue: { fontSize: 20, fontWeight: '700', color: colors.ink },
  statLabel: { fontSize: 11, color: colors.ink3, marginTop: 2 },
  section: { paddingHorizontal: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: colors.ink, marginBottom: 8 },
  card: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardWarning: { borderColor: colors.orange },
  cardTime: { fontSize: 12, color: colors.blue, fontWeight: '600', marginBottom: 2 },
  cardType: { fontSize: 10, color: colors.ink4, textTransform: 'uppercase', marginBottom: 2 },
  cardTitle: { fontSize: 14, color: colors.ink, fontWeight: '500' },
  cardSub: { fontSize: 12, color: colors.ink3, marginTop: 2 },
  empty: { fontSize: 13, color: colors.ink4, fontStyle: 'italic', padding: 8 },
})
