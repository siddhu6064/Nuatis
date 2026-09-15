import { Router, type Request, type Response, type NextFunction } from 'express'
import { getServiceClient } from '../../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../../lib/auth.js'
import { isModuleEnabled } from '../../lib/modules.js'

const router = Router()

/**
 * POS module gate. Mirrors the `requireOrders` pattern already used by
 * routes/orders.ts — entitlement only, no subscription_status opinion.
 * Exported so the ticket and drawer routers reuse one definition instead of
 * each declaring their own copy.
 */
export async function requirePos(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authed = req as AuthenticatedRequest
  const enabled = await isModuleEnabled(authed.tenantId, 'pos')
  if (!enabled) {
    res.status(403).json({ error: 'POS module is not enabled' })
    return
  }
  next()
}

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Confirm a row belongs to the caller's tenant before referencing it.
 *
 * These routes run on the service-role client, which BYPASSES RLS — the
 * `tenant_id = current_tenant_id()` policies are defense in depth, not the
 * live boundary. Every foreign key that arrives from a request body or URL
 * must therefore be proven to belong to the caller here, or a tenant can
 * write rows pointing at another tenant's categories, groups, or items.
 */
async function ownsRow(
  supabase: ReturnType<typeof getServiceClient>,
  table: string,
  id: string,
  tenantId: string
): Promise<boolean> {
  const { data } = await supabase
    .from(table)
    .select('id')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle<{ id: string }>()
  return !!data
}

interface MenuOption {
  id: string
  name: string
  price_delta: string
  sort_order: number
}

interface MenuGroup {
  id: string
  name: string
  min_select: number
  max_select: number
  required: boolean
  options: MenuOption[]
}

interface MenuItemNode {
  id: string
  name: string
  price: string
  taxable: boolean
  kitchen_station: string | null
  available: boolean
  sort_order: number
  modifier_groups: MenuGroup[]
}

type OptionRow = MenuOption & { group_id: string; deleted_at: unknown }
type GroupRow = Omit<MenuGroup, 'options'> & { deleted_at: unknown }
type ItemRow = Omit<MenuItemNode, 'modifier_groups'> & { category_id: string; deleted_at: unknown }
type CategoryRow = { id: string; name: string; sort_order: number; deleted_at: unknown }
type LinkRow = { item_id: string; group_id: string; sort_order: number }

// ── GET /api/pos/menu/tree ──────────────────────────────────────────────────
// One round trip per table rather than nested selects: the tree is small (a
// menu, not a catalogue), and assembling it in memory keeps the shape explicit.
router.get('/tree', requireAuth, requirePos, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const [cats, items, groups, options, links] = await Promise.all([
    supabase.from('menu_categories').select('*').eq('tenant_id', authed.tenantId),
    supabase.from('menu_items').select('*').eq('tenant_id', authed.tenantId),
    supabase.from('modifier_groups').select('*').eq('tenant_id', authed.tenantId),
    supabase.from('modifier_options').select('*').eq('tenant_id', authed.tenantId),
    supabase.from('menu_item_modifier_groups').select('*').eq('tenant_id', authed.tenantId),
  ])

  const live = <T extends { deleted_at?: unknown }>(rows: T[]): T[] =>
    rows.filter((r) => !r.deleted_at)

  const optionRows = live((options.data ?? []) as OptionRow[])
  const groupRows = live((groups.data ?? []) as GroupRow[])
  const itemRows = live((items.data ?? []) as ItemRow[])
  const catRows = live((cats.data ?? []) as CategoryRow[])
  const linkRows = (links.data ?? []) as LinkRow[]

  const optionsByGroup = new Map<string, MenuOption[]>()
  for (const o of optionRows) {
    const list = optionsByGroup.get(o.group_id) ?? []
    list.push({ id: o.id, name: o.name, price_delta: o.price_delta, sort_order: o.sort_order })
    optionsByGroup.set(o.group_id, list)
  }

  const groupById = new Map<string, MenuGroup>()
  for (const g of groupRows) {
    groupById.set(g.id, {
      id: g.id,
      name: g.name,
      min_select: g.min_select,
      max_select: g.max_select,
      required: g.required,
      options: (optionsByGroup.get(g.id) ?? []).sort((a, b) => a.sort_order - b.sort_order),
    })
  }

  const groupsByItem = new Map<string, MenuGroup[]>()
  for (const l of [...linkRows].sort((a, b) => a.sort_order - b.sort_order)) {
    const g = groupById.get(l.group_id)
    if (!g) continue
    const list = groupsByItem.get(l.item_id) ?? []
    list.push(g)
    groupsByItem.set(l.item_id, list)
  }

  const itemsByCategory = new Map<string, MenuItemNode[]>()
  for (const i of itemRows) {
    const list = itemsByCategory.get(i.category_id) ?? []
    list.push({
      id: i.id,
      name: i.name,
      price: i.price,
      taxable: i.taxable,
      kitchen_station: i.kitchen_station,
      available: i.available,
      sort_order: i.sort_order,
      modifier_groups: groupsByItem.get(i.id) ?? [],
    })
    itemsByCategory.set(i.category_id, list)
  }

  const categories = [...catRows]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((c) => ({
      id: c.id,
      name: c.name,
      sort_order: c.sort_order,
      items: (itemsByCategory.get(c.id) ?? []).sort((a, b) => a.sort_order - b.sort_order),
    }))

  res.json({ categories })
})

// ── POST /api/pos/menu/categories ───────────────────────────────────────────
router.post(
  '/categories',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const body = req.body as Record<string, unknown>
    const name = trimmedString(body['name'])
    if (!name) {
      res.status(400).json({ error: 'name is required' })
      return
    }
    const sortOrder = typeof body['sort_order'] === 'number' ? body['sort_order'] : 0

    const supabase = getServiceClient()
    const { data, error } = await supabase
      .from('menu_categories')
      .insert({ tenant_id: authed.tenantId, name, sort_order: sortOrder })
      .select()
      .single()

    if (error || !data) {
      res.status(500).json({ error: 'Failed to create category' })
      return
    }
    res.status(201).json({ category: data })
  }
)

// ── DELETE /api/pos/menu/categories/:id ─────────────────────────────────────
router.delete(
  '/categories/:id',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const { data, error } = await supabase
      .from('menu_categories')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .select('id')

    if (error || !data || data.length === 0) {
      res.status(404).json({ error: 'Category not found' })
      return
    }
    res.status(204).send()
  }
)

// ── POST /api/pos/menu/items ────────────────────────────────────────────────
router.post(
  '/items',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const body = req.body as Record<string, unknown>
    const name = trimmedString(body['name'])
    const categoryId = trimmedString(body['category_id'])
    if (!name || !categoryId) {
      res.status(400).json({ error: 'name and category_id are required' })
      return
    }
    const price = typeof body['price'] === 'number' ? body['price'] : 0
    if (price < 0) {
      res.status(400).json({ error: 'price must not be negative' })
      return
    }

    const supabase = getServiceClient()
    if (!(await ownsRow(supabase, 'menu_categories', categoryId, authed.tenantId))) {
      res.status(404).json({ error: 'Category not found' })
      return
    }

    const { data, error } = await supabase
      .from('menu_items')
      .insert({
        tenant_id: authed.tenantId,
        category_id: categoryId,
        name,
        price,
        taxable: body['taxable'] !== false,
        kitchen_station: trimmedString(body['kitchen_station']) || null,
        available: body['available'] !== false,
        sort_order: typeof body['sort_order'] === 'number' ? body['sort_order'] : 0,
      })
      .select()
      .single()

    if (error || !data) {
      res.status(500).json({ error: 'Failed to create item' })
      return
    }
    res.status(201).json({ item: data })
  }
)

// ── PATCH /api/pos/menu/items/:id ───────────────────────────────────────────
router.patch(
  '/items/:id',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const body = req.body as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    if (typeof body['name'] === 'string') patch['name'] = body['name'].trim()
    if (typeof body['price'] === 'number') patch['price'] = body['price']
    if (typeof body['taxable'] === 'boolean') patch['taxable'] = body['taxable']
    if (typeof body['available'] === 'boolean') patch['available'] = body['available']
    if (typeof body['kitchen_station'] === 'string') {
      patch['kitchen_station'] = body['kitchen_station'].trim() || null
    }
    if (typeof body['sort_order'] === 'number') patch['sort_order'] = body['sort_order']

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: 'No updatable fields supplied' })
      return
    }

    const supabase = getServiceClient()
    const { data, error } = await supabase
      .from('menu_items')
      .update(patch)
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .select()
      .single()

    if (error || !data) {
      res.status(404).json({ error: 'Item not found' })
      return
    }
    res.json({ item: data })
  }
)

// ── DELETE /api/pos/menu/items/:id ──────────────────────────────────────────
// Soft delete. Kitchen tickets and receipts snapshot their line text, but the
// menu_item_id FK on order_line_items must keep resolving for reporting.
router.delete(
  '/items/:id',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    // .select() so a no-match is distinguishable from a success. Without it an
    // update that matched nothing — an unknown id, or another tenant's item —
    // returns no error and the route reports a 204 it did not perform.
    const { data, error } = await supabase
      .from('menu_items')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .select('id')

    if (error || !data || data.length === 0) {
      res.status(404).json({ error: 'Item not found' })
      return
    }
    res.status(204).send()
  }
)

// ── POST /api/pos/menu/modifier-groups ──────────────────────────────────────
router.post(
  '/modifier-groups',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const body = req.body as Record<string, unknown>
    const name = trimmedString(body['name'])
    if (!name) {
      res.status(400).json({ error: 'name is required' })
      return
    }
    const minSelect = typeof body['min_select'] === 'number' ? body['min_select'] : 0
    const maxSelect = typeof body['max_select'] === 'number' ? body['max_select'] : 1
    if (minSelect > maxSelect) {
      res.status(400).json({ error: 'min_select must not exceed max_select' })
      return
    }

    const supabase = getServiceClient()
    const { data, error } = await supabase
      .from('modifier_groups')
      .insert({
        tenant_id: authed.tenantId,
        name,
        min_select: minSelect,
        max_select: maxSelect,
        required: body['required'] === true,
      })
      .select()
      .single()

    if (error || !data) {
      res.status(500).json({ error: 'Failed to create modifier group' })
      return
    }
    res.status(201).json({ group: data })
  }
)

// ── POST /api/pos/menu/modifier-options ─────────────────────────────────────
router.post(
  '/modifier-options',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const body = req.body as Record<string, unknown>
    const name = trimmedString(body['name'])
    const groupId = trimmedString(body['group_id'])
    if (!name || !groupId) {
      res.status(400).json({ error: 'name and group_id are required' })
      return
    }

    const supabase = getServiceClient()
    if (!(await ownsRow(supabase, 'modifier_groups', groupId, authed.tenantId))) {
      res.status(404).json({ error: 'Modifier group not found' })
      return
    }

    const { data, error } = await supabase
      .from('modifier_options')
      .insert({
        tenant_id: authed.tenantId,
        group_id: groupId,
        name,
        price_delta: typeof body['price_delta'] === 'number' ? body['price_delta'] : 0,
        sort_order: typeof body['sort_order'] === 'number' ? body['sort_order'] : 0,
      })
      .select()
      .single()

    if (error || !data) {
      res.status(500).json({ error: 'Failed to create modifier option' })
      return
    }
    res.status(201).json({ option: data })
  }
)

// ── POST /api/pos/menu/items/:itemId/modifier-groups/:groupId ───────────────
router.post(
  '/items/:itemId/modifier-groups/:groupId',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const body = req.body as Record<string, unknown>
    const supabase = getServiceClient()
    const itemId = req.params['itemId'] as string
    const groupId = req.params['groupId'] as string

    // Both sides of the link must belong to the caller — otherwise a tenant
    // can attach another tenant's modifier group to their own item.
    const [ownsItem, ownsGroup] = await Promise.all([
      ownsRow(supabase, 'menu_items', itemId, authed.tenantId),
      ownsRow(supabase, 'modifier_groups', groupId, authed.tenantId),
    ])
    if (!ownsItem || !ownsGroup) {
      res.status(404).json({ error: 'Item or modifier group not found' })
      return
    }

    const { error } = await supabase.from('menu_item_modifier_groups').insert({
      tenant_id: authed.tenantId,
      item_id: itemId,
      group_id: groupId,
      sort_order: typeof body['sort_order'] === 'number' ? body['sort_order'] : 0,
    })

    if (error) {
      res.status(500).json({ error: 'Failed to link modifier group' })
      return
    }
    res.status(201).json({ linked: true })
  }
)

// ── DELETE /api/pos/menu/items/:itemId/modifier-groups/:groupId ─────────────
router.delete(
  '/items/:itemId/modifier-groups/:groupId',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const { error } = await supabase
      .from('menu_item_modifier_groups')
      .delete()
      .eq('item_id', req.params['itemId'])
      .eq('group_id', req.params['groupId'])
      .eq('tenant_id', authed.tenantId)

    if (error) {
      res.status(500).json({ error: 'Failed to unlink modifier group' })
      return
    }
    res.status(204).send()
  }
)

export default router
