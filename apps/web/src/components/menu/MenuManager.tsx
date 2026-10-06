'use client'

import { useCallback, useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import MenuItem from '@mui/material/MenuItem'
import Chip from '@mui/material/Chip'
import Alert from '@mui/material/Alert'
import Divider from '@mui/material/Divider'
import Switch from '@mui/material/Switch'
import FormControlLabel from '@mui/material/FormControlLabel'
import Checkbox from '@mui/material/Checkbox'
import CircularProgress from '@mui/material/CircularProgress'
import Snackbar from '@mui/material/Snackbar'
import {
  itemPayload,
  groupPayload,
  optionPayload,
  describeGroupRule,
  type ItemFormValues,
} from '@/lib/menu-admin'

// ── The shapes the menu endpoints return ────────────────────────────────────

interface OptionDto {
  id: string
  name: string
  price_delta: string
  sort_order: number
}

interface GroupDto {
  id: string
  name: string
  min_select: number
  max_select: number
  required: boolean
  options: OptionDto[]
}

interface ItemDto {
  id: string
  name: string
  price: string
  taxable: boolean
  kitchen_station: string | null
  available: boolean
  sort_order: number
  modifier_groups: GroupDto[]
}

interface CategoryDto {
  id: string
  name: string
  sort_order: number
  items: ItemDto[]
}

const EMPTY_ITEM: ItemFormValues = {
  name: '',
  price: '',
  taxable: true,
  kitchenStation: '',
  available: true,
  sortOrder: '0',
}

/**
 * Menu administration for the register and the kitchen display.
 *
 * The menu endpoints have existed since the first POS slice, with ownership
 * guards and 14 tests, but nothing in the dashboard called them: a merchant's
 * only route to a menu was the demo seed script or raw API calls. This is that
 * screen.
 *
 * It talks to `/api/pos/menu/*` through the dashboard's own proxy, which mints
 * a fresh short-lived JWT per request. A web session carries no `portalScope`
 * claim, so it is not confined the way a register token is, and `requirePos`
 * is what gates this — the same module check the register passes.
 */
export default function MenuManager() {
  const [categories, setCategories] = useState<CategoryDto[]>([])
  const [groups, setGroups] = useState<GroupDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // Dialog state
  const [editing, setEditing] = useState<{ categoryId: string; item: ItemDto | null } | null>(null)
  const [renaming, setRenaming] = useState<CategoryDto | null>(null)
  const [addingCategory, setAddingCategory] = useState(false)

  const load = useCallback(async () => {
    try {
      const [treeRes, groupsRes] = await Promise.all([
        fetch('/api/pos/menu/tree'),
        fetch('/api/pos/menu/modifier-groups'),
      ])

      if (treeRes.status === 402 || treeRes.status === 403) {
        setError('The Point of Sale module is not enabled for this workspace.')
        return
      }
      if (!treeRes.ok) {
        setError('Could not load the menu.')
        return
      }

      const tree = (await treeRes.json()) as { categories: CategoryDto[] }
      setCategories(tree.categories ?? [])

      // A failure here costs the modifier panel, not the menu.
      if (groupsRes.ok) {
        const body = (await groupsRes.json()) as { groups: GroupDto[] }
        setGroups(body.groups ?? [])
      }
      setError(null)
    } catch {
      setError('Could not reach the server.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** Every write goes through here so one place reloads and reports. */
  const send = useCallback(
    async (url: string, init: RequestInit, failure: string): Promise<boolean> => {
      try {
        const res = await fetch(url, {
          ...init,
          headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
        })
        if (!res.ok) {
          let message = failure
          try {
            const body = (await res.json()) as { error?: string }
            if (body.error) message = body.error
          } catch {
            // Keep the fallback — a 204 or an HTML error page has no JSON body.
          }
          setToast(message)
          return false
        }
        await load()
        return true
      } catch {
        setToast('Could not reach the server.')
        return false
      }
    },
    [load]
  )

  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    )
  }

  const stations = Array.from(
    new Set(
      categories
        .flatMap((c) => c.items)
        .map((i) => i.kitchen_station)
        .filter((s): s is string => !!s)
    )
  ).sort()

  return (
    <Box sx={{ p: 3 }}>
      <Stack
        direction="row"
        sx={{
          mb: 3,
          flexWrap: 'wrap',
          gap: 2,
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Box>
          <Typography variant="h5">Menu</Typography>
          <Typography variant="body2" color="text.secondary">
            What the register sells and how the kitchen display routes it.
          </Typography>
        </Box>
        <Button variant="contained" onClick={() => setAddingCategory(true)}>
          Add category
        </Button>
      </Stack>

      {categories.length === 0 && (
        <Alert severity="info" sx={{ mb: 3 }}>
          No categories yet. A register needs at least one category with one item before it can sell
          anything.
        </Alert>
      )}

      <Stack spacing={3}>
        {categories.map((category) => (
          <Paper key={category.id} variant="outlined" sx={{ p: 2 }}>
            <Stack
              direction="row"
              sx={{
                mb: 1,
                gap: 1,
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Box>
                <Typography variant="h6">{category.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {category.items.length} item{category.items.length === 1 ? '' : 's'} · position{' '}
                  {category.sort_order}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1}>
                <Button size="small" onClick={() => setRenaming(category)}>
                  Rename
                </Button>
                <Button
                  size="small"
                  color="error"
                  onClick={() =>
                    void send(
                      `/api/pos/menu/categories/${category.id}`,
                      { method: 'DELETE' },
                      'The category could not be deleted.'
                    )
                  }
                >
                  Delete
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setEditing({ categoryId: category.id, item: null })}
                >
                  Add item
                </Button>
              </Stack>
            </Stack>

            <Divider sx={{ mb: 1 }} />

            {category.items.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                No items in this category yet.
              </Typography>
            ) : (
              <Stack divider={<Divider />}>
                {category.items.map((item) => (
                  <Stack
                    key={item.id}
                    direction="row"
                    sx={{ py: 1, gap: 2, flexWrap: 'wrap', alignItems: 'center' }}
                  >
                    <Box sx={{ flex: 1, minWidth: 180 }}>
                      <Typography sx={{ fontWeight: 500 }}>
                        {item.name}
                        {!item.available && (
                          <Chip size="small" label="Unavailable" sx={{ ml: 1 }} color="default" />
                        )}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        ${item.price}
                        {item.taxable ? '' : ' · not taxed'}
                        {item.kitchen_station
                          ? ` · ${item.kitchen_station}`
                          : ' · no kitchen station'}
                        {item.modifier_groups.length > 0 &&
                          ` · ${item.modifier_groups.length} modifier group${
                            item.modifier_groups.length === 1 ? '' : 's'
                          }`}
                      </Typography>
                    </Box>
                    {/* Availability is the one thing a manager flips mid-service,
                        so it is a switch here rather than buried in the dialog. */}
                    <FormControlLabel
                      control={
                        <Switch
                          size="small"
                          checked={item.available}
                          onChange={(e) =>
                            void send(
                              `/api/pos/menu/items/${item.id}`,
                              {
                                method: 'PATCH',
                                body: JSON.stringify({ available: e.target.checked }),
                              },
                              'The item could not be updated.'
                            )
                          }
                        />
                      }
                      label={<Typography variant="caption">Available</Typography>}
                    />
                    <Button
                      size="small"
                      onClick={() => setEditing({ categoryId: category.id, item })}
                    >
                      Edit
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      onClick={() =>
                        void send(
                          `/api/pos/menu/items/${item.id}`,
                          { method: 'DELETE' },
                          'The item could not be deleted.'
                        )
                      }
                    >
                      Delete
                    </Button>
                  </Stack>
                ))}
              </Stack>
            )}
          </Paper>
        ))}
      </Stack>

      <ModifierGroupsPanel groups={groups} send={send} />

      {addingCategory && (
        <NameDialog
          title="Add category"
          label="Category name"
          initial=""
          onCancel={() => setAddingCategory(false)}
          onSave={async (name) => {
            const ok = await send(
              '/api/pos/menu/categories',
              { method: 'POST', body: JSON.stringify({ name, sort_order: categories.length }) },
              'The category could not be created.'
            )
            if (ok) setAddingCategory(false)
          }}
        />
      )}

      {renaming && (
        <NameDialog
          title="Rename category"
          label="Category name"
          initial={renaming.name}
          onCancel={() => setRenaming(null)}
          onSave={async (name) => {
            const ok = await send(
              `/api/pos/menu/categories/${renaming.id}`,
              { method: 'PATCH', body: JSON.stringify({ name }) },
              'The category could not be renamed.'
            )
            if (ok) setRenaming(null)
          }}
        />
      )}

      {editing && (
        <ItemDialog
          categoryId={editing.categoryId}
          categories={categories}
          item={editing.item}
          groups={groups}
          stations={stations}
          send={send}
          onClose={() => setEditing(null)}
        />
      )}

      <Snackbar
        open={toast !== null}
        autoHideDuration={6000}
        onClose={() => setToast(null)}
        message={toast ?? ''}
      />
    </Box>
  )
}

type Send = (url: string, init: RequestInit, failure: string) => Promise<boolean>

// ── One text field, used for both adding and renaming a category ────────────

function NameDialog({
  title,
  label,
  initial,
  onCancel,
  onSave,
}: {
  title: string
  label: string
  initial: string
  onCancel: () => void
  onSave: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)
  const trimmed = name.trim()

  return (
    <Dialog open fullWidth maxWidth="xs" onClose={onCancel}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          label={label}
          value={name}
          onChange={(e) => setName(e.target.value)}
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={busy || trimmed === ''}
          onClick={() => {
            setBusy(true)
            void onSave(trimmed).finally(() => setBusy(false))
          }}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Create or edit one item, including which modifier groups it carries ─────

function ItemDialog({
  categoryId,
  categories,
  item,
  groups,
  stations,
  send,
  onClose,
}: {
  categoryId: string
  categories: CategoryDto[]
  item: ItemDto | null
  groups: GroupDto[]
  stations: string[]
  send: Send
  onClose: () => void
}) {
  const [values, setValues] = useState<ItemFormValues>(
    item
      ? {
          name: item.name,
          price: item.price,
          taxable: item.taxable,
          kitchenStation: item.kitchen_station ?? '',
          available: item.available,
          sortOrder: String(item.sort_order),
        }
      : EMPTY_ITEM
  )
  const [targetCategory, setTargetCategory] = useState(categoryId)
  const [busy, setBusy] = useState(false)
  const [invalid, setInvalid] = useState(false)

  const attached = new Set((item?.modifier_groups ?? []).map((g) => g.id))

  async function save() {
    const payload = itemPayload(targetCategory, values)
    if (!payload) {
      setInvalid(true)
      return
    }
    setBusy(true)
    const ok = item
      ? await send(
          `/api/pos/menu/items/${item.id}`,
          { method: 'PATCH', body: JSON.stringify(payload) },
          'The item could not be saved.'
        )
      : await send(
          '/api/pos/menu/items',
          { method: 'POST', body: JSON.stringify(payload) },
          'The item could not be created.'
        )
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>{item ? 'Edit item' : 'Add item'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            autoFocus
            label="Name"
            value={values.name}
            onChange={(e) => setValues({ ...values, name: e.target.value })}
            fullWidth
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label="Price"
              value={values.price}
              onChange={(e) => setValues({ ...values, price: e.target.value })}
              placeholder="0.00"
              inputMode="decimal"
              sx={{ flex: 1 }}
            />
            <TextField
              label="Position"
              value={values.sortOrder}
              onChange={(e) => setValues({ ...values, sortOrder: e.target.value })}
              sx={{ width: 120 }}
            />
          </Stack>

          <TextField
            select
            label="Category"
            value={targetCategory}
            onChange={(e) => setTargetCategory(e.target.value)}
            helperText="Moving an item here is how you empty a category you want to delete."
            fullWidth
          >
            {categories.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.name}
              </MenuItem>
            ))}
          </TextField>

          {/* Free text, not a select: the station is whatever the kitchen calls
              it, and the KDS filters on the string. Existing stations are
              offered so a typo does not silently create a second board. */}
          <TextField
            label="Kitchen station"
            value={values.kitchenStation}
            onChange={(e) => setValues({ ...values, kitchenStation: e.target.value })}
            helperText={
              stations.length > 0
                ? `In use: ${stations.join(', ')} — blank means it never reaches the kitchen display.`
                : 'Blank means this item never reaches the kitchen display.'
            }
            fullWidth
          />

          <Stack direction="row" spacing={3}>
            <FormControlLabel
              control={
                <Switch
                  checked={values.taxable}
                  onChange={(e) => setValues({ ...values, taxable: e.target.checked })}
                />
              }
              label="Taxable"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={values.available}
                  onChange={(e) => setValues({ ...values, available: e.target.checked })}
                />
              }
              label="Available"
            />
          </Stack>

          {item && groups.length > 0 && (
            <>
              <Divider />
              <Typography variant="subtitle2">Modifier groups</Typography>
              <Typography variant="caption" color="text.secondary">
                Attaching takes effect immediately — it is a separate record from the item itself.
              </Typography>
              <Stack>
                {groups.map((group) => (
                  <FormControlLabel
                    key={group.id}
                    control={
                      <Checkbox
                        checked={attached.has(group.id)}
                        onChange={(e) =>
                          void send(
                            `/api/pos/menu/items/${item.id}/modifier-groups/${group.id}`,
                            { method: e.target.checked ? 'POST' : 'DELETE' },
                            'The modifier group could not be changed.'
                          )
                        }
                      />
                    }
                    label={
                      <Typography variant="body2">
                        {group.name}{' '}
                        <Typography component="span" variant="caption" color="text.secondary">
                          · {describeGroupRule(group)} · {group.options.length} option
                          {group.options.length === 1 ? '' : 's'}
                        </Typography>
                      </Typography>
                    }
                  />
                ))}
              </Stack>
            </>
          )}

          {!item && (
            <Alert severity="info">
              Save the item first, then reopen it to attach modifier groups.
            </Alert>
          )}

          {invalid && (
            <Alert severity="error">
              Give the item a name and a price — a price like &quot;12&quot; or &quot;12.50&quot;.
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void save()} disabled={busy}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Modifier groups and their options ───────────────────────────────────────

function ModifierGroupsPanel({ groups, send }: { groups: GroupDto[]; send: Send }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [minSelect, setMinSelect] = useState('0')
  const [maxSelect, setMaxSelect] = useState('1')
  const [required, setRequired] = useState(false)
  const [invalid, setInvalid] = useState(false)

  const [optionFor, setOptionFor] = useState<GroupDto | null>(null)
  const [optionName, setOptionName] = useState('')
  const [optionDelta, setOptionDelta] = useState('')

  async function createGroup() {
    const payload = groupPayload({ name, minSelect, maxSelect, required })
    if (!payload) {
      setInvalid(true)
      return
    }
    const ok = await send(
      '/api/pos/menu/modifier-groups',
      { method: 'POST', body: JSON.stringify(payload) },
      'The modifier group could not be created.'
    )
    if (ok) {
      setAdding(false)
      setName('')
      setMinSelect('0')
      setMaxSelect('1')
      setRequired(false)
      setInvalid(false)
    }
  }

  async function createOption() {
    if (!optionFor) return
    const payload = optionPayload(optionFor.id, {
      name: optionName,
      priceDelta: optionDelta,
      sortOrder: String(optionFor.options.length),
    })
    if (!payload) {
      setInvalid(true)
      return
    }
    const ok = await send(
      '/api/pos/menu/modifier-options',
      { method: 'POST', body: JSON.stringify(payload) },
      'The option could not be created.'
    )
    if (ok) {
      setOptionFor(null)
      setOptionName('')
      setOptionDelta('')
      setInvalid(false)
    }
  }

  return (
    <Box sx={{ mt: 5 }}>
      <Stack direction="row" sx={{ mb: 2, justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h6">Modifier groups</Typography>
          <Typography variant="body2" color="text.secondary">
            Choices a cashier is asked for — temperature, extras, sides. Attach them to an item from
            its Edit dialog.
          </Typography>
        </Box>
        <Button variant="outlined" onClick={() => setAdding(true)}>
          Add group
        </Button>
      </Stack>

      {groups.length === 0 ? (
        <Alert severity="info">No modifier groups yet.</Alert>
      ) : (
        <Stack spacing={2}>
          {groups.map((group) => (
            <Paper key={group.id} variant="outlined" sx={{ p: 2 }}>
              <Stack
                direction="row"
                sx={{
                  gap: 1,
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Box>
                  <Typography sx={{ fontWeight: 500 }}>{group.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {describeGroupRule(group)}
                    {group.required ? ' · required' : ' · optional'}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1}>
                  <Button size="small" onClick={() => setOptionFor(group)}>
                    Add option
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    onClick={() =>
                      void send(
                        `/api/pos/menu/modifier-groups/${group.id}`,
                        { method: 'DELETE' },
                        'The group could not be deleted.'
                      )
                    }
                  >
                    Delete
                  </Button>
                </Stack>
              </Stack>

              {group.options.length > 0 && (
                <Stack direction="row" sx={{ mt: 1.5, gap: 1, flexWrap: 'wrap' }}>
                  {group.options.map((option) => (
                    <Chip
                      key={option.id}
                      label={
                        Number(option.price_delta) === 0
                          ? option.name
                          : `${option.name} +$${option.price_delta}`
                      }
                      onDelete={() =>
                        void send(
                          `/api/pos/menu/modifier-options/${option.id}`,
                          { method: 'DELETE' },
                          'The option could not be deleted.'
                        )
                      }
                    />
                  ))}
                </Stack>
              )}
            </Paper>
          ))}
        </Stack>
      )}

      <Dialog open={adding} fullWidth maxWidth="xs" onClose={() => setAdding(false)}>
        <DialogTitle>Add modifier group</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              autoFocus
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
            />
            <Stack direction="row" spacing={2}>
              <TextField
                label="Choose at least"
                value={minSelect}
                onChange={(e) => setMinSelect(e.target.value)}
                sx={{ flex: 1 }}
              />
              <TextField
                label="At most"
                value={maxSelect}
                onChange={(e) => setMaxSelect(e.target.value)}
                sx={{ flex: 1 }}
              />
            </Stack>
            <FormControlLabel
              control={
                <Switch checked={required} onChange={(e) => setRequired(e.target.checked)} />
              }
              label="Cashier must choose"
            />
            {invalid && (
              <Alert severity="error">
                Give the group a name, and an &quot;at most&quot; that is not below &quot;at
                least&quot; — a required group also has to allow at least one choice.
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAdding(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => void createGroup()}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={optionFor !== null} fullWidth maxWidth="xs" onClose={() => setOptionFor(null)}>
        <DialogTitle>Add option to {optionFor?.name}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              autoFocus
              label="Name"
              value={optionName}
              onChange={(e) => setOptionName(e.target.value)}
              fullWidth
            />
            <TextField
              label="Extra charge"
              value={optionDelta}
              onChange={(e) => setOptionDelta(e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              helperText="Leave blank for a choice that costs nothing."
              fullWidth
            />
            {invalid && <Alert severity="error">Give the option a name and a valid amount.</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOptionFor(null)}>Cancel</Button>
          <Button variant="contained" onClick={() => void createOption()}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
