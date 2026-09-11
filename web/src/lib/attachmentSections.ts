import AdmZip from 'adm-zip'
import { loadDoc, saveDoc } from '@/lib/docStorage'

/** The photo and drawing blocks SiteIQ manages inside the report .docx.
 *
 *  Each lives in its own bookmark so it can be rebuilt on its own: inserting
 *  photos rewrites only the photo block and leaves the markups where they
 *  are, and vice versa. They are also lifted out and re-grafted whenever the
 *  written text is regenerated (AI or plain), so regenerating never costs
 *  the user their attachments.
 *
 *  Everything here is deliberately tolerant of a document that has been
 *  through the OnlyOffice editor: bookmarks are located by NAME and the
 *  matching end tag by the id that name carries, because a round-trip can
 *  renumber ids and reorder attributes. */

const REL_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'

export type SectionName = 'drawings' | 'photos'

export const SECTION_DEFS: Record<SectionName, { id: string; bookmark: string }> = {
  drawings: { id: '999001', bookmark: 'siteiq_drawings' },
  photos:   { id: '999002', bookmark: 'siteiq_photos' },
}

/** Documents written before the split carry one combined bookmark holding
 *  both blocks. It can't be divided after the fact, so the first insert into
 *  such a document removes it and rebuilds both sections — the same
 *  all-or-nothing behaviour those documents already had. */
export const LEGACY_SECTION = { id: '999000', bookmark: 'siteiq_attachments' }

export const ALL_SECTIONS: SectionName[] = ['drawings', 'photos']

export function isSectionName(value: unknown): value is SectionName {
  return value === 'drawings' || value === 'photos'
}

type SectionSpan = {
  /** Offsets of the bookmarkStart/bookmarkEnd tags themselves. */
  start: number
  end: number
  /** Everything between the two bookmark tags, exactly as stored. */
  inner: string
  outer: string
  /** The part of `inner` that is a self-contained run of whole block
   *  elements — the only part that is safe to lift out or re-insert. */
  middle: string
  /** `inner` before the middle: content sitting inside the block that holds
   *  bookmarkStart (our page break, typically). Ours to delete. */
  leading: string
  /** `inner` after the middle: the tail of the block that holds bookmarkEnd.
   *  Left alone — it belongs to that block, not to us. */
  trailing: string
  /** Closing tags inside `leading` that belong to blocks opened before the
   *  bookmark. Removing the section has to put these back. */
  closers: string[]
}

const TAG_RE = /<(\/?)([A-Za-z_][\w.:-]*)((?:"[^"]*"|[^>"])*?)(\/?)>/g

/** Narrows a fragment to the largest well-formed run of whole elements
 *  inside it.
 *
 *  Needed because a document that has been through the OnlyOffice editor
 *  comes back with the bookmarks moved INSIDE paragraphs — the editor
 *  attaches them to the nearest one — so the text between bookmarkStart and
 *  bookmarkEnd starts mid-paragraph and ends mid-paragraph. Cutting there
 *  happens to work for deletion (the two half-paragraphs rejoin), but
 *  lifting that text out and re-inserting it elsewhere produces a document
 *  Word will not open. */
function balancedRange(inner: string): { start: number; end: number; closers: string[] } {
  const tags = [...inner.matchAll(TAG_RE)]

  // Forward: find every closing tag that was never opened in here. Those
  // close blocks that began BEFORE the bookmark, so they have to stay in the
  // document when the section is removed — they are collected, not dropped.
  let depth = 0
  let start = 0
  const closers: string[] = []
  for (const m of tags) {
    if (m[4] === '/' || m[3].startsWith('?') || m[2].startsWith('!')) continue
    if (m[1] === '/') {
      if (depth === 0) { closers.push(m[0]); start = m.index! + m[0].length; continue }
      depth--
    } else {
      depth++
    }
  }

  // Backward over what's left: drop every opening tag never closed in here.
  const rest = tags.filter(m => m.index! >= start)
  depth = 0
  let end = inner.length
  for (let i = rest.length - 1; i >= 0; i--) {
    const m = rest[i]
    if (m[4] === '/' || m[3].startsWith('?') || m[2].startsWith('!')) continue
    if (m[1] === '/') {
      depth++
    } else {
      if (depth === 0) { end = m.index!; continue }
      depth--
    }
  }

  return end >= start ? { start, end, closers } : { start, end: start, closers }
}

/** Locates a bookmarked span by name. Returns null if it isn't there. */
function findSectionSpan(docXml: string, bookmark: string): SectionSpan | null {
  const startRe = new RegExp(`<w:bookmarkStart[^>]*w:name="${bookmark}"[^>]*/>`)
  const startMatch = docXml.match(startRe)
  if (!startMatch || startMatch.index === undefined) return null

  const id = startMatch[0].match(/w:id="(\d+)"/)?.[1]
  if (!id) return null

  const afterStart = startMatch.index + startMatch[0].length
  const endRe = new RegExp(`<w:bookmarkEnd[^>]*w:id="${id}"[^>]*/>`)
  const endMatch = docXml.slice(afterStart).match(endRe)
  if (!endMatch || endMatch.index === undefined) return null

  const end = afterStart + endMatch.index + endMatch[0].length
  const inner = docXml.slice(afterStart, afterStart + endMatch.index)
  const range = balancedRange(inner)

  return {
    start: startMatch.index,
    end,
    inner,
    outer: docXml.slice(startMatch.index, end),
    leading:  inner.slice(0, range.start),
    middle:   inner.slice(range.start, range.end),
    trailing: inner.slice(range.end),
    closers:  range.closers,
  }
}

/** Every image relationship id referenced inside a fragment. */
function referencedRIds(xml: string): string[] {
  return [...xml.matchAll(/r:embed="(rId\d+)"/g)].map(m => m[1])
}

function relTarget(relsXml: string, rId: string): string | null {
  return relsXml.match(new RegExp(`<Relationship Id="${rId}"[^>]*Target="([^"]+)"[^>]*/>`))?.[1] ?? null
}

function maxRId(relsXml: string): number {
  let max = 0
  for (const m of relsXml.matchAll(/Id="rId(\d+)"/g)) {
    const n = parseInt(m[1], 10)
    if (n > max) max = n
  }
  return max
}

/** PNG and JPEG must be declared or Word rejects the part. */
function ensureImageContentTypes(zip: AdmZip): void {
  const entry = zip.getEntry('[Content_Types].xml')
  if (!entry) return
  let xml = entry.getData().toString('utf-8')
  let changed = false
  for (const [ext, type] of [['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg']]) {
    if (!xml.includes(`Extension="${ext}"`)) {
      xml = xml.replace('</Types>', `  <Default Extension="${ext}" ContentType="${type}"/>\n</Types>`)
      changed = true
    }
  }
  if (changed) zip.updateFile('[Content_Types].xml', Buffer.from(xml, 'utf-8'))
}

// ── REMOVAL ─────────────────────────────────────────────────────────────────

/** Strips the named sections from a document, along with the image
 *  relationships and media parts only they referenced, so repeated
 *  insert/remove cycles don't leak storage into the .docx. */
export function removeSections(
  docXml: string,
  relsXml: string,
  zip: AdmZip,
  bookmarks: string[]
): { docXml: string; relsXml: string; removed: string[] } {
  const removed: string[] = []

  for (const bookmark of bookmarks) {
    const span = findSectionSpan(docXml, bookmark)
    if (!span) continue

    // Both bookmark tags go (they're self-closing, so the document stays
    // balanced), along with everything that is ours. Two things are put
    // back: the closing tags for blocks that opened before the bookmark, and
    // `trailing`, the tail of whatever block the editor parked bookmarkEnd
    // in — deleting either would leave the document malformed or take the
    // user's content with it.
    docXml =
      docXml.slice(0, span.start) +
      span.closers.join('') +
      span.trailing +
      docXml.slice(span.end)
    removed.push(bookmark)

    for (const rId of referencedRIds(span.leading + span.middle)) {
      const target = relTarget(relsXml, rId)
      if (target) {
        try { zip.deleteFile(`word/${target}`) } catch { /* best-effort cleanup */ }
      }
      relsXml = relsXml.replace(new RegExp(`\\s*<Relationship Id="${rId}"[^>]*/>`), '')
    }
  }

  return { docXml, relsXml, removed }
}

/** True if the document still carries the pre-split combined bookmark. */
export function hasLegacySection(docXml: string): boolean {
  return findSectionSpan(docXml, LEGACY_SECTION.bookmark) !== null
}

// ── PLACEMENT ───────────────────────────────────────────────────────────────

const PAGE_BREAK_PARA = `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`

/** Appends to the end of the body, but ahead of the body-level <w:sectPr>
 *  when there is one: sectPr must be the last thing in the body, and content
 *  placed after it is not part of the document. (The editor quietly fixed
 *  that up on its next save, so it only ever showed as a problem in a .docx
 *  downloaded before the report had been reopened.) */
function appendToBody(docXml: string, xml: string): string {
  const sectPr = docXml.lastIndexOf('<w:sectPr')
  const bodyEnd = docXml.lastIndexOf('</w:body>')
  if (sectPr !== -1 && sectPr < bodyEnd) {
    return docXml.slice(0, sectPr) + xml + docXml.slice(sectPr)
  }
  return docXml.replace('</w:body>', `${xml}</w:body>`)
}

/** Inserts a built section, keeping drawings ahead of photos however the two
 *  were inserted — re-adding markups after photos must not leave the report
 *  reading photos-then-markups. */
export function placeSection(docXml: string, section: SectionName, xml: string): string {
  if (section === 'drawings') {
    const photos = findSectionSpan(docXml, SECTION_DEFS.photos.bookmark)
    if (photos) return docXml.slice(0, photos.start) + xml + docXml.slice(photos.start)
  }
  return appendToBody(docXml, xml)
}

export function wrapSection(section: SectionName, innerXml: string): string {
  const def = SECTION_DEFS[section]
  return (
    `<w:bookmarkStart w:id="${def.id}" w:name="${def.bookmark}"/>` +
    innerXml +
    `<w:bookmarkEnd w:id="${def.id}"/>`
  )
}

// ── CARRYING ATTACHMENTS ACROSS A REGENERATION ──────────────────────────────

export type CarriedSection = {
  bookmark: string
  id: string
  inner: string
  media: { rId: string; fileName: string; buffer: Buffer }[]
}

/** Lifts every managed section out of a document, with the image bytes they
 *  reference, so they can be re-grafted into a freshly generated one. */
export function extractSections(docBuffer: Buffer): CarriedSection[] {
  const zip = new AdmZip(docBuffer)
  const docXml  = zip.getEntry('word/document.xml')?.getData().toString('utf-8')
  const relsXml = zip.getEntry('word/_rels/document.xml.rels')?.getData().toString('utf-8')
  if (!docXml || !relsXml) return []

  const wanted = [
    { bookmark: SECTION_DEFS.drawings.bookmark, id: SECTION_DEFS.drawings.id },
    { bookmark: SECTION_DEFS.photos.bookmark,   id: SECTION_DEFS.photos.id },
    { bookmark: LEGACY_SECTION.bookmark,        id: LEGACY_SECTION.id },
  ]

  const carried: CarriedSection[] = []
  for (const { bookmark, id } of wanted) {
    const span = findSectionSpan(docXml, bookmark)
    if (!span || !span.middle.trim()) continue

    // Only the well-formed middle can be moved. Trimming can drop the page
    // break the section opened with (the editor leaves it in the paragraph
    // holding bookmarkStart), so put one back if it isn't there — the
    // attachments should still start on a fresh page.
    const inner = span.middle.slice(0, 600).includes('w:br w:type="page"')
      ? span.middle
      : PAGE_BREAK_PARA + span.middle

    const media: CarriedSection['media'] = []
    for (const rId of new Set(referencedRIds(inner))) {
      const target = relTarget(relsXml, rId)
      if (!target) continue
      const entry = zip.getEntry(`word/${target}`)
      if (!entry) continue
      media.push({ rId, fileName: target.split('/').pop() ?? 'image.png', buffer: entry.getData() })
    }
    carried.push({ bookmark, id, inner, media })
  }
  return carried
}

/** Re-attaches carried sections to a newly generated document, rebuilding
 *  their relationships and media parts under fresh ids so nothing collides
 *  with the new file's own. */
export function graftSections(docBuffer: Buffer, sections: CarriedSection[]): Buffer {
  if (sections.length === 0) return docBuffer

  const zip = new AdmZip(docBuffer)
  const docEntry  = zip.getEntry('word/document.xml')
  const relsEntry = zip.getEntry('word/_rels/document.xml.rels')
  if (!docEntry || !relsEntry) return docBuffer

  let docXml  = docEntry.getData().toString('utf-8')
  let relsXml = relsEntry.getData().toString('utf-8')

  // A regenerated document should never already carry these, but a retry
  // could hand us one that does — clear them so nothing is duplicated.
  ;({ docXml, relsXml } = removeSections(docXml, relsXml, zip, [
    SECTION_DEFS.drawings.bookmark,
    SECTION_DEFS.photos.bookmark,
    LEGACY_SECTION.bookmark,
  ]))

  ensureImageContentTypes(zip)
  let nextRId = maxRId(relsXml) + 1
  const newRels: string[] = []

  for (const section of sections) {
    const idMap = new Map<string, string>()
    for (const item of section.media) {
      const ext      = (item.fileName.split('.').pop() ?? 'png').toLowerCase()
      const rId      = `rId${nextRId++}`
      const mediaName = `siteiqCarried${rId}.${ext}`
      zip.addFile(`word/media/${mediaName}`, item.buffer)
      newRels.push(`  <Relationship Id="${rId}" Type="${REL_IMAGE}" Target="media/${mediaName}"/>`)
      idMap.set(item.rId, rId)
    }

    // Single pass over the fragment — rewriting ids one at a time could
    // rename an id onto one not yet processed.
    const inner = section.inner.replace(
      /r:embed="(rId\d+)"/g,
      (whole, rId: string) => (idMap.has(rId) ? `r:embed="${idMap.get(rId)}"` : whole)
    )

    const wrapped =
      `<w:bookmarkStart w:id="${section.id}" w:name="${section.bookmark}"/>` +
      inner +
      `<w:bookmarkEnd w:id="${section.id}"/>`
    docXml = appendToBody(docXml, wrapped)
  }

  if (newRels.length > 0) {
    relsXml = relsXml.replace('</Relationships>', `${newRels.join('\n')}\n</Relationships>`)
  }
  zip.updateFile('word/_rels/document.xml.rels', Buffer.from(relsXml, 'utf-8'))
  zip.updateFile('word/document.xml', Buffer.from(docXml, 'utf-8'))
  return zip.toBuffer()
}

/** Regenerating the written text replaces the whole file, which used to take
 *  the inserted photos and markups with it. This carries them across, so the
 *  text can be rewritten (AI or plain) at any point in the workflow without
 *  the user having to insert everything again afterwards.
 *
 *  Never throws: a report with no stored document yet, or one whose sections
 *  can't be read, simply gets the new document as-is. */
export async function carryAttachmentsForward(
  inspectionId: string,
  newBuffer: Buffer
): Promise<{ buffer: Buffer; carried: string[] }> {
  try {
    const existing = await loadDoc(inspectionId)
    const sections = extractSections(existing)
    if (sections.length === 0) return { buffer: newBuffer, carried: [] }
    return {
      buffer: graftSections(newBuffer, sections),
      carried: sections.map(s => s.bookmark),
    }
  } catch (err) {
    console.warn('[attachments] nothing carried forward:', err)
    return { buffer: newBuffer, carried: [] }
  }
}

/** Stores a regenerated document with the previous one's inserted photos and
 *  markups re-attached. Returns the bookmarks that were carried across, for
 *  the caller to report back to the UI. */
export async function writeWithAttachments(
  inspectionId: string,
  newBuffer: Buffer
): Promise<string[]> {
  const { buffer, carried } = await carryAttachmentsForward(inspectionId, newBuffer)
  await saveDoc(inspectionId, buffer)
  if (carried.length > 0) console.log('[attachments] carried forward:', carried.join(', '))
  return carried
}
