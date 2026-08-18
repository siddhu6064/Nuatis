import { createTheme } from '@mui/material/styles'

/**
 * MUI theme mapped onto the existing Tailwind design tokens
 * (apps/web/tailwind.config.js). Values are duplicated rather than
 * shared from a single source for now — see docs/mui-v9-migration-plan.md
 * phase 1 for why, and the follow-up to extract a shared tokens module.
 * If you change a color/font here, change tailwind.config.js too.
 */
export const muiTheme = createTheme({
  cssVariables: {
    // Scope MUI's CSS variables so they can't collide with any app-level
    // custom properties already on :root.
    cssVarPrefix: 'mui',
  },
  palette: {
    mode: 'light',
    background: {
      default: '#f9f8f5', // bg
      paper: '#ffffff',
    },
    text: {
      primary: '#1a1814', // ink
      secondary: '#7a7468', // ink3
      disabled: '#a8a29a', // ink4
    },
    primary: {
      main: '#0d9488', // teal / accent
      light: '#99f6e4', // teal.mid
      dark: '#0f766e', // teal.dark
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#d97706', // amber-brand
      contrastText: '#ffffff',
    },
    divider: '#dedad2', // border
    error: {
      main: '#ef4444', // cpq module color, reused as the closest existing red
    },
  },
  typography: {
    fontFamily: '"DM Sans", system-ui, -apple-system, sans-serif',
    h1: { fontFamily: '"DM Serif Display", Georgia, serif' },
    h2: { fontFamily: '"DM Serif Display", Georgia, serif' },
    h3: { fontFamily: '"DM Serif Display", Georgia, serif' },
    button: { textTransform: 'none' }, // Tailwind buttons in this app are not uppercased
  },
  shape: {
    borderRadius: 12, // matches Tailwind's rounded-xl used across existing cards
  },
  components: {
    MuiButtonBase: {
      defaultProps: {
        disableRipple: false,
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          border: '1px solid #dedad2',
          backgroundImage: 'none', // disable MUI's default elevation overlay gradient
        },
      },
    },
    MuiCard: {
      defaultProps: {
        elevation: 0, // this app's cards use a border, not a shadow, at rest
      },
    },
  },
})
