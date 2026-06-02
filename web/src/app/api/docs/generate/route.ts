import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateServerReport } from '@/lib/reportGeneratorServer'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import os from 'os'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(request: NextRequest) {
  try {
    const { inspectionId, photos: photoList, drawingIds: _drawingIds } = await request.json()

    if (!inspectionId) {
      return NextResponse.json({ error: 'Missing inspectionId' }, { status: 400 })
    }

    const [inspRes, obsRes] = await Promise.all([
      supabase
        .from('inspections')
        .select('*, projects(name, project_number, client_name, address)')
        .eq('id', inspectionId)
        .single(),
      supabase
        .from('observations')
        .select('*')
        .eq('inspection_id', inspectionId)
        .order('created_at', { ascending: true }),
    ])

    if (!inspRes.data) {
      return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
    }

    // Fetch photos server-side if provided
    const photoAttachments: { url: string; zoneLabel: string; buffer?: Buffer }[] = []
    if (Array.isArray(photoList) && photoList.length > 0) {
      await Promise.all(
        photoList.map(async (p: { url: string; zoneLabel: string }) => {
          try {
            const res = await fetch(p.url)
            if (res.ok) {
              const buf = Buffer.from(await res.arrayBuffer())
              photoAttachments.push({ url: p.url, zoneLabel: p.zoneLabel, buffer: buf })
            }
          } catch { /* skip failed photos */ }
        })
      )
    }

    const buffer = await generateServerReport(
      inspRes.data,
      obsRes.data ?? [],
      undefined,
      photoAttachments,
    )

    const dir = path.join(os.tmpdir(), 'siteiq-docs')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, `${inspectionId}.docx`), buffer)

    return NextResponse.json({ success: true, inspectionId })
  } catch (err) {
    console.error('[docs/generate] error:', err)
    return NextResponse.json({ error: 'Failed to generate document' }, { status: 500 })
  }
}
