export const metadata = {
  title: 'Nuatis',
  description: 'AI-powered front-office platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
