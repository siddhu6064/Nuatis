'use client'

interface VerticalField {
  key: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'boolean'
  required: boolean
  options?: string[]
}

interface VerticalFieldRendererProps {
  fields: VerticalField[]
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  readOnly?: boolean
}

export function VerticalFieldRenderer({
  fields,
  values,
  onChange,
  readOnly = false,
}: VerticalFieldRendererProps) {
  if (fields.length === 0) return null

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {fields.map((field) => (
        <FieldInput
          key={field.key}
          field={field}
          value={values[field.key]}
          onChange={(val) => onChange(field.key, val)}
          readOnly={readOnly}
        />
      ))}
    </div>
  )
}

interface FieldInputProps {
  field: VerticalField
  value: unknown
  onChange: (value: unknown) => void
  readOnly: boolean
}

function FieldInput({ field, value, onChange, readOnly }: FieldInputProps) {
  const baseInput = `
    w-full px-3 py-2 text-sm border border-gray-300 rounded-lg
    focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent
    disabled:bg-gray-50 disabled:text-gray-500
  `.trim()

  const label = (
    <label className="block text-sm font-medium text-gray-700 mb-1">
      {field.label}
      {field.required && <span className="text-red-500 ml-1">*</span>}
    </label>
  )

  switch (field.type) {
    case 'text':
      return (
        <div>
          {label}
          <input
            type="text"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={readOnly}
            required={field.required}
            className={baseInput}
          />
        </div>
      )

    case 'textarea':
      return (
        <div className="sm:col-span-2">
          {label}
          <textarea
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={readOnly}
            required={field.required}
            rows={3}
            className={baseInput}
          />
        </div>
      )

    case 'number':
      return (
        <div>
          {label}
          <input
            type="number"
            value={typeof value === 'number' ? value : ''}
            onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
            disabled={readOnly}
            required={field.required}
            className={baseInput}
          />
        </div>
      )

    case 'date':
      return (
        <div>
          {label}
          <input
            type="date"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={readOnly}
            required={field.required}
            className={baseInput}
          />
        </div>
      )

    case 'select':
      return (
        <div>
          {label}
          <select
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={readOnly}
            required={field.required}
            className={baseInput}
          >
            <option value="">— select —</option>
            {field.options?.map((opt) => (
              <option key={opt} value={opt}>
                {opt.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
      )

    case 'boolean':
      return (
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id={`field-${field.key}`}
            checked={typeof value === 'boolean' ? value : false}
            onChange={(e) => onChange(e.target.checked)}
            disabled={readOnly}
            className="w-4 h-4 text-teal-600 border-gray-300 rounded
                       focus:ring-teal-500"
          />
          <label htmlFor={`field-${field.key}`} className="text-sm font-medium text-gray-700">
            {field.label}
          </label>
        </div>
      )

    default:
      return null
  }
}
