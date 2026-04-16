import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

interface FieldDefinition {
  id: string
  type: string
  label: string
  required: boolean
  placeholder?: string
  options?: string[]
}

interface FormDefinition {
  name: string
  fields: FieldDefinition[]
}

const VERTICAL_FORMS: Record<string, FormDefinition> = {
  dental: {
    name: 'New Patient Intake',
    fields: [
      { id: 'field_1', type: 'text', label: 'Name', required: true, placeholder: 'Your full name' },
      {
        id: 'field_2',
        type: 'email',
        label: 'Email',
        required: true,
        placeholder: 'you@example.com',
      },
      {
        id: 'field_3',
        type: 'phone',
        label: 'Phone',
        required: true,
        placeholder: '(555) 000-0000',
      },
      { id: 'field_4', type: 'date', label: 'Date of Birth', required: true },
      {
        id: 'field_5',
        type: 'text',
        label: 'Insurance Provider',
        required: false,
        placeholder: 'e.g. Delta Dental',
      },
      {
        id: 'field_6',
        type: 'textarea',
        label: 'Allergies',
        required: false,
        placeholder: 'List any known allergies',
      },
      {
        id: 'field_7',
        type: 'text',
        label: 'Emergency Contact',
        required: false,
        placeholder: 'Name and phone number',
      },
      {
        id: 'field_8',
        type: 'checkbox',
        label: 'I consent to treatment and data collection',
        required: true,
      },
    ],
  },

  salon: {
    name: 'New Client Form',
    fields: [
      { id: 'field_1', type: 'text', label: 'Name', required: true, placeholder: 'Your full name' },
      {
        id: 'field_2',
        type: 'email',
        label: 'Email',
        required: true,
        placeholder: 'you@example.com',
      },
      {
        id: 'field_3',
        type: 'phone',
        label: 'Phone',
        required: true,
        placeholder: '(555) 000-0000',
      },
      {
        id: 'field_4',
        type: 'select',
        label: 'Hair Type',
        required: false,
        options: ['Straight', 'Wavy', 'Curly', 'Coily'],
      },
      {
        id: 'field_5',
        type: 'textarea',
        label: 'Allergies',
        required: false,
        placeholder: 'List any known allergies or sensitivities',
      },
      {
        id: 'field_6',
        type: 'select',
        label: 'Referral Source',
        required: false,
        options: ['Google', 'Referral', 'Social Media', 'Walk-in', 'Other'],
      },
      {
        id: 'field_7',
        type: 'checkbox',
        label: 'I agree to receive marketing communications',
        required: false,
      },
    ],
  },

  contractor: {
    name: 'Project Request Form',
    fields: [
      { id: 'field_1', type: 'text', label: 'Name', required: true, placeholder: 'Your full name' },
      {
        id: 'field_2',
        type: 'email',
        label: 'Email',
        required: true,
        placeholder: 'you@example.com',
      },
      {
        id: 'field_3',
        type: 'phone',
        label: 'Phone',
        required: true,
        placeholder: '(555) 000-0000',
      },
      {
        id: 'field_4',
        type: 'select',
        label: 'Project Type',
        required: true,
        options: ['Renovation', 'New Build', 'Repair', 'Other'],
      },
      {
        id: 'field_5',
        type: 'text',
        label: 'Property Address',
        required: true,
        placeholder: '123 Main St, City, State',
      },
      {
        id: 'field_6',
        type: 'select',
        label: 'Budget Range',
        required: false,
        options: ['Under $5k', '$5k-$15k', '$15k-$50k', '$50k+'],
      },
      {
        id: 'field_7',
        type: 'select',
        label: 'Timeline',
        required: false,
        options: ['ASAP', '1-3 months', '3-6 months', '6+ months'],
      },
      {
        id: 'field_8',
        type: 'textarea',
        label: 'Project Description',
        required: false,
        placeholder: 'Describe your project in detail',
      },
    ],
  },

  restaurant: {
    name: 'Reservation Details',
    fields: [
      { id: 'field_1', type: 'text', label: 'Name', required: true, placeholder: 'Your full name' },
      {
        id: 'field_2',
        type: 'email',
        label: 'Email',
        required: true,
        placeholder: 'you@example.com',
      },
      {
        id: 'field_3',
        type: 'phone',
        label: 'Phone',
        required: true,
        placeholder: '(555) 000-0000',
      },
      {
        id: 'field_4',
        type: 'number',
        label: 'Party Size',
        required: true,
        placeholder: 'Number of guests',
      },
      {
        id: 'field_5',
        type: 'textarea',
        label: 'Dietary Restrictions',
        required: false,
        placeholder: 'Any dietary restrictions or allergies',
      },
      {
        id: 'field_6',
        type: 'select',
        label: 'Special Occasion',
        required: false,
        options: ['Birthday', 'Anniversary', 'Business', 'None'],
      },
    ],
  },

  law_firm: {
    name: 'Client Intake',
    fields: [
      { id: 'field_1', type: 'text', label: 'Name', required: true, placeholder: 'Your full name' },
      {
        id: 'field_2',
        type: 'email',
        label: 'Email',
        required: true,
        placeholder: 'you@example.com',
      },
      {
        id: 'field_3',
        type: 'phone',
        label: 'Phone',
        required: true,
        placeholder: '(555) 000-0000',
      },
      {
        id: 'field_4',
        type: 'select',
        label: 'Case Type',
        required: true,
        options: ['Family', 'Criminal', 'Corporate', 'Real Estate', 'Personal Injury', 'Other'],
      },
      {
        id: 'field_5',
        type: 'textarea',
        label: 'Brief Description',
        required: true,
        placeholder: 'Briefly describe your legal matter',
      },
      {
        id: 'field_6',
        type: 'select',
        label: 'Preferred Contact Method',
        required: false,
        options: ['Phone', 'Email'],
      },
      {
        id: 'field_7',
        type: 'text',
        label: 'Referral Source',
        required: false,
        placeholder: 'How did you hear about us?',
      },
      {
        id: 'field_8',
        type: 'checkbox',
        label: 'I consent to the collection and use of my information',
        required: true,
      },
    ],
  },

  real_estate: {
    name: 'Buyer/Seller Inquiry',
    fields: [
      { id: 'field_1', type: 'text', label: 'Name', required: true, placeholder: 'Your full name' },
      {
        id: 'field_2',
        type: 'email',
        label: 'Email',
        required: true,
        placeholder: 'you@example.com',
      },
      {
        id: 'field_3',
        type: 'phone',
        label: 'Phone',
        required: true,
        placeholder: '(555) 000-0000',
      },
      {
        id: 'field_4',
        type: 'select',
        label: 'Interest',
        required: true,
        options: ['Buying', 'Selling', 'Renting'],
      },
      {
        id: 'field_5',
        type: 'select',
        label: 'Property Type',
        required: false,
        options: ['Single Family', 'Condo', 'Townhouse', 'Multi-family', 'Commercial'],
      },
      {
        id: 'field_6',
        type: 'select',
        label: 'Budget Range',
        required: false,
        options: ['Under $200k', '$200k-$500k', '$500k-$1M', '$1M+'],
      },
      {
        id: 'field_7',
        type: 'select',
        label: 'Timeline',
        required: false,
        options: ['ASAP', '1-3 months', '3-6 months', '6+ months'],
      },
      {
        id: 'field_8',
        type: 'select',
        label: 'Pre-Approval',
        required: false,
        options: ['Yes', 'No', 'In Progress'],
      },
    ],
  },

  default: {
    name: 'Lead Inquiry',
    fields: [
      { id: 'field_1', type: 'text', label: 'Name', required: true, placeholder: 'Your full name' },
      {
        id: 'field_2',
        type: 'email',
        label: 'Email',
        required: true,
        placeholder: 'you@example.com',
      },
      {
        id: 'field_3',
        type: 'phone',
        label: 'Phone',
        required: true,
        placeholder: '(555) 000-0000',
      },
      {
        id: 'field_4',
        type: 'text',
        label: 'Company',
        required: false,
        placeholder: 'Your company name',
      },
      {
        id: 'field_5',
        type: 'text',
        label: 'Role',
        required: false,
        placeholder: 'Your job title',
      },
      {
        id: 'field_6',
        type: 'textarea',
        label: 'Interest',
        required: false,
        placeholder: 'What are you interested in?',
      },
      {
        id: 'field_7',
        type: 'select',
        label: 'Budget',
        required: false,
        options: ['Under $1k', '$1k-$10k', '$10k-$50k', '$50k+'],
      },
      {
        id: 'field_8',
        type: 'select',
        label: 'Timeline',
        required: false,
        options: ['Immediate', '1-3 months', '3-6 months', 'Exploring'],
      },
    ],
  },
}

// sales_crm maps to the same form definition as default
VERTICAL_FORMS['sales_crm'] = VERTICAL_FORMS['default']!

async function main() {
  const tenantId = process.argv[2]
  const vertical = process.argv[3] ?? 'default'

  if (!tenantId) {
    console.error('Usage: npx tsx apps/api/src/scripts/seed-intake-forms.ts <tenant_id> [vertical]')
    process.exit(1)
  }

  const supabaseUrl = process.env['SUPABASE_URL']
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY']

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      '[seed-intake-forms] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required'
    )
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const formDef = VERTICAL_FORMS[vertical]
  if (!formDef) {
    const available = Object.keys(VERTICAL_FORMS).join(', ')
    console.error(`[seed-intake-forms] unknown vertical: "${vertical}". Available: ${available}`)
    process.exit(1)
  }

  // Check if a form with the same name already exists for this tenant (idempotent)
  const { data: existing, error: fetchError } = await supabase
    .from('intake_forms')
    .select('name')
    .eq('tenant_id', tenantId)
    .eq('name', formDef.name)

  if (fetchError) {
    console.error(`[seed-intake-forms] error fetching existing forms: ${fetchError.message}`)
    process.exit(1)
  }

  if (existing && existing.length > 0) {
    console.info(
      `[seed-intake-forms] form "${formDef.name}" already exists for tenant=${tenantId} — skipping`
    )
    return
  }

  const { error: insertError } = await supabase.from('intake_forms').insert({
    tenant_id: tenantId,
    name: formDef.name,
    fields: formDef.fields,
    is_default: true,
    is_active: true,
  })

  if (insertError) {
    console.error(`[seed-intake-forms] insert error: ${insertError.message}`)
    process.exit(1)
  }

  console.info(
    `[seed-intake-forms] created form "${formDef.name}" for tenant=${tenantId} vertical=${vertical}`
  )
}

main().catch(console.error)
