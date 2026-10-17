import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import {
  PDFDocument, PDFFont, PDFPage, PDFForm, PDFField, PDFTextField, PDFDropdown, PDFCheckBox,
  StandardFonts, rgb, degrees, PDFDict, PDFName, PDFString, PDFHexString,
} from 'pdf-lib'
import { supabaseUrl } from '@/lib/storageFetch'
import { loadPdf } from '@/lib/docStorage'
import { noteRefs, noteRefLabel, reportOrder, compareReportOrder, visitTime } from '@/lib/noteRefs'
import { reportNoLabel } from '@/lib/reportFileName'
import {
  PS1_KEYS, PS4_FIELDS, normaliseCm,
  type Ps1Key, type ProjectCloseout, type FirmPs4Settings, type Ps4Author, type CompileRequest, type PackSectionId,
} from '@/lib/closeout'
import { CLOSEOUT_PLACEHOLDERS, type CloseoutTemplateKind } from '@/lib/closeout'
import { LINK_PREFIX, renderTemplatePdf, reportLinkText } from '@/lib/closeoutTemplates'

/**
 * Server side of close-out packs (lib/closeout has the shared types):
 * reading a design PS1, checking a firm's PS4 form, and putting a pack
 * together — the PS4 filled in from the PS1, the project and the PS4
 * author, then the summary, registers and finalised reports, as one PDF.
 *
 * Everything lives in the private `reports` bucket under closeout/<firm>/,
 * reached only through these routes with the service key.
 */

export const BUCKET = 'reports'
export const admin = () => createClient(supabaseUrl(), (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim())

export const closeoutPaths = {
  ps4Form: (firmId: string, stamp: string) => `closeout/${firmId}/ps4-form-${stamp}.pdf`,
  signature: (firmId: string, authorId: string, stamp: string, ext: string) => `closeout/${firmId}/signatures/${authorId}-${stamp}.${ext}`,
  ps1: (firmId: string, projectId: string, stamp: string) => `closeout/${firmId}/projects/${projectId}/ps1-${stamp}.pdf`,
  draft: (firmId: string, projectId: string) => `closeout/${firmId}/projects/${projectId}/draft.pdf`,
  template: (firmId: string, kind: string, stamp: string) => `closeout/${firmId}/templates/${kind}-${stamp}.docx`,
}

/** A stored path belongs to this firm's close-out folder — so a path saved
 *  in a row can't be pointed at another firm's files. */
export const ownsPath = (firmId: string, path: unknown): path is string =>
  typeof path === 'string' && path.startsWith(`closeout/${firmId}/`) && !path.includes('..')

export async function download(path: string): Promise<Buffer> {
  const { data, error } = await admin().storage.from(BUCKET).download(path)
  if (error || !data) throw new Error('File not found')
  return Buffer.from(await data.arrayBuffer())
}

// ── Text that the standard PDF fonts can draw ───────────────────────────────

/** Helvetica only carries the Windows Latin set: anything else (a macron in
 *  a Māori place name, an emoji) would throw. Accents come off; the rest
 *  become close equivalents or go. */
export function pdfSafe(text: unknown): string {
  return String(text ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\r/g, '').replace(/\t/g, ' ')
    .replace(/[‐-‒]/g, '-')
    .replace(/[^\n\x20-\x7E\xA0-\xFF–—‘’“”•…€™]/g, '')
}

export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = []
  for (const para of pdfSafe(text).split('\n')) {
    const words = para.split(/ +/)
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) { line = candidate; continue }
      if (line) out.push(line)
      // A single word wider than the column is cut to fit.
      let rest = word
      while (font.widthOfTextAtSize(rest, size) > maxWidth && rest.length > 1) {
        let cut = rest.length - 1
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--
        out.push(rest.slice(0, cut))
        rest = rest.slice(cut)
      }
      line = rest
    }
    out.push(line)
  }
  return out
}

// ── Form fields ──────────────────────────────────────────────────────────────

function fieldNamed(form: PDFForm, name: string): PDFField | undefined {
  const want = name.toLowerCase()
  return form.getFields().find(f => f.getName().trim().toLowerCase() === want)
}

/** Which of the PS4 boxes SiteIQ fills are on this form. */
export async function inspectPs4Form(bytes: Buffer): Promise<{ found: number; missing: string[] }> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const form = doc.getForm()
  const names = Object.values(PS4_FIELDS)
  const missing = names.filter(n => !fieldNamed(form, n))
  return { found: names.length - missing.length, missing }
}

/** The PS1's own fillable boxes (ACE NZ / Engineering NZ form). Null when
 *  it has none, or they're empty — a flattened or scanned PS1. */
export async function readPs1FormFields(bytes: Buffer): Promise<{ fields: Record<Ps1Key, string>; legalNA: boolean } | null> {
  let form: PDFForm
  try {
    form = (await PDFDocument.load(bytes, { ignoreEncryption: true })).getForm()
  } catch {
    return null
  }
  const text = (name: string): string => {
    const f = fieldNamed(form, name)
    try {
      if (f instanceof PDFTextField) return (f.getText() ?? '').trim()
      if (f instanceof PDFDropdown) {
        const v = (f.getSelected()[0] ?? '').trim()
        return /choose/i.test(v) ? '' : v
      }
    } catch { /* unreadable box */ }
    return ''
  }
  const naBox = fieldNamed(form, 'N/A')
  let legalNA = false
  try { legalNA = naBox instanceof PDFCheckBox && naBox.isChecked() } catch { /* ignore */ }

  const fields: Record<Ps1Key, string> = {
    clauses: text('Building code clauses'),
    owner: text('To'),
    bca: text('To be supplied to'),
    respect: text('In respect of'),
    at: text('At'),
    legal: text('legal description'),
    designFirm: text('Engineering Design Firm'),
    designer: text('Design Professional'),
    designerCpeng: text('CPEng number'),
    ps1Date: text('Date'),
    cm: normaliseCm(text('Dropdown2')),
    references: text('References'),
  }
  const filled = PS1_KEYS.filter(k => fields[k]).length
  return filled >= 3 ? { fields, legalNA } : null
}

const PS1_SCHEMA = {
  type: 'object',
  properties: {
    ...Object.fromEntries(PS1_KEYS.map(k => [k, { type: 'string' }])),
    legal_na: { type: 'boolean' },
  },
  required: [...PS1_KEYS, 'legal_na'],
  additionalProperties: false,
} as const

const PS1_PROMPT = `This PDF is a New Zealand Producer Statement PS1 (Design), usually on the ACE New Zealand / Engineering New Zealand form. Read what has been filled in and return it exactly as written. Use an empty string for anything not filled in; never guess.

- clauses: the Building Code clause(s), e.g. "B1, B2".
- owner: who it is issued TO (the owner / developer).
- bca: "To be supplied to" — the building consent authority.
- respect: "In respect of" — the description of the building work.
- at: "At" — the address, town/city.
- legal: the legal description.
- legal_na: true if the legal description's N/A box is ticked.
- designFirm: the engineering design firm that issued it.
- designer: the name of the engineering design professional.
- designerCpeng: their CPEng number.
- ps1Date: the date it was signed, as written.
- cm: the recommended level of construction monitoring, written "CM 1" to "CM 5".
- references: everything listed in the Schedule (drawings, specifications, calculations, other documents), one item per line.`

/** Claude reads a PS1 that has no readable boxes. The engineer checks every
 *  value before it is used. */
export async function readPs1WithClaude(bytes: Buffer): Promise<{ fields: Record<Ps1Key, string>; legalNA: boolean }> {
  const apiKey = (process.env.ANTHROPIC_KEY ?? process.env.ANTHROPIC_API_KEY ?? '').replace(/^﻿/, '').trim()
  if (!apiKey) throw new Error('AI service not configured')
  const client = new Anthropic({ apiKey })
  const params = {
    model: 'claude-opus-5-5',
    max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: PS1_SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bytes.toString('base64') } },
        { type: 'text', text: PS1_PROMPT },
      ],
    }],
  } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming
  const response = await client.beta.messages.create(params)
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
    throw new Error('The AI could not read this PS1. Fill in the details by hand.')
  }
  const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')?.text ?? ''
  const raw = JSON.parse(text)
  const fields = Object.fromEntries(PS1_KEYS.map(k => [k, String(raw[k] ?? '').trim()])) as Record<Ps1Key, string>
  fields.cm = normaliseCm(fields.cm)
  return { fields, legalNA: !!raw.legal_na }
}

// ── Page layout for the pages SiteIQ draws ──────────────────────────────────

const A4: [number, number] = [595.28, 841.89]
const MARGIN = 50
const INK = rgb(0.165, 0.18, 0.216)
const MID = rgb(0.42, 0.45, 0.5)
const INDIGO = rgb(0.227, 0.29, 0.388)
const LINE = rgb(0.86, 0.84, 0.8)
const SOFT = rgb(0.98, 0.973, 0.957)
/** Text that jumps to a report when clicked. */
const LINK = rgb(0.12, 0.25, 0.6)

type Fonts = { regular: PDFFont; bold: PDFFont }

/** A clickable area over text that names a report; linked to the report's
 *  first page once the reports are in the pack. */
type LinkSpot = { page: PDFPage; rect: [number, number, number, number]; reportId: string }

/** A report link that came out of a firm's Word template as a web address
 *  (closeoutTemplates linkUrl), to be pointed at the report's page. */
type TemplateLink = { page: PDFPage; annot: PDFDict; reportId: string }

function harvestTemplateLinks(doc: PDFDocument, pages: PDFPage[]): TemplateLink[] {
  const found: TemplateLink[] = []
  for (const page of pages) {
    const annots = page.node.Annots()
    if (!annots) continue
    for (let i = 0; i < annots.size(); i++) {
      const annot = doc.context.lookup(annots.get(i))
      if (!(annot instanceof PDFDict)) continue
      const action = annot.lookup(PDFName.of('A'))
      const uri = action instanceof PDFDict ? action.lookup(PDFName.of('URI')) : undefined
      const text = uri instanceof PDFString || uri instanceof PDFHexString ? uri.decodeText() : ''
      if (text.startsWith(LINK_PREFIX)) found.push({ page, annot, reportId: text.slice(LINK_PREFIX.length) })
    }
  }
  return found
}

/** Points a template's report link at the report's page, or takes it off
 *  if the report isn't in the pack. */
function relinkTemplateLink(doc: PDFDocument, link: TemplateLink, target: PDFPage | undefined) {
  link.annot.delete(PDFName.of('A'))
  if (target) {
    link.annot.set(PDFName.of('Dest'), doc.context.obj([target.ref, 'XYZ', null, null, null]))
    link.annot.set(PDFName.of('Border'), doc.context.obj([0, 0, 0]))
    return
  }
  const annots = link.page.node.Annots()
  if (!annots) return
  for (let i = annots.size() - 1; i >= 0; i--) {
    if (doc.context.lookup(annots.get(i)) === link.annot) annots.remove(i)
  }
}

/** A link inside the pack: clicking `rect` on `page` opens `target`. */
function addLink(doc: PDFDocument, page: PDFPage, rect: [number, number, number, number], target: PDFPage) {
  const annot = doc.context.register(doc.context.obj({
    Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0],
    Dest: [target.ref, 'XYZ', null, null, null],
  }))
  page.node.addAnnot(annot)
}

/** Writes down the page, starting a new one when it runs out of room. */
class PageWriter {
  page!: PDFPage
  y = 0
  pages: PDFPage[] = []
  /** `insertAt`: put the pages there rather than at the end. */
  constructor(private doc: PDFDocument, private fonts: Fonts, private heading: string, private sub: string, private insertAt?: number) {
    this.newPage()
  }
  newPage() {
    this.page = this.insertAt === undefined
      ? this.doc.addPage(A4)
      : this.doc.insertPage(this.insertAt + this.pages.length, A4)
    this.pages.push(this.page)
    this.y = A4[1] - MARGIN
    const continued = this.pages.length > 1 ? ' (continued)' : ''
    this.page.drawText(pdfSafe(this.heading + continued), { x: MARGIN, y: this.y - 16, size: 17, font: this.fonts.bold, color: INDIGO })
    this.y -= 34
    if (this.sub) {
      this.page.drawText(pdfSafe(this.sub), { x: MARGIN, y: this.y - 10, size: 10, font: this.fonts.regular, color: MID })
      this.y -= 26
    }
  }
  room(h: number) {
    if (this.y - h < MARGIN + 24) this.newPage()
  }
}

type Col = { header: string; width: number }
type Cell = string | { text: string; image?: Awaited<ReturnType<PDFDocument['embedJpg']>> }

/** `links`: per row, the report the row names — the row becomes a link to
 *  it, and the `linkCol` cell is drawn as link text. */
function drawTable(w: PageWriter, fonts: Fonts, cols: Col[], rows: Cell[][], size = 8.5,
  links?: { reports: (string | null | undefined)[]; linkCol: number; spots: LinkSpot[] }) {
  const pad = 5
  const lh = size * 1.3
  const drawHeader = () => {
    w.room(lh + pad * 2 + 20)
    let x = MARGIN
    w.page.drawRectangle({ x: MARGIN, y: w.y - lh - pad * 2, width: A4[0] - MARGIN * 2, height: lh + pad * 2, color: SOFT })
    for (const c of cols) {
      w.page.drawText(pdfSafe(c.header.toUpperCase()), { x: x + pad, y: w.y - pad - size, size: size - 1, font: fonts.bold, color: MID })
      x += c.width
    }
    w.y -= lh + pad * 2
  }
  drawHeader()
  rows.forEach((row, rowIndex) => {
    const reportId = links?.reports[rowIndex] ?? null
    const cellLines = row.map((cell, i) => wrapText(typeof cell === 'string' ? cell : cell.text, fonts.regular, size, cols[i].width - pad * 2 - (typeof cell !== 'string' && cell.image ? 50 : 0)))
    const imgH = row.some(c => typeof c !== 'string' && c.image) ? 34 : 0
    const h = Math.max(...cellLines.map(l => l.length * lh), imgH) + pad * 2
    if (w.y - h < MARGIN + 24) { w.newPage(); drawHeader() }
    let x = MARGIN
    row.forEach((cell, i) => {
      let tx = x + pad
      if (typeof cell !== 'string' && cell.image) {
        const img = cell.image
        const scale = Math.min(44 / img.width, 33 / img.height)
        w.page.drawImage(img, { x: tx, y: w.y - pad - img.height * scale, width: img.width * scale, height: img.height * scale })
        tx += 50
      }
      const linked = !!reportId && i === links?.linkCol
      cellLines[i].forEach((line, j) => {
        const y = w.y - pad - size - j * lh
        w.page.drawText(line, { x: tx, y, size, font: fonts.regular, color: linked ? LINK : INK })
        if (linked) w.page.drawLine({ start: { x: tx, y: y - 1.2 }, end: { x: tx + fonts.regular.widthOfTextAtSize(line, size), y: y - 1.2 }, thickness: 0.4, color: LINK })
      })
      x += cols[i].width
    })
    if (reportId && links) links.spots.push({ page: w.page, rect: [MARGIN, w.y - h, A4[0] - MARGIN, w.y], reportId })
    w.y -= h
    w.page.drawLine({ start: { x: MARGIN, y: w.y }, end: { x: A4[0] - MARGIN, y: w.y }, thickness: 0.5, color: LINE })
  })
}

function drawKeyValues(w: PageWriter, fonts: Fonts, rows: [string, string][]) {
  const keyW = 150
  const valW = A4[0] - MARGIN * 2 - keyW
  for (const [k, v] of rows) {
    const lines = wrapText(v || '—', fonts.regular, 10, valW)
    const h = lines.length * 13 + 10
    w.room(h)
    w.page.drawText(pdfSafe(k), { x: MARGIN, y: w.y - 14, size: 10, font: fonts.bold, color: INK })
    lines.forEach((line, i) => w.page.drawText(line, { x: MARGIN + keyW, y: w.y - 14 - i * 13, size: 10, font: fonts.regular, color: INK }))
    w.y -= h
    w.page.drawLine({ start: { x: MARGIN, y: w.y + 2 }, end: { x: A4[0] - MARGIN, y: w.y + 2 }, thickness: 0.5, color: LINE })
  }
}

// ── Pack data ────────────────────────────────────────────────────────────────

type Report = { id: string; report_no: string | null; date: string | null; created_at: string | null; purpose: string | null; created_by: string | null; report_status: string | null; status: string | null }
type Note = {
  id: string; inspection_id: string | null; zone_label: string | null; severity: string | null
  notes: string | null; transcript: string | null; report_text: string | null; closed_at: string | null
}

const shortDate = (iso: string | null | undefined) => {
  const t = Date.parse(String(iso ?? ''))
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Pacific/Auckland' }) : ''
}
const visitDate = (r: Report) => (r.date ?? '').trim() || shortDate(r.created_at)
/** '10 Oct 2026', for table columns. */
const visitDateShort = (r: Report) => shortDate(r.date) || visitDate(r)
/** A report's purpose without its closing full stop, for lists. */
const purposeOf = (r: Report) => (r.purpose ?? '').trim().replace(/[.;\s]+$/, '')
const firstSentence = (s: string, max = 140) => {
  const t = s.replace(/\s+/g, ' ').trim()
  const cut = t.match(/^.*?[.!?](\s|$)/)?.[0]?.trim() ?? t
  return cut.length > max ? cut.slice(0, max - 1).trimEnd() + '…' : cut
}
const isClosed = (n: Note) => String(n.severity ?? '').toUpperCase() === 'CLOSED'

async function fetchImage(doc: PDFDocument, url: string) {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) return undefined
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.length > 12 * 1024 * 1024) return undefined
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return await doc.embedJpg(bytes)
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return await doc.embedPng(bytes)
  } catch { /* no thumbnail */ }
  return undefined
}

export type CompileResult = { bytes: Uint8Array; pageCount: number; warnings: string[] }

export async function compilePack(req: CompileRequest, firmId: string): Promise<CompileResult> {
  const supabase = admin()
  const warnings: string[] = []
  const isPs4 = req.mode === 'ps4'
  const want = new Set<PackSectionId>(req.sections)

  const [{ data: project }, { data: firm }, { data: inspections }, { data: members }] = await Promise.all([
    supabase.from('projects').select('id, name, address, project_number, client_name, firm_id, closeout').eq('id', req.projectId).single(),
    supabase.from('firms').select('name, ps4_settings').eq('id', firmId).single(),
    supabase.from('inspections').select('id, report_no, date, created_at, purpose, created_by, report_status, status').eq('project_id', req.projectId),
    supabase.from('firm_members').select('user_id, full_name, email').eq('firm_id', firmId),
  ])
  if (!project) throw new Error('Project not found')
  const closeout = (project.closeout ?? {}) as ProjectCloseout
  const settings = ((firm as any)?.ps4_settings ?? {}) as FirmPs4Settings
  const ps1 = closeout.ps1
  const nameOf = new Map((members ?? []).map((m: any) => [m.user_id, (m.full_name || m.email || '').trim()]))

  const allReports = ((inspections ?? []) as Report[]).sort((a, b) => compareReportOrder(reportOrder(a), reportOrder(b)))
  let reports = allReports.filter(r => r.report_status === 'finalised')
  if (req.reportIds) {
    const chosen = new Set(req.reportIds)
    reports = reports.filter(r => chosen.has(r.id))
  }

  // Notes: by project, and by report for older rows with no project.
  const ids = allReports.map(r => r.id)
  const cols = 'id, inspection_id, zone_label, severity, notes, transcript, report_text, closed_at'
  const [byProject, byReport] = await Promise.all([
    supabase.from('observations').select(cols).eq('project_id', req.projectId),
    ids.length ? supabase.from('observations').select(cols).in('inspection_id', ids) : Promise.resolve({ data: [] as any[] }),
  ])
  const noteMap = new Map<string, Note>()
  for (const n of [...((byProject as any).data ?? []), ...((byReport as any).data ?? [])]) noteMap.set(n.id, n)
  const refs = noteRefs(allReports, [...noteMap.values()])
  const notes = [...noteMap.values()].sort((a, b) => (refs.get(a.id) ?? 9999) - (refs.get(b.id) ?? 9999))
  const closedCount = notes.filter(isClosed).length

  let author: Ps4Author | null = null
  if (isPs4) {
    const authorId = req.authorId ?? closeout.authorId
    if (authorId) {
      const { data } = await supabase.from('ps4_authors').select('*').eq('id', authorId).eq('firm_id', firmId).maybeSingle()
      author = data as Ps4Author | null
    }
    if (!author) warnings.push('No PS4 author chosen: their name, CPEng number and qualifications are blank.')
    if (!ps1) warnings.push('No PS1 uploaded: the PS4 details from it are blank.')
    if (!closeout.consentNo?.trim()) warnings.push('No building consent number entered.')
    if (closedCount < notes.length) warnings.push(`${notes.length - closedCount} site note${notes.length - closedCount === 1 ? ' is' : 's are'} still open.`)
  }

  const reportById = new Map(allReports.map(r => [r.id, r]))
  const engineerOf = (r: Report) => (r.created_by && nameOf.get(r.created_by)) || ''
  const reportLine = (r: Report) => [reportNoLabel(r.report_no), visitDate(r), purposeOf(r), engineerOf(r)].filter(Boolean).join(' · ')

  const pack = await PDFDocument.create()
  const fonts: Fonts = {
    regular: await pack.embedFont(StandardFonts.Helvetica),
    bold: await pack.embedFont(StandardFonts.HelveticaBold),
  }
  const generated = new Set<PDFPage>()
  const contents: { title: string; page: PDFPage }[] = []
  const spots: LinkSpot[] = []
  const templateLinks: TemplateLink[] = []

  // ── 1. The PS4 ─────────────────────────────────────────────────────────
  if (isPs4) {
    if (!settings.formPath) throw new Error('Upload your firm’s PS4 form under Settings first.')
    const ps4 = await PDFDocument.load(await download(settings.formPath), { ignoreEncryption: true })
    const scheduleLines: SchedLine[] = []
    const push = (text: string, reportId?: string) => { scheduleLines.push({ text, reportId }) }
    if (ps1) {
      const f = ps1.fields
      push('Design documents (from the PS1)')
      const issued = [f.designFirm, [f.designer, f.designerCpeng && `CPEng ${f.designerCpeng}`].filter(Boolean).join(', '), f.ps1Date && `dated ${f.ps1Date}`].filter(Boolean).join(', ')
      push(`    PS1 – ${issued || 'design producer statement'}`)
      for (const ref of f.references.split('\n').map(s => s.trim()).filter(Boolean)) push(`    ${ref}`)
      push('')
    }
    push('Construction monitoring site reports')
    for (const r of reports) push(`    ${reportLine(r)}`, want.has('reports') ? r.id : undefined)
    if (reports.length === 0) push('    None finalised yet')
    push('')
    push(`Site notes: ${notes.length} raised, ${closedCount} closed (see the site notes closed register).`)

    const { overflow: continuation, spots: ps4Spots } = fillPs4(ps4, {
      clauses: ps1?.fields.clauses ?? '',
      jobNo: project.project_number ?? '',
      firmName: (firm as any)?.name ?? '',
      owner: ps1?.fields.owner ?? '',
      bca: ps1?.fields.bca ?? '',
      respect: ps1?.fields.respect ?? '',
      at: ps1?.fields.at ?? project.address ?? '',
      legal: ps1?.legalNA ? '' : ps1?.fields.legal ?? '',
      legalNA: !!ps1?.legalNA,
      designFirm: ps1?.fields.designFirm ?? '',
      consentNo: closeout.consentNo ?? '',
      amendmentNo: closeout.amendmentNo ?? '',
      professional: author?.name ?? '',
      cpeng: author?.cpeng ?? '',
      qualifications: author?.qualifications ?? '',
      aceMember: settings.aceMember ?? '',
      cm: normaliseCm(ps1?.fields.cm),
      schedule: scheduleLines,
    }, warnings)

    const copied = await pack.copyPages(ps4, ps4.getPageIndices())
    copied.forEach(p => pack.addPage(p))
    for (const sp of ps4Spots) if (copied[sp.pageIndex]) spots.push({ page: copied[sp.pageIndex], rect: sp.rect, reportId: sp.reportId })
    contents.push({ title: 'PS4 – Producer statement, construction review', page: copied[0] })
    if (continuation.length > 0) {
      // Straight after the schedule page, as the form's "refer the
      // Schedule" allows.
      const w = new PageWriter(pack, fonts, 'SCHEDULE to PS4', `Job number ${project.project_number ?? ''}`, Math.min(2, pack.getPageCount()))
      for (const line of continuation) {
        w.room(12)
        const x = MARGIN + fonts.regular.widthOfTextAtSize(line.indent, 9)
        w.page.drawText(line.text, { x, y: w.y - 10, size: 9, font: fonts.regular, color: line.reportId ? LINK : INK })
        if (line.reportId) spots.push({ page: w.page, rect: [x, w.y - 13, x + fonts.regular.widthOfTextAtSize(line.text, 9), w.y - 1], reportId: line.reportId })
        w.y -= 12
      }
      w.pages.forEach(p => generated.add(p))
    }
  }

  // Contents page, filled in once the page numbers are known.
  const contentsPage = pack.addPage(A4)
  generated.add(contentsPage)

  // A firm's own Word layout for a page, when it has one (Settings): filled,
  // converted, and put in the pack. Null if it couldn't be used — SiteIQ's
  // own page goes in instead, with a warning.
  const linkable = new Set(want.has('reports') ? reports.map(r => r.id) : [])
  const today = new Date().toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Pacific/Auckland' })
  const fromTemplate = async (kind: CloseoutTemplateKind, data: Record<string, unknown>): Promise<PDFPage[] | null> => {
    const tpl = settings.templates?.[kind]
    if (!tpl || !ownsPath(firmId, tpl.path)) return null
    try {
      const pdf = await renderTemplatePdf(
        tpl.path, { firm_name: (firm as any)?.name ?? '', date: today, ...data },
        `closeout/${firmId}/projects/${req.projectId}/work-${kind}-${Date.now().toString(36)}.docx`,
        CLOSEOUT_PLACEHOLDERS[kind].title,
      )
      const doc = await PDFDocument.load(pdf, { ignoreEncryption: true })
      const pages = await pack.copyPages(doc, doc.getPageIndices())
      pages.forEach(p => pack.addPage(p))
      templateLinks.push(...harvestTemplateLinks(pack, pages))
      return pages
    } catch (err: any) {
      console.warn('[closeout] template', kind, 'failed:', err?.message)
      warnings.push(`Your ${CLOSEOUT_PLACEHOLDERS[kind].title.toLowerCase()} template couldn't be used (${err?.message ?? 'error'}), so SiteIQ's own page is in its place.`)
      return null
    }
  }

  // ── 2. Summary ─────────────────────────────────────────────────────────
  if (want.has('summary')) {
    const dated = reports.filter(r => visitDate(r))
    const byVisit = [...dated].sort((a, b) => visitTime(a) - visitTime(b))
    const engineers = [...new Set(reports.map(engineerOf).filter(Boolean))]
    const purposes = [...new Set(reports.map(purposeOf).filter(Boolean))]
    const consent = [closeout.consentNo, closeout.amendmentNo && `amendment(s) ${closeout.amendmentNo}`].filter(Boolean).join(', ')
    const period: [string, string] = byVisit.length ? [visitDate(byVisit[0]), visitDate(byVisit[byVisit.length - 1])] : ['', '']

    const pages = await fromTemplate('summary', {
      project_name: project.name ?? '',
      job_number: project.project_number ?? '',
      address: ps1?.fields.at || project.address || '',
      client: ps1?.fields.owner || project.client_name || '',
      consent_no: closeout.consentNo ?? '',
      amendment_no: closeout.amendmentNo ?? '',
      council: ps1?.fields.bca ?? '',
      monitoring_level: normaliseCm(ps1?.fields.cm),
      period_start: period[0],
      period_end: period[1],
      visit_count: String(reports.length),
      engineers: engineers.join(', '),
      inspected: purposes.join('; '),
      notes_raised: String(notes.length),
      notes_closed: String(closedCount),
      notes_open: String(notes.length - closedCount),
      design_firm: ps1?.fields.designFirm ?? '',
      designer: ps1?.fields.designer ?? '',
      ps1_date: ps1?.fields.ps1Date ?? '',
      ps4_author: isPs4 ? author?.name ?? '' : '',
      ps4_author_cpeng: isPs4 ? author?.cpeng ?? '' : '',
      reports: reports.map(r => ({
        report: reportLinkText(linkable.has(r.id) ? r.id : null, reportNoLabel(r.report_no)),
        visit_date: visitDate(r),
        purpose: purposeOf(r),
        engineer: engineerOf(r),
      })),
    })
    if (pages) {
      contents.push({ title: 'Construction monitoring summary', page: pages[0] })
    } else {
      const w = new PageWriter(pack, fonts, 'Construction monitoring summary', project.name)
      const rows: [string, string][] = [
        ['Project', project.name ?? ''],
        ['Job number', project.project_number ?? ''],
        ['Address', ps1?.fields.at || project.address || ''],
        ['Client', ps1?.fields.owner || project.client_name || ''],
        ['Building consent', consent],
        ['Building consent authority', ps1?.fields.bca ?? ''],
        ['Monitoring level', normaliseCm(ps1?.fields.cm)],
        ['Monitoring period', period[0] ? `${period[0]} to ${period[1]}` : ''],
        ['Site visits', `${reports.length} site report${reports.length === 1 ? '' : 's'}`],
        ['Engineers', engineers.join(', ')],
        ['Inspected', purposes.join('; ')],
        ['Site notes', `${notes.length} raised, ${closedCount} closed${notes.length > closedCount ? `, ${notes.length - closedCount} open` : ''}`],
        ['Design', ps1 ? [ps1.fields.designFirm, ps1.fields.designer, ps1.fields.ps1Date && `PS1 dated ${ps1.fields.ps1Date}`].filter(Boolean).join(', ') : ''],
      ]
      if (isPs4) rows.push(['PS4 author', author ? `${author.name}, CPEng ${author.cpeng}` : ''])
      drawKeyValues(w, fonts, rows)
      w.pages.forEach(p => generated.add(p))
      contents.push({ title: 'Construction monitoring summary', page: w.pages[0] })
    }
  }

  // ── 3. Site report register (in the PS4 schedule when there is one) ────
  if (want.has('reportReg') && !isPs4) {
    const w = new PageWriter(pack, fonts, 'Site report register', `${project.name} · ${reports.length} report${reports.length === 1 ? '' : 's'}`)
    drawTable(w, fonts,
      [{ header: 'Report', width: 60 }, { header: 'Visit', width: 95 }, { header: 'Purpose', width: 230 }, { header: 'Engineer', width: A4[0] - MARGIN * 2 - 385 }],
      reports.map(r => [reportNoLabel(r.report_no), visitDate(r), purposeOf(r), engineerOf(r)]), 9,
      want.has('reports') ? { reports: reports.map(r => r.id), linkCol: 0, spots } : undefined)
    w.pages.forEach(p => generated.add(p))
    contents.push({ title: 'Site report register', page: w.pages[0] })
  }

  // ── 4. Site notes closed register ──────────────────────────────────────
  if (want.has('noteReg')) {
    // Latest response on each closed note: its comment and first picture.
    const closedIds = notes.filter(isClosed).map(n => n.id)
    const latest = new Map<string, any>()
    if (closedIds.length) {
      const { data: responses } = await supabase.from('note_responses').select('observation_id, comment, file_url, file_type, files, created_at, created_by').in('observation_id', closedIds).order('created_at', { ascending: true })
      for (const r of responses ?? []) latest.set(r.observation_id, r)
    }
    const raisedIn = (n: Note) => {
      const r = n.inspection_id ? reportById.get(n.inspection_id) : undefined
      return r ? `${reportNoLabel(r.report_no)} · ${visitDateShort(r)}` : '—'
    }
    const closedBy = (n: Note) => {
      const by = latest.get(n.id)?.created_by
      return (by && nameOf.get(by)) || ''
    }

    const pages = await fromTemplate('noteReg', {
      project_name: project.name ?? '',
      job_number: project.project_number ?? '',
      notes_raised: String(notes.length),
      notes_closed: String(closedCount),
      notes_open: String(notes.length - closedCount),
      notes: notes.map(n => {
        const text = (n.report_text || n.transcript || n.notes || '').trim()
        return {
          ref: noteRefLabel(refs.get(n.id)) ?? '—',
          location: n.zone_label || 'General',
          item: firstSentence(text),
          description: text,
          raised_in: reportLinkText(n.inspection_id && linkable.has(n.inspection_id) ? n.inspection_id : null, raisedIn(n)),
          status: isClosed(n) ? 'Closed' : 'Open',
          closed_date: isClosed(n) ? shortDate(n.closed_at) || '—' : '—',
          closed_by: isClosed(n) ? closedBy(n) : '',
          how_closed: isClosed(n) ? (latest.get(n.id)?.comment ?? '').trim() || 'Closed' : '—',
        }
      }),
    })
    if (pages) {
      contents.push({ title: 'Site notes closed register', page: pages[0] })
    } else {
      const sub = closedCount === notes.length
        ? `${project.name} · all ${notes.length} site notes closed`
        : `${project.name} · ${closedCount} of ${notes.length} site notes closed, ${notes.length - closedCount} open`
      const w = new PageWriter(pack, fonts, 'Site notes closed register', sub)
      const images = new Map<string, Awaited<ReturnType<typeof fetchImage>>>()
      await Promise.all([...latest.entries()].map(async ([id, r]) => {
        const files: { url: string; type?: string | null }[] = Array.isArray(r.files) && r.files.length ? r.files : r.file_url ? [{ url: r.file_url, type: r.file_type }] : []
        const pic = files.find(f => /^image\//.test(f.type ?? '') || /\.(jpe?g|png)(\?|$)/i.test(f.url))
        if (pic) images.set(id, await fetchImage(pack, pic.url))
      }))
      const rows: Cell[][] = notes.map(n => {
        const resp = latest.get(n.id)
        const text = (n.report_text || n.transcript || n.notes || '').trim()
        const how = isClosed(n)
          ? [firstSentence(resp?.comment ?? '', 160), closedBy(n) ? `(${closedBy(n)})` : ''].filter(Boolean).join(' ') || 'Closed'
          : '—'
        return [
          noteRefLabel(refs.get(n.id)) ?? '—',
          [n.zone_label || 'General', firstSentence(text)].filter(Boolean).join(': '),
          raisedIn(n),
          isClosed(n) ? 'Closed' : 'Open',
          isClosed(n) ? shortDate(n.closed_at) || '—' : '—',
          { text: how, image: images.get(n.id) },
        ]
      })
      drawTable(w, fonts,
        [{ header: 'Note', width: 42 }, { header: 'Item', width: 140 }, { header: 'Raised in', width: 92 }, { header: 'Status', width: 44 }, { header: 'Closed', width: 62 }, { header: 'How it was closed', width: A4[0] - MARGIN * 2 - 380 }],
        rows, 8.5,
        { reports: notes.map(n => (n.inspection_id && linkable.has(n.inspection_id) ? n.inspection_id : null)), linkCol: 2, spots })
      if (notes.length === 0) {
        w.page.drawText('No site notes on this project.', { x: MARGIN, y: w.y - 16, size: 10, font: fonts.regular, color: MID })
      }
      w.pages.forEach(p => generated.add(p))
      contents.push({ title: 'Site notes closed register', page: w.pages[0] })
    }
  }

  // ── 5. The reports ─────────────────────────────────────────────────────
  const reportFirstPage = new Map<string, PDFPage>()
  if (want.has('reports')) {
    for (const r of reports) {
      try {
        const doc = await PDFDocument.load(await loadPdf(r.id), { ignoreEncryption: true })
        const pages = await pack.copyPages(doc, doc.getPageIndices())
        pages.forEach(p => pack.addPage(p))
        if (pages[0]) reportFirstPage.set(r.id, pages[0])
        if (pages[0]) contents.push({ title: `${reportNoLabel(r.report_no)} · ${visitDate(r)}`, page: pages[0] })
      } catch {
        warnings.push(`${reportNoLabel(r.report_no)} has no finalised PDF and was left out.`)
      }
    }
  }

  // ── Contents, page numbers, DRAFT ──────────────────────────────────────
  const all = pack.getPages()
  const total = all.length
  {
    let y = A4[1] - MARGIN
    contentsPage.drawText('Contents', { x: MARGIN, y: y - 16, size: 17, font: fonts.bold, color: INDIGO })
    y -= 34
    contentsPage.drawText(pdfSafe(`${project.name} · ${isPs4 ? 'PS4 close-out pack' : 'Site reports and registers'} · ${total} pages`), { x: MARGIN, y: y - 10, size: 10, font: fonts.regular, color: MID })
    y -= 30
    const size = contents.length > 45 ? 8 : 10
    for (const c of contents) {
      const n = String(all.indexOf(c.page) + 1)
      contentsPage.drawText(pdfSafe(c.title), { x: MARGIN, y, size, font: fonts.regular, color: LINK })
      addLink(pack, contentsPage, [MARGIN, y - 3, A4[0] - MARGIN, y + size], c.page)
      contentsPage.drawText(n, { x: A4[0] - MARGIN - fonts.regular.widthOfTextAtSize(n, size), y, size, font: fonts.regular, color: INK })
      y -= size * 1.6
      if (y < MARGIN) break
    }
  }
  // Every mention of a report opens it — but only reports in this pack.
  for (const sp of spots) {
    const target = reportFirstPage.get(sp.reportId)
    if (target) addLink(pack, sp.page, sp.rect, target)
  }
  for (const l of templateLinks) relinkTemplateLink(pack, l, reportFirstPage.get(l.reportId))

  all.forEach((p, i) => {
    if (generated.has(p)) {
      const label = pdfSafe(`${project.name} · close-out pack · page ${i + 1} of ${total}`)
      p.drawText(label, { x: MARGIN, y: 28, size: 8, font: fonts.regular, color: MID })
    }
    const { width, height } = p.getSize()
    p.drawText('DRAFT', {
      x: width / 2 - 170, y: height / 2 - 90, size: 120, font: fonts.bold,
      color: rgb(0.9, 0.45, 0.36), opacity: 0.13, rotate: degrees(35),
    })
  })

  pack.setTitle(pdfSafe(`${project.name} – ${isPs4 ? 'PS4 close-out pack' : 'site reports and registers'} (DRAFT)`))
  const bytes = await pack.save()
  return { bytes, pageCount: total, warnings }
}

type Ps4Values = {
  clauses: string; jobNo: string; firmName: string; owner: string; bca: string; respect: string; at: string
  legal: string; legalNA: boolean; designFirm: string; consentNo: string; amendmentNo: string
  professional: string; cpeng: string; qualifications: string; aceMember: string; cm: string
  schedule: SchedLine[]
}

/** A line of the PS4 schedule; reportId when it names a report in the pack. */
type SchedLine = { text: string; reportId?: string }
/** A schedule line after wrapping: its indent kept apart so it can be drawn. */
type WrappedLine = { indent: string; text: string; reportId?: string }

/** Fills the PS4's boxes and flattens them. Returns the schedule lines that
 *  didn't fit in its box, for continuation pages, and where each line
 *  naming a report was drawn, to link it. */
export function fillPs4(doc: PDFDocument, v: Ps4Values, warnings: string[]): {
  overflow: WrappedLine[]
  spots: { pageIndex: number; rect: [number, number, number, number]; reportId: string }[]
} {
  const form = doc.getForm()
  const helv = doc.embedStandardFont(StandardFonts.Helvetica)
  const missing: string[] = []

  const setText = (name: string, value: string, maxSize = 10) => {
    const f = fieldNamed(form, name)
    if (!(f instanceof PDFTextField)) { if (value) missing.push(name); return }
    const text = pdfSafe(value).replace(/\n+/g, ' ')
    const width = f.acroField.getWidgets()[0]?.getRectangle().width ?? 200
    let size = maxSize
    while (size > 6 && helv.widthOfTextAtSize(text, size) > width - 4) size -= 0.5
    f.setFontSize(size)
    f.setText(text)
  }
  const select = (name: string, value: string) => {
    const f = fieldNamed(form, name)
    if (!(f instanceof PDFDropdown) || !value) return
    const match = f.getOptions().find(o => o.trim().toLowerCase() === value.trim().toLowerCase())
    if (match) f.select(match)
  }

  setText(PS4_FIELDS.clauses, v.clauses)
  setText(PS4_FIELDS.clauses2, v.clauses)
  setText(PS4_FIELDS.jobNo, v.jobNo)
  setText(PS4_FIELDS.jobNoFooter, v.jobNo, 8)
  setText(PS4_FIELDS.monitoringFirm, v.firmName)
  setText(PS4_FIELDS.to, v.owner)
  setText(PS4_FIELDS.bca, v.bca)
  setText(PS4_FIELDS.respect, v.respect)
  setText(PS4_FIELDS.at, v.at)
  setText(PS4_FIELDS.legal, v.legal)
  setText(PS4_FIELDS.designFirm, v.designFirm)
  setText(PS4_FIELDS.consentNo, v.consentNo)
  setText(PS4_FIELDS.amendmentNo, v.amendmentNo)
  setText(PS4_FIELDS.professional, v.professional)
  setText(PS4_FIELDS.cpeng, v.cpeng)
  setText(PS4_FIELDS.qualifications, v.qualifications)
  setText(PS4_FIELDS.date, '')
  select(PS4_FIELDS.aceMember, v.aceMember)
  select(PS4_FIELDS.cmLevel, v.cm)
  if (v.legalNA) {
    const cb = fieldNamed(form, PS4_FIELDS.legalNA)
    if (cb instanceof PDFCheckBox) cb.check()
  }

  // The schedule: as much as fits in its box at 9pt down to 7pt; the rest
  // goes on continuation pages. Drawn straight onto the page over the box
  // (left empty) rather than typed into it, so each report's line has a
  // known place to put a link on.
  const wrapAt = (size: number, width: number): WrappedLine[] => v.schedule.flatMap(line => {
    const indent = line.text.match(/^ */)?.[0] ?? ''
    return wrapText(line.text.trim(), helv, size, width - helv.widthOfTextAtSize(indent, size))
      .map(text => ({ indent, text, reportId: line.reportId }))
  })
  let overflow: WrappedLine[] = []
  const spots: { pageIndex: number; rect: [number, number, number, number]; reportId: string }[] = []
  const sched = fieldNamed(form, PS4_FIELDS.schedule)
  const widget = sched?.acroField.getWidgets()[0]
  const pageIndex = widget ? doc.getPages().findIndex(p => p.ref === widget.P()) : -1
  if (sched instanceof PDFTextField && widget && pageIndex >= 0) {
    const rect = widget.getRectangle()
    const width = rect.width - 8
    const height = rect.height - 8
    let size = 9
    let lines = wrapAt(size, width)
    while (size > 7 && lines.length * size * 1.25 > height) { size -= 0.5; lines = wrapAt(size, width) }
    const lh = size * 1.25
    const capacity = Math.floor(height / lh)
    if (lines.length > capacity) {
      overflow = lines.slice(capacity - 1)
      lines = [...lines.slice(0, capacity - 1), { indent: '', text: 'Continued on the next page.' }]
    }
    sched.setText('')
    const page = doc.getPages()[pageIndex]
    lines.forEach((line, i) => {
      const x = rect.x + 4 + helv.widthOfTextAtSize(line.indent, size)
      const y = rect.y + rect.height - 4 - size - i * lh
      page.drawText(line.text, { x, y, size, font: helv, color: line.reportId ? LINK : rgb(0, 0, 0) })
      if (line.reportId) spots.push({ pageIndex, rect: [x, y - 2, x + helv.widthOfTextAtSize(line.text, size), y + size], reportId: line.reportId })
    })
  } else {
    missing.push(PS4_FIELDS.schedule)
    overflow = wrapAt(9, A4[0] - MARGIN * 2)
  }

  if (missing.length) warnings.push(`Your PS4 form has no box for: ${missing.join(', ')}.`)
  try {
    form.updateFieldAppearances(helv)
    form.flatten()
  } catch (err) {
    console.warn('[closeout] PS4 could not be flattened:', (err as Error).message)
  }
  return { overflow, spots }
}
