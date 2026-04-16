import { useEffect, useState, useCallback } from 'react'
import { View, Text, FlatList, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { apiGet } from '../../lib/api'
import { colors } from '../../lib/colors'

interface AppNotification {
  id: string
  type: string
  title: string
  body: string
  read: boolean
  created_at: string
}

const TYPE_COLORS: Record<string, string> = {
  appointment: colors.blue,
  task: colors.orange,
  lead: colors.purple,
  system: colors.ink4,
}

export default function NotificationsScreen() {
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(false)

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await apiGet<{ data: AppNotification[] } | AppNotification[]>(
        '/api/notifications?limit=50'
      )
      const list: AppNotification[] = Array.isArray(res)
        ? res
        : ((res as { data: AppNotification[] }).data ?? [])
      setNotifications(list)
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    fetchNotifications()
  }, [fetchNotifications])

  const renderItem = ({ item }: { item: AppNotification }) => {
    const typeColor = TYPE_COLORS[item.type] ?? colors.ink4
    return (
      <View style={[styles.card, !item.read && styles.cardUnread]}>
        <View style={styles.cardTop}>
          <View style={[styles.typeDot, { backgroundColor: typeColor }]} />
          <Text style={styles.cardTitle}>{item.title}</Text>
          {!item.read && <View style={styles.unreadDot} />}
        </View>
        <Text style={styles.cardBody}>{item.body}</Text>
        <Text style={styles.cardDate}>{new Date(item.created_at).toLocaleString()}</Text>
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Notifications</Text>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.blue} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.empty}>No notifications yet</Text>
          <Text style={styles.subEmpty}>
            You'll see alerts for appointments, tasks, and leads here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(n) => n.id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={notifications.length === 0 ? styles.center : { padding: 16 }}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.empty}>No notifications yet</Text>
              <Text style={styles.subEmpty}>
                You'll see alerts for appointments, tasks, and leads here.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.ink,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  empty: { fontSize: 16, fontWeight: '600', color: colors.ink3, textAlign: 'center' },
  subEmpty: { fontSize: 13, color: colors.ink4, textAlign: 'center', marginTop: 8 },
  card: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardUnread: { borderColor: colors.blue + '44', backgroundColor: colors.blue + '08' },
  cardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 8 },
  typeDot: { width: 8, height: 8, borderRadius: 4 },
  cardTitle: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.ink },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.blue,
  },
  cardBody: { fontSize: 13, color: colors.ink2, lineHeight: 18 },
  cardDate: { fontSize: 11, color: colors.ink4, marginTop: 6 },
})
