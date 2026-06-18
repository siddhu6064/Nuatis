/**
 * Module registry — single source of truth for module identity, display
 * metadata, plan gating, and defaults.
 *
 * The API derives VALID_MODULE_IDS (the PUT-endpoint allow-list) from here.
 * Plan→tier entitlement still lives in stripe-plans.ts (PLANS[].modules);
 * that file is intentionally NOT derived from this registry yet.
 *
 * `hidden: true` modules are valid keys (route guards + PUT validation still
 * honor them) but are not rendered as toggles in the settings UI:
 *   - companies / deals — gated suite features with no dedicated toggle row
 *   - appointments — legacy alias of `scheduling`; storage is being
 *     canonicalized to `scheduling` (migration 0134), the key is retained
 *     for the existing appointments route guard + web redirect.
 */

export type ModuleId =
  | 'maya'
  | 'crm'
  | 'scheduling'
  | 'pipeline'
  | 'automation'
  | 'insights'
  | 'campaigns'
  | 'cpq'
  | 'companies'
  | 'deals'
  | 'appointments'

export type PlanTier = 'core' | 'pro' | 'scale'

export interface ModuleDef {
  id: ModuleId
  label: string
  description: string
  minPlan: PlanTier // minimum tier required to enable
  defaultOn: boolean // default value for new tenants
  alwaysOn?: boolean // true = cannot be toggled off (maya, crm)
  hidden?: boolean // true = valid key but no settings-UI toggle row
}

export const MODULES: ModuleDef[] = [
  {
    id: 'maya',
    label: 'Maya Voice AI',
    description: 'AI receptionist that answers calls, books appointments, and captures leads 24/7.',
    minPlan: 'core',
    defaultOn: true,
    alwaysOn: true,
  },
  {
    id: 'crm',
    label: 'CRM',
    description: 'Contacts, companies, deals, activity timeline, and lead scoring.',
    minPlan: 'core',
    defaultOn: true,
    alwaysOn: true,
  },
  {
    id: 'scheduling',
    label: 'Scheduling',
    description: 'Appointment booking, calendar sync, public booking page, and SMS reminders.',
    minPlan: 'core',
    defaultOn: true,
  },
  {
    id: 'pipeline',
    label: 'Pipeline',
    description: 'Lead Kanban, multi-pipeline support, stage probability, and revenue forecasting.',
    minPlan: 'core',
    defaultOn: true,
  },
  {
    id: 'automation',
    label: 'Automation',
    description:
      'BullMQ scanners for stalled leads, no-shows, lapsed clients, and review requests.',
    minPlan: 'pro',
    defaultOn: false,
  },
  {
    id: 'insights',
    label: 'Insights',
    description: 'Analytics dashboard, ROI reporting, Maya metrics, and custom report builder.',
    minPlan: 'pro',
    defaultOn: false,
  },
  {
    id: 'campaigns',
    label: 'AI Campaigns',
    description:
      'Segment-driven AI-generated campaigns across SMS, email, and social with approval gate.',
    minPlan: 'pro',
    defaultOn: false,
  },
  {
    id: 'cpq',
    label: 'CPQ',
    description:
      'Service catalog, quote builder, PDF proposals, payment links, and transaction ledger.',
    minPlan: 'scale',
    defaultOn: false,
  },
  // ── Hidden modules — valid keys, no settings-UI toggle row ──────────────
  {
    id: 'companies',
    label: 'Companies',
    description: 'Company records and B2B account management.',
    minPlan: 'core',
    defaultOn: true,
    hidden: true,
  },
  {
    id: 'deals',
    label: 'Deals',
    description: 'Deal records and revenue tracking.',
    minPlan: 'core',
    defaultOn: true,
    hidden: true,
  },
  {
    id: 'appointments',
    label: 'Appointments',
    description: 'Legacy alias of Scheduling — retained for the appointments route guard.',
    minPlan: 'core',
    defaultOn: true,
    hidden: true,
  },
]

export const VALID_MODULE_IDS: readonly string[] = MODULES.map((m) => m.id)

export function getModuleDef(id: string): ModuleDef | undefined {
  return MODULES.find((m) => m.id === id)
}

export function getModulesForPlan(plan: PlanTier): ModuleId[] {
  const order: PlanTier[] = ['core', 'pro', 'scale']
  const planIndex = order.indexOf(plan)
  return MODULES.filter((m) => order.indexOf(m.minPlan) <= planIndex).map((m) => m.id)
}
