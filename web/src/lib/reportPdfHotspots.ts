import { PDFDocument, PDFName } from 'pdf-lib'
import { zoneHotspots, type MarkupZone } from './zoneHotspots'

/**
 * Makes the marked-up drawings in the finalised report clickable: each area,
 * pin or scribble jumps to that zone's photos later in the same PDF.
 *
 * The report is written as a Word document and converted by OnlyOffice, so
 * the drawing arrives as a flat picture with nothing clickable on it. The
 * links are added afterwards, straight onto the PDF, by finding where each
 * drawing and each photo heading landed.
 *
 * Internal jumps rather than links out to the hosted photos: they work
 * offline, in every viewer, and in a copy that was emailed or archived.
 *
 * Best-effort throughout — a drawing whose caption can't be found simply
 * gets no hotspots, and the report is returned untouched if anything fails.
 */

/** The drawing picture's size in the document (EMU), from appendAttachments. */
const IMAGE_W_PT = 5400000 / 12700
const IMAGE_H_PT = 3827160 / 12700
/** Gap between a caption's baseline and the top of the picture below it. */
const CAPTION_GAP = 10

export type HotspotZone = MarkupZone & { drawingNumber: string | null; drawingRevision: string | null }

export type HotspotSpec = {
  zones: HotspotZone[]
  /** The drawing's own page size, which shape_data is measured against. */
  drawingSize?: { width: number; height: number }
}

type TextItem = { text: string; x: number; y: number; page: number }

/** Every text run in the PDF with its position, or null if it can't be read. */
async function readTextItems(bytes: Uint8Array): Promise<TextItem[] | null> {
  try {
    // Imported here so a failure to load it can't break finalising.
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.js')
    const pdf = await pdfjs.getDocument({ data: bytes, useSystemFonts: true, disableWorker: true, isEvalSupported: false }).promise
    const items: TextItem[] = []
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p)
      const content = await page.getTextContent()
      for (const item of content.items as any[]) {
        const text = String(item.str ?? '').trim()
        if (!text) continue
        items.push({ text, x: item.transform[4], y: item.transform[5], page: p - 1 })
      }
    }
    return items
  } catch (err) {
    console.warn('[hotspots] could not read the PDF text:', err)
    return null
  }
}

function addLink(doc: PDFDocument, page: any, rect: [number, number, number, number], targetRef: any) {
  const annot = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: rect,
    Border: [0, 0, 0],
    A: { S: 'GoTo', D: [targetRef, 'XYZ', null, null, null] },
  })
  const ref = doc.context.register(annot)
  const existing = page.node.lookup(PDFName.of('Annots'))
  if (existing && typeof existing.push === 'function') existing.push(ref)
  else page.node.set(PDFName.of('Annots'), doc.context.obj([ref]))
}

export type HotspotOutcome = { bytes: Buffer; added: number; reason?: string }

export async function addDrawingHotspots(pdfBytes: Buffer, spec: HotspotSpec): Promise<HotspotOutcome> {
  const zonesWithDrawing = spec.zones.filter(z => (z.drawingNumber ?? '').trim())
  if (zonesWithDrawing.length === 0) return { bytes: pdfBytes, added: 0, reason: 'no markups on this report' }

  const items = await readTextItems(new Uint8Array(pdfBytes))
  if (!items) return { bytes: pdfBytes, added: 0, reason: 'could not read the PDF text' }

  try {
    const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false })
    const pages = doc.getPages()

    // Where the photographs start — zone headings before this are the
    // drawings' own titles, not photo headings.
    const photosStart = items.find(i => /^SITE PHOTOGRAPHS$/i.test(i.text))?.page ?? Infinity

    /** The page a zone's photos are on, by its heading. */
    const photoPageFor = (label: string): number | null => {
      const hit = items.find(i => i.page >= photosStart && i.text.toLowerCase() === label.trim().toLowerCase())
      return hit ? hit.page : null
    }

    let added = 0
    const missed: string[] = []
    const byDrawing = new Map<string, HotspotZone[]>()
    for (const z of zonesWithDrawing) {
      const key = `${z.drawingNumber}|${z.drawingRevision ?? ''}`
      if (!byDrawing.has(key)) byDrawing.set(key, [])
      byDrawing.get(key)!.push(z)
    }

    for (const [key, zones] of byDrawing) {
      const [number, revision] = key.split('|')
      // The caption appendAttachments writes under each drawing.
      const caption = items.find(i => i.text.startsWith(`Ref: ${number}`) && i.text.includes(revision || ''))
        ?? items.find(i => i.text.startsWith(`Ref: ${number}`))
      if (!caption) { missed.push(`no caption for ${number}`); continue }

      // The picture sits below its caption, unless it wouldn't fit — Word
      // then pushes it to the top of the next page.
      let imagePage = caption.page
      let imageTop = caption.y - CAPTION_GAP
      let imageLeft = caption.x
      if (imageTop - IMAGE_H_PT < 40 && imagePage + 1 < pages.length) {
        imagePage = caption.page + 1
        imageTop = pages[imagePage].getHeight() - 60
      }
      const page = pages[imagePage]
      if (!page) continue

      for (const zone of zones) {
        const target = photoPageFor(zone.label)
        if (target === null) { missed.push(`no photo page for ${zone.label}`); continue }
        if (target === imagePage) { missed.push(`${zone.label} photos on the drawing page`); continue }

        // zoneHotspots works in the picture's own coordinates, measured from
        // its bottom-left, so the rects only need shifting onto the page.
        const rects = zoneHotspots(
          zone,
          IMAGE_W_PT,
          IMAGE_H_PT,
          spec.drawingSize?.width ?? IMAGE_W_PT,
          spec.drawingSize?.height ?? IMAGE_H_PT,
        )
        for (const [x0, y0, x1, y1] of rects) {
          const rect: [number, number, number, number] = [
            imageLeft + x0,
            imageTop - IMAGE_H_PT + y0,
            imageLeft + x1,
            imageTop - IMAGE_H_PT + y1,
          ]
          addLink(doc, page, rect, pages[target].ref)
          added++
        }
      }
    }

    if (added === 0) return { bytes: pdfBytes, added: 0, reason: missed.join('; ') || 'nothing to link' }
    console.log('[hotspots] added', added, 'clickable areas to the drawings')
    return { bytes: Buffer.from(await doc.save()), added, reason: missed.join('; ') || undefined }
  } catch (err: any) {
    console.warn('[hotspots] skipped:', err)
    return { bytes: pdfBytes, added: 0, reason: String(err?.message ?? err).slice(0, 200) }
  }
}
