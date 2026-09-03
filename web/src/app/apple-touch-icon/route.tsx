import { ImageResponse } from 'next/og'

// A plain custom route (not Next's special apple-icon.tsx convention) —
// that convention forces build-time prerendering regardless of a
// force-dynamic export, which hits the same Windows @vercel/og font-path
// bug as icon-192/icon-512 did. Linked manually via
// <link rel="apple-touch-icon"> in layout.tsx instead.
export const dynamic = 'force-dynamic'

// No rounded corners — iOS applies its own squircle mask to
// apple-touch-icon automatically; a pre-rounded square gets double-masked.
export async function GET() {
  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%',
        background: '#F5A524',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="118" height="118" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      </div>
    ),
    { width: 180, height: 180 }
  )
}
