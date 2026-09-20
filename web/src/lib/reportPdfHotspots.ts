import zlib from 'zlib'
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import { zoneHotspots, type MarkupZone } from './zoneHotspots'

/**
 * Makes the marked-up drawings in the finalised report clickable: each area,
 * pin or scribble jumps to that zone's photos later in the same PDF.
 *
 * The report is a Word document converted by OnlyOffice, so a drawing
 * arrives as a flat picture — the markups an engineer drew on site are
 * decoration by the time the report is finalised. The links are added
 * afterwards, onto the PDF itself.
 *
 * Finding the pictures is the whole problem. OnlyOffice paints every image
 * as a tiling pattern rather than an image XObject, and writes text with
 * subset fonts carrying no readable characters, so neither the pictures nor
 * the captions can be found by name or by text. What they do have is size:
 * drawings are placed at 425x301pt and photos at 213x159pt, the extents
 * appendAttachments writes. So the pattern fills are read out of each page's
 * content stream, sorted by size, and matched in document order against what
 * was inserted.
 *
 * Internal jumps rather than links to the hosted photos: they work offline,
 * in every viewer, and in a copy that was emailed or archived.
 *
 * Best-effort throughout: anything that can't be matched is left without
 * links, and the report is returned untouched if the parse fails.
 */

/** Sizes appendAttachments places pictures at, in points. */
const DRAWING_W = 5400000 / 12700
const DRAWING_H = 3827160 / 12700
const PHOTO_W = 2700000 / 12700
const PHOTO_H = 2016000 / 12700
const SIZE_TOLERANCE = 6

export type HotspotZone = MarkupZone & { drawingNumber: string | null; drawingRevision: string | null }

export type HotspotSpec = {
  zones: HotspotZone[]
  /** Drawing numbers in the order the report lists them. */
  drawingOrder: string[]
  /** Zone labels in the order their photos appear, with how many each has. */
  photoGroups: { zoneLabel: string; count: number }[]
  /** Each drawing's own page size — the units shape_data is stored in —
   *  keyed by drawing number. */
  drawingSizes?: Record<string, { width: number; height: number }>
}

export type HotspotOutcome = { bytes: Buffer; added: number; reason?: string }

/** The title still has to be set when no hotspots are added. */
async function stampOnly(pdfBytes: Buffer, title?: string): Promise<Buffer> {
  if (!title) return pdfBytes
  try {
    const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false })
    if (doc.getTitle() === title) return pdfBytes
    doc.setTitle(title)
    return Buffer.from(await doc.save())
  } catch {
    return pdfBytes
  }
}

type PlacedImage = { page: number; x0: number; y0: number; x1: number; y1: number; w: number; h: number }

function pageContent(doc: PDFDocument, page: any): string {
  const contents = doc.context.lookup(page.node.get(PDFName.of('Contents')))
  const streams = contents instanceof PDFRawStream
    ? [contents]
    : ((contents as any)?.asArray?.() ?? []).map((r: any) => doc.context.lookup(r))
  return streams
    .map((st: any) => {
      if (!st?.contents) return ''
      try { return zlib.inflateSync(Buffer.from(st.contents)).toString('latin1') }
      catch { return Buffer.from(st.contents).toString('latin1') }
    })
    .join('\n')
}

/** Every pattern-filled rectangle on a page — one per picture. */
function placedImages(content: string, pageIndex: number): PlacedImage[] {
  const out: PlacedImage[] = []
  for (const block of content.split(/\bq\b/)) {
    if (!/\/Pattern cs/.test(block) || !/scn/.test(block)) continue
    const cm = block.match(/([\d.\-]+) ([\d.\-]+) ([\d.\-]+) ([\d.\-]+) ([\d.\-]+) ([\d.\-]+) cm/)
    const points = [...block.matchAll(/([\d.\-]+) ([\d.\-]+) (?:m|l)\b/g)].map(m => [parseFloat(m[1]), parseFloat(m[2])])
    if (!cm || points.length < 2) continue
    const tx = parseFloat(cm[5]), ty = parseFloat(cm[6])
    const xs = points.map(p => p[0]), ys = points.map(p => p[1])
    const x0 = Math.min(...xs) + tx, x1 = Math.max(...xs) + tx
    const y0 = Math.min(...ys) + ty, y1 = Math.max(...ys) + ty
    out.push({ page: pageIndex, x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 })
  }
  // Document order: down the page, then across.
  return out.sort((a, b) => (b.y1 - a.y1) || (a.x0 - b.x0))
}

const isSize = (img: PlacedImage, w: number, h: number) =>
  Math.abs(img.w - w) < SIZE_TOLERANCE && Math.abs(img.h - h) < SIZE_TOLERANCE

function addLink(doc: PDFDocument, page: any, rect: [number, number, number, number], targetRef: any) {
  const annot = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: rect,
    // No visible border — the markup itself already shows where to click.
    Border: [0, 0, 0],
    A: { S: 'GoTo', D: [targetRef, 'XYZ', null, null, null] },
  })
  const ref = doc.context.register(annot)
  const existing = page.node.lookup(PDFName.of('Annots'))
  if (existing && typeof existing.push === 'function') existing.push(ref)
  else page.node.set(PDFName.of('Annots'), doc.context.obj([ref]))
}

/** Adds the hotspots and stamps the title in one pass. Loading and
 *  re-serialising the PDF twice — once for each — was pure duplication. */
export async function addDrawingHotspots(pdfBytes: Buffer, spec: HotspotSpec, title?: string): Promise<HotspotOutcome> {
  const zones = spec.zones.filter(z => (z.drawingNumber ?? '').trim())
  if (zones.length === 0) return { bytes: await stampOnly(pdfBytes, title), added: 0, reason: 'no markups on this report' }
  if (spec.drawingOrder.length === 0) return { bytes: await stampOnly(pdfBytes, title), added: 0, reason: 'no drawings in the report' }

  try {
    const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false })
    const pages = doc.getPages()

    const images: PlacedImage[] = []
    pages.forEach((page, i) => images.push(...placedImages(pageContent(doc, page), i)))

    const drawingImages = images.filter(i => isSize(i, DRAWING_W, DRAWING_H))
    const photoImages = images.filter(i => isSize(i, PHOTO_W, PHOTO_H))
    if (drawingImages.length === 0) {
      return { bytes: await stampOnly(pdfBytes, title), added: 0, reason: 'could not find the drawings in the PDF' }
    }

    // The nth picture of drawing size is the nth drawing the report lists.
    // A rebuilt report can carry the section more than once; the last copy is
    // the one that stands, so later placements win.
    const placementOf = new Map<string, PlacedImage>()
    spec.drawingOrder.forEach((number, i) => {
      for (let k = i; k < drawingImages.length; k += spec.drawingOrder.length) {
        placementOf.set(number.trim(), drawingImages[k])
      }
    })

    // Photos run group by group, so counting them off gives the page each
    // zone's photos start on.
    const photoPageOf = new Map<string, number>()
    let cursor = 0
    for (const group of spec.photoGroups) {
      const first = photoImages[cursor]
      if (first) photoPageOf.set(group.zoneLabel.trim().toLowerCase(), first.page)
      cursor += group.count
    }

    let added = 0
    const missed: string[] = []
    for (const zone of zones) {
      const placement = placementOf.get((zone.drawingNumber ?? '').trim())
      if (!placement) { missed.push(`no placement for ${zone.drawingNumber}`); continue }
      const target = photoPageOf.get(zone.label.trim().toLowerCase())
      if (target === undefined) { missed.push(`no photos for ${zone.label}`); continue }
      if (target === placement.page) { missed.push(`${zone.label} photos share the drawing's page`); continue }

      // zoneHotspots works within the picture, measured from its bottom-left.
      // shape_data is measured in the drawing's own page units, so the
      // drawing's size is what normalises it — not the size it was placed at.
      const source = spec.drawingSizes?.[(zone.drawingNumber ?? '').trim()]
      const rects = zoneHotspots(
        zone, placement.w, placement.h,
        source?.width ?? placement.w, source?.height ?? placement.h,
      )
      for (const [x0, y0, x1, y1] of rects) {
        addLink(
          doc,
          pages[placement.page],
          [placement.x0 + x0, placement.y0 + y0, placement.x0 + x1, placement.y0 + y1],
          pages[target].ref,
        )
        added++
      }
    }

    // The title goes on in this same pass — one load and one save for both.
    const needsTitle = !!title && doc.getTitle() !== title
    if (needsTitle) doc.setTitle(title!)
    if (added === 0 && !needsTitle) {
      return { bytes: pdfBytes, added: 0, reason: missed.join('; ') || 'nothing to link' }
    }
    if (added > 0) console.log('[hotspots] added', added, 'clickable areas across', drawingImages.length, 'drawing placements')
    return { bytes: Buffer.from(await doc.save()), added, reason: missed.join('; ') || undefined }
  } catch (err: any) {
    console.warn('[hotspots] skipped:', err)
    return { bytes: await stampOnly(pdfBytes, title), added: 0, reason: String(err?.message ?? err).slice(0, 200) }
  }
}
