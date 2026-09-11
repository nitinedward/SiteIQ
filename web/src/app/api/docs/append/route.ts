import { NextRequest, NextResponse } from 'next/server'
import AdmZip from 'adm-zip'
import { xmlEscape } from '@/lib/templateProcessor'
import { saveDoc, loadDoc } from '@/lib/docStorage'
import {
  ALL_SECTIONS,
  LEGACY_SECTION,
  SECTION_DEFS,
  SectionName,
  hasLegacySection,
  isSectionName,
  placeSection,
  removeSections,
  wrapSection,
} from '@/lib/attachmentSections'

const REL_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'

type PhotoInput   = { url: string; zoneLabel: string }
type DrawingInput = {
  title: string; number: string; revision?: string
  // `url` is the normal path — a full-page capture inlined as base64 blows
  // the request body limit. dataUrl/pngBase64 are still accepted so older
  // callers keep working.
  url?: string
  dataUrl?: string; pngBase64?: string
}

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

// Drawings and photos each own a bookmarked section (see
// src/lib/attachmentSections.ts), so one can be rebuilt without disturbing
// the other. A call replaces the sections it was asked for with the CURRENT
// selection rather than only ever adding, so deselecting something and
// re-applying removes it from the document.
//
// `sections` says which to rebuild — omit it to rebuild both, which is what
// the download path wants.

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

    const asked: SectionName[] = Array.isArray(body.sections)
      ? body.sections.filter(isSectionName)
      : ALL_SECTIONS
    let requested: SectionName[] = asked.length > 0 ? asked : ALL_SECTIONS

    console.log('[append] Loading:', inspectionId)
    let docBuffer: Buffer
    try {
      docBuffer = await loadDoc(inspectionId)
    } catch {
      return NextResponse.json(
        { error: 'Document not found. Generate the report first.' },
        { status: 404, headers: corsHeaders }
      )
    }

    const validPhotos   = (photos   as PhotoInput[]).filter(p => p?.url)
    const validDrawings = (drawings as DrawingInput[]).filter(d => d?.url || d?.dataUrl || d?.pngBase64)

    // Resolved up front because the section below is built synchronously.
    // A drawing that can't be resolved yields null and is skipped rather
    // than aborting the whole insert.
    const drawingBuffers: (Buffer | null)[] = await Promise.all(
      validDrawings.map(async (drawing) => {
        if (drawing.url) {
          try {
            const res = await fetch(drawing.url, { cache: 'no-store' })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            return Buffer.from(await res.arrayBuffer())
          } catch (err) {
            console.warn(`[append] Drawing "${drawing.title}" could not be fetched — skipping`, err)
            return null
          }
        }
        const match = (drawing.pngBase64 || drawing.dataUrl || '').match(/^data:image\/\w+;base64,(.+)$/)
        if (!match) {
          console.warn(`[append] Drawing "${drawing.title}" has bad dataUrl — skipping`)
          return null
        }
        return Buffer.from(match[1], 'base64')
      })
    )

    const zip = new AdmZip(docBuffer)

    // ── Relationships file ───────────────────────────────────────────────────
    const relsPath  = 'word/_rels/document.xml.rels'
    const relsEntry = zip.getEntry(relsPath)
    if (!relsEntry) {
      return NextResponse.json({ error: 'Invalid document structure' }, { status: 500, headers: corsHeaders })
    }
    let relsXml = relsEntry.getData().toString('utf-8')

    const docEntry = zip.getEntry('word/document.xml')
    if (!docEntry) {
      return NextResponse.json({ error: 'Invalid document structure' }, { status: 500, headers: corsHeaders })
    }
    let docXml = docEntry.getData().toString('utf-8')

    // A document written before drawings and photos were split carries one
    // combined bookmark that can't be divided after the fact, so the first
    // insert into such a document rebuilds both sections — exactly the
    // behaviour it already had. Afterwards the two are independent.
    const legacy = hasLegacySection(docXml)
    if (legacy) {
      console.log('[append] Legacy combined section found — rebuilding both sections once')
      requested = ALL_SECTIONS
    }

    // Remove the sections being rebuilt (and their images) first. This runs
    // even with an empty selection, so deselecting everything and clicking
    // again clears that section — and only that section.
    const bookmarksToClear = requested.map(s => SECTION_DEFS[s].bookmark)
    if (legacy) bookmarksToClear.push(LEGACY_SECTION.bookmark)
    ;({ docXml, relsXml } = removeSections(docXml, relsXml, zip, bookmarksToClear))

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
    // Built separately so each can be placed in its own bookmark.
    let drawingsXml = ''
    let photosXml   = ''

    // docPr IDs must be unique across the document; start high to avoid collisions
    let docPrId = 500

    // ── STRUCTURAL DRAWINGS section ──────────────────────────────────────────
    if (requested.includes('drawings') && validDrawings.length > 0) {
      drawingsXml += PAGE_BREAK + sectionHeading('STRUCTURAL DRAWINGS')

      validDrawings.forEach((drawing, i) => {
        const imgBuffer = drawingBuffers[i]
        if (!imgBuffer) return

        const mediaName = `appendDrawing${i + 1}.png`
        zip.addFile(`word/media/${mediaName}`, imgBuffer)

        const rId = `rId${nextRId++}`
        newRels.push({ id: rId, type: REL_IMAGE, target: `media/${mediaName}` })

        const safeRef = `Ref: ${drawing.number || '—'} · Rev ${drawing.revision || 'A'}`
        drawingsXml += subHeading(drawing.title || 'Untitled Drawing')
        drawingsXml += refLine(safeRef)
        drawingsXml += `<w:p><w:r>${buildDrawingImageXml(rId, docPrId++)}</w:r></w:p>`
      })
    }

    // ── SITE PHOTOGRAPHS section ─────────────────────────────────────────────
    if (requested.includes('photos') && validPhotos.length > 0) {
      photosXml += PAGE_BREAK + sectionHeading('SITE PHOTOGRAPHS')

      // Group by zone
      const byZone: Record<string, PhotoInput[]> = {}
      validPhotos.forEach(p => {
        const k = p.zoneLabel || 'General Observation'
        if (!byZone[k]) byZone[k] = []
        byZone[k].push(p)
      })

      for (const [zone, zonePhotos] of Object.entries(byZone)) {
        photosXml += subHeading(zone)

        let photoCount = 0

        for (let i = 0; i < zonePhotos.length; i += 2) {
          if (photoCount > 0 && photoCount % 6 === 0) {
            photosXml += PAGE_BREAK
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
            photosXml += buildPhotoTableRow(leftRId, docPrId++, rightRId, docPrId++)
          }

          photoCount += rightPhoto ? 2 : 1
        }
      }
    }

    // ── Apply relationships ──────────────────────────────────────────────────
    if (newRels.length > 0) {
      relsXml = addRelEntries(relsXml, newRels)
    }
    zip.updateFile(relsPath, Buffer.from(relsXml, 'utf-8'))

    // ── Append content to document.xml ───────────────────────────────────────
    // Each block goes in its own bookmark so a later call can find and
    // rebuild exactly that one. Drawings are placed ahead of the photos
    // section if it's already there, so re-adding markups after photos
    // doesn't leave the report reading photos-then-markups. An empty
    // selection writes nothing — the removal above already ran, which is
    // how deselecting everything clears a section.
    if (drawingsXml) {
      docXml = placeSection(docXml, 'drawings', wrapSection('drawings', drawingsXml))
    }
    if (photosXml) {
      docXml = placeSection(docXml, 'photos', wrapSection('photos', photosXml))
    }
    zip.updateFile('word/document.xml', Buffer.from(docXml, 'utf-8'))

    await saveDoc(inspectionId, zip.toBuffer())

    const photosAdded   = requested.includes('photos')   ? validPhotos.length   : 0
    const drawingsAdded = requested.includes('drawings') ? validDrawings.length : 0
    console.log(`[append] Saved ${requested.join('+')} — photos: ${photosAdded}, drawings: ${drawingsAdded}`)

    return NextResponse.json(
      {
        success: true,
        photosAdded,
        drawingsAdded,
        sections: requested,
        // True when this call had to fold a pre-split document's combined
        // section back into the two separate ones.
        legacyMigrated: legacy,
      },
      { headers: corsHeaders }
    )
  } catch (err: any) {
    console.error('[append] error:', err)
    return NextResponse.json({ error: err.message || 'Failed to append attachments' }, { status: 500, headers: corsHeaders })
  }
}
