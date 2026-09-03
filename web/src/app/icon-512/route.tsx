import { ImageResponse } from 'next/og'

// force-dynamic (not force-static) — see icon-192/route.tsx for why.
export const dynamic = 'force-dynamic'

export async function GET() {
  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%',
        background: '#F5A524',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="340" height="340" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      </div>
    ),
    { width: 512, height: 512 }
  )
}
