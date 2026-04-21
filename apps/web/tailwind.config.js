/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        bg: '#f9f8f5',
        bg2: '#f2f0eb',
        bg3: '#e8e5de',
        ink: '#1a1814',
        ink2: '#3d3a34',
        ink3: '#7a7468',
        accent: '#1d4ed8',
        accent2: '#1e40af',
        'teal-brand': '#0d9488',
        'amber-brand': '#d97706',
        'border-brand': '#dedad2',
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
