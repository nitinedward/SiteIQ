import {
  Document, Packer, Paragraph, TextRun,
  Table, TableRow, TableCell, ImageRun,
  PageBreak, HeadingLevel, AlignmentType,
  BorderStyle, WidthType, VerticalAlign,
  UnderlineType,
} from 'docx'
import {
  getImageDimensions,
  DRAWING_WIDTH_MM, DRAWING_MAX_HEIGHT_MM,
  PHOTO_WIDTH_MM, PHOTO_MAX_HEIGHT_MM,
} from './docxSizing'

// DXA unit helpers (1 inch = 1440 DXA, 1 mm ≈ 56.69 DXA)
const MM_TO_DXA = 1440 / 25.4
const toTwips = (mm: number) => Math.round(mm * MM_TO_DXA)

const PAGE_W_DXA  = toTwips(163)
const PHOTO_W_DXA = toTwips(PHOTO_WIDTH_MM)
const GAP_W_DXA   = toTwips(7)

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } as const
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER }

function detectImageType(buffer: ArrayBuffer): 'png' | 'jpg' {
  const bytes = new Uint8Array(buffer.slice(0, 4))
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png'
  return 'jpg'
}

export type AttachedPhoto = {
  url: string
  buffer: ArrayBuffer
  zoneLabel: string
  naturalWidth: number
  naturalHeight: number
}

export type AttachedDrawing = {
  title: string
  number: string
  revision: string
  buffer: ArrayBuffer
  naturalWidth: number
  naturalHeight: number
}

// ── BUILD PHOTO TABLE ──────────────────────────────────────────────────────────
function buildPhotoTable(photos: AttachedPhoto[]): Table[] {
  const tables: Table[] = []

  // Split into groups of 6 (one page worth)
  const pageGroups: AttachedPhoto[][] = []
  for (let i = 0; i < photos.length; i += 6) {
    pageGroups.push(photos.slice(i, i + 6))
  }

  pageGroups.forEach((group, groupIndex) => {
    const rows: TableRow[] = []

    for (let i = 0; i < group.length; i += 2) {
      const leftPhoto  = group[i]
      const rightPhoto = group[i + 1] || null

      const leftDims = getImageDimensions(
        leftPhoto.naturalWidth, leftPhoto.naturalHeight,
        PHOTO_WIDTH_MM, PHOTO_MAX_HEIGHT_MM
      )
      const rightDims = rightPhoto ? getImageDimensions(
        rightPhoto.naturalWidth, rightPhoto.naturalHeight,
        PHOTO_WIDTH_MM, PHOTO_MAX_HEIGHT_MM
      ) : null

      rows.push(
        new TableRow({
          children: [
            new TableCell({
              width: { size: PHOTO_W_DXA, type: WidthType.DXA },
              verticalAlign: VerticalAlign.TOP,
              borders: NO_BORDERS,
              children: [
                new Paragraph({
                  children: [
                    new ImageRun({
                      data: leftPhoto.buffer,
                      transformation: { width: leftDims.widthEmu, height: leftDims.heightEmu },
                      type: detectImageType(leftPhoto.buffer),
                    }),
                  ],
                  spacing: { after: 120 },
                }),
              ],
            }),
            // Gap cell
            new TableCell({
              width: { size: GAP_W_DXA, type: WidthType.DXA },
              borders: NO_BORDERS,
              children: [new Paragraph({ children: [] })],
            }),
            new TableCell({
              width: { size: PHOTO_W_DXA, type: WidthType.DXA },
              verticalAlign: VerticalAlign.TOP,
              borders: NO_BORDERS,
              children: rightPhoto && rightDims ? [
                new Paragraph({
                  children: [
                    new ImageRun({
                      data: rightPhoto.buffer,
                      transformation: { width: rightDims.widthEmu, height: rightDims.heightEmu },
                      type: detectImageType(rightPhoto.buffer),
                    }),
                  ],
                  spacing: { after: 120 },
                }),
              ] : [new Paragraph({ children: [] })],
            }),
          ],
        })
      )
    }

    tables.push(
      new Table({
        width: { size: PAGE_W_DXA, type: WidthType.DXA },
        rows,
      })
    )

    // Page break after each group except the last
    if (groupIndex < pageGroups.length - 1) {
      tables.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  borders: NO_BORDERS,
                  children: [new Paragraph({ children: [new PageBreak()] })],
                }),
              ],
            }),
          ],
        })
      )
    }
  })

  return tables
}

// ── STRUCTURAL DRAWINGS SECTION ───────────────────────────────────────────────
function buildDrawingsSection(drawings: AttachedDrawing[]): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = []

  elements.push(
    new Paragraph({
      text: 'STRUCTURAL DRAWINGS',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 240, after: 120 },
    })
  )

  drawings.forEach((drawing, index) => {
    const dims = getImageDimensions(
      drawing.naturalWidth, drawing.naturalHeight,
      DRAWING_WIDTH_MM, DRAWING_MAX_HEIGHT_MM
    )

    elements.push(
      new Paragraph({
        text: drawing.title,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 60 },
      })
    )
    elements.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Ref: ${drawing.number}   Rev: ${drawing.revision}`,
            size: 18,
            color: '9b968d',
            italics: true,
          }),
        ],
        spacing: { before: 0, after: 120 },
      })
    )
    elements.push(
      new Paragraph({
        children: [
          new ImageRun({
            data: drawing.buffer,
            transformation: { width: dims.widthEmu, height: dims.heightEmu },
            type: 'png',
          }),
        ],
        spacing: { after: 240 },
      })
    )

    if (index < drawings.length - 1) {
      elements.push(new Paragraph({ children: [new PageBreak()] }))
    }
  })

  return elements
}

// ── SITE PHOTOGRAPHS SECTION ──────────────────────────────────────────────────
function buildPhotographsSection(
  photosByZone: Record<string, AttachedPhoto[]>
): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = []

  elements.push(
    new Paragraph({
      text: 'SITE PHOTOGRAPHS',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 240, after: 120 },
    })
  )

  Object.entries(photosByZone).forEach(([zoneLabel, photos]) => {
    elements.push(
      new Paragraph({
        text: zoneLabel,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
      })
    )
    elements.push(...buildPhotoTable(photos))
  })

  return elements
}

// ── HTML → DOCX PARAGRAPHS ────────────────────────────────────────────────────
function processInlineNodes(
  el: Element,
  bold = false,
  italic = false,
  underline = false
): TextRun[] {
  const runs: TextRun[] = []
  el.childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || ''
      if (text) {
        runs.push(new TextRun({
          text,
          bold: bold || undefined,
          italics: italic || undefined,
          underline: underline ? { type: UnderlineType.SINGLE } : undefined,
        }))
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const child = node as Element
      const tag   = child.tagName.toLowerCase()
      runs.push(...processInlineNodes(
        child,
        bold    || tag === 'strong' || tag === 'b',
        italic  || tag === 'em'     || tag === 'i',
        underline || tag === 'u'
      ))
    }
  })
  return runs
}

function htmlToParagraphs(html: string): Paragraph[] {
  if (typeof document === 'undefined') return []
  const parser = new DOMParser()
  const doc    = parser.parseFromString(html, 'text/html')
  const result: Paragraph[] = []

  Array.from(doc.body.children).forEach(el => {
    const tag = el.tagName.toLowerCase()

    if (tag === 'h1') {
      result.push(new Paragraph({ text: el.textContent || '', heading: HeadingLevel.HEADING_1, spacing: { before: 280, after: 120 } }))
    } else if (tag === 'h2') {
      result.push(new Paragraph({ text: el.textContent || '', heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 } }))
    } else if (tag === 'h3') {
      result.push(new Paragraph({ text: el.textContent || '', heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 60 } }))
    } else if (tag === 'p') {
      const runs = processInlineNodes(el)
      result.push(new Paragraph({
        children: runs.length > 0 ? runs : [new TextRun({ text: el.textContent || '' })],
        spacing: { before: 0, after: 80 },
      }))
    } else if (tag === 'ul') {
      Array.from(el.querySelectorAll(':scope > li')).forEach(li => {
        result.push(new Paragraph({
          children: processInlineNodes(li),
          bullet: { level: 0 },
          spacing: { before: 0, after: 40 },
        }))
      })
    } else if (tag === 'ol') {
      Array.from(el.querySelectorAll(':scope > li')).forEach((li, idx) => {
        result.push(new Paragraph({
          children: [
            new TextRun({ text: `${idx + 1}. ` }),
            ...processInlineNodes(li),
          ],
          indent: { left: 360 },
          spacing: { before: 0, after: 40 },
        }))
      })
    } else if (tag === 'blockquote') {
      result.push(new Paragraph({
        children: processInlineNodes(el),
        indent: { left: 720 },
        spacing: { before: 80, after: 80 },
      }))
    }
  })

  return result
}

// ── HEADER TABLE ──────────────────────────────────────────────────────────────
const CELL_BORDER = { style: BorderStyle.SINGLE, size: 1, color: '000000' } as const
const CELL_BORDERS = { top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER }
const toTwipsCols = (pct: number) => Math.round(PAGE_W_DXA * pct)

function headerCell(text: string, bold = false, width = 0.17): TableCell {
  return new TableCell({
    width: { size: toTwipsCols(width), type: WidthType.DXA },
    borders: CELL_BORDERS,
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold, size: 20 })],
        spacing: { before: 40, after: 40 },
      }),
    ],
  })
}

function buildHeaderTable(data: TemplateData): Table {
  return new Table({
    width: { size: PAGE_W_DXA, type: WidthType.DXA },
    rows: [
      new TableRow({ children: [
        headerCell('Job:', true),
        headerCell(data.project_name, false, 0.33),
        headerCell('Job No:', true),
        headerCell(data.report_no, false, 0.33),
      ]}),
      new TableRow({ children: [
        headerCell('Date:', true),
        headerCell(data.date, false, 0.33),
        headerCell('Inspected by:', true),
        headerCell(data.engineer_name, false, 0.33),
      ]}),
      new TableRow({ children: [
        headerCell('Weather:', true),
        headerCell(data.weather, false, 0.33),
        headerCell('Site contact:', true),
        headerCell(data.site_contact, false, 0.33),
      ]}),
      new TableRow({ children: [
        headerCell('Report No:', true),
        headerCell(data.report_no, false, 0.33),
        headerCell('Phone:', true),
        headerCell(data.contact_phone, false, 0.33),
      ]}),
      new TableRow({ children: [
        headerCell('Drawings:', true),
        new TableCell({
          width: { size: toTwipsCols(0.83), type: WidthType.DXA },
          columnSpan: 3,
          borders: CELL_BORDERS,
          children: [new Paragraph({ children: [new TextRun({ text: data.drawings, size: 20 })] })],
        }),
      ]}),
    ],
  })
}

// ── MAIN GENERATE FUNCTION ────────────────────────────────────────────────────
export async function generateReport(
  _inspectionData: unknown,
  _observationsData: unknown[],
  templateData: TemplateData | null,
  editorHtml: string,
  attachedDrawings: AttachedDrawing[] = [],
  attachedPhotos: AttachedPhoto[] = [],
): Promise<Blob> {
  const margin = toTwips(23.5)

  const children: (Paragraph | Table)[] = []

  // Report title
  children.push(
    new Paragraph({
      children: [new TextRun({ text: 'SITE INSPECTION REPORT', bold: true, size: 40, color: '2c5282' })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 200 },
    })
  )

  // Header table
  if (templateData) {
    children.push(buildHeaderTable(templateData))
    children.push(new Paragraph({ children: [], spacing: { before: 240, after: 0 } }))
  }

  // Editor HTML content
  const contentParagraphs = htmlToParagraphs(editorHtml)
  children.push(...contentParagraphs)

  // Drawings appendix
  if (attachedDrawings.length > 0) {
    children.push(new Paragraph({ children: [new PageBreak()] }))
    children.push(...buildDrawingsSection(attachedDrawings))
  }

  // Photos appendix
  if (attachedPhotos.length > 0) {
    children.push(new Paragraph({ children: [new PageBreak()] }))
    const photosByZone = attachedPhotos.reduce(
      (acc, p) => {
        if (!acc[p.zoneLabel]) acc[p.zoneLabel] = []
        acc[p.zoneLabel].push(p)
        return acc
      },
      {} as Record<string, AttachedPhoto[]>
    )
    children.push(...buildPhotographsSection(photosByZone))
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: margin, right: margin, bottom: margin, left: margin },
        },
      },
      children,
    }],
  })

  return Packer.toBlob(doc)
}

export type TemplateData = {
  project_name: string
  report_no: string
  client_name: string
  client_email: string
  date: string
  engineer_name: string
  weather: string
  emailed_to: string
  site_contact: string
  contact_phone: string
  drawings: string
  purpose: string
  findings: string
  recommendations: string
  health_safety: string
  other_activity: string
  next_inspection: string
  firm_name: string
}

// Convert text to HTML — lines starting with "- " become bullet list
function toHtml(text: string, fallback: string): string {
  if (!text || !text.trim()) return '<p>' + fallback + '</p>'
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  const result: string[] = []
  let inList = false

  for (const line of lines) {
    if (line.startsWith('- ') || line.startsWith('• ')) {
      if (!inList) { result.push('<ul>'); inList = true }
      result.push('<li>' + line.replace(/^[-•]\s+/, '') + '</li>')
    } else {
      if (inList) { result.push('</ul>'); inList = false }
      result.push('<p>' + line + '</p>')
    }
  }
  if (inList) result.push('</ul>')
  return result.join('\n')
}

export function buildInitialContent(data: TemplateData): string {
  const lines: string[] = []

  lines.push('<h2>Purpose of inspection</h2>')
  lines.push(toHtml(data.purpose, 'Enter purpose of inspection...'))

  lines.push('<h2>Observations/Comments</h2>')
  lines.push(toHtml(data.findings, 'Enter observations and comments...'))

  lines.push('<h2>Contractor to provide (prior to next inspection)</h2>')
  lines.push(toHtml(data.recommendations, 'Enter items contractor must provide...'))

  lines.push('<h2>Health and safety</h2>')
  lines.push(toHtml(data.health_safety, 'Record any health and safety observations here. If none, state nothing to note.'))

  lines.push('<h2>Other activity on site</h2>')
  lines.push('<p><em>Noted but did not inspect:</em></p>')
  lines.push(toHtml(data.other_activity, 'Nothing to note.'))

  lines.push('<h2>Next anticipated inspection</h2>')
  lines.push(toHtml(data.next_inspection, 'To be confirmed.'))

  lines.push('<p><em>Contractor to confirm time and date for next inspection 48 hours in advance. This review has been completed for a sample only of the structural elements to ensure the design intent is being met and does not relieve the contractor of overall QA responsibilities.</em></p>')

  return lines.join('\n')
}

export const EDITOR_STYLES = [
  '.tiptap-editor .ProseMirror {',
  '  outline: none !important;',
  '  padding: 12px 48px 48px 48px !important;',
  '  min-height: 400px;',
  '  font-family: "Calibri Light", Calibri, Arial, sans-serif !important;',
  '  font-size: 11pt !important;',
  '  line-height: 1.5 !important;',
  '  color: #000 !important;',
  '  background: #fff !important;',
  '}',
  '.tiptap-editor .ProseMirror h1 {',
  '  font-size: 18pt !important; font-weight: bold !important; margin: 16pt 0 6pt 0 !important;',
  '}',
  '.tiptap-editor .ProseMirror h2 {',
  '  font-size: 12pt !important;',
  '  font-weight: bold !important;',
  '  color: #000 !important;',
  '  text-transform: uppercase !important;',
  '  margin: 14pt 0 4pt 0 !important;',
  '  padding: 0 !important;',
  '  border: none !important;',
  '  background: none !important;',
  '  font-family: "Calibri Light", Calibri, Arial, sans-serif !important;',
  '  line-height: 1.3 !important;',
  '}',
  '.tiptap-editor .ProseMirror h3 {',
  '  font-size: 11pt !important; font-weight: bold !important; margin: 10pt 0 3pt 0 !important;',
  '}',
  '.tiptap-editor .ProseMirror p {',
  '  margin: 0 0 6px 0 !important;',
  '  font-size: 11pt !important;',
  '  line-height: 1.5 !important;',
  '  color: #000 !important;',
  '  font-family: "Calibri Light", Calibri, Arial, sans-serif !important;',
  '}',
  '.tiptap-editor .ProseMirror em { font-style: italic !important; }',
  '.tiptap-editor .ProseMirror strong { font-weight: bold !important; }',
  '.tiptap-editor .ProseMirror u { text-decoration: underline !important; }',
  '.tiptap-editor .ProseMirror ul {',
  '  list-style-type: disc !important;',
  '  margin: 2px 0 8px 28px !important;',
  '  padding: 0 !important;',
  '}',
  '.tiptap-editor .ProseMirror ol {',
  '  list-style-type: decimal !important;',
  '  margin: 2px 0 8px 28px !important;',
  '  padding: 0 !important;',
  '}',
  '.tiptap-editor .ProseMirror li {',
  '  display: list-item !important;',
  '  margin-bottom: 3px !important;',
  '  font-size: 11pt !important;',
  '  color: #000 !important;',
  '  line-height: 1.5 !important;',
  '  font-family: "Calibri Light", Calibri, Arial, sans-serif !important;',
  '}',
  '.tiptap-editor .ProseMirror img {',
  '  max-width: 100% !important; height: auto !important; margin: 8px 0 !important;',
  '}',
  '.tiptap-editor .ProseMirror img.ProseMirror-selectednode { outline: 2px solid #2563eb !important; }',
  '.tiptap-editor .ProseMirror p.is-editor-empty:first-child::before {',
  "  content: 'Click ✦ Generate AI Report to populate the report...' !important;",
  '  color: #94a3b8 !important; pointer-events: none !important; float: left !important; height: 0 !important;',
  '}',
  '/* Highlight */',
  '.tiptap-editor .ProseMirror mark { background-color: #fef08a !important; }',
].join('\n')

export function REPORT_HEADER_HTML(_name: string): string { return '' }