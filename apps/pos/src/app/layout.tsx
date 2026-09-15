import type { Metadata, Viewport } from 'next'
import { ThemeRegistry } from '@/theme/ThemeRegistry'
import './globals.css'

export const metadata: Metadata = {
  title: 'Nuatis Register',
  // A register is never a search result.
  robots: { index: false, follow: false },
}

/**
 * A register is a fixed-size touchscreen. Pinch-zooming it mid-service is
 * never intentional — it is a mis-grab with two fingers on the counter.
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
