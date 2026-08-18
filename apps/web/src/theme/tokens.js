/**
 * Single source of truth for design tokens shared between Tailwind
 * (tailwind.config.js) and the MUI theme (muiTheme.ts). Plain CJS so
 * tailwind.config.js can `require()` it directly — Tailwind v3's config
 * loader doesn't run through a TS transpiler. muiTheme.ts imports it too
 * (apps/web's tsconfig has allowJs: true, so the JSDoc types below are
 * checked on that side).
 *
 * Change a value here, not in tailwind.config.js or muiTheme.ts — until
 * this file existed the two were hand-duplicated and could silently drift.
 * See docs/mui-v9-migration-plan.md phase 3.
 */

/** @typedef {{ DEFAULT: string, light: string, mid: string, dark: string }} TealScale */

/**
 * @type {{
 *   colors: {
 *     bg: string, bg2: string, bg3: string,
 *     cream: string, cream2: string, cream3: string,
 *     ink: string, ink2: string, ink3: string, ink4: string,
 *     accent: string,
 *     teal: TealScale,
 *     tealBrand: string,
 *     amberBrand: string,
 *     border: string, borderBrand: string,
 *     darkBg: string, darkAlt: string, darkCard: string,
 *     mayaAi: string, crm: string, automation: string, scheduling: string,
 *     pipeline: string, cpq: string, inventory: string, staff: string, insights: string,
 *   },
 *   fontFamily: {
 *     display: string[], sans: string[], mono: string[],
 *   },
 * }}
 */
const tokens = {
  colors: {
    // Base palette
    bg: '#f9f8f5',
    bg2: '#f2f0eb',
    bg3: '#e8e5de',
    cream: '#f9f8f5',
    cream2: '#f2f0eb',
    cream3: '#e8e4dc',
    // Text / ink scale
    ink: '#1a1814',
    ink2: '#3d3a34',
    ink3: '#7a7468',
    ink4: '#a8a29a',
    // Accent
    accent: '#0d9488',
    // Teal scale
    teal: {
      DEFAULT: '#0d9488',
      light: '#ccfbf1',
      mid: '#99f6e4',
      dark: '#0f766e',
    },
    tealBrand: '#0d9488',
    // Amber
    amberBrand: '#d97706',
    // Border
    border: '#dedad2',
    borderBrand: '#dedad2',
    // Dark mode
    darkBg: '#12110e',
    darkAlt: '#1a1714',
    darkCard: '#0f1a1a',
    // Module colors
    mayaAi: '#0d9488',
    crm: '#6366f1',
    automation: '#f59e0b',
    scheduling: '#10b981',
    pipeline: '#8b5cf6',
    cpq: '#ef4444',
    inventory: '#0ea5e9',
    staff: '#f97316',
    insights: '#f97316',
  },
  fontFamily: {
    display: ['DM Serif Display', 'Georgia', 'serif'],
    sans: ['DM Sans', 'system-ui', '-apple-system', 'sans-serif'],
    mono: ['DM Mono', 'ui-monospace', 'monospace'],
  },
}

module.exports = tokens
