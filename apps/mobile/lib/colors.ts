export const colors = {
  paper: '#F8F7F4',
  white: '#FFFFFF',
  black: '#000000',
  ink: '#0E0E0E',
  ink2: '#3A3A3A',
  ink3: '#6B6B6B',
  ink4: '#9B9B9B',
  border: '#E5E5E2',
  bg: '#F8F7F4',
  blue: '#0047FF',
  green: '#006B3F',
  orange: '#E84A00',
  teal: '#007A6E',
  red: '#C73F1A',
  yellow: '#E9A800',
  purple: '#7C3AED',
  emerald: '#059669',
}

export const lifecycleColors: Record<string, string> = {
  subscriber: colors.ink4,
  lead: colors.blue,
  marketing_qualified: colors.purple,
  sales_qualified: colors.orange,
  opportunity: colors.yellow,
  customer: colors.green,
  evangelist: colors.emerald,
  other: colors.ink4,
}

export const gradeColors: Record<string, string> = {
  A: colors.green,
  B: colors.blue,
  C: colors.yellow,
  D: colors.orange,
  F: colors.red,
}
