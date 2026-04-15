interface Contact {
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
}

interface Tenant {
  business_name?: string
  name?: string
  phone?: string
}

export function resolveMergeTags(templateBody: string, contact: Contact, tenant: Tenant): string {
  const fullName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim()

  return templateBody
    .replaceAll('{{first_name}}', contact.first_name || '')
    .replaceAll('{{last_name}}', contact.last_name || '')
    .replaceAll('{{full_name}}', fullName)
    .replaceAll('{{email}}', contact.email || '')
    .replaceAll('{{phone}}', contact.phone || '')
    .replaceAll('{{business_name}}', tenant.business_name || tenant.name || '')
    .replaceAll('{{business_phone}}', tenant.phone || '')
}

export function resolveTemplate(
  template: { subject: string; body: string },
  contact: Contact,
  tenant: Tenant
): { subject: string; body: string } {
  return {
    subject: resolveMergeTags(template.subject, contact, tenant),
    body: resolveMergeTags(template.body, contact, tenant),
  }
}
