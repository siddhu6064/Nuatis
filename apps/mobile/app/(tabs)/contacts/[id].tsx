import { useEffect, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Linking,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, router } from 'expo-router'
import { apiGet } from '../../../lib/api'
import { colors, lifecycleColors, gradeColors } from '../../../lib/colors'

interface ContactDetail {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  lifecycle_stage: string | null
  lead_score: number | null
  lead_grade: string | null
  company: string | null
  title: string | null
  notes: string | null
  created_at: string
}

interface Activity {
  id: string
  type: string
  body: string
  created_at: string
}

export default function ContactDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const [contact, setContact] = useState<ContactDetail | null>(null)
  const [activity, setActivity] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    ;(async () => {
      try {
        const [c, acts] = await Promise.all([
          apiGet<ContactDetail>(`/api/contacts/${id}`),
          apiGet<Activity[] | { data: Activity[] }>(`/api/contacts/${id}/activity`),
        ])
        setContact(c)
        setActivity(Array.isArray(acts) ? acts : (acts.data ?? []))
      } catch (e) {
        console.error('[contact-detail]', e)
      } finally {
        setLoading(false)
      }
    })()
  }, [id])

  function callPhone() {
    if (!contact?.phone) return
    Linking.openURL(`tel:${contact.phone}`).catch(() =>
      Alert.alert('Error', 'Unable to open phone app')
    )
  }

  function sendSms() {
    if (!contact?.phone) return
    Linking.openURL(`sms:${contact.phone}`).catch(() =>
      Alert.alert('Error', 'Unable to open messages app')
    )
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.blue} />
        </View>
      </SafeAreaView>
    )
  }

  if (!contact) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.empty}>Contact not found</Text>
        </View>
      </SafeAreaView>
    )
  }

  const stage = contact.lifecycle_stage ?? 'other'
  const stageColor = lifecycleColors[stage] ?? colors.ink4
  const gradeColor = contact.lead_grade
    ? (gradeColors[contact.lead_grade] ?? colors.ink4)
    : colors.ink4

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.back} onPress={() => router.back()}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
      <ScrollView>
        <View style={styles.heroCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{contact.full_name.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.name}>{contact.full_name}</Text>
          {contact.title && <Text style={styles.jobTitle}>{contact.title}</Text>}
          {contact.company && <Text style={styles.company}>{contact.company}</Text>}
          <View style={styles.badges}>
            <View style={[styles.badge, { backgroundColor: stageColor + '22' }]}>
              <Text style={[styles.badgeText, { color: stageColor }]}>
                {stage.replace('_', ' ')}
              </Text>
            </View>
            {contact.lead_grade && (
              <View style={[styles.badge, { backgroundColor: gradeColor + '22' }]}>
                <Text style={[styles.badgeText, { color: gradeColor }]}>
                  Grade {contact.lead_grade}
                </Text>
              </View>
            )}
            {contact.lead_score != null && (
              <View style={[styles.badge, { backgroundColor: colors.border }]}>
                <Text style={[styles.badgeText, { color: colors.ink3 }]}>
                  Score {contact.lead_score}
                </Text>
              </View>
            )}
          </View>
        </View>

        {(contact.phone || contact.email) && (
          <View style={styles.actions}>
            {contact.phone && (
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: colors.green }]}
                onPress={callPhone}
              >
                <Text style={styles.actionText}>Call</Text>
              </TouchableOpacity>
            )}
            {contact.phone && (
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: colors.blue }]}
                onPress={sendSms}
              >
                <Text style={styles.actionText}>SMS</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contact Info</Text>
          {contact.email && <InfoRow label="Email" value={contact.email} />}
          {contact.phone && <InfoRow label="Phone" value={contact.phone} />}
          <InfoRow label="Member since" value={new Date(contact.created_at).toLocaleDateString()} />
          {contact.notes && <InfoRow label="Notes" value={contact.notes} />}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Activity</Text>
          {activity.length === 0 ? (
            <Text style={styles.empty}>No activity yet</Text>
          ) : (
            activity.slice(0, 10).map((a) => (
              <View key={a.id} style={styles.activityRow}>
                <Text style={styles.activityType}>{a.type}</Text>
                <Text style={styles.activityBody}>{a.body}</Text>
                <Text style={styles.activityDate}>{new Date(a.created_at).toLocaleString()}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  back: { paddingHorizontal: 16, paddingVertical: 10 },
  backText: { color: colors.blue, fontSize: 15 },
  heroCard: {
    alignItems: 'center',
    backgroundColor: colors.white,
    marginHorizontal: 16,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.blue + '22',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  avatarText: { fontSize: 28, fontWeight: '700', color: colors.blue },
  name: { fontSize: 20, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  jobTitle: { fontSize: 14, color: colors.ink3, marginTop: 2, textAlign: 'center' },
  company: { fontSize: 13, color: colors.ink4, marginTop: 1, textAlign: 'center' },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
    justifyContent: 'center',
  },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  actions: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 12 },
  actionBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  actionText: { color: colors.white, fontWeight: '600', fontSize: 15 },
  section: { paddingHorizontal: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: colors.ink, marginBottom: 8 },
  infoRow: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: 10,
    padding: 12,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoLabel: { width: 90, fontSize: 13, color: colors.ink4, fontWeight: '500' },
  infoValue: { flex: 1, fontSize: 13, color: colors.ink },
  activityRow: {
    backgroundColor: colors.white,
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  activityType: { fontSize: 10, color: colors.ink4, textTransform: 'uppercase', marginBottom: 2 },
  activityBody: { fontSize: 13, color: colors.ink },
  activityDate: { fontSize: 11, color: colors.ink4, marginTop: 4 },
  empty: { fontSize: 13, color: colors.ink4, fontStyle: 'italic', padding: 8 },
})
