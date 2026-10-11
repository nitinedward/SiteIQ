/** When the phone uploads — the engineer's choice, in Profile, so site work
 *  needn't use their mobile data.
 *
 *  Note text, visits and mark-ups are tiny; photos and recordings are what
 *  use data, which is why one of the choices separates them. */

import { getMeta, setMeta } from './db'

export type UploadMode = 'auto' | 'photos-wifi' | 'wifi' | 'manual'

export const UPLOAD_MODES: { key: UploadMode; label: string; detail: string }[] = [
  { key: 'auto',        label: 'Automatically',     detail: 'Everything uploads whenever there’s signal.' },
  { key: 'photos-wifi', label: 'Photos on Wi-Fi',   detail: 'Notes upload on any signal; photos and recordings wait for Wi-Fi.' },
  { key: 'wifi',        label: 'Wi-Fi only',        detail: 'Nothing uploads over mobile data.' },
  { key: 'manual',      label: 'When I tap Upload', detail: 'Nothing uploads until you tap Upload now.' },
]

const KEY = 'device:uploadMode'
let mode: UploadMode | null = null
const listeners = new Set<(m: UploadMode) => void>()

export async function uploadMode(): Promise<UploadMode> {
  if (!mode) mode = (await getMeta<UploadMode>(KEY)) ?? 'auto'
  return mode
}

export async function setUploadMode(next: UploadMode): Promise<void> {
  mode = next
  await setMeta(KEY, next)
  listeners.forEach(l => l(next))
}

export function onUploadModeChange(listener: (m: UploadMode) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** What may upload now, given the mode and the connection. `manual` is an
 *  engineer's tap on Upload now, which sends everything. */
export function allowed(m: UploadMode, onWifi: boolean, manual: boolean): { changes: boolean; files: boolean } {
  if (manual) return { changes: true, files: true }
  switch (m) {
    case 'auto':        return { changes: true, files: true }
    case 'photos-wifi': return { changes: true, files: onWifi }
    case 'wifi':        return { changes: onWifi, files: onWifi }
    case 'manual':      return { changes: false, files: false }
  }
}
