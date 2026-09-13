import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateServerReport } from '@/lib/reportGeneratorServer'
import { fillTemplate, TemplateData, buildBulletXml, buildParagraphXml } from '@/lib/templateProcessor'
import { writeWithAttachments } from '@/lib/attachmentSections'
import { splitFindingRefs, stripFindingRefs } from '@/lib/reportFindings'
import { buildAnchoredBulletXml, storeReportText, type FindingLine } from '@/lib/reportAnchors'

export const dynamic = 'force-dynamic'

/** Extract the body text of a named CAPS section from AI output. */
function parseAISection(text: string, sectionName: string): string {
  const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(
    `${escaped}[:\\s]*([\\s\\S]*?)(?=\\n[A-Z][A-Z /()\\-]{2,}(?::|\\n)|$)`,
    'i'
  )
  const match = text.match(regex)
  return match ? match[1].trim() : ''
}

/** Convert AI section text into bullet lines (strips leading "- " or "• " markers). */
function sectionToBulletLines(text: string): string[] {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .map(l => l.replace(/^[-•]\s+/, ''))
}

/** Asks Claude for the report and hands back the text as it is written.
 *
 *  Streamed because a report takes the model the better part of a minute and
 *  the request used to sit silent for all of it. The total is much the same;
 *  what changes is that the engineer watches it being written.
 *
 *  Raw HTTP rather than the SDK to match every other Anthropic call in this
 *  codebase (transcribe, extract-info) — one way of calling it, and no new
 *  dependency in a change made for speed.
 *
 *  Server-sent events: blank-line separated, payload on the `data:` lines.
 *  Only the text deltas carry report content; message_start, ping and the
 *  rest are skipped. */
async function streamReportText(
  prompt: string,
  apiKey: string,
  onDelta: (text: string) => void
): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 2000,
      stream:     true,
      messages:   [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '')
    console.error('[ai-generate] Anthropic error:', res.status, detail)
    throw new Error('AI generation failed')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    // The last piece may be half a line; it is completed by the next read.
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload) continue

      let event: any
      try {
        event = JSON.parse(payload)
      } catch {
        continue // not a whole JSON object; the next read completes it
      }

      if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        const chunk: string = event.delta.text ?? ''
        text += chunk
        onDelta(chunk)
      } else if (event?.type === 'error') {
        throw new Error(event.error?.message ?? 'AI generation failed')
      }
    }
  }

  return text
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co'
  const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()
  if (!supabaseKey) {
    console.error('SUPABASE_SERVICE_ROLE_KEY not set')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }
  const supabase = createClient(supabaseUrl, supabaseKey)

  // Strip a leading BOM (U+FEFF) — see extract-info/route.ts for why.
  const anthropicKey = (process.env.ANTHROPIC_KEY ?? process.env.ANTHROPIC_API_KEY ?? '')
    .replace(/^﻿/, '').trim()
  if (!anthropicKey) {
    console.error('[ai-generate] No Anthropic API key set (ANTHROPIC_KEY / ANTHROPIC_API_KEY)')
    return NextResponse.json({ error: 'AI service not configured — ANTHROPIC_KEY missing on server' }, { status: 500 })
  }

  try {
    const { inspectionId } = await request.json()
    if (!inspectionId) {
      return NextResponse.json({ error: 'Missing inspectionId' }, { status: 400 })
    }

    console.log('[ai-generate] Starting for:', inspectionId)

    const [inspRes, obsRes] = await Promise.all([
      supabase
        .from('inspections')
        .select('*, projects(name, project_number, client_name, address, firm_id)')
        .eq('id', inspectionId)
        .single(),
      supabase
        .from('observations')
        .select('*')
        .eq('inspection_id', inspectionId)
        .order('id', { ascending: true }),
    ])

    if (!inspRes.data) {
      return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
    }

    const inspection   = inspRes.data
    const observations = obsRes.data ?? []
    const projects     = (inspection.projects as any) ?? {}
    const firmId       = projects.firm_id as string | undefined

    // Get engineer name from firm_members
    const userId = (inspection as any).created_by ?? (inspection as any).user_id
    const { data: member } = userId
      ? await supabase
          .from('firm_members')
          .select('full_name')
          .eq('user_id', userId)
          .single()
      : { data: null }

    const engineerName = member?.full_name ?? 'Site Engineer'

    // Build observation text for AI prompt. Each one is numbered so the
    // findings it produces can be traced back to the note they came from —
    // see splitFindingRefs.
    const observationIds: string[] = observations.map((ob: any) => ob.id)
    const obsText = observations.map((ob: any, i: number) => {
      const zone = ob.zone_label || 'General'
      const text = ob.transcript || ob.notes || 'No notes'
      const sev  = ob.severity ? `Status: ${ob.severity}` : ''
      return `#${i + 1}\nZone: ${zone}${sev ? `\n${sev}` : ''}\nNotes: ${text}`
    }).join('\n\n')

    const prompt = `You are a structural engineer writing a formal site inspection report.

Project: ${projects.name ?? ''}
Date: ${inspection.date ?? ''}
Weather: ${inspection.weather ?? ''}
Purpose: ${inspection.purpose ?? ''}

Observations from site:
${obsText || 'No observations recorded.'}

Write a professional site inspection report with EXACTLY these six section headings in ALL CAPS on their own line:

PURPOSE OF INSPECTION
WORKS OBSERVED
OBSERVATIONS/COMMENTS
CONTRACTOR TO PROVIDE (PRIOR TO NEXT INSPECTION)
HEALTH AND SAFETY
OTHER ACTIVITY ON SITE

Rules:
- Each section heading must appear alone on its own line in ALL CAPS.
- Do NOT use separator lines, dashes, underscores, or horizontal rules between sections.
- Do NOT number the headings.
- Under OBSERVATIONS/COMMENTS, write each zone observation as a separate line starting with "- ".
- Every line under OBSERVATIONS/COMMENTS must begin with the reference of the site observation it describes, in the form "- [#2] The steel connection at...". Use the numbers given above. If a line draws on more than one observation, reference the main one. Do not invent numbers that were not listed.
- Under CONTRACTOR TO PROVIDE, write each item as a separate line starting with "- ".
- Use formal structural engineering language throughout.`

    console.log('[ai-generate] Calling Anthropic, observations:', observations.length)

    // From here the response is a stream of newline-delimited JSON: the
    // model's words as they arrive, then one final line saying how it went.
    //
    // Once the first byte is sent the status is already 200, so anything that
    // fails after that is reported in the stream rather than as an HTTP
    // error. The checks above — missing keys, missing inspection — still
    // answer with a proper status, because nothing has been sent yet.
    const encoder = new TextEncoder()

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (line: unknown) =>
          controller.enqueue(encoder.encode(JSON.stringify(line) + '\n'))

        try {
          const rawAiText = await streamReportText(prompt, anthropicKey, chunk =>
            send({ t: 'text', v: chunk })
          )

          // Clean up AI output: remove separator lines and excess blank lines
          const aiText = rawAiText
            .replace(/^[-─═=*]{3,}\s*$/gm, '')   // strip separator lines
            .replace(/\n{3,}/g, '\n\n')            // max 2 consecutive newlines
            .trim()

          console.log('AI text generated, length:', aiText.length)

          // Work out which finding belongs to which observation before
          // anything is rendered, so the document and the site notes carry
          // the same wording.
          const { cleaned: observationLines, byObservation } = splitFindingRefs(
            sectionToBulletLines(parseAISection(aiText, 'OBSERVATIONS/COMMENTS')),
            observationIds
          )
          const stored = await storeReportText(byObservation)
          console.log('[ai-generate] Report wording stored for', stored, 'of', observationIds.length, 'observations')

          // The [#n] references are working notation, never report text. The
          // template path renders from the cleaned lines above; the
          // from-scratch generator takes the whole AI text, so strip them
          // there too.
          const cleanAiText = stripFindingRefs(aiText)

          // Regenerating rewrites the whole file, which used to take the
          // inserted photos and markups with it — they are lifted out and
          // re-attached, so the text can be regenerated at any point in the
          // workflow.
          let carried: string[] = []

          if (firmId) {
            const purposeText  = parseAISection(aiText, 'PURPOSE OF INSPECTION') || (inspection.purpose ?? '')
            const worksText    = parseAISection(aiText, 'WORKS OBSERVED')
            const recsText     = parseAISection(aiText, 'CONTRACTOR TO PROVIDE')
            const otherText    = parseAISection(aiText, 'OTHER ACTIVITY ON SITE')

            // Combine works observed + observations into one bullet list.
            // Works observed is general narrative with no note behind it, so
            // only the observation lines carry an anchor back to their site
            // note.
            const findingLines: FindingLine[] = [
              ...sectionToBulletLines(worksText).map(text => ({ text })),
              ...observationLines,
            ]

            const templateData: TemplateData = {
              engineer_name:   engineerName,
              client_email:    `${engineerName.toLowerCase().replace(/\s+/g, '.').replace(/[^a-z.]/g, '')}@silvesterclark.co.nz`,
              project_name:    projects.name              ?? '',
              report_no:       inspection.report_no       ?? '',
              site_contact:    inspection.site_contact    ?? '',
              contact_phone:   inspection.contact_phone   ?? '',
              weather:         inspection.weather         ?? '',
              drawings:        (inspection as any).drawing_ref ?? '',
              emailed_to_1:    projects.client_name       ?? '',
              emailed_to_2:    '',
              purpose:         buildParagraphXml(purposeText),
              findings:        buildAnchoredBulletXml(
                                 findingLines.length > 0
                                   ? findingLines
                                   : [{ text: 'No specific findings recorded.' }]
                               ),
              recommendations: buildBulletXml(sectionToBulletLines(recsText)),
              other_activity:  buildParagraphXml(otherText),
              date:            inspection.date            ?? '',
            }

            const buffer = await fillTemplate(firmId, templateData)
            carried = await writeWithAttachments(inspectionId, buffer)
            console.log('AI document generated using firm template')
          } else {
            console.log('No firm_id — generating AI doc from scratch')
            const buffer = await generateServerReport(inspection, observations, cleanAiText)
            carried = await writeWithAttachments(inspectionId, buffer)
          }

          send({ t: 'done', carried })
        } catch (err: any) {
          console.error('[ai-generate] error:', err)
          // In-band: the response is already a 200 by the time we get here.
          send({ t: 'error', error: err?.message || 'AI generation failed' })
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[ai-generate] error:', err)
    return NextResponse.json({ error: 'AI generation failed' }, { status: 500 })
  }
}
