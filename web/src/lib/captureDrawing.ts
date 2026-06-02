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

export async function captureDrawingWithMarkup(
  pdfUrl: string,
  zones: Zone[],
  pageNumber = 1
): Promise<Blob> {
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

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Canvas export failed')),
      'image/png',
      0.95
    )
  })
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
