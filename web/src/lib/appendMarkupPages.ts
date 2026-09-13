import { PDFDocument, PDFName } from 'pdf-lib'

/** Appends the marked-up drawing pages, with their photo hotspots intact, to
 *  the finalised report PDF.
 *
 *  The markup PDF already links every pin, area and freehand markup to the
 *  photos taken at it (see markupPdf.ts). Those links are internal GoTo
 *  jumps, and copying pages between documents does NOT carry them across
 *  correctly: pdf-lib copies the annotation, but its destination still points
 *  at the page object from the source document, so the hotspot lands nowhere.
 *  Verified directly — a naive copy produces a link whose target is not any
 *  page of the merged file.
 *
 *  So each copied link is re-pointed at the copied page that now holds its
 *  target, worked out by page index rather than by object reference.
 *
 *  Never throws: the finalised PDF is the document of record, and it is worth
 *  more without the extra pages than not at all. */
export async function appendMarkupPages(
  reportPdf: Buffer,
  markupPdf: Buffer
): Promise<Buffer> {
  try {
    const report = await PDFDocument.load(new Uint8Array(reportPdf), { ignoreEncryption: true })
    const markup = await PDFDocument.load(new Uint8Array(markupPdf), { ignoreEncryption: true })

    const sourcePages = markup.getPages()
    if (sourcePages.length === 0) return reportPdf

    // A document saved with no pages comes back from pdf-lib reporting one
    // page, with nothing drawn on it — appending that would put a blank sheet
    // on the end of a signed-off report. The client never stores an empty
    // markup PDF, so this is only a guard against a damaged one.
    if (sourcePages.every(page => !(page.node as any).Contents())) {
      console.warn('[appendMarkupPages] Stored markup PDF has no content — nothing appended')
      return reportPdf
    }

    // Which source page does each link point at? Recorded before copying,
    // while the refs still mean something in the source document.
    const destinations: (number | null)[][] = sourcePages.map(page => {
      const annots: any = page.node.lookup(PDFName.of('Annots'))
      if (!annots?.size) return []

      const perAnnot: (number | null)[] = []
      for (let i = 0; i < annots.size(); i++) {
        const dest = annots.lookup(i)?.lookup(PDFName.of('A'))?.lookup(PDFName.of('D'))
        const ref = dest?.get?.(0)
        if (!ref) { perAnnot.push(null); continue }
        const index = sourcePages.findIndex(p => String(p.ref) === String(ref))
        perAnnot.push(index >= 0 ? index : null)
      }
      return perAnnot
    })

    const copied = await report.copyPages(markup, markup.getPageIndices())
    copied.forEach(page => report.addPage(page))

    copied.forEach((page, pageIndex) => {
      const annots: any = page.node.lookup(PDFName.of('Annots'))
      if (!annots?.size) return

      for (let i = 0; i < annots.size(); i++) {
        const target = destinations[pageIndex]?.[i]
        if (target === undefined || target === null) continue

        const action = annots.lookup(i)?.lookup(PDFName.of('A'))
        if (!action) continue

        action.set(
          PDFName.of('D'),
          report.context.obj([copied[target].ref, PDFName.of('XYZ'), null, null, null])
        )
      }
    })

    return Buffer.from(await report.save())
  } catch (err) {
    console.error('[appendMarkupPages] Could not append the marked-up drawings:', err)
    return reportPdf
  }
}
