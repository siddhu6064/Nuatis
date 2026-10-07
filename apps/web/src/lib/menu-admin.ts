/**
 * Menu administration: form values in, API payloads out.
 *
 * Kept pure and free of React so the validation that decides what reaches the
 * menu can be tested in this app's node test environment — apps/web has no
 * component-testing library, and this is where a mistake would be expensive:
 * a price or a kitchen station that is wrong here is wrong on every ticket
 * until someone notices.
 *
 * Prices are dollars here rather than cents, because the API's menu endpoints
 * speak `numeric(10,2)`. The register converts to integer cents on the way in
 * (`toCents`) and does all its arithmetic there; this module only has to hand
 * the API the two-decimal number it stores.
 */

export interface ItemFormValues {
  name: string
  price: string
  taxable: boolean
  kitchenStation: string
  available: boolean
  sortOrder: string
}

export interface ItemPayload {
  category_id: string
  name: string
  price: number
  taxable: boolean
  kitchen_station: string | null
  available: boolean
  sort_order: number
}

export interface GroupFormValues {
  name: string
  minSelect: string
  maxSelect: string
  required: boolean
}

export interface GroupPayload {
  name: string
  min_select: number
  max_select: number
  required: boolean
}

export interface OptionFormValues {
  name: string
  priceDelta: string
  sortOrder: string
}

export interface OptionPayload {
  group_id: string
  name: string
  price_delta: number
  sort_order: number
}

/**
 * Read a typed price as a two-decimal number, or null if it is not a price.
 *
 * Rounded here rather than left to the database so the merchant is shown the
 * price that will actually be stored. Deliberately not parseFloat: that reads
 * "12.34.56" as 12.34 and "12abc" as 12, turning a typo into a wrong price on
 * every sale of that item.
 */
export function parsePriceInput(input: string | number): number | null {
  // String() first: these are typed as strings because the column is numeric,
  // but supabase-js hands numerics back as JS numbers, and the edit dialog
  // seeds its form straight from an item. Calling .replace on that throws.
  const cleaned = String(input).replace(/[$,\s]/g, '')
  if (cleaned === '') return null
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0) return null
  return Number(value.toFixed(2))
}

/**
 * A money value from the API, as two decimals.
 *
 * Postgres `numeric` arrives as a string and the driver makes no promise about
 * trailing zeros, so a price stored as 15.50 can come back as "15.5". Rendered
 * raw that reads as a typo on a price list a merchant is checking — the live
 * menu showed "$12", "$15.5" and "+$1.5".
 *
 * An unparseable value is passed through untouched rather than becoming
 * "NaN": showing the merchant the odd string the API actually sent is more
 * use than showing them nothing at all.
 */
export function formatMoney(value: string | number): string {
  const text = String(value).trim()
  const parsed = Number(text)
  if (text === '' || !Number.isFinite(parsed)) return text
  return parsed.toFixed(2)
}

/** A whole number from a form field, with blank meaning zero. */
function parseCount(text: string): number | null {
  const cleaned = text.trim()
  if (cleaned === '') return 0
  if (!/^\d+$/.test(cleaned)) return null
  return Number(cleaned)
}

export function itemPayload(categoryId: string, values: ItemFormValues): ItemPayload | null {
  const name = values.name.trim()
  if (!name) return null

  const price = parsePriceInput(values.price)
  if (price === null) return null

  const sortOrder = parseCount(values.sortOrder)
  if (sortOrder === null) return null

  const station = values.kitchenStation.trim()

  return {
    category_id: categoryId,
    name,
    price,
    taxable: values.taxable,
    // Null, never '': kitchen_station is the KDS routing key, and an empty
    // string routes a ticket to a station board that does not exist — the item
    // would be rung up and then cooked by nobody.
    kitchen_station: station === '' ? null : station,
    available: values.available,
    sort_order: sortOrder,
  }
}

/**
 * A modifier group, refusing bounds no choice could satisfy.
 *
 * The register enforces these at order time; a group stored with max below min
 * would make its item unsellable, and the cashier would have no way to tell
 * why from the register.
 */
export function groupPayload(values: GroupFormValues): GroupPayload | null {
  const name = values.name.trim()
  if (!name) return null

  const minSelect = parseCount(values.minSelect)
  const maxSelect = parseCount(values.maxSelect)
  if (minSelect === null || maxSelect === null) return null
  if (maxSelect < minSelect) return null
  if (values.required && maxSelect === 0) return null

  return { name, min_select: minSelect, max_select: maxSelect, required: values.required }
}

export function optionPayload(groupId: string, values: OptionFormValues): OptionPayload | null {
  const name = values.name.trim()
  if (!name) return null

  // Blank is free. Most options are preparation choices at no charge, and
  // making a merchant type 0.00 for each of them is friction with no purpose.
  const delta = values.priceDelta.trim() === '' ? 0 : parsePriceInput(values.priceDelta)
  if (delta === null) return null

  const sortOrder = parseCount(values.sortOrder)
  if (sortOrder === null) return null

  return { group_id: groupId, name, price_delta: delta, sort_order: sortOrder }
}

/** The selection rule in the words the register will enforce. */
export function describeGroupRule(group: {
  min_select: number
  max_select: number
  required: boolean
}): string {
  if (group.min_select === group.max_select) return `Choose ${group.min_select}`
  if (group.min_select === 0) return `Up to ${group.max_select}`
  return `Choose ${group.min_select} to ${group.max_select}`
}
