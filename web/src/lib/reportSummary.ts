import type { SupabaseClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { noteDictation, noteLabel } from './reportNotes'

/**
 * A report's short description — what the visit covered, in a few words —
 * shown under its name in a project's Reports list (web/sql/report_summary.sql).
 * The AI writes it from the site notes; an engineer can edit it, which sets
 * inspections.summary_edited so the AI leaves their wording alone unless
 * asked to rewrite it.
 *
 * Written when the report first appears in the list (api/reports/summary),
 * and again when the report is finalised (api/docs/finalise-pdf), from the
 * report's final wording, unless an engineer has edited it.
 */

const MODEL = 'claude-opus-5-5'
export const SUMMARY_MAX_LENGTH = 120

const SCHEMA = {
  type: 'object',
  properties: { summary: { type: 'string' } },
  required: ['summary'],
  additionalProperties: false,
} as const

export const SUMMARY_PROMPT = `Below are the site notes a structural engineer recorded on one site inspection. Write a short title saying what this inspection covered, so it can be told apart from the project's other inspections in a list.

- At most 10 words. Plain words, no full stop.
- Name the main elements or areas inspected and, if there is one, the key finding — e.g. "Blockwall restraint at GL Tw/Vw; grout missing behind angles".
- Don't include the date, the project name, the report number, or words like "Site inspection" or "Report".
- Use only what the notes say.`

/** One line, trimmed to the length the list shows. */
export const tidySummary = (text: string) =>
  text.trim().replace(/\s+/g, ' ').replace(/\.$/, '').slice(0, SUMMARY_MAX_LENGTH)

/**
 * Has the AI write the report's description and saves it. With
 * `keepEdited`, a description an engineer edited is kept instead.
 *
 * Returns the description now stored (null when there is none, or nothing
 * to write it from). Throws only on database errors and API errors.
 */
export async function writeReportSummary(
  supabase: SupabaseClient,
  inspectionId: string,
  { keepEdited }: { keepEdited: boolean },
): Promise<string | null> {
  const { data: inspection, error: readError } = await supabase
    .from('inspections')
    .select('summary, summary_edited, purpose')
    .eq('id', inspectionId)
    .single()
  // No summary column yet (report_summary.sql not run): nothing to write to.
  if (readError) {
    console.warn('[reportSummary] could not read the summary:', readError.message)
    return null
  }
  if (keepEdited && inspection.summary_edited && inspection.summary) return inspection.summary

  // The report's own wording for a note once there is one (finalising copies
  // it onto the note), else what was dictated.
  const { data: notes } = await supabase
    .from('observations')
    .select('zone_label, transcript, notes, report_text')
    .eq('inspection_id', inspectionId)
    .order('id', { ascending: true })
  const noteText = (notes ?? [])
    .map((n: any) => `- ${noteLabel(n)}: ${String(n.report_text ?? '').trim() || noteDictation(n) || '(photos only)'}`)
    .join('\n')
  const purpose = String(inspection.purpose ?? '').trim()
  if (!noteText && !purpose) return inspection.summary ?? null

  const apiKey = (process.env.ANTHROPIC_KEY ?? process.env.ANTHROPIC_API_KEY ?? '').replace(/^﻿/, '').trim()
  if (!apiKey) throw new Error('AI service not configured')

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
      content: `${SUMMARY_PROMPT}\n\nPurpose recorded on site: ${purpose || '(none)'}\n\nSite notes:\n${noteText || '(none)'}`,
    }],
  } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming

  const response = await client.beta.messages.create(params)
  if (response.stop_reason !== 'end_turn') {
    console.warn('[reportSummary] no summary:', response.stop_reason, JSON.stringify((response as any).stop_details ?? null))
    return inspection.summary ?? null
  }
  const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')?.text ?? ''
  let written = ''
  try {
    written = tidySummary(String(JSON.parse(text).summary ?? ''))
  } catch {
    console.error('[reportSummary] unparseable reply')
  }
  if (!written) return inspection.summary ?? null

  const { error } = await supabase.from('inspections').update({ summary: written, summary_edited: false }).eq('id', inspectionId)
  if (error) throw new Error(error.message)
  console.log('[reportSummary]', inspectionId, '|', written, '| model:', response.model)
  return written
}
