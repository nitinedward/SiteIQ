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
    const { inspectionId } = await request.json()
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

    const inspection  = inspRes.data
    const observations = obsRes.data ?? []
    const projects    = (inspection.projects as any) ?? {}

    const obsText = observations.map((ob: any) => {
      const zone = ob.zone_label || 'General'
      const text = ob.transcript || ob.notes || 'No notes'
      const sev  = ob.severity ? `Severity: ${ob.severity}` : ''
      return `Zone: ${zone}\n${sev}\nNotes: ${text}`
    }).join('\n\n')

    const prompt = `You are a structural engineer writing a formal site inspection report.

Project: ${projects.name ?? ''}
Date: ${inspection.date ?? ''}
Weather: ${inspection.weather ?? ''}
Purpose: ${inspection.purpose ?? ''}

Observations from site:
${obsText || 'No observations recorded.'}

Write a professional site inspection report with these exact sections (use these exact headings in CAPS):
1. PURPOSE OF INSPECTION
2. WORKS OBSERVED
3. OBSERVATIONS/COMMENTS (bullet points per zone, starting with "- ")
4. CONTRACTOR TO PROVIDE (PRIOR TO NEXT INSPECTION)
5. HEALTH AND SAFETY
6. OTHER ACTIVITY ON SITE

Use formal engineering language. Be specific about structural elements. Format as plain text with section headings in ALL CAPS on their own line.`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_KEY ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-5',
        max_tokens: 2000,
        messages:   [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('[ai-generate] Anthropic error:', err)
      return NextResponse.json({ error: 'AI generation failed' }, { status: 500 })
    }

    const aiData = await response.json()
    const aiText = aiData.content?.[0]?.text ?? ''

    const buffer = await generateServerReport(inspection, observations, aiText)

    const dir = path.join(os.tmpdir(), 'siteiq-docs')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, `${inspectionId}.docx`), buffer)

    return NextResponse.json({
      success: true,
      preview: aiText.slice(0, 200),
    })
  } catch (err) {
    console.error('[ai-generate] error:', err)
    return NextResponse.json({ error: 'AI generation failed' }, { status: 500 })
  }
}
