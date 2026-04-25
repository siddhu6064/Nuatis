/**
 * Seed vertical-appropriate sample inventory items for a tenant.
 * Called from tenant provisioner on new-tenant creation. Safe to re-run —
 * uses insert; duplicates avoided by (tenant_id, sku) check beforehand.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

interface ItemSeed {
  name: string
  sku: string
  unit: string
  quantity: number
  reorder_threshold: number
  supplier?: string
}

const PRESETS: Record<string, ItemSeed[]> = {
  dental: [
    {
      name: 'Exam Gloves (Box)',
      sku: 'GL-100',
      unit: 'box',
      quantity: 20,
      reorder_threshold: 5,
      supplier: 'Henry Schein',
    },
    {
      name: 'Composite Resin',
      sku: 'CR-A2',
      unit: 'each',
      quantity: 12,
      reorder_threshold: 3,
      supplier: 'Dentsply Sirona',
    },
    {
      name: 'Anesthetic Cartridges',
      sku: 'AN-LID',
      unit: 'box',
      quantity: 8,
      reorder_threshold: 2,
      supplier: 'Henry Schein',
    },
    { name: 'Prophy Paste', sku: 'PP-MED', unit: 'box', quantity: 16, reorder_threshold: 4 },
    { name: 'Impression Material', sku: 'IM-VPS', unit: 'each', quantity: 8, reorder_threshold: 2 },
  ],
  medical: [
    { name: 'Exam Gloves (Box)', sku: 'GL-MED', unit: 'box', quantity: 20, reorder_threshold: 5 },
    { name: 'Disposable Gowns', sku: 'GWN-L', unit: 'box', quantity: 8, reorder_threshold: 2 },
    { name: 'Alcohol Swabs', sku: 'SW-70', unit: 'box', quantity: 12, reorder_threshold: 3 },
    {
      name: 'Blood Pressure Cuffs',
      sku: 'BP-ADU',
      unit: 'each',
      quantity: 8,
      reorder_threshold: 2,
    },
    { name: 'Pulse Oximeters', sku: 'PO-01', unit: 'each', quantity: 8, reorder_threshold: 2 },
  ],
  veterinary: [
    { name: 'Exam Gloves (Box)', sku: 'GL-VET', unit: 'box', quantity: 16, reorder_threshold: 4 },
    { name: 'Syringes 3mL', sku: 'SY-3ML', unit: 'box', quantity: 8, reorder_threshold: 2 },
    { name: 'Surgical Scrub', sku: 'SS-CLH', unit: 'L', quantity: 8, reorder_threshold: 2 },
    { name: 'IV Catheters', sku: 'IV-22G', unit: 'box', quantity: 8, reorder_threshold: 2 },
    { name: 'Bandage Rolls', sku: 'BND-4IN', unit: 'box', quantity: 12, reorder_threshold: 3 },
  ],
  salon: [
    {
      name: 'Shampoo (Professional)',
      sku: 'SH-PRO',
      unit: 'L',
      quantity: 8,
      reorder_threshold: 2,
      supplier: 'Wella',
    },
    { name: 'Color Developer 20v', sku: 'DEV-20', unit: 'L', quantity: 8, reorder_threshold: 2 },
    { name: 'Hair Color', sku: 'HC-AST', unit: 'each', quantity: 20, reorder_threshold: 5 },
    { name: 'Foil Sheets', sku: 'FL-500', unit: 'box', quantity: 8, reorder_threshold: 2 },
    { name: 'Disposable Capes', sku: 'CP-DISP', unit: 'box', quantity: 8, reorder_threshold: 2 },
  ],
  restaurant: [
    {
      name: 'All-Purpose Flour (5kg)',
      sku: 'FL-5KG',
      unit: 'bag',
      quantity: 16,
      reorder_threshold: 4,
    },
    { name: 'Olive Oil (3L)', sku: 'OO-3L', unit: 'each', quantity: 12, reorder_threshold: 3 },
    { name: 'Napkins', sku: 'NP-WHT', unit: 'box', quantity: 8, reorder_threshold: 2 },
    { name: 'Disposable Gloves', sku: 'GL-RST', unit: 'box', quantity: 12, reorder_threshold: 3 },
    { name: 'To-Go Containers', sku: 'TG-MED', unit: 'box', quantity: 8, reorder_threshold: 2 },
  ],
  contractor: [
    { name: 'Safety Gloves', sku: 'SG-LRG', unit: 'each', quantity: 20, reorder_threshold: 5 },
    { name: 'Safety Glasses', sku: 'SS-CLR', unit: 'each', quantity: 12, reorder_threshold: 3 },
    { name: 'Wire Nuts (Assorted)', sku: 'WN-AST', unit: 'box', quantity: 8, reorder_threshold: 2 },
    { name: 'PVC Pipe 1/2"', sku: 'PV-HALF', unit: 'each', quantity: 20, reorder_threshold: 5 },
    { name: 'Duct Tape', sku: 'DT-2IN', unit: 'each', quantity: 12, reorder_threshold: 3 },
  ],
  law_firm: [
    { name: 'Copy Paper (Ream)', sku: 'CP-LTR', unit: 'each', quantity: 20, reorder_threshold: 5 },
    { name: 'File Folders', sku: 'FF-LGL', unit: 'box', quantity: 8, reorder_threshold: 2 },
    { name: 'Toner Cartridge', sku: 'TC-BLK', unit: 'each', quantity: 8, reorder_threshold: 2 },
    { name: 'Pens (Box)', sku: 'PN-BLU', unit: 'box', quantity: 8, reorder_threshold: 2 },
    { name: 'Sticky Notes', sku: 'SN-3X3', unit: 'each', quantity: 12, reorder_threshold: 3 },
  ],
  real_estate: [
    { name: 'For Sale Signs', sku: 'FS-YRD', unit: 'each', quantity: 12, reorder_threshold: 3 },
    { name: 'Brochure Paper', sku: 'BP-GLO', unit: 'box', quantity: 8, reorder_threshold: 2 },
    { name: 'Lockboxes', sku: 'LB-KEY', unit: 'each', quantity: 8, reorder_threshold: 2 },
    { name: 'Yard Sign Stakes', sku: 'YS-MET', unit: 'each', quantity: 16, reorder_threshold: 4 },
    { name: 'Pen Sets (Branded)', sku: 'PS-BRD', unit: 'box', quantity: 8, reorder_threshold: 2 },
  ],
  sales_crm: [
    { name: 'Business Cards (Box)', sku: 'BC-STD', unit: 'box', quantity: 8, reorder_threshold: 2 },
    { name: 'Presentation Folders', sku: 'PF-BRD', unit: 'box', quantity: 8, reorder_threshold: 2 },
    { name: 'Branded Notebooks', sku: 'NB-BRD', unit: 'each', quantity: 12, reorder_threshold: 3 },
    { name: 'USB Drives', sku: 'USB-16G', unit: 'each', quantity: 12, reorder_threshold: 3 },
    { name: 'HDMI Adapters', sku: 'HD-USB', unit: 'each', quantity: 8, reorder_threshold: 2 },
  ],
}

function getAdminClient(): SupabaseClient {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(url, key)
}

export async function seedInventory(tenantId: string, vertical: string): Promise<void> {
  const presets = PRESETS[vertical] ?? PRESETS['sales_crm']!
  if (presets.length === 0) return

  const supabase = getAdminClient()

  // Only insert items this tenant doesn't already have (matched by SKU).
  const skus = presets.map((p) => p.sku)
  const { data: existing } = await supabase
    .from('inventory_items')
    .select('sku')
    .eq('tenant_id', tenantId)
    .in('sku', skus)

  const existingSkus = new Set((existing ?? []).map((r) => r.sku as string))
  const rows = presets
    .filter((p) => !existingSkus.has(p.sku))
    .map((p) => ({
      tenant_id: tenantId,
      vertical,
      name: p.name,
      sku: p.sku,
      unit: p.unit,
      quantity: p.quantity,
      reorder_threshold: p.reorder_threshold,
      supplier: p.supplier ?? null,
    }))

  if (rows.length === 0) return

  const { error } = await supabase.from('inventory_items').insert(rows)
  if (error) {
    console.error(`[seed:inventory] tenant=${tenantId} error: ${error.message}`)
  }
}
