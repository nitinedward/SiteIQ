import { PDFDocument } from 'pdf-lib'

/** Makes sure a PDF carries `title` as its document title, returning the
 *  bytes to serve and whether anything had to change.
 *
 *  A PDF viewer shows this title in preference to the file name it was
 *  served under — Chrome puts it top-left in its toolbar — so this, not
 *  Content-Disposition, is what decides whether a finalised report reads as
 *  "Lynn Mall Zone C - Report 001" or as a raw UUID. OnlyOffice takes a
 *  `title` on the conversion, but this doesn't rely on it honouring one:
 *  the bytes are checked, and stamped, after the fact.
 *
 *  The title can't be found by searching the raw bytes — pdf-lib writes
 *  metadata into compressed object streams — so this parses. Measured at
 *  ~110ms to read and ~110ms to rewrite a 2.6MB, 60-page document; only a
 *  document whose title is already wrong pays the second half.
 *
 *  Never throws: a report that opens under an ugly name still beats a
 *  report that doesn't open, so an unparseable PDF is passed through. */
export async function ensurePdfTitle(
  pdf: Buffer,
  title: string
): Promise<{ bytes: Buffer; changed: boolean }> {
  try {
    const doc = await PDFDocument.load(new Uint8Array(pdf), { ignoreEncryption: true })
    if (doc.getTitle() === title) return { bytes: pdf, changed: false }

    doc.setTitle(title)
    return { bytes: Buffer.from(await doc.save()), changed: true }
  } catch (err) {
    console.error('[pdfTitle] could not set the title, leaving the PDF as-is:', err)
    return { bytes: pdf, changed: false }
  }
}
