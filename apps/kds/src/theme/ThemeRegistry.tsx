'use client'

import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter'
import { ThemeProvider } from '@mui/material/styles'
import { muiTheme } from './muiTheme'

/**
 * Wraps the app in MUI's Emotion SSR cache + theme. `enableCssLayer: true`
 * wraps every MUI-generated rule in `@layer mui`, which Tailwind's own
 * utilities sit outside of — Tailwind utility classes win any specificity
 * conflict against MUI defaults without needing `!important`. See
 * docs/mui-v9-migration-plan.md for why this matters here specifically.
 *
 * No CssBaseline: Tailwind's preflight already normalizes the document: two
 * competing resets would fight over margin/box-sizing.
 */
export function ThemeRegistry({ children }: { children: React.ReactNode }) {
  return (
    <AppRouterCacheProvider options={{ key: 'mui', enableCssLayer: true }}>
      <ThemeProvider theme={muiTheme}>{children}</ThemeProvider>
    </AppRouterCacheProvider>
  )
}
