import { createTheme } from '@mui/material/styles'
// Same tokens the dashboard and Tailwind read — change colours there, not here.
import tokens from '@nuatis/design-tokens'

/**
 * Register theme.
 *
 * Same palette as the dashboard, deliberately larger controls: this is a
 * touchscreen operated by someone standing up, often in a hurry, sometimes
 * with one hand. 56px is the smallest comfortable repeated-use touch target;
 * the PIN pad goes larger still.
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
