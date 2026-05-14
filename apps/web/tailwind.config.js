/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
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
        'teal-brand': '#0d9488',
        // Amber
        'amber-brand': '#d97706',
        // Border
        border: '#dedad2',
        'border-brand': '#dedad2',
        // Dark mode
        'dark-bg': '#12110e',
        'dark-alt': '#1a1714',
        'dark-card': '#0f1a1a',
        // Module colors
        'maya-ai': '#0d9488',
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
    },
  },
  plugins: [],
}
