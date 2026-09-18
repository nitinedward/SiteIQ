/** Where a markup is clickable on a drawing.
 *
 *  Shared by the markup PDF built in the browser and the clickable areas
 *  added to the finalised report on the server, so both put the target in the
 *  same place. Kept free of any browser or Node dependency for that reason.
 */

export type MarkupZone = {
  id: string
  label: string
  x_percent: number
  y_percent: number
  markup_type: 'pin' | 'rectangle' | 'freehand'
  shape_data: string | null
}

type Rect = [number, number, number, number]

/** Grows a rect by `pad`, and out to `min` on either axis if it came back
 *  smaller than a fingertip — a short scribble or a thin sliver of an area
 *  is still something you should be able to tap. */
function padRect([x0, y0, x1, y1]: Rect, pad: number, min: number): Rect {
  let a = x0 - pad, b = y0 - pad, c = x1 + pad, d = y1 + pad
  if (c - a < min) { const m = (a + c) / 2; a = m - min / 2; c = m + min / 2 }
  if (d - b < min) { const m = (b + d) / 2; b = m - min / 2; d = m + min / 2 }
  return [a, b, c, d]
}

/** The clickable region for a zone on the drawing page, in page coordinates.
 *
 *  A pin is a point, so a fixed target on it is right. An area or a freehand
 *  shape is not: its centre is usually blank drawing inside the outline, and
 *  a freehand stroke need not pass anywhere near its own centroid — so those
 *  used to have a 40pt target floating in empty space, which is why only
 *  pinned photos appeared to be linked. Each shape now gets its own outline.
 *
 *  `shape_data` is stored in the drawing's own PDF units measured from the
 *  top-left (the same mapping captureDrawing renders with); page coordinates
 *  run from the bottom-left, hence the flip.
 */
export function zoneHotspots(
  zone: MarkupZone,
  imgW: number,
  imgH: number,
  pdfWidth: number,
  pdfHeight: number
): Rect[] {
  const cx = (zone.x_percent / 100) * imgW
  const cy = imgH - (zone.y_percent / 100) * imgH
  const PIN_R = 20
  // Room for the label chip, which is drawn above the shape.
  const LABEL_H = 22
  const atCentre: Rect = [cx - PIN_R, cy - PIN_R, cx + PIN_R, cy + PIN_R]

  const toPage = (fx: number, fy: number): [number, number] => [fx * imgW, imgH - fy * imgH]

  if (!zone.markup_type || zone.markup_type === 'pin' || !zone.shape_data) return [atCentre]

  try {
    let left: number, right: number, top: number, bottom: number

    if (zone.markup_type === 'rectangle') {
      const r = JSON.parse(zone.shape_data) as { x: number; y: number; width: number; height: number }
      // Normalised, because a rectangle dragged up or left has a negative
      // width or height and would otherwise produce an inside-out rect.
      left = Math.min(r.x, r.x + r.width) / pdfWidth
      right = Math.max(r.x, r.x + r.width) / pdfWidth
      top = Math.min(r.y, r.y + r.height) / pdfHeight
      bottom = Math.max(r.y, r.y + r.height) / pdfHeight
    } else {
      const pts = JSON.parse(zone.shape_data) as { x: number; y: number }[]
      if (!pts?.length) return [atCentre]
      left = Math.min(...pts.map(p => p.x)) / pdfWidth
      right = Math.max(...pts.map(p => p.x)) / pdfWidth
      top = Math.min(...pts.map(p => p.y)) / pdfHeight
      bottom = Math.max(...pts.map(p => p.y)) / pdfHeight
    }

    const [x0, yBottom] = toPage(left, bottom)
    const [x1, yTop] = toPage(right, top)
    const shape = padRect([x0, yBottom, x1, yTop + LABEL_H], 6, 28)
    // The centre target stays as well: harmless where it overlaps, and it
    // keeps a freehand zone's label clickable when the label sits off the
    // stroke's bounding box.
    return [shape, atCentre]
  } catch {
    return [atCentre]
  }
}
