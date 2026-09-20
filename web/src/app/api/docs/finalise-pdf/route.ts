import { NextRequest, NextResponse } from 'next/server'
import { savePdf } from '@/lib/docStorage'
import { forceSaveAndWait, convertDocxToPdf } from '@/lib/onlyofficeConvert'
import { reportFileNameFor } from '@/lib/reportFileNameServer'
import { syncReportWordingToNotes, type WordingSyncResult } from '@/lib/reportWordingSync'
import { addDrawingHotspots, type HotspotSpec } from '@/lib/reportPdfHotspots'
import { createClient } from '@supabase/supabase-js'
import { PDFDocument } from 'pdf-lib'

// Drawing page sizes rarely change, so a warm instance keeps them: a finalise
// otherwise re-downloads a 17MB sheet just to read its dimensions.
const drawingSizeCache = new Map<string, { width: number; height: number }>()

/**
 * What the clickable areas need: the markups, and the order the report lists
 * its drawings and photo groups in — the same order appendAttachments wrote
 * them, which is how each picture in the PDF is identified.
 */
async function loadHotspotSpec(inspectionId: string): Promise<HotspotSpec> {
  const empty: HotspotSpec = { zones: [], drawingOrder: [], photoGroups: [] }
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
      (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()
    )

    const [{ data: zoneRows }, { data: noteRows }, { data: inspection }] = await Promise.all([
      supabase
        .from('zones')
        .select('id, label, x_percent, y_percent, markup_type, shape_data, drawings(number, revision)')
        .eq('inspection_id', inspectionId),
      supabase
        .from('observations')
        .select('zone_label, photos')
        .eq('inspection_id', inspectionId)
        .order('id', { ascending: true }),
      supabase.from('inspections').select('project_id').eq('id', inspectionId).single(),
    ])

    // Drawings are listed in the order the markup images were captured,
    // which the rebuild sorts by drawing number.
    const { data: assets } = await supabase.storage
      .from('reports')
      .list(`drawing-assets/${inspectionId}`, { limit: 100 })
    const { data: drawings } = inspection?.project_id
      ? await supabase.from('drawings').select('number').eq('project_id', inspection.project_id)
      : { data: [] as any[] }

    const drawingOrder = (assets ?? [])
      .filter(f => f.name.endsWith('.png'))
      .map(f => {
        const stem = f.name.replace(/\.png$/i, '')
        const match = (drawings ?? []).find((d: any) => (d.number ?? '').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) === stem)
        return (match?.number ?? stem) as string
      })
      .sort((a, b) => a.localeCompare(b))

    // Photos are grouped by note, in note order.
    const photoGroups: { zoneLabel: string; count: number }[] = []
    for (const note of noteRows ?? []) {
      const raw = (note as any).photos
      const list = Array.isArray(raw) ? raw : (() => { try { return JSON.parse(raw || '[]') } catch { return [] } })()
      const count = list.filter((u: unknown) => typeof u === 'string' && (u as string).startsWith('http')).length
      if (count === 0) continue
      const zoneLabel = (note as any).zone_label || 'General Observation'
      const existing = photoGroups.find(g => g.zoneLabel === zoneLabel)
      if (existing) existing.count += count
      else photoGroups.push({ zoneLabel, count })
    }

    // A markup's shape is stored in the drawing's own page units, so each
    // drawing's page size is read from the drawing itself.
    const drawingSizes: Record<string, { width: number; height: number }> = {}
    const referenced = [...new Set((zoneRows ?? []).map((z: any) => z.drawings?.number).filter(Boolean))]
    if (referenced.length > 0 && inspection?.project_id) {
      const { data: files } = await supabase
        .from('drawings')
        .select('number, file_url')
        .eq('project_id', inspection.project_id)
        .in('number', referenced as string[])
      await Promise.all((files ?? []).map(async (d: any) => {
        const cached = drawingSizeCache.get(d.file_url)
        if (cached) { drawingSizes[String(d.number).trim()] = cached; return }
        try {
          const res = await fetch(d.file_url)
          if (!res.ok) return
          const pdf = await PDFDocument.load(await res.arrayBuffer(), { updateMetadata: false })
          const page = pdf.getPages()[0]
          if (page) {
            const size = { width: page.getWidth(), height: page.getHeight() }
            drawingSizes[String(d.number).trim()] = size
            drawingSizeCache.set(d.file_url, size)
          }
        } catch { /* fall back to the placed size */ }
      }))
    }

    return {
      drawingSizes,
      zones: (zoneRows ?? []).map((z: any) => ({
        id: z.id,
        label: z.label,
        x_percent: z.x_percent,
        y_percent: z.y_percent,
        markup_type: z.markup_type ?? 'pin',
        shape_data: z.shape_data ?? null,
        drawingNumber: z.drawings?.number ?? null,
        drawingRevision: z.drawings?.revision ?? null,
      })),
      drawingOrder,
      photoGroups,
    }
  } catch (err) {
    console.warn('[finalise-pdf] could not load markups for hotspots:', err)
    return empty
  }
}

export const dynamic = 'force-dynamic'
// Force-save (~10s) + conversion polling (~90s worst case for a large,
// photo-heavy report) can exceed the platform's default function timeout.
// Vercel caps this to whatever the account's plan actually allows, but
// declaring it costs nothing and gets us the full budget where possible.
export const maxDuration = 120

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: cors })
}

/** Force-saves the live OnlyOffice document, converts the resulting .docx
 *  to PDF, and stores the PDF — but does NOT touch report_status. The
 *  caller (client) only flips the inspection to 'finalised' after this
 *  returns success, so a report is never marked finalised without a valid
 *  frozen PDF actually existing. */
export async function POST(request: NextRequest) {
  try {
    const { inspectionId, docKey } = await request.json()
    if (!inspectionId || !docKey) {
      return NextResponse.json({ error: 'Missing inspectionId or docKey' }, { status: 400, headers: cors })
    }

    console.log('[finalise-pdf] Force-saving before freeze:', inspectionId)
    const saveResult = await forceSaveAndWait(inspectionId, docKey)
    console.log('[finalise-pdf] Force-save result:', saveResult)

    const appUrl = process.env.NEXT_PUBLIC_APP_URL
      ?? new URL(request.url).origin

    console.log('[finalise-pdf] Converting to PDF:', inspectionId)
    // The frozen PDF is the copy people keep and pass around, so it carries
    // the report's name inside it rather than the inspection UUID.
    const title = await reportFileNameFor(inspectionId)
    // The markups and the spec are gathered while OnlyOffice converts.
    const [converted, spec] = await Promise.all([
      convertDocxToPdf(inspectionId, appUrl, title),
      loadHotspotSpec(inspectionId),
    ])

    // One pass over the PDF: the drawings arrive from the conversion as flat
    // pictures, so the markups are made clickable again, and the title is
    // stamped at the same time rather than loading and re-saving twice.
    const hotspots = await addDrawingHotspots(Buffer.from(converted), spec, title)
    const pdfBuffer = hotspots.bytes
    console.log('[finalise-pdf] drawing hotspots:', hotspots.added, hotspots.reason ?? '')

    await savePdf(inspectionId, pdfBuffer)
    console.log('[finalise-pdf] PDF stored as:', title, 'size:', pdfBuffer.length)

    // The report's final wording for each site note goes back onto the note.
    // A failure here is reported but never blocks the finalise.
    let wording: WordingSyncResult | null = null
    try {
      wording = await syncReportWordingToNotes(inspectionId)
      console.log('[finalise-pdf] Report wording saved to notes:', wording.updated, '| unmatched:', wording.unmatched)
    } catch (err) {
      console.error('[finalise-pdf] Could not save report wording to notes:', err)
    }

    return NextResponse.json({ success: true, pdfSize: pdfBuffer.length, wording, hotspots: { added: hotspots.added, reason: hotspots.reason } }, { headers: cors })
  } catch (err: any) {
    console.error('[finalise-pdf] error:', err)
    // Never a partial success — the caller must not mark the report
    // finalised if this errors, so a report can't end up "finalised"
    // without a valid PDF.
    return NextResponse.json({ error: err.message || 'Failed to finalise to PDF' }, { status: 500, headers: cors })
  }
}
