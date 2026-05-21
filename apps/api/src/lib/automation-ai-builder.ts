import { GoogleGenAI } from '@google/genai'
import type {
  GeneratedAutomation,
  CustomAutomationTrigger,
  CustomAutomationAction,
} from '@nuatis/shared'

const VALID_TRIGGERS: CustomAutomationTrigger[] = [
  'no_response',
  'birthday',
  'overdue_invoice',
  'inactive_customer',
  'new_contact',
  'appointment_followup',
]

const VALID_ACTIONS: CustomAutomationAction[] = [
  'send_sms',
  'send_email',
  'create_task',
  'add_tag',
  'update_field',
  'send_to_campaign',
]

const FALLBACK_UNAVAILABLE: GeneratedAutomation = {
  name: 'Unnamed',
  description: '',
  trigger_type: 'no_response',
  trigger_config: {},
  action_type: 'send_sms',
  action_config: {},
  confidence: 0,
  error: 'AI service unavailable',
}

const FALLBACK_INVALID: GeneratedAutomation = {
  name: 'Unnamed',
  description: '',
  trigger_type: 'no_response',
  trigger_config: {},
  action_type: 'send_sms',
  action_config: {},
  confidence: 0,
  error: 'Invalid AI response',
}

export async function generateAutomationConfig(params: {
  naturalLanguagePrompt: string
  tenantId: string
  businessName?: string
  vertical?: string
}): Promise<GeneratedAutomation> {
  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) {
    return FALLBACK_UNAVAILABLE
  }

  const { naturalLanguagePrompt, businessName, vertical } = params

  const contextLines: string[] = []
  if (businessName) contextLines.push(`Business name: ${businessName}`)
  if (vertical) contextLines.push(`Business vertical: ${vertical}`)
  const contextBlock = contextLines.length > 0 ? `\n${contextLines.join('\n')}\n` : ''

  const prompt = `You are an automation configuration assistant for a small business CRM platform.
${contextBlock}
The user wants to create an automation. Based on their description, generate a JSON automation configuration.

User request: "${naturalLanguagePrompt}"

Valid trigger_type values (choose exactly one):
- no_response: Contact hasn't replied within N days
- birthday: Contact's birthday
- overdue_invoice: Invoice is past due
- inactive_customer: Customer hasn't engaged in N days
- new_contact: A new contact is added
- appointment_followup: After an appointment

Valid action_type values (choose exactly one):
- send_sms: Send an SMS message (action_config should include { message: "..." })
- send_email: Send an email (action_config should include { subject: "...", body: "..." })
- create_task: Create a task (action_config should include { title: "...", due_days: N })
- add_tag: Add a tag to contact (action_config should include { tag: "..." })
- update_field: Update a contact field (action_config should include { field: "...", value: "..." })
- send_to_campaign: Enroll contact in a campaign (action_config should include { campaign_name: "..." })

For trigger_config, include relevant settings such as { days: N } for time-based triggers.

Respond with ONLY valid JSON — no markdown, no code blocks, no explanation. The JSON must have exactly these fields:
{
  "name": "string — short automation name",
  "description": "string — one sentence describing what this automation does",
  "trigger_type": "one of the valid trigger_type values",
  "trigger_config": { ... },
  "action_type": "one of the valid action_type values",
  "action_config": { ... },
  "confidence": 0.0 to 1.0
}`

  try {
    const genai = new GoogleGenAI({ apiKey })
    const response = await genai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ parts: [{ text: prompt }] }],
    })

    const rawText = response.text
    if (!rawText) {
      return FALLBACK_UNAVAILABLE
    }

    // Strip markdown code fences if present
    const stripped = rawText
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim()

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(stripped) as Record<string, unknown>
    } catch {
      return FALLBACK_INVALID
    }

    // Validate required fields
    const triggerType = parsed['trigger_type']
    const actionType = parsed['action_type']
    const confidence = parsed['confidence']

    if (
      typeof triggerType !== 'string' ||
      !VALID_TRIGGERS.includes(triggerType as CustomAutomationTrigger)
    ) {
      return FALLBACK_INVALID
    }

    if (
      typeof actionType !== 'string' ||
      !VALID_ACTIONS.includes(actionType as CustomAutomationAction)
    ) {
      return FALLBACK_INVALID
    }

    if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
      return FALLBACK_INVALID
    }

    return {
      name: typeof parsed['name'] === 'string' ? parsed['name'] : 'Unnamed',
      description: typeof parsed['description'] === 'string' ? parsed['description'] : '',
      trigger_type: triggerType as CustomAutomationTrigger,
      trigger_config:
        parsed['trigger_config'] !== null &&
        typeof parsed['trigger_config'] === 'object' &&
        !Array.isArray(parsed['trigger_config'])
          ? (parsed['trigger_config'] as Record<string, unknown>)
          : {},
      action_type: actionType as CustomAutomationAction,
      action_config:
        parsed['action_config'] !== null &&
        typeof parsed['action_config'] === 'object' &&
        !Array.isArray(parsed['action_config'])
          ? (parsed['action_config'] as Record<string, unknown>)
          : {},
      confidence,
    }
  } catch {
    return FALLBACK_UNAVAILABLE
  }
}
