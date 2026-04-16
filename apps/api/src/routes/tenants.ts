import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { getVertical, VERTICAL_SLUGS } from '@nuatis/shared'
import { z } from 'zod'

const router = Router()

const supabase = createClient(
  process.env['SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_ROLE_KEY']!
)

// ── Validation schema ─────────────────────────────────────────
const CreateTenantSchema = z.object({
  business_name: z.string().min(2).max(100),
  vertical_slug: z.enum(VERTICAL_SLUGS as [string, ...string[]]),
  owner_email: z.string().email(),
  owner_password: z.string().min(8),
  owner_name: z.string().min(2).max(100),
  timezone: z.string().default('America/Chicago'),
  product: z.enum(['maya_only', 'suite']).default('suite'),
})

// ── POST /api/tenants ─────────────────────────────────────────
router.post('/', async (req: Request, res: Response): Promise<void> => {
  // 1. Validate body
  const parsed = CreateTenantSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      details: parsed.error.flatten().fieldErrors,
    })
    return
  }

  const {
    business_name,
    vertical_slug,
    owner_email,
    owner_password,
    owner_name,
    timezone,
    product,
  } = parsed.data

  // 2. Create Supabase auth user
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: owner_email,
    password: owner_password,
    email_confirm: true,
  })

  if (authError || !authData.user) {
    // Handle duplicate email
    if (authError?.message?.includes('already registered')) {
      res.status(409).json({ error: 'An account with this email already exists' })
      return
    }
    res.status(500).json({ error: 'Failed to create user account' })
    return
  }

  const supabaseUserId = authData.user.id

  // 3. Generate tenant slug from business name
  const slug = business_name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)

  // Ensure uniqueness by appending random suffix
  const uniqueSlug = `${slug}-${Math.random().toString(36).slice(2, 7)}`

  // 4. Load vertical config
  const vertical = getVertical(vertical_slug)

  // 5. Create tenant row
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .insert({
      name: business_name,
      slug: uniqueSlug,
      vertical: vertical_slug,
      auth_provider: 'authjs',
      timezone,
      subscription_status: 'active',
      subscription_plan: 'starter',
      product,
      modules:
        product === 'maya_only'
          ? {
              maya: true,
              crm: false,
              appointments: false,
              pipeline: false,
              automation: false,
              cpq: false,
              insights: false,
            }
          : {
              maya: true,
              crm: true,
              appointments: true,
              pipeline: true,
              automation: true,
              cpq: ['contractor', 'law_firm', 'real_estate', 'sales_crm'].includes(vertical_slug),
              insights: true,
            },
    })
    .select('id')
    .single()

  if (tenantError || !tenant) {
    // Rollback: delete auth user
    console.error('Tenant insert error:', JSON.stringify(tenantError))
    await supabase.auth.admin.deleteUser(supabaseUserId)
    res.status(500).json({ error: 'Failed to create tenant', detail: tenantError?.message })
    return
  }

  const tenantId = tenant.id as string

  // 6. Create owner user row
  const { error: userError } = await supabase.from('users').insert({
    tenant_id: tenantId,
    authjs_user_id: supabaseUserId,
    email: owner_email,
    full_name: owner_name,
    role: 'owner',
  })

  if (userError) {
    // Rollback both
    await supabase.auth.admin.deleteUser(supabaseUserId)
    await supabase.from('tenants').delete().eq('id', tenantId)
    res.status(500).json({ error: 'Failed to create user record' })
    return
  }

  // 6b. Create tenant_users record (RBAC foundation)
  await supabase.from('tenant_users').insert({
    tenant_id: tenantId,
    user_id: supabaseUserId,
    role: 'owner',
    email: owner_email,
    name: owner_name,
  })

  // Also set owner_user_id on tenant
  await supabase.from('tenants').update({ owner_user_id: supabaseUserId }).eq('id', tenantId)

  // 7. Seed vertical config
  const { error: configError } = await supabase.from('vertical_configs').insert({
    tenant_id: tenantId,
    vertical_slug,
    field_definitions: vertical.fields,
    system_prompt_template: vertical.system_prompt_template,
    pipeline_stages_seed: vertical.pipeline_stages,
  })

  if (configError) {
    console.error('vertical_configs seed failed:', configError.message)
    // Non-fatal — tenant still works, config can be reseeded
  }

  // 8. Seed pipeline stages
  const stageInserts = vertical.pipeline_stages.map((stage) => ({
    tenant_id: tenantId,
    name: stage.name,
    position: stage.position,
    color: stage.color,
    is_default: stage.is_default ?? false,
    is_terminal: stage.is_terminal ?? false,
  }))

  await supabase.from('pipeline_stages').insert(stageInserts)

  // 9. Seed default automation rules
  await supabase.from('automation_rules').insert([
    {
      tenant_id: tenantId,
      type: 'appointment_reminder',
      name: 'Appointment reminder',
      is_enabled: true,
      config: {
        send_24h_before: true,
        send_2h_before: true,
        sms_template:
          'Hi {{contact_name}}, reminder: your appointment is tomorrow at {{time}} with {{business_name}}. Reply C to confirm.',
      },
    },
    {
      tenant_id: tenantId,
      type: 'missed_call_sms',
      name: 'Missed call SMS',
      is_enabled: true,
      config: {
        delay_seconds: 60,
        sms_template:
          'Hi! We missed your call at {{business_name}}. How can we help? Reply here or call us back.',
      },
    },
    {
      tenant_id: tenantId,
      type: 'no_show_recovery',
      name: 'No-show recovery',
      is_enabled: true,
      config: {
        delay_minutes: 30,
        sms_template:
          'We missed you today at {{business_name}}! Would you like to reschedule? Reply here.',
      },
    },
  ])

  res.status(201).json({
    message: 'Account created successfully',
    tenant_id: tenantId,
    vertical: vertical_slug,
    slug: uniqueSlug,
  })
})

export default router
