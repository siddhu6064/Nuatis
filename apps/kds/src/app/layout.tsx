import type { Metadata, Viewport } from 'next'
import { ThemeRegistry } from '@/theme/ThemeRegistry'
import './globals.css'

export const metadata: Metadata = {
  title: 'Nuatis Kitchen',
  // A kitchen display is never a search result.
  robots: { index: false, follow: false },
}

/**
 * A fixed wall-mounted screen. Pinch-zoom on it is never intentional — it is a
 * cook steadying themselves against the monitor.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ThemeRegistry>{children}</ThemeRegistry>
      </body>
    </html>
  )
}
