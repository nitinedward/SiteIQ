import { ImageResponse } from 'next/og'

// force-dynamic (not force-static) — @vercel/og's ImageResponse hits a
// Windows-path bug ("TypeError: Invalid URL" in fileURLToPath) when Next
// tries to prerender it during `next build` on Windows. Deferring to real
// request time (on Vercel's Linux servers) avoids that entirely.
export const dynamic = 'force-dynamic'

export async function GET() {
  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%',
        background: '#F5A524',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="130" height="130" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      </div>
    ),
    { width: 192, height: 192 }
  )
}
