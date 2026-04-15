import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

interface TemplateDefinition {
  name: string
  subject: string
  body: string
}

const VERTICAL_TEMPLATES: Record<string, TemplateDefinition[]> = {
  default: [
    {
      name: 'Welcome',
      subject: 'Welcome to {{business_name}}',
      body: `Hi {{first_name}},

Thank you for choosing {{business_name}}! We're so glad to have you with us.

If you have any questions or need assistance, don't hesitate to reach out. You can call us at {{business_phone}} and we'll be happy to help.

Looking forward to working with you!

Warm regards,
The Team at {{business_name}}`,
    },
    {
      name: 'Appointment Reminder',
      subject: 'Your appointment tomorrow at {{business_name}}',
      body: `Hi {{first_name}},

This is a friendly reminder that you have an appointment with us tomorrow at {{business_name}}.

If you need to reschedule or have any questions beforehand, please give us a call at {{business_phone}}.

We look forward to seeing you!

Best,
{{business_name}}`,
    },
    {
      name: 'Follow Up',
      subject: "We'd love to hear from you, {{first_name}}",
      body: `Hi {{first_name}},

We wanted to check in and see how everything went after your recent visit to {{business_name}}.

Your feedback means a lot to us. If there's anything we can do better — or if we knocked it out of the park — we'd love to hear about it.

Feel free to reply to this email or give us a call at {{business_phone}}.

Thank you for your time!

Best,
{{business_name}}`,
    },
  ],

  dental: [
    {
      name: 'Welcome',
      subject: 'Welcome to {{business_name}}',
      body: `Dear {{first_name}},

Welcome to {{business_name}}! We are delighted to have you as a new patient and look forward to partnering with you on your dental health journey.

Our team is committed to providing you with the highest quality of care in a comfortable and welcoming environment. Should you have any questions prior to your first visit, please do not hesitate to contact us at {{business_phone}}.

We look forward to meeting you.

Warm regards,
The Care Team at {{business_name}}`,
    },
    {
      name: 'Appointment Reminder',
      subject: 'Your appointment tomorrow at {{business_name}}',
      body: `Dear {{first_name}},

We wanted to send a warm reminder that you have a dental appointment scheduled with us tomorrow at {{business_name}}.

Please arrive a few minutes early if this is your first visit, so we can complete any necessary paperwork. If you need to reschedule, please call us at {{business_phone}} as soon as possible so we can accommodate another patient.

We look forward to seeing you and helping you maintain a healthy, beautiful smile.

With care,
{{business_name}}`,
    },
    {
      name: 'Follow Up',
      subject: "We'd love to hear from you, {{first_name}}",
      body: `Dear {{first_name}},

We hope you're feeling well following your recent visit to {{business_name}}. Your comfort and satisfaction are our top priorities, and we want to make sure you received the best care possible.

If you have any concerns, questions about your treatment, or simply want to share your experience, please reach out to us at {{business_phone}}. We are always here to help.

Thank you for trusting us with your dental care.

Warmly,
{{business_name}}`,
    },
  ],

  salon: [
    {
      name: 'Welcome',
      subject: 'Welcome to {{business_name}}',
      body: `Hey {{first_name}}! 🎉

Welcome to the {{business_name}} family — we're SO excited you're here!

Whether you're coming in for a fresh cut, a bold new color, or just some well-deserved pampering, we've got you covered. We can't wait to help you look and feel amazing.

Got questions? Give us a ring at {{business_phone}} — we're always happy to chat!

See you soon,
The Crew at {{business_name}}`,
    },
    {
      name: 'Appointment Reminder',
      subject: 'Your appointment tomorrow at {{business_name}}',
      body: `Hey {{first_name}}!

Just a quick heads-up — you've got an appointment with us tomorrow at {{business_name}} and we are READY for you! ✂️✨

Need to make any changes? No worries — just give us a call at {{business_phone}} and we'll sort it out.

Can't wait to see you!

XO,
{{business_name}}`,
    },
    {
      name: 'Follow Up',
      subject: "We'd love to hear from you, {{first_name}}",
      body: `Hey {{first_name}}!

Hope you're loving your new look! We had so much fun with you at {{business_name}} and would love to hear what you think.

Did we nail it? Have ideas on how we can make your next visit even better? Drop us a reply or call us at {{business_phone}} — your feedback truly means the world to us!

Until next time,
{{business_name}} 💇`,
    },
  ],

  contractor: [
    {
      name: 'Welcome',
      subject: 'Welcome to {{business_name}}',
      body: `Hi {{first_name}},

Thanks for choosing {{business_name}}. We're glad to have you on board and look forward to getting the job done right.

Our team is committed to quality work, clear communication, and showing up when we say we will. If you have any questions or need to discuss your project, call us directly at {{business_phone}}.

We'll be in touch soon.

{{business_name}}`,
    },
    {
      name: 'Appointment Reminder',
      subject: 'Your appointment tomorrow at {{business_name}}',
      body: `Hi {{first_name}},

Confirming that our team from {{business_name}} will be on-site tomorrow for your scheduled appointment.

If anything has changed or you need to reschedule, please contact us at {{business_phone}} as soon as possible so we can adjust our schedule accordingly.

We'll see you tomorrow.

{{business_name}}`,
    },
    {
      name: 'Follow Up',
      subject: "We'd love to hear from you, {{first_name}}",
      body: `Hi {{first_name}},

We recently completed work at your property and wanted to follow up to make sure everything met your expectations.

If you have any concerns or notice anything that needs attention, contact us at {{business_phone}} and we'll make it right. We also appreciate referrals — if you know someone who needs reliable contractor services, we'd be grateful for the introduction.

Thanks for your business.

{{business_name}}`,
    },
  ],
}

async function main() {
  const tenantId = process.argv[2]
  const vertical = process.argv[3] ?? 'default'

  if (!tenantId) {
    console.error(
      'Usage: npx tsx apps/api/src/scripts/seed-email-templates.ts <tenant_id> [vertical]'
    )
    process.exit(1)
  }

  const supabaseUrl = process.env['SUPABASE_URL']
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY']

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      '[seed-email-templates] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required'
    )
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const templates = VERTICAL_TEMPLATES[vertical]
  if (!templates) {
    const available = Object.keys(VERTICAL_TEMPLATES).join(', ')
    console.error(`[seed-email-templates] unknown vertical: "${vertical}". Available: ${available}`)
    process.exit(1)
  }

  // Fetch existing template names for this tenant to support idempotent inserts
  const { data: existing, error: fetchError } = await supabase
    .from('email_templates')
    .select('name')
    .eq('tenant_id', tenantId)

  if (fetchError) {
    console.error(`[seed-email-templates] error fetching existing templates: ${fetchError.message}`)
    process.exit(1)
  }

  const existingNames = new Set((existing ?? []).map((t: { name: string }) => t.name))

  const toInsert = templates
    .filter((t) => !existingNames.has(t.name))
    .map((t) => ({
      tenant_id: tenantId,
      name: t.name,
      subject: t.subject,
      body: t.body,
      vertical,
      is_default: true,
    }))

  if (toInsert.length === 0) {
    console.info(
      `[seed-email-templates] all templates already exist for tenant=${tenantId} — skipping`
    )
    return
  }

  const { error: insertError } = await supabase.from('email_templates').insert(toInsert)

  if (insertError) {
    console.error(`[seed-email-templates] insert error: ${insertError.message}`)
    process.exit(1)
  }

  console.info(
    `[seed-email-templates] inserted ${toInsert.length} template(s) for tenant=${tenantId} vertical=${vertical}`
  )

  const skipped = templates.length - toInsert.length
  if (skipped > 0) {
    console.info(`[seed-email-templates] skipped ${skipped} already-existing template(s)`)
  }
}

main().catch(console.error)
