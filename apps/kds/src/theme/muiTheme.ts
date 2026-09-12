import { createTheme } from '@mui/material/styles'
// Same tokens the dashboard, the register and Tailwind read — change colours
// there, not here.
import tokens from '@nuatis/design-tokens'

/**
 * Kitchen display theme.
 *
 * Same palette as the register, but tuned for a screen nobody stands close to:
 * a cook reads it from across a hot line, hands full, often at an angle. Type
 * is larger and the base font size is bumped so every rem-sized control scales
 * with it rather than needing per-component overrides.
 *
 * Touch targets stay large even though the KDS is mostly read, not tapped —
 * the taps it does get are with the back of a knuckle or a gloved hand.
 */
export const muiTheme = createTheme({
  palette: {
    primary: { main: tokens.colors.tealBrand },
    secondary: { main: tokens.colors.amberBrand },
    background: { default: tokens.colors.bg, paper: tokens.colors.cream },
    text: { primary: tokens.colors.ink, secondary: tokens.colors.ink3 },
  },
  shape: { borderRadius: 12 },
  typography: {
    htmlFontSize: 16,
    fontSize: 16,
    button: { fontSize: '1.125rem', textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { minHeight: 56, paddingInline: 20 },
      },
    },
    MuiIconButton: {
      styleOverrides: { root: { minWidth: 48, minHeight: 48 } },
    },
  },
})
