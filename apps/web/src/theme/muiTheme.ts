import { createTheme } from '@mui/material/styles'
import tokens from './tokens.js'

/** Tailwind's fontFamily arrays -> MUI's CSS font-family string, quoting names with spaces. */
function fontStack(stack: string[]): string {
  return stack.map((name) => (name.includes(' ') ? `"${name}"` : name)).join(', ')
}

/**
 * MUI theme mapped onto the existing Tailwind design tokens. Both this
 * file and tailwind.config.js read from theme/tokens.js — see
 * docs/mui-v9-migration-plan.md phase 3. Change a color/font in
 * tokens.js, not here or in tailwind.config.js.
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
      default: tokens.colors.bg,
      paper: '#ffffff', // no Tailwind equivalent — plain white MUI surface
    },
    text: {
      primary: tokens.colors.ink,
      secondary: tokens.colors.ink3,
      disabled: tokens.colors.ink4,
    },
    primary: {
      main: tokens.colors.accent,
      light: tokens.colors.teal.mid,
      dark: tokens.colors.teal.dark,
      contrastText: '#ffffff',
    },
    secondary: {
      main: tokens.colors.amberBrand,
      contrastText: '#ffffff',
    },
    divider: tokens.colors.border,
    error: {
      main: tokens.colors.cpq, // reused as the closest existing red
    },
  },
  typography: {
    fontFamily: fontStack(tokens.fontFamily.sans),
    h1: { fontFamily: fontStack(tokens.fontFamily.display) },
    h2: { fontFamily: fontStack(tokens.fontFamily.display) },
    h3: { fontFamily: fontStack(tokens.fontFamily.display) },
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
          border: `1px solid ${tokens.colors.border}`,
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
