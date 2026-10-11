import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { requireInspectionAccess } from '@/lib/apiAuth'
import { noteDictation, noteLabel } from '@/lib/reportNotes'

export const dynamic = 'force-dynamic'

/**
 * A report's short description — what the visit covered, in a few words —
 * shown under its name in a project's Reports list (web/sql/report_summary.sql).
 *
 * POST { inspectionId }                    the description, written by the AI
 *                                          from the site notes if there is none
 * POST { inspectionId, regenerate: true }  the AI writes it afresh, replacing
 *                                          an engineer's wording too
 * POST { inspectionId, summary: '…' }      the engineer's own wording, which
 *                                          the AI then leaves alone; '' hands
 *                                          it back to the AI
 *
 * Answers { summary } — null when there is nothing to write from yet.
 */

const MODEL = 'claude-opus-5-5'
const MAX_LENGTH = 120

const SCHEMA = {
  type: 'object',
  properties: { summary: { type: 'string' } },
  required: ['summary'],
  additionalProperties: false,
} as const

const PROMPT = `Below are the site notes a structural engineer recorded on one site inspection. Write a short title saying what this inspection covered, so it can be told apart from the project's other inspections in a list.

- At most 10 words. Plain words, no full stop.
- Name the main elements or areas inspected and, if there is one, the key finding — e.g. "Blockwall restraint at GL Tw/Vw; grout missing behind angles".
- Don't include the date, the project name, the report number, or words like "Site inspection" or "Report".
- Use only what the notes say.`

export async function POST(request: NextRequest) {
  try {
    const { inspectionId, regenerate, summary } = await request.json()
    if (!inspectionId) return NextResponse.json({ error: 'Missing inspectionId' }, { status: 400 })
    const access = await requireInspectionAccess(request, inspectionId)
    if (!access.ok) return access.response

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
      (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()
    )

    // The engineer's own wording.
    if (typeof summary === 'string' && summary.trim()) {
      const own = summary.trim().replace(/\s+/g, ' ').slice(0, MAX_LENGTH)
      const { error } = await supabase.from('inspections').update({ summary: own, summary_edited: true }).eq('id', inspectionId)
      if (error) throw new Error(error.message)
      return NextResponse.json({ summary: own })
    }

    const { data: inspection, error: readError } = await supabase
      .from('inspections')
      .select('summary, summary_edited, purpose')
      .eq('id', inspectionId)
      .single()
    if (readError) {
      // No summary column yet (report_summary.sql not run): nothing to show.
      console.warn('[reports/summary] could not read the summary:', readError.message)
      return NextResponse.json({ summary: null })
    }
    const handBack = typeof summary === 'string'
    if (inspection.summary && !regenerate && !handBack) {
      return NextResponse.json({ summary: inspection.summary })
    }

    const { data: notes } = await supabase
      .from('observations')
      .select('zone_label, transcript, notes')
      .eq('inspection_id', inspectionId)
      .order('id', { ascending: true })
    const noteText = (notes ?? [])
      .map((n: any) => `- ${noteLabel(n)}: ${noteDictation(n) || '(photos only)'}`)
      .join('\n')
    const purpose = String(inspection.purpose ?? '').trim()
    if (!noteText && !purpose) {
      if (handBack) await supabase.from('inspections').update({ summary: null, summary_edited: false }).eq('id', inspectionId)
      return NextResponse.json({ summary: null })
    }

    const apiKey = (process.env.ANTHROPIC_KEY ?? process.env.ANTHROPIC_API_KEY ?? '').replace(/^﻿/, '').trim()
    if (!apiKey) return NextResponse.json({ error: 'AI service not configured' }, { status: 500 })

    const client = new Anthropic({ apiKey })
    // fallbacks: "default" re-runs a request a safety classifier declines on
    // Anthropic's recommended fallback model, server-side; the SDK's types
    // don't carry it yet, hence the widened params.
    const params = {
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: SCHEMA },
      },
      messages: [{
        role: 'user',
        content: `${PROMPT}\n\nPurpose recorded on site: ${purpose || '(none)'}\n\nSite notes:\n${noteText || '(none)'}`,
      }],
    } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming

    const response = await client.beta.messages.create(params)
    if (response.stop_reason !== 'end_turn') {
      console.warn('[reports/summary] no summary:', response.stop_reason, JSON.stringify((response as any).stop_details ?? null))
      return NextResponse.json({ summary: inspection.summary ?? null })
    }
    const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')?.text ?? ''
    let written = ''
    try {
      written = String(JSON.parse(text).summary ?? '').trim().replace(/\s+/g, ' ').replace(/\.$/, '').slice(0, MAX_LENGTH)
    } catch {
      console.error('[reports/summary] unparseable reply')
    }
    if (!written) return NextResponse.json({ summary: inspection.summary ?? null })

    const { error } = await supabase.from('inspections').update({ summary: written, summary_edited: false }).eq('id', inspectionId)
    if (error) throw new Error(error.message)
    console.log('[reports/summary]', inspectionId, '|', written, '| model:', response.model)
    return NextResponse.json({ summary: written })
  } catch (err: any) {
    if (err instanceof Anthropic.APIError) {
      console.error('[reports/summary] API error', err.status, err.message)
      return NextResponse.json({ error: 'The AI could not write a description' }, { status: 502 })
    }
    console.error('[reports/summary] error:', err)
    return NextResponse.json({ error: err?.message ?? 'Could not save the description' }, { status: 500 })
  }
}
