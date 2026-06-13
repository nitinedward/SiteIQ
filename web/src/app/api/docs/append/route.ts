import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs/promises'
import * as path from 'path'
import AdmZip from 'adm-zip'
import { xmlEscape } from '@/lib/templateProcessor'

// NOTE: /tmp is ephemeral on Vercel serverless.
// Documents may not persist between requests.
// TODO: move to Supabase storage for production.
const DOCS_DIR = path.join('/tmp', 'siteiq-docs-cache')

const REL_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'

type PhotoInput   = { url: string; zoneLabel: string }
type DrawingInput = { title: string; number: string; revision?: string; dataUrl?: string; pngBase64?: string }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders })
}

function getMaxRId(relsXml: string): number {
  let max = 0
  for (const m of relsXml.matchAll(/Id="rId(\d+)"/g)) {
    const n = parseInt(m[1], 10)
    if (n > max) max = n
  }
  return max
}

function addRelEntries(
  relsXml: string,
  entries: { id: string; type: string; target: string }[]
): string {
  const lines = entries.map(e =>
    `  <Relationship Id="${e.id}" Type="${e.type}" Target="${e.target}"/>`
  ).join('\n')
  return relsXml.replace('</Relationships>', `${lines}\n</Relationships>`)
}

/** Full-width inline image for drawings (A3 landscape proportions). */
function buildDrawingImageXml(rId: string, docPrId: number): string {
  const w = 5400000 // ~15cm
  const h = 3827160 // ~10.6cm (A3 landscape ~1.41 ratio)
  return buildInlineImage(rId, docPrId, w, h)
}

/** Inline image XML — no surrounding <w:p>, just the <w:drawing> element. */
function buildInlineImage(rId: string, docPrId: number, cx: number, cy: number): string {
  return (
    `<w:drawing>` +
    `<wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="${docPrId}" name="img${docPrId}"/>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="${docPrId}" name="img${docPrId}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic>` +
    `</wp:inline></w:drawing>`
  )
}

const NO_BORDERS = (
  `<w:tcBorders>` +
  `<w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>` +
  `<w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>` +
  `<w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>` +
  `<w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>` +
  `</w:tcBorders>`
)

/** Build a 3-column table row with 2 photos side by side and a gap column. */
function buildPhotoTableRow(
  leftRId: string, leftDocPr: number,
  rightRId: string | null, rightDocPr: number
): string {
  const photoW = 2700000 // ~7.5cm
  const photoH = 2016000 // ~5.6cm (4:3 landscape)

  const buildCell = (rId: string | null, docPr: number, colW: number) => {
    if (!rId) {
      return `<w:tc><w:tcPr><w:tcW w:w="${colW}" w:type="dxa"/>${NO_BORDERS}</w:tcPr><w:p/></w:tc>`
    }
    return (
      `<w:tc><w:tcPr><w:tcW w:w="${colW}" w:type="dxa"/>${NO_BORDERS}</w:tcPr>` +
      `<w:p><w:r>${buildInlineImage(rId, docPr, photoW, photoH)}</w:r></w:p>` +
      `</w:tc>`
    )
  }

  return (
    `<w:tbl>` +
    `<w:tblPr>` +
    `<w:tblW w:w="9160" w:type="dxa"/>` +
    `<w:tblBorders>` +
    `<w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>` +
    `<w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>` +
    `<w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>` +
    `<w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>` +
    `<w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>` +
    `<w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>` +
    `</w:tblBorders>` +
    `</w:tblPr>` +
    `<w:tblGrid>` +
    `<w:gridCol w:w="4480"/><w:gridCol w:w="200"/><w:gridCol w:w="4480"/>` +
    `</w:tblGrid>` +
    `<w:tr>` +
    buildCell(leftRId, leftDocPr, 4480) +
    `<w:tc><w:tcPr><w:tcW w:w="200" w:type="dxa"/>${NO_BORDERS}</w:tcPr><w:p/></w:tc>` +
    buildCell(rightRId, rightDocPr, 4480) +
    `</w:tr></w:tbl>` +
    `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr></w:p>`
  )
}

function sectionHeading(text: string): string {
  return (
    `<w:p><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>` +
    `<w:r><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>` +
    `<w:t>${xmlEscape(text)}</w:t></w:r></w:p>`
  )
}

function subHeading(text: string): string {
  return (
    `<w:p><w:pPr><w:spacing w:before="160" w:after="60"/></w:pPr>` +
    `<w:r><w:rPr><w:b/><w:color w:val="2C5282"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>` +
    `<w:t>${xmlEscape(text)}</w:t></w:r></w:p>`
  )
}

function refLine(text: string): string {
  return (
    `<w:p><w:pPr><w:spacing w:after="60"/></w:pPr>` +
    `<w:r><w:rPr><w:i/><w:color w:val="9B968D"/><w:sz w:val="18"/></w:rPr>` +
    `<w:t>${xmlEscape(text)}</w:t></w:r></w:p>`
  )
}

const PAGE_BREAK = `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      inspectionId,
      photos   = [] as PhotoInput[],
      drawings = [] as DrawingInput[],
    } = body

    if (!inspectionId) {
      return NextResponse.json({ error: 'Missing inspectionId' }, { status: 400, headers: corsHeaders })
    }

    const docPath = path.join(DOCS_DIR, `${inspectionId}.docx`)
    console.log('[append] Loading:', docPath)
    let docBuffer: Buffer
    try {
      docBuffer = await fs.readFile(docPath)
    } catch {
      return NextResponse.json(
        { error: 'Document not found. Generate the report first.' },
        { status: 404, headers: corsHeaders }
      )
    }

    const validPhotos   = (photos   as PhotoInput[]).filter(p => p?.url)
    const validDrawings = (drawings as DrawingInput[]).filter(d => d?.dataUrl || d?.pngBase64)

    if (validPhotos.length === 0 && validDrawings.length === 0) {
      return NextResponse.json(
        { success: true, photosAdded: 0, drawingsAdded: 0 },
        { headers: corsHeaders }
      )
    }

    const zip = new AdmZip(docBuffer)

    // ── Relationships file ───────────────────────────────────────────────────
    const relsPath  = 'word/_rels/document.xml.rels'
    const relsEntry = zip.getEntry(relsPath)
    if (!relsEntry) {
      return NextResponse.json({ error: 'Invalid document structure' }, { status: 500, headers: corsHeaders })
    }
    let relsXml = relsEntry.getData().toString('utf-8')
    let nextRId = getMaxRId(relsXml) + 1

    // ── Content-Types: ensure PNG and JPEG are registered ───────────────────
    const ctEntry = zip.getEntry('[Content_Types].xml')
    if (ctEntry) {
      let ctXml = ctEntry.getData().toString('utf-8')
      let ctChanged = false
      if (!ctXml.includes('Extension="png"')) {
        ctXml = ctXml.replace('</Types>', '  <Default Extension="png" ContentType="image/png"/>\n</Types>')
        ctChanged = true
      }
      if (!ctXml.includes('Extension="jpg"')) {
        ctXml = ctXml.replace('</Types>', '  <Default Extension="jpg" ContentType="image/jpeg"/>\n</Types>')
        ctChanged = true
      }
      if (!ctXml.includes('Extension="jpeg"')) {
        ctXml = ctXml.replace('</Types>', '  <Default Extension="jpeg" ContentType="image/jpeg"/>\n</Types>')
        ctChanged = true
      }
      if (ctChanged) zip.updateFile('[Content_Types].xml', Buffer.from(ctXml, 'utf-8'))
    }

    const newRels: { id: string; type: string; target: string }[] = []
    let appendXml = ''

    // docPr IDs must be unique across the document; start high to avoid collisions
    let docPrId = 500

    // ── STRUCTURAL DRAWINGS section ──────────────────────────────────────────
    if (validDrawings.length > 0) {
      appendXml += PAGE_BREAK + sectionHeading('STRUCTURAL DRAWINGS')

      validDrawings.forEach((drawing, i) => {
        const base64Match = (drawing.pngBase64 || drawing.dataUrl || '').match(/^data:image\/\w+;base64,(.+)$/)
        if (!base64Match) {
          console.warn(`[append] Drawing "${drawing.title}" has bad dataUrl — skipping`)
          return
        }

        const imgBuffer = Buffer.from(base64Match[1], 'base64')
        const mediaName = `appendDrawing${i + 1}.png`
        zip.addFile(`word/media/${mediaName}`, imgBuffer)

        const rId = `rId${nextRId++}`
        newRels.push({ id: rId, type: REL_IMAGE, target: `media/${mediaName}` })

        const safeRef = `Ref: ${drawing.number || '—'} · Rev ${drawing.revision || 'A'}`
        appendXml += subHeading(drawing.title || 'Untitled Drawing')
        appendXml += refLine(safeRef)
        appendXml += `<w:p><w:r>${buildDrawingImageXml(rId, docPrId++)}</w:r></w:p>`
      })
    }

    // ── SITE PHOTOGRAPHS section ─────────────────────────────────────────────
    if (validPhotos.length > 0) {
      appendXml += PAGE_BREAK + sectionHeading('SITE PHOTOGRAPHS')

      // Group by zone
      const byZone: Record<string, PhotoInput[]> = {}
      validPhotos.forEach(p => {
        const k = p.zoneLabel || 'General Observation'
        if (!byZone[k]) byZone[k] = []
        byZone[k].push(p)
      })

      for (const [zone, zonePhotos] of Object.entries(byZone)) {
        appendXml += subHeading(zone)

        let photoCount = 0

        for (let i = 0; i < zonePhotos.length; i += 2) {
          if (photoCount > 0 && photoCount % 6 === 0) {
            appendXml += PAGE_BREAK
          }

          const leftPhoto  = zonePhotos[i]
          const rightPhoto = zonePhotos[i + 1] ?? null

          // Fetch and embed left photo
          let leftRId = ''
          try {
            console.log('[append] Fetching photo:', leftPhoto.url)
            const res = await fetch(leftPhoto.url)
            if (res.ok) {
              const buf  = Buffer.from(await res.arrayBuffer())
              console.log('[append] Photo size:', buf.byteLength)
              const ext  = leftPhoto.url.toLowerCase().includes('.png') ? 'png' : 'jpg'
              const name = `photo_${nextRId}.${ext}`
              zip.addFile(`word/media/${name}`, buf)
              leftRId = `rId${nextRId}`
              newRels.push({ id: leftRId, type: REL_IMAGE, target: `media/${name}` })
              nextRId++
            }
          } catch (err) {
            console.error(`[append] Failed to fetch photo: ${leftPhoto.url}`, err)
          }

          // Fetch and embed right photo
          let rightRId: string | null = null
          if (rightPhoto) {
            try {
              const res = await fetch(rightPhoto.url)
              if (res.ok) {
                const buf  = Buffer.from(await res.arrayBuffer())
                const ext  = rightPhoto.url.toLowerCase().includes('.png') ? 'png' : 'jpg'
                const name = `photo_${nextRId}.${ext}`
                zip.addFile(`word/media/${name}`, buf)
                rightRId = `rId${nextRId}`
                newRels.push({ id: rightRId, type: REL_IMAGE, target: `media/${name}` })
                nextRId++
              }
            } catch (err) {
              console.error(`[append] Failed to fetch photo: ${rightPhoto.url}`, err)
            }
          }

          if (leftRId || rightRId) {
            appendXml += buildPhotoTableRow(leftRId, docPrId++, rightRId, docPrId++)
          }

          photoCount += rightPhoto ? 2 : 1
        }
      }
    }

    // ── Apply relationships ──────────────────────────────────────────────────
    if (newRels.length > 0) {
      relsXml = addRelEntries(relsXml, newRels)
      zip.updateFile(relsPath, Buffer.from(relsXml, 'utf-8'))
    }

    // ── Append content to document.xml ───────────────────────────────────────
    const docEntry = zip.getEntry('word/document.xml')
    if (docEntry) {
      let docXml = docEntry.getData().toString('utf-8')
      docXml = docXml.replace('</w:body>', `${appendXml}</w:body>`)
      zip.updateFile('word/document.xml', Buffer.from(docXml, 'utf-8'))
    }

    zip.writeZip(docPath)
    console.log(`[append] Saved, photos: ${validPhotos.length}, drawings: ${validDrawings.length}`)

    return NextResponse.json(
      { success: true, photosAdded: validPhotos.length, drawingsAdded: validDrawings.length },
      { headers: corsHeaders }
    )
  } catch (err: any) {
    console.error('[append] error:', err)
    return NextResponse.json({ error: err.message || 'Failed to append attachments' }, { status: 500, headers: corsHeaders })
  }
}
