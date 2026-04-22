import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { apiGet, apiPost } from '../../lib/api'
import { colors } from '../../lib/colors'

interface InventoryItem {
  id: string
  name: string
  sku: string | null
  quantity: number
  reorder_threshold: number
  unit: string
  unit_cost: number | null
  supplier: string | null
  notes: string | null
}

function qtyColor(qty: number, thr: number): string {
  if (qty <= thr) return colors.red
  if (qty <= thr * 2) return colors.yellow
  return colors.green
}

export default function InventoryScreen() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<InventoryItem | null>(null)
  const [delta, setDelta] = useState('')
  const [reason, setReason] = useState('')
  const [adjusting, setAdjusting] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const fetchItems = useCallback(async () => {
    try {
      const res = await apiGet<{ data: InventoryItem[] }>('/api/inventory?limit=100')
      const list = res.data ?? (res as unknown as InventoryItem[])
      setItems(list)
    } catch {
      // keep existing list on error
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void fetchItems()
  }, [fetchItems])

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  const filtered = useMemo(() => {
    if (!query.trim()) return items
    const q = query.toLowerCase()
    return items.filter(
      (i) => i.name.toLowerCase().includes(q) || (i.sku ?? '').toLowerCase().includes(q)
    )
  }, [items, query])

  const openRow = (item: InventoryItem) => {
    setSelected(item)
    setDelta('')
    setReason('')
  }

  const handleAdjust = async () => {
    if (!selected) return
    const d = Number(delta)
    if (!Number.isFinite(d) || d === 0) {
      setToast('Delta must be a non-zero number')
      return
    }
    if (!reason.trim()) {
      setToast('Reason is required')
      return
    }
    setAdjusting(true)
    try {
      const updated = await apiPost<InventoryItem>(`/api/inventory/${selected.id}/adjust`, {
        delta: d,
        reason: reason.trim(),
      })
      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))
      setSelected(null)
      setToast('Quantity adjusted')
    } catch {
      setToast('Failed to adjust quantity')
    } finally {
      setAdjusting(false)
    }
  }

  const renderRow = ({ item }: { item: InventoryItem }) => {
    const color = qtyColor(item.quantity, item.reorder_threshold)
    return (
      <TouchableOpacity style={styles.row} onPress={() => openRow(item)}>
        <View style={styles.rowInfo}>
          <Text style={styles.name}>{item.name}</Text>
          {item.sku ? <Text style={styles.sub}>{item.sku}</Text> : null}
          {item.supplier ? <Text style={styles.supplier}>{item.supplier}</Text> : null}
        </View>
        <View style={[styles.badge, { backgroundColor: color + '22' }]}>
          <Text style={[styles.badgeText, { color }]}>
            {item.quantity} {item.unit}
          </Text>
        </View>
      </TouchableOpacity>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Inventory</Text>
      </View>
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          placeholder="Search name or SKU..."
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
          data={filtered}
          keyExtractor={(i) => i.id}
          renderItem={renderRow}
          contentContainerStyle={filtered.length === 0 ? styles.center : undefined}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true)
                void fetchItems()
              }}
            />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>No inventory items yet. Add items from the web app.</Text>
          }
        />
      )}

      {selected !== null && (
        <Modal visible transparent animationType="slide" onRequestClose={() => setSelected(null)}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalBackdrop}
          >
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={() => setSelected(null)}
            />
            <View style={styles.modalSheet}>
              <View style={styles.modalHandle} />
              <ScrollView>
                <Text style={styles.modalTitle}>{selected.name}</Text>

                <View style={styles.fieldGrid}>
                  {selected.sku ? (
                    <View style={styles.fieldRow}>
                      <Text style={styles.fieldLabel}>SKU</Text>
                      <Text style={styles.fieldValue}>{selected.sku}</Text>
                    </View>
                  ) : null}
                  <View style={styles.fieldRow}>
                    <Text style={styles.fieldLabel}>Quantity</Text>
                    <Text style={styles.fieldValue}>
                      {selected.quantity} {selected.unit}
                    </Text>
                  </View>
                  <View style={styles.fieldRow}>
                    <Text style={styles.fieldLabel}>Reorder at</Text>
                    <Text style={styles.fieldValue}>{selected.reorder_threshold}</Text>
                  </View>
                  {selected.unit_cost != null ? (
                    <View style={styles.fieldRow}>
                      <Text style={styles.fieldLabel}>Unit cost</Text>
                      <Text style={styles.fieldValue}>
                        ${Number(selected.unit_cost).toFixed(2)}
                      </Text>
                    </View>
                  ) : null}
                  {selected.supplier ? (
                    <View style={styles.fieldRow}>
                      <Text style={styles.fieldLabel}>Supplier</Text>
                      <Text style={styles.fieldValue}>{selected.supplier}</Text>
                    </View>
                  ) : null}
                  {selected.notes ? (
                    <View style={styles.fieldRow}>
                      <Text style={styles.fieldLabel}>Notes</Text>
                      <Text style={styles.fieldValue}>{selected.notes}</Text>
                    </View>
                  ) : null}
                </View>

                <Text style={styles.adjustTitle}>Adjust quantity</Text>
                <View style={styles.stepperRow}>
                  <TouchableOpacity
                    style={styles.stepperBtn}
                    onPress={() => {
                      const cur = Number(delta || '0')
                      setDelta(String(cur - 1))
                    }}
                  >
                    <Text style={styles.stepperText}>−</Text>
                  </TouchableOpacity>
                  <TextInput
                    style={styles.stepperInput}
                    value={delta}
                    onChangeText={setDelta}
                    keyboardType="numbers-and-punctuation"
                    placeholder="0"
                    placeholderTextColor={colors.ink4}
                  />
                  <TouchableOpacity
                    style={styles.stepperBtn}
                    onPress={() => {
                      const cur = Number(delta || '0')
                      setDelta(String(cur + 1))
                    }}
                  >
                    <Text style={styles.stepperText}>+</Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={styles.reasonInput}
                  placeholder="Reason (required)"
                  placeholderTextColor={colors.ink4}
                  value={reason}
                  onChangeText={setReason}
                />

                <TouchableOpacity
                  style={[styles.primaryBtn, adjusting && { opacity: 0.6 }]}
                  onPress={handleAdjust}
                  disabled={adjusting}
                >
                  <Text style={styles.primaryBtnText}>{adjusting ? 'Adjusting…' : 'Adjust'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setSelected(null)} style={styles.cancelBtn}>
                  <Text style={styles.cancelBtnText}>Close</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      )}

      {toast ? (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  title: { fontSize: 24, fontWeight: '700', color: colors.ink },
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
  rowInfo: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600', color: colors.ink },
  sub: { fontSize: 12, color: colors.ink3, marginTop: 2 },
  supplier: { fontSize: 11, color: colors.ink4, marginTop: 2 },
  badge: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 12, fontWeight: '700' },
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
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.ink, marginBottom: 12 },
  fieldGrid: { marginBottom: 20 },
  fieldRow: { flexDirection: 'row', paddingVertical: 6 },
  fieldLabel: { width: 100, fontSize: 13, color: colors.ink4 },
  fieldValue: { flex: 1, fontSize: 13, color: colors.ink },
  adjustTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.ink,
    marginTop: 12,
    marginBottom: 8,
  },
  stepperRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  stepperBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.paper,
  },
  stepperText: { fontSize: 18, fontWeight: '600', color: colors.ink },
  stepperInput: {
    flex: 1,
    marginHorizontal: 10,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    textAlign: 'center',
    fontSize: 15,
    color: colors.ink,
  },
  reasonInput: {
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    fontSize: 14,
    color: colors.ink,
    marginBottom: 12,
  },
  primaryBtn: {
    backgroundColor: colors.teal,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 8,
  },
  primaryBtnText: { color: colors.white, fontSize: 15, fontWeight: '600' },
  cancelBtn: { paddingVertical: 10, alignItems: 'center' },
  cancelBtnText: { color: colors.ink3, fontSize: 14 },
  toast: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    backgroundColor: colors.ink,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  toastText: { color: colors.white, fontSize: 13 },
})
