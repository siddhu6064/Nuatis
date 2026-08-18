const tokens = require('./src/theme/tokens.js')

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Base palette
        bg: tokens.colors.bg,
        bg2: tokens.colors.bg2,
        bg3: tokens.colors.bg3,
        cream: tokens.colors.cream,
        cream2: tokens.colors.cream2,
        cream3: tokens.colors.cream3,
        // Text / ink scale
        ink: tokens.colors.ink,
        ink2: tokens.colors.ink2,
        ink3: tokens.colors.ink3,
        ink4: tokens.colors.ink4,
        // Accent
        accent: tokens.colors.accent,
        // Teal scale
        teal: tokens.colors.teal,
        'teal-brand': tokens.colors.tealBrand,
        // Amber
        'amber-brand': tokens.colors.amberBrand,
        // Border
        border: tokens.colors.border,
        'border-brand': tokens.colors.borderBrand,
        // Dark mode
        'dark-bg': tokens.colors.darkBg,
        'dark-alt': tokens.colors.darkAlt,
        'dark-card': tokens.colors.darkCard,
        // Module colors
        'maya-ai': tokens.colors.mayaAi,
        crm: tokens.colors.crm,
        automation: tokens.colors.automation,
        scheduling: tokens.colors.scheduling,
        pipeline: tokens.colors.pipeline,
        cpq: tokens.colors.cpq,
        inventory: tokens.colors.inventory,
        staff: tokens.colors.staff,
        insights: tokens.colors.insights,
      },
      fontFamily: tokens.fontFamily,
    },
  },
  plugins: [],
}
