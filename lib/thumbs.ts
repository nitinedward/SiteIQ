/** Small images of drawings and sketches, for lists and pickers.
 *
 *  A drawing's own image (preview_url) is the full sheet, 0.5–2 MB — fine to
 *  mark up, far too heavy for a grid of twenty on mobile data. The website
 *  makes a ~15 KB copy on request (Next.js's image resizer, which serves
 *  only our Supabase storage — web/next.config.mjs) and caches it.
 *
 *  A project kept offline has these copies on the phone (lib/offline/
 *  download); localFor() finds them. With neither, the list shows a
 *  placeholder. */

import { localFor } from './offline/files'

const DEFAULT_APP_URL = 'https://www.site-iq.co.nz'
const WIDTH = 384 // one of Next.js's standard sizes; 2× a 190 px card

function appBase(): string {
  const raw = (process.env.EXPO_PUBLIC_APP_URL ?? DEFAULT_APP_URL).trim().replace(/\/+$/, '')
  return raw.replace(/^https:\/\/site-iq\.co\.nz/i, DEFAULT_APP_URL)
}

/** The web address of a drawing image's small copy. */
export function thumbRemote(previewUrl: string): string {
  return `${appBase()}/_next/image?url=${encodeURIComponent(previewUrl)}&w=${WIDTH}&q=70`
}

/** What to show for a drawing in a list: the small copy (the phone's, when
 *  kept offline), else the phone's full image, else the small copy's web
 *  address; null for a drawing with no image. */
export function thumbFor(previewUrl: string | null | undefined): string | null {
  if (!previewUrl) return null
  const remote = thumbRemote(previewUrl)
  const local = localFor(remote)
  if (local !== remote) return local
  const full = localFor(previewUrl)
  if (full !== previewUrl) return full
  return remote
}

/** The full image to look at closely: the phone's copy when there is one. */
export function fullImageFor(previewUrl: string | null | undefined): string | null {
  return previewUrl ? localFor(previewUrl) : null
}
