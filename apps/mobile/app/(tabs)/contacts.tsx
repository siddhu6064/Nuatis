import { useEffect, useState, useCallback } from 'react'
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { apiGet } from '../../lib/api'
import { colors, lifecycleColors } from '../../lib/colors'
import { cacheContacts, getCachedContacts } from '../../lib/offline-cache'

interface Contact {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  lifecycle_stage: string | null
  lead_score: number | null
  lead_grade: string | null
}

export default function ContactsScreen() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [offline, setOffline] = useState(false)

  const fetchContacts = useCallback(async (q: string) => {
    try {
      const path = q
        ? `/api/contacts?q=${encodeURIComponent(q)}&limit=50`
        : '/api/contacts?limit=50'
      const res = await apiGet<{ data: Contact[] }>(path)
      const list = res.data ?? (res as unknown as Contact[])
      setContacts(list)
      if (!q) await cacheContacts(list)
      setOffline(false)
    } catch {
      if (!q) {
        const cached = await getCachedContacts()
        setContacts(cached)
        setOffline(true)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchContacts('')
  }, [fetchContacts])

  useEffect(() => {
    const t = setTimeout(() => fetchContacts(query), 300)
    return () => clearTimeout(t)
  }, [query, fetchContacts])

  const renderItem = ({ item }: { item: Contact }) => {
    const stage = item.lifecycle_stage ?? 'other'
    const badgeColor = lifecycleColors[stage] ?? colors.ink4
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => router.push(`/(tabs)/contacts/${item.id}` as never)}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{item.full_name.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.rowInfo}>
          <Text style={styles.name}>{item.full_name}</Text>
          {item.phone && <Text style={styles.sub}>{item.phone}</Text>}
        </View>
        <View style={[styles.badge, { backgroundColor: badgeColor + '22' }]}>
          <Text style={[styles.badgeText, { color: badgeColor }]}>{stage.replace('_', ' ')}</Text>
        </View>
      </TouchableOpacity>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Contacts</Text>
        {offline && <Text style={styles.offlineTag}>Offline</Text>}
      </View>
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          placeholder="Search contacts..."
          placeholderTextColor={colors.ink4}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.blue} />
        </View>
      ) : (
        <FlatList
          data={contacts}
          keyExtractor={(c) => c.id}
          renderItem={renderItem}
          contentContainerStyle={contacts.length === 0 ? styles.center : undefined}
          ListEmptyComponent={<Text style={styles.empty}>No contacts found</Text>}
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
  searchWrap: { paddingHorizontal: 16, paddingVertical: 8 },
  search: {
    backgroundColor: colors.white,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.ink,
    borderWidth: 1,
    borderColor: colors.border,
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { fontSize: 14, color: colors.ink4, fontStyle: 'italic' },
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
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.blue + '22',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: { fontSize: 16, fontWeight: '700', color: colors.blue },
  rowInfo: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600', color: colors.ink },
  sub: { fontSize: 12, color: colors.ink3, marginTop: 2 },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
})
