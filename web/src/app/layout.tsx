import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'SiteIQ Web',
  description: 'Structural Engineering Site Inspection Platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant:wght@400;500;600;700&family=Outfit:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}