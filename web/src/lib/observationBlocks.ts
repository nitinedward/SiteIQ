import type { SupabaseClient } from '@supabase/supabase-js'
import { noteLabel } from './reportNotes'
import { drawingAssetStem } from './drawingAssetName'

/**
 * Templates that lay a report out one block per site note.
 *
 * A firm marks the part of its template that repeats with {{#observations}}
 * before it and {{/observations}} after it, and uses per-note placeholders
 * inside ({{ref}}, {{title}}, {{finding}}, {{photos}}…). The block is copied
 * once per site note, in note order. A summary table works the same way:
 * markers at the start and end of one row repeat that row.
 *
 * Templates without the markers never reach this code — fillTemplate only
 * calls it when {{#observations}} is in the file — so every template in use
 * before this existed fills exactly as it did.
 *
 * Photos and markups aren't put in here. Each note's {{photos}} and
 * {{markup}} become an empty, named slot, which lib/appendAttachments fills
 * with whatever is ticked on the report page — the same step that writes
 * the photo and markup pages for other templates, so inserting, regenerating
 * and downloading all keep the report's selection.
 */

export const BLOCK_START = '{{#observations}}'
export const BLOCK_END = '{{/observations}}'

/** One site note, as its block shows it. */
export type ObservationBlock = {
  /** The note's id, which names its slots and finding marker. */
  noteId: string
  ref: string
  title: string
  /** The drawing the note was marked on, e.g. "S-202 · Ground floor plan". */
  location: string
  status: 'Open' | 'Closed'
  /** Lines of the note's wording — one paragraph each. */
  finding: string[]
  /** That note's contractor item; empty when it asks for nothing. */
  action: string[]
  /** "S-202 Rev B". */
  drawingRef: string
  /** For an item from an earlier report: that report, "SR 002". */
  fromReport?: string
  /** For a closed item from an earlier report: when, "12 Oct 2026". */
  closedOn?: string
  /** For an item from an earlier report: its latest response. */
  update?: string
  /** False for items from earlier reports: finalising reads back only this
   *  visit's notes, so only theirs are marked. */
  markFinding?: boolean
}

export const OPEN_ITEMS_START = '{{#open_items}}'
export const OPEN_ITEMS_END = '{{/open_items}}'

/** Per-note placeholders, filled only inside a block. */
export const BLOCK_FIELDS = ['ref', 'title', 'location', 'status', 'finding', 'action', 'drawing_ref', 'photos', 'markup', 'from_report', 'closed_on', 'update'] as const
/** Only meaningful in {{#open_items}} rows. */
export const OPEN_ITEM_FIELDS = ['from_report', 'closed_on', 'update'] as const
/** Of those, the ones that replace the whole paragraph they sit in. */
export const BLOCK_PARAGRAPH_FIELDS = ['finding', 'action', 'photos', 'markup'] as const

// ── Names of the things a filled block leaves in the report ─────────────────

/** Bookmark names allow 40 characters, so a note is named by the first 16
 *  hex digits of its id — unique enough within one report. */
export function noteKey(noteId: string): string {
  return noteId.replace(/[^0-9a-fA-F]/g, '').slice(0, 16).toLowerCase()
}

/** Marks a note's finding paragraphs, so finalising can read back what the
 *  engineer left there after editing. */
export function findingBookmark(noteId: string): string {
  return `siteiq_nt_${noteKey(noteId)}`
}

export type SlotKind = 'photos' | 'markup'

/** A slot carries the width it has to fill, in twentieths of a point, so
 *  the photos can be sized to its table cell without the template to hand. */
function slotBookmark(kind: SlotKind, noteId: string, widthDxa: number): string {
  return `siteiq_n${kind === 'photos' ? 'p' : 'm'}_${noteKey(noteId)}_w${Math.round(widthDxa)}`
}

export type Slot = { name: string; kind: SlotKind; key: string; widthDxa: number }

/** Every photo and markup slot in a filled report. */
export function findSlots(docXml: string): Slot[] {
  const out: Slot[] = []
  for (const m of docXml.matchAll(/<w:bookmarkStart\b[^>]*\bw:name="(siteiq_n([pm])_([0-9a-f]{1,16})_w(\d+))"/g)) {
    out.push({ name: m[1], kind: m[2] === 'p' ? 'photos' : 'markup', key: m[3], widthDxa: Number(m[4]) })
  }
  return out
}

/** True if the report was laid out with observation blocks — judged from
 *  the marks a filled block leaves, which survive even when the editor has
 *  dropped a slot. */
export function hasObservationBlocks(docXml: string): boolean {
  return /w:name="siteiq_n[tpm]_/.test(docXml)
}

// ── Reading the notes ───────────────────────────────────────────────────────

const statusOf = (stored: unknown): 'Open' | 'Closed' =>
  String(stored ?? '').toUpperCase() === 'CLOSED' ? 'Closed' : 'Open'

export type NoteDrawing = { number: string; title: string; revision: string; stem: string }

/** The drawing each note was marked on, by note id. Notes not placed on a
 *  drawing are left out. */
export async function loadNoteDrawings(
  supabase: SupabaseClient,
  notes: { id: string; zone_id?: string | null }[],
): Promise<Map<string, NoteDrawing>> {
  const out = new Map<string, NoteDrawing>()
  const zoneIds = [...new Set(notes.map(n => n.zone_id).filter((z): z is string => !!z))]
  if (zoneIds.length === 0) return out

  const { data: zones } = await supabase.from('zones').select('id, drawing_id').in('id', zoneIds)
  const drawingIds = [...new Set((zones ?? []).map((z: any) => z.drawing_id).filter(Boolean))]
  if (drawingIds.length === 0) return out
  const { data: drawings } = await supabase.from('drawings').select('id, number, title, revision').in('id', drawingIds)

  const drawingByZone = new Map((zones ?? []).map((z: any) => [z.id, (drawings ?? []).find((d: any) => d.id === z.drawing_id)]))
  for (const note of notes) {
    const d: any = note.zone_id ? drawingByZone.get(note.zone_id) : null
    if (!d) continue
    out.set(note.id, {
      number: d.number ?? '',
      title: d.title ?? '',
      revision: d.revision ?? '',
      stem: drawingAssetStem(d.number ?? ''),
    })
  }
  return out
}

/**
 * How many site notes the project's earlier reports hold, so this report's
 * Refs carry on from them: SR 001 lists 01–03, SR 002 starts at 04.
 *
 * Earlier means a lower report number, or for reports without one, an
 * earlier visit date. Worked out afresh at each generation, so a note added
 * to an earlier report later moves the numbers of reports regenerated after
 * that. 0 when it can't be read, which numbers from 01 as before.
 */
type ReportRow = { id: string; report_no?: string | null; date?: string | null; created_at?: string | null }
type ThisReport = ReportRow & { project_id?: string | null }

/** When a report's visit was: its visit date ("10 October 2026", as the app
 *  writes it), else when it was created. */
function visitTime(r: ReportRow): number {
  const visit = Date.parse(String(r.date ?? ''))
  if (Number.isFinite(visit)) return visit
  const created = Date.parse(String(r.created_at ?? ''))
  return Number.isFinite(created) ? created : Number.MAX_SAFE_INTEGER
}

/** The project's reports before this one, oldest first: by report number,
 *  then visit date, then when created. */
async function earlierReports(supabase: SupabaseClient, inspection: ThisReport): Promise<ReportRow[]> {
  if (!inspection.project_id) return []
  const { data: reports, error } = await supabase
    .from('inspections')
    .select('id, report_no, date, created_at')
    .eq('project_id', inspection.project_id)
  if (error) throw new Error(error.message)
  const order = (r: ReportRow): [number, number, number] => {
    const n = parseInt(String(r.report_no ?? '').replace(/\D/g, ''), 10)
    const created = Date.parse(String(r.created_at ?? ''))
    return [Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER, visitTime(r), Number.isFinite(created) ? created : 0]
  }
  const compare = (a: [number, number, number], b: [number, number, number]) =>
    a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
  const self = order(inspection)
  return ((reports ?? []) as ReportRow[])
    .filter(r => r.id !== inspection.id && compare(order(r), self) < 0)
    .sort((a, b) => compare(order(a), order(b)))
}

export async function earlierNoteCount(
  supabase: SupabaseClient,
  inspection: ThisReport,
): Promise<number> {
  try {
    const earlier = (await earlierReports(supabase, inspection)).map(r => r.id)
    if (earlier.length === 0) return 0
    const { count } = await supabase
      .from('observations')
      .select('id', { count: 'exact', head: true })
      .in('inspection_id', earlier)
    return count ?? 0
  } catch (err) {
    console.warn('[blocks] could not count earlier reports’ notes; numbering from 01:', err)
    return 0
  }
}

/**
 * Items from the project's earlier reports to carry into this one's
 * {{#open_items}} rows: every one still open, and those closed since the
 * previous report's visit. Each keeps the Ref it had in its own report.
 *
 * When an item was closed comes from observations.closed_at, stamped by the
 * database (web/sql/note_closed_at.sql). Until that has been run — and for
 * items closed before it was — nothing counts as recently closed.
 * An empty list on any failure: the rows are left out, nothing else changes.
 */
export async function loadPreviousItems(supabase: SupabaseClient, inspection: ThisReport): Promise<ObservationBlock[]> {
  try {
    const reports = await earlierReports(supabase, inspection)
    if (reports.length === 0) return []
    const ids = reports.map(r => r.id)

    const columns = 'id, inspection_id, zone_id, zone_label, transcript, notes, report_text, severity'
    let rows: any[] = []
    let closedDates = true
    const withClosed = await supabase.from('observations').select(`${columns}, closed_at`).in('inspection_id', ids).order('id', { ascending: true })
    if (withClosed.error) {
      // No closed_at column yet.
      closedDates = false
      const plain = await supabase.from('observations').select(columns).in('inspection_id', ids).order('id', { ascending: true })
      if (plain.error) throw new Error(plain.error.message)
      rows = plain.data ?? []
    } else {
      rows = withClosed.data ?? []
    }

    // Refs as each report numbered them: its notes in order, counted on
    // from the reports before it (see earlierNoteCount).
    const refOf = new Map<string, number>()
    let running = 0
    for (const report of reports) {
      for (const note of rows.filter(n => n.inspection_id === report.id)) refOf.set(note.id, ++running)
    }

    const previousVisit = visitTime(reports[reports.length - 1])
    const keep = rows.filter(n => {
      if (statusOf(n.severity) === 'Open') return true
      if (!closedDates || !n.closed_at) return false
      return Date.parse(n.closed_at) > previousVisit
    })
    if (keep.length === 0) return []

    const reportNo = new Map(reports.map(r => [r.id, String(r.report_no ?? '').trim()]))
    const [drawings, updates] = await Promise.all([
      loadNoteDrawings(supabase, keep).catch(() => new Map<string, NoteDrawing>()),
      latestResponses(supabase, keep.map(n => n.id)),
    ])
    const lines = (text: string) => text.split('\n').map(l => l.trim()).filter(Boolean)

    return keep
      .sort((a, b) => (refOf.get(a.id) ?? 0) - (refOf.get(b.id) ?? 0))
      .map(n => {
        const d = drawings.get(n.id)
        const no = reportNo.get(n.inspection_id)
        return {
          noteId: n.id,
          ref: String(refOf.get(n.id) ?? 0).padStart(2, '0'),
          title: noteLabel(n),
          location: d ? [d.number, d.title].filter(Boolean).join(' · ') : '',
          status: statusOf(n.severity),
          finding: lines(String(n.report_text || n.transcript || n.notes || '').trim()),
          action: [],
          drawingRef: d ? [d.number, d.revision && `Rev ${d.revision}`].filter(Boolean).join(' ') : '',
          fromReport: no ? `SR ${no}` : '',
          closedOn: statusOf(n.severity) === 'Closed' && n.closed_at
            ? new Date(n.closed_at).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Pacific/Auckland' })
            : '',
          update: updates.get(n.id) ?? '',
          markFinding: false,
        }
      })
  } catch (err) {
    console.warn('[blocks] could not read earlier reports’ items; none carried forward:', err)
    return []
  }
}

/** Each item's most recent response with something written in it. */
async function latestResponses(supabase: SupabaseClient, noteIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (noteIds.length === 0) return out
  const { data, error } = await supabase
    .from('note_responses')
    .select('observation_id, comment, created_at')
    .in('observation_id', noteIds)
    .order('created_at', { ascending: false })
  if (error) return out
  for (const r of data ?? []) {
    const comment = String(r.comment ?? '').trim()
    if (comment && !out.has(r.observation_id)) out.set(r.observation_id, comment)
  }
  return out
}

/** The blocks for a report's notes, in note order. `finding` and `action`
 *  give each note's wording by its position; Refs start after `earlier`
 *  (see earlierNoteCount). */
export async function buildObservationBlocks(
  supabase: SupabaseClient,
  notes: any[],
  wording: (note: any, index: number) => { finding: string; action: string },
  earlier = 0,
): Promise<ObservationBlock[]> {
  let drawings = new Map<string, NoteDrawing>()
  try {
    drawings = await loadNoteDrawings(supabase, notes)
  } catch (err) {
    console.warn('[blocks] could not read the notes’ drawings:', err)
  }
  const lines = (text: string) => text.split('\n').map(l => l.trim()).filter(Boolean)

  return notes.map((note, i) => {
    const d = drawings.get(note.id)
    const { finding, action } = wording(note, i)
    return {
      noteId: note.id,
      ref: String(earlier + i + 1).padStart(2, '0'),
      title: noteLabel(note),
      location: d ? [d.number, d.title].filter(Boolean).join(' · ') : '',
      status: statusOf(note.severity),
      finding: lines(finding),
      action: lines(action),
      drawingRef: d ? [d.number, d.revision && `Rev ${d.revision}`].filter(Boolean).join(' ') : '',
    }
  })
}

// ── Expanding the blocks in a template ──────────────────────────────────────

const esc = (text: string) => text
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')

type El = { tag: string; start: number; end: number }

/** Body, table, row, cell and paragraph elements, with their extents. */
function structure(xml: string): El[] {
  const els: El[] = []
  const stack: El[] = []
  for (const m of xml.matchAll(/<(\/?)(w:body|w:tbl|w:tr|w:tc|w:p)(?=[\s>/])[^>]*?(\/?)>/g)) {
    const [whole, closing, tag, selfClosing] = m
    if (selfClosing) {
      els.push({ tag, start: m.index!, end: m.index! + whole.length })
    } else if (!closing) {
      stack.push({ tag, start: m.index!, end: -1 })
    } else {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag !== tag) continue
        const el = stack.splice(i)[0]
        el.end = m.index! + whole.length
        els.push(el)
        break
      }
    }
  }
  return els.filter(e => e.end > e.start)
}

/** The elements containing `at`, outermost first. */
function ancestors(els: El[], at: number): El[] {
  return els.filter(e => e.start <= at && at < e.end).sort((a, b) => a.start - b.start || b.end - a.end)
}

/** Text of a fragment's paragraphs. */
const textOf = (xml: string) => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map(t => t[1]).join('')

/**
 * Where a block runs from and to. The markers can sit in body paragraphs
 * around the block, in its first and last table cells, or at the two ends
 * of one table row; the block is the run of whole elements between them.
 */
type Range = {
  start: number
  end: number
  /** The block is a run of sibling elements (in the body or one cell), so a
   *  paragraph that only held a marker can go. */
  siblings: boolean
  /** The block is part of a table cell, which must keep a paragraph if
   *  there are no notes. */
  inCell: boolean
}

function blockRange(xml: string, startAt: number, endAt: number): Range | null {
  const els = structure(xml)
  const a = ancestors(els, startAt)
  const b = ancestors(els, endAt)
  let common = 0
  while (common < a.length && common < b.length && a[common] === b[common]) common++
  if (common === 0) return null
  const shared = a[common - 1]

  // Both markers in one row: that row repeats.
  if (shared.tag === 'w:tr') return { start: shared.start, end: shared.end, siblings: false, inCell: false }
  // In one paragraph: that paragraph repeats.
  if (shared.tag === 'w:p') return { start: shared.start, end: shared.end, siblings: false, inCell: false }

  const from = a[common]
  const to = b[common]
  if (!from || !to) return null

  // Every row of a table: the whole table repeats, rather than one long
  // table of every note's rows.
  if (shared.tag === 'w:tbl') {
    const rows = els.filter(e => e.tag === 'w:tr' && e.start > shared.start && e.end <= shared.end
      && !els.some(o => o.tag === 'w:tr' && o !== e && o.start < e.start && e.end < o.end))
    const first = rows[0]
    const last = rows[rows.length - 1]
    if (first && last && from.start === first.start && to.end === last.end) {
      return { start: shared.start, end: shared.end, siblings: false, inCell: false }
    }
    // Some of a table's rows.
    return { start: from.start, end: to.end, siblings: false, inCell: false }
  }
  return { start: from.start, end: to.end, siblings: true, inCell: shared.tag === 'w:tc' }
}

/** Takes a marker out of a block. A paragraph that held nothing else goes
 *  too when it is one of the block's own top-level elements; inside a table
 *  the paragraph stays, as every cell needs one. */
function removeMarker(block: string, marker: string, siblings: boolean): string {
  const tables = structure(block).filter(e => e.tag === 'w:tbl')
  let out = ''
  let last = 0
  for (const m of block.matchAll(/<w:p(?:\s[^>]*)?(?<!\/)>[\s\S]*?<\/w:p>/g)) {
    const para = m[0]
    if (!textOf(para).includes(marker)) continue
    const topLevel = !tables.some(t => t.start < m.index! && m.index! < t.end)
    // A page break on the marker's line is how a template starts each note
    // on a new page, so that paragraph stays (without the marker).
    const onlyMarker = !textOf(para).split(marker).join('').trim()
      && !para.includes('<w:drawing') && !/<w:br\b[^>]*w:type="page"/.test(para) && !para.includes('w:pageBreakBefore')
    out += block.slice(last, m.index!) + (siblings && topLevel && onlyMarker ? '' : para.split(marker).join(''))
    last = m.index! + para.length
  }
  return out + block.slice(last)
}

/** The paragraph properties and the first run's properties of a template
 *  paragraph, so generated paragraphs keep its look. */
function paragraphStyle(para: string): { pPr: string; rPr: string } {
  const pPr = para.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? ''
  const afterPPr = pPr ? para.slice(para.indexOf(pPr) + pPr.length) : para
  const rPr = (afterPPr.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? '')
    .replace(/<w:rStyle w:val="PlaceholderText"\/>/g, '')
    .replace(/<w:color w:val="00B050"\/>/g, '<w:color w:val="000000"/>')
  return { pPr, rPr }
}

/** Paragraphs styled like `para`, one per line. With `bookmark`, the lines
 *  are wrapped in it — inside the paragraphs, where the editor keeps it. */
function styledParagraphs(para: string, lines: string[], bookmark?: { id: number; name: string }): string {
  const { pPr, rPr } = paragraphStyle(para)
  const list = lines.length > 0 ? lines : ['']
  return list.map((line, i) => {
    const open = bookmark && i === 0 ? `<w:bookmarkStart w:id="${bookmark.id}" w:name="${bookmark.name}"/>` : ''
    const close = bookmark && i === list.length - 1 ? `<w:bookmarkEnd w:id="${bookmark.id}"/>` : ''
    const run = line ? `<w:r>${rPr}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>` : ''
    return `<w:p>${pPr}${open}${run}${close}</w:p>`
  }).join('')
}

/** Text width of the page, for a slot outside any table. */
function pageTextWidth(xml: string): number {
  const sects = [...xml.matchAll(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g)].map(m => m[0])
  const last = sects[sects.length - 1] ?? ''
  const w = Number(last.match(/<w:pgSz\b[^>]*\bw:w="(\d+)"/)?.[1] ?? 11906)
  const l = Number(last.match(/<w:pgMar\b[^>]*\bw:left="(\d+)"/)?.[1] ?? 1440)
  const r = Number(last.match(/<w:pgMar\b[^>]*\bw:right="(\d+)"/)?.[1] ?? 1440)
  return Math.max(2000, w - l - r)
}

/** Width available to a paragraph at `at` in `block`: its cell's, less the
 *  cell's default padding, or the page's. */
function widthAt(block: string, at: number, pageWidth: number): number {
  const cell = ancestors(structure(block), at).filter(e => e.tag === 'w:tc').pop()
  if (!cell) return pageWidth
  const tcW = block.slice(cell.start, cell.end).match(/<w:tcW\b[^>]*\bw:w="(\d+)"[^>]*\bw:type="dxa"/)?.[1]
    ?? block.slice(cell.start, cell.end).match(/<w:tcW\b[^>]*\bw:type="dxa"[^>]*\bw:w="(\d+)"/)?.[1]
  return tcW ? Math.max(1000, Math.min(pageWidth, Number(tcW) - 216)) : pageWidth
}

/** Replaces each paragraph holding `placeholder` via `build`. */
function eachParagraphWith(xml: string, placeholder: string, build: (para: string, at: number) => string): string {
  let out = ''
  let last = 0
  for (const m of xml.matchAll(/<w:p(?:\s[^>]*)?(?<!\/)>[\s\S]*?<\/w:p>/g)) {
    if (!textOf(m[0]).includes(placeholder)) continue
    out += xml.slice(last, m.index!) + build(m[0], m.index!)
    last = m.index! + m[0].length
  }
  return out + xml.slice(last)
}

/** One note's copy of the block. */
function fillBlock(block: string, note: ObservationBlock, nextId: () => number, pageWidth: number): string {
  let xml = block

  // Slots first, while the copy's cells still have their template widths.
  for (const kind of ['photos', 'markup'] as const) {
    xml = eachParagraphWith(xml, `{{${kind}}}`, (para, at) => {
      const id = nextId()
      const name = slotBookmark(kind, note.noteId, widthAt(xml, at, pageWidth))
      const { pPr } = paragraphStyle(para)
      return `<w:bookmarkStart w:id="${id}" w:name="${name}"/><w:p>${pPr}</w:p><w:bookmarkEnd w:id="${id}"/>`
    })
  }

  let findingMarked = false
  xml = eachParagraphWith(xml, '{{finding}}', para => {
    // Only the first copy is marked: finalising reads one finding per note.
    const bookmark = findingMarked || note.markFinding === false ? undefined : { id: nextId(), name: findingBookmark(note.noteId) }
    findingMarked = true
    return styledParagraphs(para, note.finding, bookmark)
  })
  xml = eachParagraphWith(xml, '{{action}}', para => styledParagraphs(para, note.action))

  const inline: Record<string, string> = {
    '{{ref}}': note.ref,
    '{{title}}': note.title,
    '{{location}}': note.location,
    '{{status}}': note.status,
    '{{drawing_ref}}': note.drawingRef,
    '{{from_report}}': note.fromReport ?? '',
    '{{closed_on}}': note.closedOn ?? '',
    '{{update}}': note.update ?? '',
  }
  for (const [ph, value] of Object.entries(inline)) xml = xml.split(ph).join(esc(value))
  return xml
}

/**
 * Copies each {{#observations}} … {{/observations}} block once per note.
 * Expects runs already merged (mergeRunsContainingPlaceholders) and content
 * controls flattened, so markers and placeholders are whole strings.
 */
export function expandObservationBlocks(xml: string, notes: ObservationBlock[], previous: ObservationBlock[] = []): string {
  let id = 990000
  const nextId = () => id++
  const pageWidth = pageTextWidth(xml)
  xml = expandBlocks(xml, BLOCK_START, BLOCK_END, notes, nextId, pageWidth)
  // Items carried forward from earlier reports ({{#open_items}}).
  return expandBlocks(xml, OPEN_ITEMS_START, OPEN_ITEMS_END, previous, nextId, pageWidth)
}

function expandBlocks(xml: string, start: string, end: string, notes: ObservationBlock[], nextId: () => number, pageWidth: number): string {
  // A summary table and the detailed blocks are two separate blocks, so
  // this repeats until none are left; the cap only guards a malformed file.
  for (let pass = 0; pass < 20; pass++) {
    const startAt = xml.indexOf(start)
    if (startAt === -1) break
    const endAt = xml.indexOf(end, startAt)
    const range = endAt === -1 ? null : blockRange(xml, startAt, endAt)
    if (!range) {
      // Unpaired or unreadable: drop the marker rather than print it.
      console.warn(`[blocks] ${start} without a matching ${end} — marker removed`)
      xml = xml.replace(start, '')
      continue
    }

    let block = xml.slice(range.start, range.end)
    block = removeMarker(removeMarker(block, start, range.siblings), end, range.siblings)

    const copies = notes.map(note => fillBlock(block, note, nextId, pageWidth))
    // No notes, and the block was part of a cell: the cell still needs a
    // paragraph.
    if (copies.length === 0 && range.inCell) copies.push('<w:p/>')
    // Two tables side by side merge into one in Word, so whole-table blocks
    // are kept apart by an empty paragraph.
    const apart = block.trimStart().startsWith('<w:tbl') && block.trimEnd().endsWith('</w:tbl>')
    xml = xml.slice(0, range.start) + copies.join(apart ? '<w:p/>' : '') + xml.slice(range.end)
  }
  return xml
}

/** Count fields, usable anywhere in the template. */
export function observationCounts(notes: ObservationBlock[], previous: ObservationBlock[] = []): Record<string, string> {
  const closed = notes.filter(n => n.status === 'Closed').length
  const previousClosed = previous.filter(n => n.status === 'Closed').length
  return {
    '{{items_count}}': String(notes.length),
    '{{open_count}}': String(notes.length - closed),
    '{{closed_count}}': String(closed),
    '{{carried_open_count}}': String(previous.length - previousClosed),
    '{{carried_closed_count}}': String(previousClosed),
  }
}
