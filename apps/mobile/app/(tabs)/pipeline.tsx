import { useEffect, useState, useCallback } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  ActionSheetIOS,
  Platform,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { apiGet, apiPut } from '../../lib/api'
import { colors, lifecycleColors } from '../../lib/colors'

const STAGES = [
  'lead',
  'marketing_qualified',
  'sales_qualified',
  'opportunity',
  'customer',
  'evangelist',
]

const STAGE_LABELS: Record<string, string> = {
  lead: 'Lead',
  marketing_qualified: 'MQL',
  sales_qualified: 'SQL',
  opportunity: 'Opportunity',
  customer: 'Customer',
  evangelist: 'Evangelist',
}

interface Contact {
  id: string
  full_name: string
  lead_score: number | null
  lead_grade: string | null
  lifecycle_stage: string
}

type Pipeline = Record<string, Contact[]>

export default function PipelineScreen() {
  const [pipeline, setPipeline] = useState<Pipeline>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchPipeline = useCallback(async () => {
    try {
      const res = await apiGet<{ data: Contact[] } | Contact[]>('/api/contacts?limit=200')
      const list: Contact[] = Array.isArray(res) ? res : ((res as { data: Contact[] }).data ?? [])
      const grouped: Pipeline = {}
      for (const stage of STAGES) grouped[stage] = []
      for (const c of list) {
        const s = c.lifecycle_stage ?? 'lead'
        if (grouped[s]) grouped[s].push(c)
      }
      setPipeline(grouped)
    } catch (e) {
      console.error('[pipeline]', e)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchPipeline()
  }, [fetchPipeline])

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    fetchPipeline()
  }, [fetchPipeline])

  function moveContact(contact: Contact) {
    const options = STAGES.map((s) => STAGE_LABELS[s])
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...options, 'Cancel'],
          cancelButtonIndex: options.length,
          title: `Move ${contact.full_name}`,
        },
        (idx) => {
          if (idx < options.length) applyMove(contact, STAGES[idx])
        }
      )
    } else {
      Alert.alert(`Move ${contact.full_name}`, 'Select new stage', [
        ...STAGES.map((s) => ({ text: STAGE_LABELS[s], onPress: () => applyMove(contact, s) })),
        { text: 'Cancel', style: 'cancel' },
      ])
    }
  }

  async function applyMove(contact: Contact, newStage: string) {
    try {
      await apiPut(`/api/contacts/${contact.id}`, { lifecycle_stage: newStage })
      setPipeline((prev) => {
        const next = { ...prev }
        for (const s of STAGES) next[s] = (next[s] ?? []).filter((c) => c.id !== contact.id)
        if (next[newStage])
          next[newStage] = [...next[newStage], { ...contact, lifecycle_stage: newStage }]
        return next
      })
    } catch {
      Alert.alert('Error', 'Failed to update stage')
    }
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

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Pipeline</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.scroll}
      >
        {STAGES.map((stage) => {
          const stageColor = lifecycleColors[stage] ?? colors.ink4
          const contacts = pipeline[stage] ?? []
          return (
            <View key={stage} style={styles.column}>
              <View style={[styles.columnHeader, { borderTopColor: stageColor }]}>
                <Text style={[styles.columnTitle, { color: stageColor }]}>
                  {STAGE_LABELS[stage]}
                </Text>
                <Text style={styles.columnCount}>{contacts.length}</Text>
              </View>
              <ScrollView style={styles.columnScroll} nestedScrollEnabled>
                {contacts.length === 0 ? (
                  <Text style={styles.emptyColumn}>Empty</Text>
                ) : (
                  contacts.map((c) => (
                    <TouchableOpacity
                      key={c.id}
                      style={styles.contactCard}
                      onPress={() => moveContact(c)}
                    >
                      <Text style={styles.contactName}>{c.full_name}</Text>
                      {c.lead_grade && (
                        <Text style={styles.contactGrade}>Grade {c.lead_grade}</Text>
                      )}
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>
            </View>
          )
        })}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.ink,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  scroll: { paddingHorizontal: 12, paddingBottom: 16 },
  column: {
    width: 180,
    marginHorizontal: 6,
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  columnHeader: {
    borderTopWidth: 3,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  columnTitle: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase' },
  columnCount: { fontSize: 13, fontWeight: '600', color: colors.ink4 },
  columnScroll: { maxHeight: 500, paddingHorizontal: 8, paddingBottom: 8 },
  emptyColumn: {
    fontSize: 12,
    color: colors.ink4,
    fontStyle: 'italic',
    padding: 8,
    textAlign: 'center',
  },
  contactCard: {
    backgroundColor: colors.paper,
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  contactName: { fontSize: 13, fontWeight: '600', color: colors.ink },
  contactGrade: { fontSize: 11, color: colors.ink3, marginTop: 2 },
})
