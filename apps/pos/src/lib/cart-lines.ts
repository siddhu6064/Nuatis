import { toCents, type CartLine, type CartModifier } from '@nuatis/pos-core'

/**
 * Cart line operations, kept pure and free of React so they can be tested in
 * the repo's node test environment — apps/web has no component-testing
 * library, and this is where the money logic lives.
 */

/** A menu item as the API returns it: prices are numeric strings. */
export interface MenuItemDto {
  id: string
  name: string
  price: string
  taxable: boolean
  kitchen_station: string | null
  available: boolean
  sort_order: number
  modifier_groups: MenuGroupDto[]
}

export interface MenuGroupDto {
  id: string
  name: string
  min_select: number
  max_select: number
  required: boolean
  options: MenuOptionDto[]
}

export interface MenuOptionDto {
  id: string
  name: string
  price_delta: string
  sort_order: number
}

export interface MenuCategoryDto {
  id: string
  name: string
  sort_order: number
  items: MenuItemDto[]
}

/** Convert an API option into a cart modifier, in cents. */
export function toCartModifier(option: MenuOptionDto): CartModifier {
  return {
    optionId: option.id,
    name: option.name,
    priceDeltaCents: toCents(option.price_delta),
  }
}

/** Convert an API item plus chosen options into a cart line, in cents. */
export function toCartLine(
  item: MenuItemDto,
  options: MenuOptionDto[] = [],
  quantity = 1
): CartLine {
  return {
    menuItemId: item.id,
    name: item.name,
    unitPriceCents: toCents(item.price),
    quantity,
    taxable: item.taxable,
    modifiers: options.map(toCartModifier),
  }
}

/**
 * Two lines merge only if they are the same item AND carry the same set of
 * modifiers. A burger with bacon is not the same line as a burger without, and
 * merging them would send the kitchen one ticket for a dish nobody ordered.
 * Order within the modifier list is not significant.
 */
export function isSameLine(a: CartLine, b: CartLine): boolean {
  if (a.menuItemId !== b.menuItemId) return false
  if (a.modifiers.length !== b.modifiers.length) return false
  const key = (mods: CartModifier[]) =>
    mods
      .map((m) => m.optionId)
      .sort()
      .join('|')
  return key(a.modifiers) === key(b.modifiers)
}

/** Add a line, merging into an identical existing line instead of duplicating. */
export function addLine(lines: CartLine[], incoming: CartLine): CartLine[] {
  const index = lines.findIndex((l) => isSameLine(l, incoming))
  if (index === -1) return [...lines, incoming]
  return lines.map((l, i) => (i === index ? { ...l, quantity: l.quantity + incoming.quantity } : l))
}

/** Set a line's quantity. Zero or less removes it — that is what a till does. */
export function setQuantity(lines: CartLine[], index: number, quantity: number): CartLine[] {
  if (index < 0 || index >= lines.length) return lines
  if (quantity <= 0) return lines.filter((_, i) => i !== index)
  return lines.map((l, i) => (i === index ? { ...l, quantity } : l))
}

export function removeLine(lines: CartLine[], index: number): CartLine[] {
  return lines.filter((_, i) => i !== index)
}

/**
 * Which required modifier groups have not been satisfied.
 *
 * The API models `required` and `min_select`, and a cart that ignores them
 * sends the kitchen a ticket it cannot make — "steak, no temperature".
 */
export function unsatisfiedGroups(item: MenuItemDto, chosen: MenuOptionDto[]): MenuGroupDto[] {
  const chosenIds = new Set(chosen.map((o) => o.id))
  return item.modifier_groups.filter((group) => {
    const picked = group.options.filter((o) => chosenIds.has(o.id)).length
    const min = group.required ? Math.max(1, group.min_select) : group.min_select
    return picked < min
  })
}

/** True when an item can be added straight to the cart with no dialog. */
export function canAddDirectly(item: MenuItemDto): boolean {
  return unsatisfiedGroups(item, []).length === 0
}
