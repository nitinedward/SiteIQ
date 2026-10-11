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
export const BLOCK_FIELDS = ['ref', 'title', 'location', 'status', 'finding', 'action', 'drawing_ref', 'photos', 'markup', 'from_report', 'closed_on', 'update', 'ref_link', 'title_link', 'back_link'] as const
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
 * Which of the earlier reports' items fill the {{#open_items}} rows, chosen
 * per report on the report page and kept in inspections.carry_forward
 * (web/sql/note_closed_at.sql), so the template never has to say:
 *  - open:        only those still open
 *  - open_recent: those still open, and those closed since the previous
 *                 report's visit — the default
 *  - all:         every item, open or closed
 */
export const CARRY_FORWARD_MODES = ['open', 'open_recent', 'all'] as const
export type CarryForward = typeof CARRY_FORWARD_MODES[number]
export const DEFAULT_CARRY_FORWARD: CarryForward = 'open_recent'

/** A stored or requested choice, or null when it isn't one of the three. */
export function parseCarryForward(raw: unknown): CarryForward | null {
  return (CARRY_FORWARD_MODES as readonly unknown[]).includes(raw) ? raw as CarryForward : null
}

/** The choice a generation uses: the one sent with it, which is then kept
 *  for the report, else the one kept, else the default. Callers that don't
 *  send one (the phone app, a first generation) get what the report page
 *  last chose. Keeping it is best-effort: without the column it applies to
 *  this generation only. */
export async function chooseCarryForward(
  supabase: SupabaseClient,
  inspection: { id: string; carry_forward?: unknown },
  requested: unknown,
): Promise<CarryForward> {
  const asked = parseCarryForward(requested)
  if (asked && asked !== inspection.carry_forward) {
    const { error } = await supabase.from('inspections').update({ carry_forward: asked }).eq('id', inspection.id)
    if (error) console.warn('[blocks] could not keep the earlier-items choice:', error.message)
  }
  return asked ?? parseCarryForward(inspection.carry_forward) ?? DEFAULT_CARRY_FORWARD
}

/**
 * Items from the project's earlier reports to carry into this one's
 * {{#open_items}} rows, as `mode` picks them (see CarryForward). Each keeps
 * the Ref it had in its own report.
 *
 * When an item was closed comes from observations.closed_at, stamped by the
 * database (web/sql/note_closed_at.sql). Until that has been run — and for
 * items closed before it was — nothing counts as recently closed; under
 * `all` those items are still listed, without a closing date.
 * An empty list on any failure: the rows are left out, nothing else changes.
 */
export async function loadPreviousItems(
  supabase: SupabaseClient,
  inspection: ThisReport,
  mode: CarryForward = DEFAULT_CARRY_FORWARD,
): Promise<ObservationBlock[]> {
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
      if (mode === 'all') return true
      if (mode === 'open' || !closedDates || !n.closed_at) return false
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
// ── Links between the summary and each note's page ──────────────────────────
// {{ref_link}} / {{title_link}} show the Ref or title as a link to the top of
// that note's page — the block holding its {{photos}} or {{markup}} (or a
// {{back_link}}). {{back_link}} links back to the table they sit in. Word
// bookmarks inside paragraphs are the targets; the editor keeps those, and a
// regeneration rebuilds them.

const SUMMARY_ANCHOR = 'siteiq_summary'
const BACK_TEXT = '↑ Back to summary'

/** Where a link to a note's page lands. */
export function noteAnchor(noteId: string): string {
  return `siteiq_ob_${noteKey(noteId)}`
}

/** A note's own page: where its links land. */
const isNotePage = (block: string) => /\{\{(photos|markup|back_link)\}\}/.test(block)
const hasLinks = (block: string) => /\{\{(ref_link|title_link)\}\}/.test(block)

type LinkState = { anchors: Set<string>; summaryPlaced: boolean; openTables: number }

/** Run properties made blue and underlined, keeping Word's element order
 *  (color before the size/spacing group, u after it). */
function linkRunProps(rPr: string): string {
  let inner = rPr.replace(/^<w:rPr>|<\/w:rPr>$/g, '')
    .replace(/<w:color\b[^>]*\/>/g, '')
    .replace(/<w:u\b[^>]*\/>/g, '')
  const insertBefore = (el: string, after: string[]) => {
    const at = after.map(t => inner.search(new RegExp(`<w:${t}\\b`))).filter(i => i >= 0).sort((a, b) => a - b)[0]
    inner = at === undefined ? inner + el : inner.slice(0, at) + el + inner.slice(at)
  }
  const tail = ['effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath']
  insertBefore('<w:color w:val="0563C1"/>', ['spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', ...tail])
  insertBefore('<w:u w:val="single"/>', tail)
  return `<w:rPr>${inner}</w:rPr>`
}

/** Replaces `placeholder` in each run with `text` — as a link to `anchor`
 *  when there is one, in the run's own formatting made blue and underlined. */
function linkify(xml: string, placeholder: string, text: string, anchor: string | null): string {
  return xml.replace(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g, run => {
    if (!run.includes(placeholder)) return run
    const rPr = run.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? ''
    const runText = [...run.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map(t => t[1]).join('')
    const plain = (s: string) => (s ? `<w:r>${rPr}<w:t xml:space="preserve">${s}</w:t></w:r>` : '')
    const linked = anchor
      ? `<w:hyperlink w:anchor="${anchor}" w:history="1"><w:r>${linkRunProps(rPr)}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:hyperlink>`
      : plain(esc(text))
    return runText.split(placeholder).map(plain).join(linked)
  })
}

/** A zero-width bookmark at the start of the first paragraph with content
 *  (a paragraph holding only a page break is passed over, so a jump lands
 *  on the page, not before the break). */
function anchorAtTop(xml: string, from: number, name: string, id: number): string {
  const re = /<w:p(?:\s[^>]*)?(?<!\/)>[\s\S]*?<\/w:p>/g
  re.lastIndex = from
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const para = m[0]
    if (/w:type="page"/.test(para) && !textOf(para).trim()) continue
    const pPrEnd = para.indexOf('</w:pPr>')
    const at = m.index + (pPrEnd === -1 ? para.indexOf('>') + 1 : pPrEnd + '</w:pPr>'.length)
    return xml.slice(0, at) + `<w:bookmarkStart w:id="${id}" w:name="${name}"/><w:bookmarkEnd w:id="${id}"/>` + xml.slice(at)
  }
  return xml
}

function fillBlock(block: string, note: ObservationBlock, nextId: () => number, pageWidth: number, links: LinkState): string {
  let xml = block

  // This visit's note, on its own page: where its links land (once).
  const ownsPage = note.markFinding !== false
  if (ownsPage && isNotePage(block) && !links.anchors.has(note.noteId)) {
    links.anchors.add(note.noteId)
    xml = anchorAtTop(xml, 0, noteAnchor(note.noteId), nextId())
  }
  // Items from earlier reports have no page in this report: plain text.
  const target = ownsPage ? noteAnchor(note.noteId) : null
  xml = linkify(xml, '{{ref_link}}', note.ref, target)
  xml = linkify(xml, '{{title_link}}', note.title, target)
  xml = linkify(xml, '{{back_link}}', BACK_TEXT, SUMMARY_ANCHOR)

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
  const links: LinkState = { anchors: new Set(), summaryPlaced: false, openTables: 0 }
  xml = expandBlocks(xml, BLOCK_START, BLOCK_END, notes, nextId, pageWidth, links)
  // Items carried forward from earlier reports ({{#open_items}}).
  xml = expandBlocks(xml, OPEN_ITEMS_START, OPEN_ITEMS_END, previous, nextId, pageWidth, links)
  return markCarriedCounts(xml, observationCounts(notes, previous), nextId)
}

// ── Updating the earlier items on their own ─────────────────────────────────
// The report page can change which earlier items a report lists without
// rewriting the rest of it. Generation marks what that changes: the table
// the {{#open_items}} rows are in, and the {{carried_…}} counts, each with a
// bookmark inside a paragraph, where the editor keeps it. replaceOpenItems
// then swaps those for a freshly filled copy's.

const OPEN_ITEMS_TABLE = 'siteiq_oi_'
const CARRIED_COUNT = 'siteiq_cc_'
const CARRIED_FIELDS = ['carried_count', 'carried_open_count', 'carried_closed_count'] as const

/** Each {{carried_…}} count, as its value wrapped in a bookmark. */
function markCarriedCounts(xml: string, counts: Record<string, string>, nextId: () => number): string {
  const seen = new Map<string, number>()
  for (const field of CARRIED_FIELDS) {
    const ph = `{{${field}}}`
    if (!xml.includes(ph)) continue
    xml = xml.replace(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g, run => {
      if (!run.includes(ph)) return run
      const rPr = run.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? ''
      const runText = [...run.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map(t => t[1]).join('')
      const plain = (s: string) => (s ? `<w:r>${rPr}<w:t xml:space="preserve">${s}</w:t></w:r>` : '')
      return runText.split(ph).map(plain).reduce((out, part) => {
        const n = (seen.get(field) ?? 0) + 1
        seen.set(field, n)
        const id = nextId()
        return out + `<w:bookmarkStart w:id="${id}" w:name="${CARRIED_COUNT}${field}_${n}"/>`
          + plain(esc(counts[ph] ?? '')) + `<w:bookmarkEnd w:id="${id}"/>` + part
      })
    })
  }
  return xml
}

/** The innermost table holding `at`. */
const tableAround = (xml: string, at: number): El | undefined =>
  ancestors(structure(xml), at).filter(e => e.tag === 'w:tbl').pop()

/** Bookmark starts by name, with where each is and its id. */
function bookmarks(xml: string, prefix: string): Map<string, { at: number; id: string }> {
  const out = new Map<string, { at: number; id: string }>()
  for (const m of xml.matchAll(/<w:bookmarkStart\b[^>]*>/g)) {
    const name = m[0].match(/\bw:name="([^"]*)"/)?.[1] ?? ''
    const id = m[0].match(/\bw:id="([^"]*)"/)?.[1] ?? ''
    if (name.startsWith(prefix) && !out.has(name)) out.set(name, { at: m.index!, id })
  }
  return out
}

/** What a bookmark wraps, as [start, end) just inside its two ends; null
 *  when its end is missing. */
function bookmarkSpan(xml: string, at: number, id: string): [number, number] | null {
  const startEnd = xml.indexOf('>', at) + 1
  const endTag = new RegExp(`<w:bookmarkEnd\\b[^>]*\\bw:id="${id}"[^>]*/>`, 'g')
  endTag.lastIndex = startEnd
  const m = endTag.exec(xml)
  return m ? [startEnd, m.index] : null
}

/** Gives a fragment's bookmarks ids from `next` on, so none repeats one
 *  already in the report the fragment goes into. */
function renumberBookmarks(fragment: string, next: () => number): string {
  const ids = new Map<string, number>()
  return fragment.replace(/<w:bookmark(Start|End)\b[^>]*\/>/g, tag =>
    tag.replace(/\bw:id="([^"]*)"/, (_, id: string) => {
      if (!ids.has(id)) ids.set(id, next())
      return `w:id="${ids.get(id)}"`
    }))
}

/**
 * Swaps a report's earlier-items tables and {{carried_…}} counts for those
 * of `fresh`, a copy of its template just filled with the items now wanted.
 * Everything else in the report is left exactly as it is.
 *
 * `tables` is how many tables were swapped: 0 when the report has none
 * marked — generated before this existed, or the editor dropped the mark —
 * in which case the report is returned unchanged and needs one full rewrite.
 */
export function replaceOpenItems(reportXml: string, freshXml: string): { xml: string; tables: number; counts: number } {
  let xml = reportXml
  let maxId = 0
  for (const m of xml.matchAll(/\bw:id="(\d+)"/g)) maxId = Math.max(maxId, Number(m[1]))
  const next = () => ++maxId

  let tables = 0
  for (const [name, fresh] of bookmarks(freshXml, OPEN_ITEMS_TABLE)) {
    const freshTable = tableAround(freshXml, fresh.at)
    const marked = bookmarks(xml, OPEN_ITEMS_TABLE).get(name)
    const table = marked && tableAround(xml, marked.at)
    if (!freshTable || !table) continue
    xml = xml.slice(0, table.start) + renumberBookmarks(freshXml.slice(freshTable.start, freshTable.end), next) + xml.slice(table.end)
    tables++
  }
  if (tables === 0) return { xml: reportXml, tables: 0, counts: 0 }

  let counts = 0
  for (const [name, fresh] of bookmarks(freshXml, CARRIED_COUNT)) {
    const freshSpan = bookmarkSpan(freshXml, fresh.at, fresh.id)
    const marked = bookmarks(xml, CARRIED_COUNT).get(name)
    const span = marked && bookmarkSpan(xml, marked.at, marked.id)
    if (!freshSpan || !span) continue
    const inner = xml.slice(span[0], span[1])
    // Only a count still within one paragraph, with text to set.
    if (/<\/?w:p[\s>]/.test(inner) || !/<w:t[\s>]/.test(inner)) continue
    const value = textOf(freshXml.slice(freshSpan[0], freshSpan[1]))
    let first = true
    const updated = inner.replace(/(<w:t(?:\s[^>]*)?>)[^<]*(<\/w:t>)/g, (_, open: string, close: string) => {
      const text = first ? value : ''
      first = false
      return `${open}${text}${close}`
    })
    xml = xml.slice(0, span[0]) + updated + xml.slice(span[1])
    counts++
  }
  return { xml, tables, counts }
}

function expandBlocks(xml: string, start: string, end: string, notes: ObservationBlock[], nextId: () => number, pageWidth: number, links: LinkState): string {
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

    const copies = notes.map(note => fillBlock(block, note, nextId, pageWidth, links))
    // No notes, and the block was part of a cell: the cell still needs a
    // paragraph.
    if (copies.length === 0 && range.inCell) copies.push('<w:p/>')
    // Two tables side by side merge into one in Word, so whole-table blocks
    // are kept apart by an empty paragraph.
    const apart = block.trimStart().startsWith('<w:tbl') && block.trimEnd().endsWith('</w:tbl>')
    // The first block with Ref or title links is the summary: "Back to
    // summary" lands at the top of the table it is in (its header row).
    const summaryAt = !links.summaryPlaced && hasLinks(block)
      ? (ancestors(structure(xml), range.start).filter(e => e.tag === 'w:tbl').pop()?.start ?? range.start)
      : null
    // Earlier items as some rows of a table: the table is marked, so the
    // report page can refill it on its own (replaceOpenItems). Its other
    // rows — the header — keep it there when no items are listed.
    const table = start === OPEN_ITEMS_START ? tableAround(xml, range.start) : undefined
    const openTableAt = table && table.start < range.start ? table.start : null
    xml = xml.slice(0, range.start) + copies.join(apart ? '<w:p/>' : '') + xml.slice(range.end)
    if (summaryAt !== null) {
      xml = anchorAtTop(xml, summaryAt, SUMMARY_ANCHOR, nextId())
      links.summaryPlaced = true
    }
    if (openTableAt !== null) {
      xml = anchorAtTop(xml, openTableAt, `${OPEN_ITEMS_TABLE}${++links.openTables}`, nextId())
    }
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
    '{{carried_count}}': String(previous.length),
    '{{carried_open_count}}': String(previous.length - previousClosed),
    '{{carried_closed_count}}': String(previousClosed),
  }
}
