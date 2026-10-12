/** Where a drawing's mark-ups sit, whatever phone drew them.
 *
 *  Pins are stored as percentages across the drawing. Areas and freehand
 *  strokes are stored in pixels of the drawing's preview image — and
 *  "pixels" depended on the phone: Android's image loader shrinks a large
 *  picture as it loads it and reports the shrunken size (about half, for a
 *  2200 px sheet on a budget phone), so the same sheet measured 2200 px on
 *  an iPhone and ~1100 on Android. Shapes drawn on one then appeared at half
 *  or double their distance from the corner on the other, while their pins
 *  and labels stayed put.
 *
 *  Two fixes, both here:
 *  - trueImageSize(): the preview's real size, read from the PNG file's own
 *    header, so new shapes are always stored in the full image's pixels;
 *  - shapeSpace(): the space a stored shape was drawn in, worked out from
 *    the shape and its centre percentage, so existing ones draw in place
 *    too. The web does the same (web/src/lib/zoneHotspots.ts).
 */

import * as FileSystem from 'expo-file-system/legacy'

type Zoneish = { x_percent: number; y_percent: number; markup_type?: string | null; shape_data?: string | null }

/** [width, height] of the space a zone's shape was drawn in; `fallback`
 *  when it can't be told (centre within 2% of the top or left edge). */
export function shapeSpace(zone: Zoneish, fallback: [number, number]): [number, number] {
  try {
    if (!zone.shape_data) return fallback
    let cx: number, cy: number
    if (zone.markup_type === 'rectangle') {
      const r = JSON.parse(zone.shape_data)
      cx = r.x + r.width / 2
      cy = r.y + r.height / 2
    } else if (zone.markup_type === 'freehand') {
      const pts: { x: number; y: number }[] = JSON.parse(zone.shape_data)
      if (!pts?.length) return fallback
      cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
      cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
    } else {
      return fallback
    }
    const fx = zone.x_percent / 100
    const fy = zone.y_percent / 100
    const w = fx > 0.02 ? cx / fx : fallback[0]
    const h = fy > 0.02 ? cy / fy : fallback[1]
    if (!(w > 0 && h > 0) || w > fallback[0] * 4 || w < fallback[0] / 4 || h > fallback[1] * 4 || h < fallback[1] / 4) return fallback
    return [w, h]
  } catch {
    return fallback
  }
}

const b64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

/** A PNG's real width and height from its header; null for anything else
 *  (or if it can't be read). Reads 24 bytes, from the phone or the web. */
export async function trueImageSize(uri: string): Promise<{ width: number; height: number } | null> {
  try {
    let head: Uint8Array
    if (uri.startsWith('file:')) {
      head = b64(await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64, position: 0, length: 24 }))
    } else {
      const res = await fetch(uri, { headers: { Range: 'bytes=0-23' } })
      head = new Uint8Array(await res.arrayBuffer()).slice(0, 24)
    }
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    if (head.length < 24 || png.some((v, i) => head[i] !== v)) return null
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
    const width = view.getUint32(16)
    const height = view.getUint32(20)
    return width > 0 && height > 0 ? { width, height } : null
  } catch {
    return null
  }
}
