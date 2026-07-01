'use client'
import { useEffect } from 'react'
import './globals.css'

// Intercepts every fetch() call on every page and logs any header value
// that contains a character outside ISO-8859-1 (code > 255).
// That is the character that triggers "String contains non ISO-8859-1 code point".
function HeaderDebugger() {
  useEffect(() => {
    const orig = window.fetch.bind(window)
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      try {
        const hdrs = init?.headers
        if (hdrs) {
          const entries: [string, string][] =
            hdrs instanceof Headers
              ? Array.from((hdrs as Headers).entries())
              : Object.entries(hdrs as Record<string, string>)
          for (const [k, v] of entries) {
            for (let i = 0; i < v.length; i++) {
              if (v.charCodeAt(i) > 255) {
                console.error(
                  '[BAD-HEADER]',
                  'key:', k,
                  'char:', JSON.stringify(v[i]),
                  'code:', v.charCodeAt(i),
                  'index:', i,
                  'url:', String(input),
                  '\nstack:', new Error().stack?.split('\n').slice(1, 5).join('\n')
                )
              }
            }
          }
        }
      } catch (ex) {
        console.error('[BAD-HEADER] inspect error:', ex)
      }
      return orig(input, init)
    }
    return () => { window.fetch = orig }
  }, [])
  return null
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant:wght@400;500;600;700&family=Outfit:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <HeaderDebugger />
        {children}
      </body>
    </html>
  )
}