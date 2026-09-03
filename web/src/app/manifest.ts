import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SiteIQ',
    short_name: 'SiteIQ',
    description: 'Structural engineering field inspection and reporting',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#FAF8F4',
    theme_color: '#F5A524',
    icons: [
      { src: '/icon-192', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
