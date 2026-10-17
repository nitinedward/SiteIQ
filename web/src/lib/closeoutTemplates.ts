import PizZip from 'pizzip'
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, AlignmentType,
} from 'docx'
import { convertUrlToPdf } from '@/lib/onlyofficeConvert'
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl } from '@/lib/storageFetch'
import { CLOSEOUT_PLACEHOLDERS, type CloseoutTemplateKind } from '@/lib/closeout'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Docxtemplater = require('docxtemplater')

/**
 * A firm's own Word layout for a close-out page (lib/closeout
 * CLOSEOUT_PLACEHOLDERS): checked on upload, filled with the pack's data,
 * converted to PDF on the Document Server and put in the pack in place of
 * SiteIQ's own page.
 *
 * Report links survive the trip through Word: a value that names a report
 * is written as a hyperlink to linkUrl(report id), which the Document Server
 * keeps as a link in the PDF, and the pack then points it at the report's
 * own page (see relinkTemplatePages in closeoutServer).
 */

const BUCKET = 'reports'
const admin = () => createClient(supabaseUrl(), (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim())

const OPTIONS = {
  paragraphLoop: true,
  linebreaks: true,
  delimiters: { start: '{{', end: '}}' },
  nullGetter: () => '',
}

/** The address a report link carries out of Word. Never opened: replaced
 *  by a link inside the pack. */
export const LINK_PREFIX = 'https://www.site-iq.co.nz/pack-link/'
export const linkUrl = (reportId: string) => `${LINK_PREFIX}${reportId}`

/** Text that becomes a link to a report once the template is filled. */
export const reportLinkText = (reportId: string | null | undefined, label: string) =>
  reportId ? `[[SIQ:${reportId}]]${label}[[/SIQ]]` : label

// ── Checking an upload ──────────────────────────────────────────────────────

export type TemplateCheckResult = { ok: true; unknown: string[]; usedLoop: boolean } | { ok: false; error: string }

/** Every {{tag}} in the document's text, in order — Word may split a tag
 *  across runs, so the text of each part is joined first. */
function tagsIn(zip: PizZip): { tag: string; kind: '' | '#' | '/' | '^' }[] {
  const parts = Object.keys(zip.files).filter(n => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n))
  const out: { tag: string; kind: '' | '#' | '/' | '^' }[] = []
  for (const name of parts) {
    const text = [...(zip.file(name)?.asText() ?? '').matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map(m => m[1]).join('')
    for (const m of text.matchAll(/\{\{\s*([#/^]?)\s*([\w.]+)\s*\}\}/g)) out.push({ kind: m[1] as any, tag: m[2] })
  }
  return out
}

export function checkCloseoutTemplate(buffer: Buffer, kind: CloseoutTemplateKind): TemplateCheckResult {
  let zip: PizZip
  try {
    zip = new PizZip(buffer)
    new Docxtemplater(zip, OPTIONS)
  } catch (err: any) {
    const first = err?.properties?.errors?.[0]?.properties
    const detail = first?.explanation ?? (/zip/i.test(err?.message ?? '') ? 'it is not a Word .docx file' : err?.message ?? 'unreadable')
    return { ok: false, error: `The template can't be used: ${detail}` }
  }
  const spec = CLOSEOUT_PLACEHOLDERS[kind]
  const top = new Set(spec.fields.map(f => f.tag))
  const inLoop = new Set([...spec.loopFields.map(f => f.tag), ...top])
  const unknown = new Set<string>()
  let depth = 0
  let usedLoop = false
  for (const { tag, kind: k } of tagsIn(zip)) {
    if (k === '#' || k === '^') {
      if (tag === spec.loop) { usedLoop = true; depth++ } else unknown.add(tag)
    } else if (k === '/') {
      if (tag === spec.loop) depth = Math.max(0, depth - 1)
    } else if (!(depth > 0 ? inLoop : top).has(tag)) {
      unknown.add(tag)
    }
  }
  return { ok: true, unknown: [...unknown], usedLoop }
}

// ── Filling ─────────────────────────────────────────────────────────────────

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Turns the [[SIQ:id]]label[[/SIQ]] markers docxtemplater wrote into Word
 *  hyperlinks, keeping the run's own formatting plus link colour and
 *  underline. */
function linkMarkers(zip: PizZip) {
  const docPath = 'word/document.xml'
  const relsPath = 'word/_rels/document.xml.rels'
  let xml = zip.file(docPath)?.asText()
  if (!xml || !xml.includes('[[SIQ:')) return
  let rels = zip.file(relsPath)?.asText() ?? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
  let n = 0
  const relIds = new Map<string, string>()
  const relFor = (id: string) => {
    if (!relIds.has(id)) {
      const rid = `rIdSiqLink${++n}`
      relIds.set(id, rid)
      rels = rels.replace('</Relationships>', `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${linkUrl(id)}" TargetMode="External"/></Relationships>`)
    }
    return relIds.get(id)!
  }

  xml = xml.replace(/<w:r(?:\s[^>]*)?>(?:(?!<\/w:r>)[\s\S])*?\[\[SIQ:(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g, run => {
    const rPr = run.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? ''
    const text = [...run.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m => m[1]).join('')
    const linkPr = rPr
      ? rPr.replace(/<w:color [^>]*\/>|<w:u [^>]*\/>/g, '').replace('</w:rPr>', '<w:color w:val="1F4099"/><w:u w:val="single"/></w:rPr>')
      : '<w:rPr><w:color w:val="1F4099"/><w:u w:val="single"/></w:rPr>'
    const plain = (t: string) => (t ? `<w:r>${rPr}<w:t xml:space="preserve">${t}</w:t></w:r>` : '')
    let out = ''
    let rest = text
    const re = /\[\[SIQ:([0-9a-f-]{36})\]\]([\s\S]*?)\[\[\/SIQ\]\]/
    let m: RegExpMatchArray | null
    while ((m = rest.match(re))) {
      out += plain(rest.slice(0, m.index))
      out += `<w:hyperlink r:id="${relFor(m[1])}" w:history="1"><w:r>${linkPr}<w:t xml:space="preserve">${m[2]}</w:t></w:r></w:hyperlink>`
      rest = rest.slice((m.index ?? 0) + m[0].length)
    }
    return out + plain(rest)
  })
  // Anything a marker split oddly across runs: drop the markers, keep the text.
  xml = xml.replace(/\[\[SIQ:[0-9a-f-]{36}\]\]|\[\[\/SIQ\]\]/g, '')
  if (!/xmlns:r=/.test(xml.slice(0, 2000))) {
    xml = xml.replace('<w:document ', '<w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ')
  }
  zip.file(docPath, xml)
  zip.file(relsPath, rels)
}

export function fillCloseoutTemplate(buffer: Buffer, data: Record<string, unknown>): Buffer {
  const zip = new PizZip(buffer)
  const doc = new Docxtemplater(zip, OPTIONS)
  doc.render(data)
  const out = doc.getZip() as PizZip
  linkMarkers(out)
  return out.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
}

/** Fills the firm's template and has the Document Server turn it into PDF.
 *  The filled .docx is parked in storage only for the conversion. */
export async function renderTemplatePdf(templatePath: string, data: Record<string, unknown>, workPath: string, title: string): Promise<Buffer> {
  const supabase = admin()
  const { data: file, error } = await supabase.storage.from(BUCKET).download(templatePath)
  if (error || !file) throw new Error('Template not found')
  const filled = fillCloseoutTemplate(Buffer.from(await file.arrayBuffer()), data)
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(workPath, filled, {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', upsert: true,
  })
  if (upErr) throw new Error('Could not stage the template: ' + upErr.message)
  try {
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(workPath, 600)
    if (!signed?.signedUrl) throw new Error('Could not stage the template')
    return await convertUrlToPdf(signed.signedUrl, `closeout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title)
  } finally {
    await supabase.storage.from(BUCKET).remove([workPath])
  }
}

// ── Starter templates ───────────────────────────────────────────────────────

const FONT = 'Arial'
const INDIGO = '3A4A63'
const MID = '6B7380'
const t = (text: string, opts: { bold?: boolean; size?: number; color?: string } = {}) =>
  new TextRun({ text, font: FONT, size: (opts.size ?? 10) * 2, bold: opts.bold, color: opts.color })
const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: 'DDD8CF' }
const borders = { top: cellBorder, bottom: cellBorder, left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } }
const cell = (text: string, opts: { head?: boolean; width?: number; bold?: boolean } = {}) => new TableCell({
  children: [new Paragraph({ children: [t(text, { bold: opts.head || opts.bold, size: opts.head ? 8 : 9, color: opts.head ? MID : undefined })] })],
  width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
  shading: opts.head ? { type: ShadingType.CLEAR, color: 'auto', fill: 'F7F5F0' } : undefined,
  margins: { top: 80, bottom: 80, left: 100, right: 100 },
  borders,
})
const heading = (text: string) => new Paragraph({ spacing: { after: 120 }, children: [t(text, { bold: true, size: 18, color: INDIGO })] })
const sub = (text: string) => new Paragraph({ spacing: { after: 240 }, children: [t(text, { size: 10, color: MID })] })

/** A starter .docx laid out like SiteIQ's own page, with every placeholder
 *  in place, for a firm to restyle. */
export async function starterTemplate(kind: CloseoutTemplateKind): Promise<Buffer> {
  const children: (Paragraph | Table)[] = []
  if (kind === 'summary') {
    children.push(heading('Construction monitoring summary'), sub('{{project_name}}'))
    const rows: [string, string][] = [
      ['Project', '{{project_name}}'], ['Job number', '{{job_number}}'], ['Address', '{{address}}'], ['Client', '{{client}}'],
      ['Building consent', '{{consent_no}} {{amendment_no}}'], ['Building consent authority', '{{council}}'],
      ['Monitoring level', '{{monitoring_level}}'], ['Monitoring period', '{{period_start}} to {{period_end}}'],
      ['Site visits', '{{visit_count}} site reports'], ['Engineers', '{{engineers}}'], ['Inspected', '{{inspected}}'],
      ['Site notes', '{{notes_raised}} raised, {{notes_closed}} closed, {{notes_open}} open'],
      ['Design', '{{design_firm}}, {{designer}}, PS1 dated {{ps1_date}}'], ['PS4 author', '{{ps4_author}}, CPEng {{ps4_author_cpeng}}'],
    ]
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: rows.map(([k, v]) => new TableRow({ children: [cell(k, { bold: true, width: 32 }), cell(v, { width: 68 })] })) }))
    children.push(new Paragraph({ spacing: { before: 360, after: 120 }, children: [t('Site reports', { bold: true, size: 12, color: INDIGO })] }))
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ tableHeader: true, children: [cell('REPORT', { head: true, width: 14 }), cell('VISIT', { head: true, width: 20 }), cell('PURPOSE', { head: true, width: 44 }), cell('ENGINEER', { head: true, width: 22 })] }),
        new TableRow({ children: [cell('{{#reports}}{{report}}'), cell('{{visit_date}}'), cell('{{purpose}}'), cell('{{engineer}}{{/reports}}')] }),
      ],
    }))
  } else {
    children.push(heading('Site notes closed register'), sub('{{project_name}} · {{notes_closed}} of {{notes_raised}} site notes closed'))
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ tableHeader: true, children: [
          cell('NOTE', { head: true, width: 8 }), cell('ITEM', { head: true, width: 26 }), cell('RAISED IN', { head: true, width: 20 }),
          cell('STATUS', { head: true, width: 9 }), cell('CLOSED', { head: true, width: 14 }), cell('HOW IT WAS CLOSED', { head: true, width: 23 }),
        ] }),
        new TableRow({ children: [
          cell('{{#notes}}{{ref}}'), cell('{{location}}: {{item}}'), cell('{{raised_in}}'), cell('{{status}}'), cell('{{closed_date}}'), cell('{{how_closed}}{{/notes}}'),
        ] }),
      ],
    }))
  }
  children.push(new Paragraph({ spacing: { before: 240 }, alignment: AlignmentType.LEFT, children: [t('{{firm_name}} · {{date}}', { size: 8, color: MID })] }))

  const doc = new Document({
    creator: 'SiteIQ',
    title: CLOSEOUT_PLACEHOLDERS[kind].title,
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children }],
  })
  return Buffer.from(await Packer.toBuffer(doc))
}
