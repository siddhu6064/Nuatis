export const colors = {
  // Homepage design system tokens
  bg: '#f9f8f5',
  bg2: '#f2f0eb',
  bg3: '#e8e5de',
  ink: '#1a1814',
  ink2: '#3d3a34',
  ink3: '#7a7468',
  accent: '#1d4ed8',
  accent2: '#1e40af',
  amber: '#d97706',
  border: '#dedad2',
  white: '#ffffff',

  // Existing aliases retained for compatibility
  paper: '#f9f8f5',
  black: '#000000',
  ink4: '#9B9B9B',
  blue: '#1d4ed8',
  green: '#006B3F',
  orange: '#E84A00',
  teal: '#0d9488',
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
