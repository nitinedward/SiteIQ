import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'

type Zone = {
  id: string
  label: string
  x_percent: number
  y_percent: number
  markup_type: 'pin' | 'rectangle' | 'freehand'
  shape_data: string | null
}

/** The capture, plus the page size the markup coordinates are expressed in.
 *  Callers that only want the picture can destructure `blob`; the markup PDF
 *  needs the dimensions to turn a zone's shape into a clickable area. */
export type DrawingCapture = {
  blob: Blob
  /** Natural page size at scale 1 — the space `shape_data` is stored in. */
  pdfWidth: number
  pdfHeight: number
}

export async function captureDrawingWithMarkup(
  pdfUrl: string,
  zones: Zone[],
  pageNumber = 1
): Promise<DrawingCapture> {
  const page = await renderPage(pdfUrl, pageNumber)
  drawZones(page.canvas, zones, page.pdfWidth, page.pdfHeight, page.scale)
  return { blob: await exportWithinBudget(page.canvas), pdfWidth: page.pdfWidth, pdfHeight: page.pdfHeight }
}

/** Longest side of a one-note copy. It is printed a few centimetres wide in
 *  a note's block, so it doesn't need the full capture's resolution. */
const ZONE_COPY_MAX_DIM = 2000

/**
 * The drawing with every markup, plus one copy per markup showing only that
 * one — for reports laid out a block per site note, where each note shows
 * its own markup. The page is rendered once and each copy drawn from it.
 */
export async function captureDrawingAndEachZone(
  pdfUrl: string,
  zones: Zone[],
  pageNumber = 1
): Promise<DrawingCapture & { zones: Map<string, Blob> }> {
  const page = await renderPage(pdfUrl, pageNumber)
  const perZone = new Map<string, Blob>()
  const fit = Math.min(1, ZONE_COPY_MAX_DIM / Math.max(page.canvas.width, page.canvas.height))
  for (const zone of zones) {
    const copy = document.createElement('canvas')
    copy.width = page.canvas.width
    copy.height = page.canvas.height
    copy.getContext('2d')!.drawImage(page.canvas, 0, 0)
    drawZones(copy, [zone], page.pdfWidth, page.pdfHeight, page.scale)
    let out = copy
    if (fit < 1) {
      out = document.createElement('canvas')
      out.width = Math.round(copy.width * fit)
      out.height = Math.round(copy.height * fit)
      const octx = out.getContext('2d')!
      octx.imageSmoothingEnabled = true
      octx.imageSmoothingQuality = 'high'
      octx.drawImage(copy, 0, 0, out.width, out.height)
    }
    perZone.set(zone.id, await exportWithinBudget(out))
  }
  drawZones(page.canvas, zones, page.pdfWidth, page.pdfHeight, page.scale)
  return { blob: await exportWithinBudget(page.canvas), pdfWidth: page.pdfWidth, pdfHeight: page.pdfHeight, zones: perZone }
}

/** The drawing's page rendered at twice its natural size, with nothing on it. */
async function renderPage(pdfUrl: string, pageNumber: number) {
  // Load PDF
  const response    = await fetch(pdfUrl)
  const arrayBuffer = await response.arrayBuffer()
  const pdf         = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise
  const page        = await pdf.getPage(pageNumber)

  // Render at scale 2 for good resolution
  const scale    = 2
  const viewport = page.getViewport({ scale })

  const canvas    = document.createElement('canvas')
  canvas.width    = viewport.width
  canvas.height   = viewport.height
  const ctx       = canvas.getContext('2d')!

  await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise

  // Natural dimensions at scale 1
  const naturalViewport = page.getViewport({ scale: 1 })
  const pdfWidth        = naturalViewport.width
  const pdfHeight       = naturalViewport.height

  return { canvas, pdfWidth, pdfHeight, scale }
}

/** Draws markups onto a rendered page. */
function drawZones(canvas: HTMLCanvasElement, zones: Zone[], pdfWidth: number, pdfHeight: number, scale: number) {
  const ctx = canvas.getContext('2d')!
  ctx.lineCap   = 'round'
  ctx.lineJoin  = 'round'

  zones.forEach(zone => {
    const cx = (zone.x_percent / 100) * canvas.width
    const cy = (zone.y_percent / 100) * canvas.height

    if (!zone.markup_type || zone.markup_type === 'pin') {
      ctx.save()
      ctx.shadowColor   = 'rgba(0,0,0,0.3)'
      ctx.shadowBlur    = 6
      ctx.shadowOffsetY = 3
      ctx.beginPath()
      ctx.arc(cx, cy, 12 * scale, 0, Math.PI * 2)
      ctx.fillStyle = '#2563EB'
      ctx.fill()
      ctx.restore()

      ctx.beginPath()
      ctx.arc(cx, cy, 12 * scale, 0, Math.PI * 2)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth   = 2 * scale
      ctx.stroke()

      ctx.beginPath()
      ctx.arc(cx, cy, 4 * scale, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()

      drawLabel(ctx, zone.label, cx, cy - 20 * scale, scale)
    }

    else if (zone.markup_type === 'rectangle' && zone.shape_data) {
      try {
        const r  = JSON.parse(zone.shape_data)
        const rx = (r.x / pdfWidth) * canvas.width
        const ry = (r.y / pdfHeight) * canvas.height
        const rw = (r.width / pdfWidth) * canvas.width
        const rh = (r.height / pdfHeight) * canvas.height

        ctx.fillStyle = 'rgba(37,99,235,0.15)'
        ctx.fillRect(rx, ry, rw, rh)
        ctx.strokeStyle = '#2563EB'
        ctx.lineWidth   = 2 * scale
        ctx.strokeRect(rx, ry, rw, rh)
        drawLabel(ctx, zone.label, rx + rw / 2, ry - 8 * scale, scale)
      } catch { /* ignore parse errors */ }
    }

    else if (zone.markup_type === 'freehand' && zone.shape_data) {
      try {
        const pts: { x: number; y: number }[] = JSON.parse(zone.shape_data)
        if (pts.length < 2) return

        ctx.beginPath()
        pts.forEach((pt, i) => {
          const px = (pt.x / pdfWidth) * canvas.width
          const py = (pt.y / pdfHeight) * canvas.height
          if (i === 0) ctx.moveTo(px, py)
          else         ctx.lineTo(px, py)
        })
        ctx.strokeStyle = '#F59E0B'
        ctx.lineWidth   = 3 * scale
        ctx.stroke()
        drawLabel(ctx, zone.label, cx, cy - 8 * scale, scale)
      } catch { /* ignore parse errors */ }
    }
  })
}

/** Largest capture we'll hand to the upload route. A dense structural
 *  drawing rendered at scale 2 can exceed the request body limit on its
 *  own, which came back as a 413 and failed the insert. */
const MAX_CAPTURE_BYTES = 3_500_000

function toBlobAsync(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Canvas export failed')),
      'image/png'
    )
  })
}

/** Exports as PNG, stepping the resolution down until it fits the budget.
 *  Kept as PNG deliberately: these are line drawings, which JPEG blurs, and
 *  the document assembler stores them as .png. Halving the linear size
 *  quarters the pixel count, so this converges quickly. */
async function exportWithinBudget(canvas: HTMLCanvasElement): Promise<Blob> {
  let blob = await toBlobAsync(canvas)
  if (blob.size <= MAX_CAPTURE_BYTES) return blob

  for (const factor of [0.75, 0.6, 0.5, 0.4, 0.3]) {
    const scaled = document.createElement('canvas')
    scaled.width = Math.max(1, Math.round(canvas.width * factor))
    scaled.height = Math.max(1, Math.round(canvas.height * factor))
    const sctx = scaled.getContext('2d')!
    sctx.imageSmoothingEnabled = true
    sctx.imageSmoothingQuality = 'high'
    sctx.drawImage(canvas, 0, 0, scaled.width, scaled.height)

    blob = await toBlobAsync(scaled)
    console.log(`[captureDrawing] downscaled to ${Math.round(factor * 100)}% → ${(blob.size / 1e6).toFixed(2)} MB`)
    if (blob.size <= MAX_CAPTURE_BYTES) return blob
  }

  // Still over budget at 30%: hand back the smallest we produced and let
  // the upload report the failure rather than silently dropping it.
  return blob
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  scale: number
) {
  if (!text) return
  const fontSize = 11 * scale
  ctx.font        = `600 ${fontSize}px Outfit, sans-serif`
  const metrics   = ctx.measureText(text)
  const padX      = 6 * scale
  const padY      = 4 * scale
  const boxW      = metrics.width + padX * 2
  const boxH      = fontSize + padY * 2
  const boxX      = x - boxW / 2
  const boxY      = y - boxH

  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.2)'
  ctx.shadowBlur  = 4
  ctx.fillStyle   = '#2563EB'
  roundRect(ctx, boxX, boxY, boxW, boxH, 4 * scale)
  ctx.fill()
  ctx.restore()

  ctx.fillStyle      = '#ffffff'
  ctx.textAlign      = 'center'
  ctx.textBaseline   = 'middle'
  ctx.fillText(text, x, boxY + boxH / 2)
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  w: number, h: number,
  r: number
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}
