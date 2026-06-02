import {
  Document, Packer, Paragraph, TextRun,
  Table, TableRow, TableCell, ImageRun,
  HeadingLevel, AlignmentType,
  BorderStyle, WidthType,
} from 'docx'

const MM_TO_DXA = 1440 / 25.4
const toTwips   = (mm: number) => Math.round(mm * MM_TO_DXA)
const PAGE_W_DXA = toTwips(163)

const CELL_BORDER  = { style: BorderStyle.SINGLE, size: 1, color: '000000' } as const
const CELL_BORDERS = { top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER }
const toTwipsCols  = (pct: number) => Math.round(PAGE_W_DXA * pct)

function hCell(text: string, bold = false, width = 0.17): TableCell {
  return new TableCell({
    width: { size: toTwipsCols(width), type: WidthType.DXA },
    borders: CELL_BORDERS,
    children: [
      new Paragraph({
        children: [new TextRun({ text: text ?? '', bold, size: 20 })],
        spacing: { before: 40, after: 40 },
      }),
    ],
  })
}

function buildHeaderTable(data: {
  project_name: string; report_no: string; date: string
  weather: string; site_contact: string; contact_phone: string
}): Table {
  return new Table({
    width: { size: PAGE_W_DXA, type: WidthType.DXA },
    rows: [
      new TableRow({ children: [
        hCell('Job:',        true),
        hCell(data.project_name, false, 0.33),
        hCell('Job No:',     true),
        hCell(data.report_no,    false, 0.33),
      ]}),
      new TableRow({ children: [
        hCell('Date:',       true),
        hCell(data.date,     false, 0.33),
        hCell('Weather:',    true),
        hCell(data.weather,  false, 0.33),
      ]}),
      new TableRow({ children: [
        hCell('Site Contact:', true),
        hCell(data.site_contact, false, 0.33),
        hCell('Phone:',        true),
        hCell(data.contact_phone, false, 0.33),
      ]}),
    ],
  })
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 24 })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 120 },
  })
}

function bodyPara(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text })],
    spacing: { before: 0, after: 80 },
  })
}

function bulletPara(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text })],
    bullet: { level: 0 },
    spacing: { before: 0, after: 60 },
  })
}

/** Parse AI plain-text into paragraphs (lines in ALL CAPS become headings, "- " lines become bullets) */
function aiTextToParagraphs(text: string): Paragraph[] {
  const paras: Paragraph[] = []
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  for (const line of lines) {
    if (line === line.toUpperCase() && line.length > 5 && /^[A-Z\s/()]+$/.test(line)) {
      paras.push(sectionHeading(line))
    } else if (line.startsWith('- ') || line.startsWith('• ')) {
      paras.push(bulletPara(line.replace(/^[-•]\s+/, '')))
    } else {
      paras.push(bodyPara(line))
    }
  }
  return paras
}

export interface PhotoAttachment {
  url: string
  zoneLabel: string
  buffer?: Buffer
}

export async function generateServerReport(
  inspection: any,
  observations: any[],
  aiText?: string,
  photos: PhotoAttachment[] = [],
): Promise<Buffer> {
  const margin   = toTwips(23.5)
  const projects = inspection.projects ?? {}
  const children: (Paragraph | Table)[] = []

  // Title
  children.push(
    new Paragraph({
      children: [new TextRun({ text: 'SITE INSPECTION REPORT', bold: true, size: 40, color: '2c5282' })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 200 },
    })
  )

  // Header table
  children.push(buildHeaderTable({
    project_name:  projects.name       ?? '',
    report_no:     inspection.report_no ?? '',
    date:          inspection.date      ?? '',
    weather:       inspection.weather   ?? '',
    site_contact:  inspection.site_contact ?? '',
    contact_phone: inspection.contact_phone ?? '',
  }))
  children.push(new Paragraph({ children: [], spacing: { before: 240, after: 0 } }))

  if (aiText) {
    children.push(...aiTextToParagraphs(aiText))
  } else {
    // Purpose
    children.push(sectionHeading('PURPOSE OF INSPECTION'))
    children.push(bodyPara(inspection.purpose || ''))

    // Observations by zone
    children.push(sectionHeading('WORKS OBSERVED / OBSERVATIONS'))
    if (observations.length === 0) {
      children.push(bodyPara('No observations recorded.'))
    } else {
      const byZone = new Map<string, any[]>()
      for (const ob of observations) {
        const z = ob.zone_label || 'General'
        if (!byZone.has(z)) byZone.set(z, [])
        byZone.get(z)!.push(ob)
      }
      byZone.forEach((obs, zoneLabel) => {
        children.push(new Paragraph({
          children: [new TextRun({ text: zoneLabel, bold: true, size: 22 })],
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 160, after: 80 },
        }))
        for (const ob of obs) {
          const text = ob.transcript || ob.notes || ''
          if (text) {
            const sev = ob.severity ? `[${ob.severity}] ` : ''
            children.push(bulletPara(sev + text))
          }
        }
      })
    }

    for (const heading of [
      'CONTRACTOR TO PROVIDE (PRIOR TO NEXT INSPECTION)',
      'HEALTH AND SAFETY',
      'OTHER ACTIVITY ON SITE',
    ]) {
      children.push(sectionHeading(heading))
      children.push(bodyPara(''))
    }
  }

  // Photos appendix (server-fetched)
  const photosWithBuffers = photos.filter(p => p.buffer)
  if (photosWithBuffers.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'SITE PHOTOGRAPHS', bold: true, size: 36, color: '2c5282' })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 400, after: 200 },
    }))

    const byZone = new Map<string, PhotoAttachment[]>()
    for (const p of photosWithBuffers) {
      if (!byZone.has(p.zoneLabel)) byZone.set(p.zoneLabel, [])
      byZone.get(p.zoneLabel)!.push(p)
    }

    byZone.forEach((zonePhotos, zoneLabel) => {
      children.push(new Paragraph({
        children: [new TextRun({ text: zoneLabel, bold: true, size: 22 })],
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
      }))
      for (const photo of zonePhotos) {
        const buf   = photo.buffer!
        const isJpg = buf[0] === 0xFF && buf[1] === 0xD8
        const W_EMU = 4572000  // ~80mm
        const H_EMU = 3429000  // ~60mm (estimate, adjust if needed)
        children.push(
          new Paragraph({
            children: [
              new ImageRun({
                data: buf,
                transformation: { width: W_EMU, height: H_EMU },
                type: isJpg ? 'jpg' : 'png',
              }),
            ],
            spacing: { after: 180 },
          })
        )
      }
    })
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: { margin: { top: margin, right: margin, bottom: margin, left: margin } },
      },
      children,
    }],
  })

  return Packer.toBuffer(doc)
}
