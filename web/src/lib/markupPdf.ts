import { PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib'
import { captureDrawingWithMarkup } from './captureDrawing'

/** Builds a self-contained "marked-up drawing + photos" PDF.
 *
 *  Page 1 (per drawing) is the drawing with its pins rendered, and each pin
 *  that has photos is a clickable hotspot jumping to that zone's photo
 *  pages later in the same file. Photo pages link back to the drawing.
 *
 *  Deliberately self-contained rather than linking out: relative links to
 *  image files next to the PDF are only honoured by Acrobat (Chrome, Edge
 *  and Preview ignore them), and links to hosted photos need a connection,
 *  which is no use for an archived or emailed handover copy. Internal GoTo
 *  jumps work in every viewer, offline.
 *
 *  Runs in the browser: it reuses the existing canvas-based drawing
 *  renderer, and downscales photos through a canvas before embedding, which
 *  is what keeps the file emailable.
 */

export type MarkupZone = {
  id: string
  label: string
  x_percent: number
  y_percent: number
  markup_type: 'pin' | 'rectangle' | 'freehand'
  shape_data: string | null
}

export type MarkupDrawing = {
  id: string
  title: string
  number: string | null
  revision: string | null
  file_url: string
  zones: MarkupZone[]
}

export type MarkupPhoto = { url: string; zoneId: string | null; zoneLabel: string }

const HEADER_H = 44
const DRAW_MAX_W = 820
const DRAW_MAX_H = 1000
const A4 = { w: 595.28, h: 841.89 }
const MARGIN = 36
const PHOTO_MAX_DIM = 1500
const PHOTO_QUALITY = 0.82

/** Fetches a photo and re-encodes it smaller. A hundred untouched site
 *  photos would produce a file too big to send; at this size they still
 *  read clearly on screen and in print. */
async function loadScaledJpeg(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const blob = await res.blob()
    const bitmap = await createImageBitmap(blob)

    const scale = Math.min(1, PHOTO_MAX_DIM / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()

    const out: Blob | null = await new Promise(resolve =>
      canvas.toBlob(b => resolve(b), 'image/jpeg', PHOTO_QUALITY)
    )
    return out ? await out.arrayBuffer() : null
  } catch {
    return null
  }
}

/** Adds a clickable region that jumps to another page in this document. */
function addInternalLink(
  doc: PDFDocument,
  page: any,
  rect: [number, number, number, number],
  targetRef: any
) {
  const annot = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: rect,
    // No visible border — the pin graphic already shows where to click.
    Border: [0, 0, 0],
    A: { S: 'GoTo', D: [targetRef, 'XYZ', null, null, null] },
  })
  const ref = doc.context.register(annot)
  const existing = page.node.lookup(PDFName.of('Annots'))
  if (existing && typeof existing.push === 'function') existing.push(ref)
  else page.node.set(PDFName.of('Annots'), doc.context.obj([ref]))
}

export type BuildMarkupPdfOptions = {
  drawings: MarkupDrawing[]
  photos: MarkupPhoto[]
  reportTitle: string
  onProgress?: (done: number, total: number) => void
}

/** Returns null when there is nothing to show — no drawing has any pins. */
export async function buildMarkupPdf(
  { drawings, photos, reportTitle, onProgress }: BuildMarkupPdfOptions
): Promise<Blob | null> {
  const usable = drawings.filter(d => d.zones.length > 0 && d.file_url)
  if (usable.length === 0) return null

  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const ink = rgb(0.16, 0.18, 0.22)
  const mid = rgb(0.48, 0.51, 0.56)
  const accent = rgb(0.23, 0.29, 0.39)

  // Photos are matched by zone id; label is only a fallback for older rows
  // whose zone_id was cleared before the linkage was fixed.
  const photosForZone = (zone: MarkupZone) =>
    photos.filter(p => (p.zoneId ? p.zoneId === zone.id : p.zoneLabel === zone.label))

  const totalPhotos = usable
    .flatMap(d => d.zones)
    .reduce((n, z) => n + photosForZone(z).length, 0)
  let done = 0

  for (const drawing of usable) {
    // ── Drawing page ────────────────────────────────────────────────────
    const blob = await captureDrawingWithMarkup(drawing.file_url, drawing.zones)
    const png = await doc.embedPng(await blob.arrayBuffer())

    const fit = Math.min(DRAW_MAX_W / png.width, DRAW_MAX_H / png.height, 1)
    const imgW = png.width * fit
    const imgH = png.height * fit

    const drawPage = doc.addPage([imgW, imgH + HEADER_H])
    const heading = [drawing.number, drawing.title].filter(Boolean).join(' — ')
    drawPage.drawText(heading || 'Marked-up drawing', {
      x: 14, y: imgH + 26, size: 12, font: bold, color: ink,
    })
    drawPage.drawText(
      `${reportTitle}${drawing.revision ? `  ·  Rev ${drawing.revision}` : ''}  ·  tap a pin to see its photos`,
      { x: 14, y: imgH + 11, size: 8.5, font, color: mid }
    )
    drawPage.drawImage(png, { x: 0, y: 0, width: imgW, height: imgH })

    // ── Photo pages, one zone at a time ─────────────────────────────────
    for (const zone of drawing.zones) {
      const zonePhotos = photosForZone(zone)
      if (zonePhotos.length === 0) continue // nothing to link to

      let firstPageRef: any = null

      for (let i = 0; i < zonePhotos.length; i += 2) {
        const page = doc.addPage([A4.w, A4.h])
        if (!firstPageRef) firstPageRef = page.ref

        page.drawText(zone.label || 'Zone', {
          x: MARGIN, y: A4.h - MARGIN - 4, size: 14, font: bold, color: ink,
        })
        page.drawText(
          `${zonePhotos.length} photo${zonePhotos.length === 1 ? '' : 's'} at this location` +
          (zonePhotos.length > 2 ? `  ·  ${i + 1}–${Math.min(i + 2, zonePhotos.length)}` : ''),
          { x: MARGIN, y: A4.h - MARGIN - 20, size: 9, font, color: mid }
        )

        // Back to the drawing it came from.
        const backLabel = 'back to drawing'
        const backW = font.widthOfTextAtSize(backLabel, 9)
        page.drawText(backLabel, {
          x: A4.w - MARGIN - backW, y: A4.h - MARGIN - 20, size: 9, font, color: accent,
        })
        addInternalLink(
          doc, page,
          [A4.w - MARGIN - backW - 4, A4.h - MARGIN - 25, A4.w - MARGIN + 4, A4.h - MARGIN - 8],
          drawPage.ref
        )

        const slotH = (A4.h - MARGIN * 2 - 46) / 2 - 14
        const slotW = A4.w - MARGIN * 2

        for (let s = 0; s < 2; s++) {
          const photo = zonePhotos[i + s]
          if (!photo) break

          const bytes = await loadScaledJpeg(photo.url)
          done++
          onProgress?.(done, totalPhotos)
          const slotTop = A4.h - MARGIN - 46 - s * (slotH + 14)
          if (!bytes) {
            page.drawText('(photo could not be loaded)', {
              x: MARGIN, y: slotTop - 14, size: 9, font, color: mid,
            })
            continue
          }

          try {
            const jpg = await doc.embedJpg(bytes)
            const s2 = Math.min(slotW / jpg.width, slotH / jpg.height)
            const w = jpg.width * s2
            const h = jpg.height * s2
            page.drawImage(jpg, { x: MARGIN + (slotW - w) / 2, y: slotTop - h, width: w, height: h })
          } catch {
            page.drawText('(photo could not be embedded)', {
              x: MARGIN, y: slotTop - 14, size: 9, font, color: mid,
            })
          }
        }
      }

      // ── Make the pin clickable ────────────────────────────────────────
      // Every markup type carries x_percent/y_percent, so the hotspot sits
      // on the pin centre regardless of whether it was drawn as a pin,
      // rectangle or freehand shape.
      if (firstPageRef) {
        const cx = (zone.x_percent / 100) * imgW
        const cy = imgH - (zone.y_percent / 100) * imgH
        const R = 20
        addInternalLink(doc, drawPage, [cx - R, cy - R, cx + R, cy + R], firstPageRef)
      }
    }
  }

  const bytes = await doc.save()
  // Copy into a plain ArrayBuffer: pdf-lib's Uint8Array is typed against
  // ArrayBufferLike, which BlobPart won't accept.
  const buf = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buf).set(bytes)
  return new Blob([buf], { type: 'application/pdf' })
}
