import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateServerReport } from '@/lib/reportGeneratorServer'
import { fillTemplate, pinReportTemplate, TemplateData, buildBulletXml, buildParagraphXml } from '@/lib/templateProcessor'
import { writeWithRebuiltAttachments } from '@/lib/rebuildAttachments'
import { noteLabel, noteDictation, noteBulletLine } from '@/lib/reportNotes'
import { loadReportEngineer, inspectionTime } from '@/lib/reportEngineer'
import { parseRecipients, recipientNames, recipientEmails } from '@/lib/reportRecipients'

export const dynamic = 'force-dynamic'

/** The structured reply the AI is constrained to (output_config.format). */
type AiReport = {
  purpose: string
  notes: { ref: string; text: string }[]
  contractor_to_provide: { ref: string; item: string }[]
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

    const engineer = await loadReportEngineer(supabase, inspection as any, firmId)
    // Read on their own so a database without these columns yet (see
    // sql/project_client_email.sql and sql/project_report_recipients.sql)
    // still generates reports.
    const { data: client } = await supabase
      .from('projects')
      .select('client_email')
      .eq('id', inspection.project_id)
      .single()
    const { data: recipientRow } = await supabase
      .from('projects')
      .select('report_recipients')
      .eq('id', inspection.project_id)
      .single()
    const recipients = parseRecipients((recipientRow as any)?.report_recipients)

    // The site notes decide what the report lists: one bullet per note, in
    // order, under the note's own label. The AI only rewrites each note's
    // wording, returned against the note's reference, so it can't add, merge,
    // rename or drop notes. Open/closed status isn't sent — it's tracked on
    // the note and changes after the report is written.
    const refs = observations.map((_: any, i: number) => `N${i + 1}`)
    const notesForPrompt = observations.map((ob: any, i: number) =>
      `${refs[i]} | ${noteLabel(ob)}\n${noteDictation(ob) || '(nothing dictated; photos only)'}`
    ).join('\n\n')

    const prompt = `You are a structural engineer writing up a site inspection report from the site notes below.

Project: ${projects.name ?? ''}
Date: ${inspection.date ?? ''}
Weather: ${inspection.weather ?? ''}
Purpose recorded on site: ${inspection.purpose ?? '(none)'}

Site notes (reference | label, then what the engineer recorded):
${notesForPrompt || '(no site notes recorded)'}

Return:
- purpose: one or two formal sentences stating the purpose of the inspection, based on the recorded purpose and the notes.
- notes: one entry per site note, using its reference. Rewrite what was recorded as formal structural engineering wording. Keep every fact, location, grid line, member and requirement, including a record that something was absent or not built; add nothing that wasn't recorded. Don't repeat the label and don't mention open/closed status. Only where a note's recorded text is exactly "(nothing dictated; photos only)", write "Observation recorded; refer to site photographs." — never use that sentence in place of text the engineer recorded.
- contractor_to_provide: at most one item per note, with that note's reference. Where a note asks the contractor to provide or do anything, gather all of that note's requests into a single formal item naming the location it relates to. Skip notes that ask for nothing; if no note asks for anything, return an empty list.`

    const noteRefSchema = refs.length > 0 ? { type: 'string', enum: refs } : { type: 'string' }

    console.log('[ai-generate] Calling Anthropic, observations:', observations.length)
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 8000,
        messages:   [{ role: 'user', content: prompt }],
        output_config: {
          format: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: {
                purpose: { type: 'string' },
                notes: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { ref: noteRefSchema, text: { type: 'string' } },
                    required: ['ref', 'text'],
                    additionalProperties: false,
                  },
                },
                contractor_to_provide: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { ref: noteRefSchema, item: { type: 'string' } },
                    required: ['ref', 'item'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['purpose', 'notes', 'contractor_to_provide'],
              additionalProperties: false,
            },
          },
        },
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('[ai-generate] Anthropic error:', err)
      return NextResponse.json({ error: 'AI generation failed' }, { status: 500 })
    }

    const aiData = await response.json()
    if (aiData.stop_reason !== 'end_turn') {
      console.error('[ai-generate] Unexpected stop_reason:', aiData.stop_reason, aiData.stop_details ?? '')
      return NextResponse.json({ error: 'AI generation did not complete' }, { status: 500 })
    }

    const textBlock = (aiData.content ?? []).find((b: any) => b.type === 'text')
    let ai: AiReport
    try {
      ai = JSON.parse(textBlock?.text ?? '')
    } catch (err) {
      console.error('[ai-generate] Could not parse AI JSON:', err)
      return NextResponse.json({ error: 'AI generation failed' }, { status: 500 })
    }

    // Built from the notes, not from the AI's list: a note the AI skipped
    // falls back to its dictated text rather than disappearing.
    const wordingByRef = new Map(ai.notes.map(n => [n.ref, n.text.trim()]))
    const findingLines = observations.map((ob: any, i: number) =>
      noteBulletLine(ob, wordingByRef.get(refs[i]) || noteDictation(ob) || 'Observation recorded; refer to site photographs.')
    )
    // One item per note, in note order — a second item against the same note
    // is dropped rather than letting one note spread across several bullets.
    const itemByRef = new Map<string, string>()
    for (const c of ai.contractor_to_provide) {
      const item = c.item.trim()
      if (item && !itemByRef.has(c.ref)) itemByRef.set(c.ref, item)
    }
    const contractorLines = refs
      .map((r: string) => itemByRef.get(r))
      .filter((item): item is string => Boolean(item))
    const purposeText = ai.purpose.trim() || (inspection.purpose ?? '')

    // Section-headed text, for the no-template fallback generator and the preview.
    const aiText = [
      'PURPOSE OF INSPECTION', purposeText, '',
      'OBSERVATIONS/COMMENTS', ...findingLines.map(l => `- ${l}`), '',
      'CONTRACTOR TO PROVIDE (PRIOR TO NEXT INSPECTION)', ...contractorLines.map(l => `- ${l}`),
    ].join('\n')

    console.log('AI text generated, length:', aiText.length)

    // Regenerating rewrites the whole file, which used to take the inserted
    // photos and markups with it — they are lifted out and re-attached, so
    // the text can be regenerated at any point in the workflow.
    let carried: string[] = []

    if (firmId) {
      const templateData: TemplateData = {
        engineer_name:   engineer.name,
        engineer_user:   engineer.user,
        client_email:    client?.client_email ?? '',
        project_name:    projects.name              ?? '',
        job_no:          projects.project_number    ?? '',
        report_no:       inspection.report_no       ?? '',
        site_contact:    inspection.site_contact    ?? '',
        contact_phone:   inspection.contact_phone   ?? '',
        weather:         inspection.weather         ?? '',
        drawings:        (inspection as any).drawing_ref ?? '',
        emailed_to_1:    recipients[0]?.name || (projects.client_name ?? ''),
        emailed_to_2:    recipientNames(recipients.slice(1)),
        issued_to:       recipientNames(recipients) || (projects.client_name ?? ''),
        issued_to_emails: recipientEmails(recipients),
        purpose:         buildParagraphXml(purposeText),
        findings:        buildBulletXml(findingLines.length > 0 ? findingLines : ['No specific findings recorded.']),
        recommendations: buildBulletXml(contractorLines),
        // Nothing is recorded for this on site, so it's left for the engineer to fill in.
        other_activity:  buildParagraphXml(''),
        date:            inspection.date            ?? '',
        time:            inspectionTime(inspection as any),
      }

      const pinnedTemplateId = (inspection as any).report_template_id as string | null | undefined
      const { buffer, templateId } = await fillTemplate(firmId, templateData, {
        pinnedTemplateId,
        projectId: inspection.project_id,
      })
      await pinReportTemplate(inspectionId, pinnedTemplateId, templateId)
      carried = await writeWithRebuiltAttachments(inspectionId, inspection.project_id, buffer)
      console.log('AI document generated using firm template')
    } else {
      console.log('No firm_id — generating AI doc from scratch')
      const buffer = await generateServerReport(inspection, observations, aiText)
      carried = await writeWithRebuiltAttachments(inspectionId, inspection.project_id, buffer)
    }

    return NextResponse.json({ success: true, preview: aiText.slice(0, 200), carried })
  } catch (err) {
    console.error('[ai-generate] error:', err)
    return NextResponse.json({ error: 'AI generation failed' }, { status: 500 })
  }
}
