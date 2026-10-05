import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { requireProjectAccess } from '@/lib/apiAuth'
import { supabaseUrl } from '@/lib/storageFetch'

export const dynamic = 'force-dynamic'
// Reading a multi-page PDF with sketches can take a minute.
export const maxDuration = 180

/**
 * Reads an uploaded CAN with Claude and returns what the review screen
 * pre-fills: its number, title, revision, issue date, a one-line summary,
 * and which pages carry a sketch (with a title for each). The engineer
 * confirms or corrects all of it before anything is filed — this only
 * proposes.
 *
 * The PDF is read from storage here (cans/<project>/<can>/original.pdf,
 * uploaded on a link from /api/cans), never taken from the request, so a
 * large CAN doesn't have to fit through the function and a caller can only
 * point at their own project's upload.
 */

const MODEL = 'claude-opus-5-5'
const MAX_PDF_BYTES = 30 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type CanReading = {
  can_number: string
  title: string
  revision: string
  issued_on: string
  summary: string
  page_count: number
  sketch_pages: { page: number; title: string; description: string }[]
}

const SCHEMA = {
  type: 'object',
  properties: {
    can_number: { type: 'string' },
    title: { type: 'string' },
    revision: { type: 'string' },
    issued_on: { type: 'string' },
    summary: { type: 'string' },
    page_count: { type: 'integer' },
    sketch_pages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          title: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['page', 'title', 'description'],
        additionalProperties: false,
      },
    },
  },
  required: ['can_number', 'title', 'revision', 'issued_on', 'summary', 'page_count', 'sketch_pages'],
  additionalProperties: false,
} as const

const PROMPT = `This PDF is a Consultant Advice Notice (CAN) issued by a structural engineering consultant to a contractor during construction. Read it and return:

- can_number: the notice's number as printed, e.g. "CAN-003" or "CAN 12". Empty if none is printed.
- title: the subject of the notice, short — as printed if it has one, otherwise a few words naming what it instructs.
- revision: the revision as printed, e.g. "A", "B", "1". Empty if none is printed.
- issued_on: the issue date as YYYY-MM-DD. Empty if no date is printed or it is ambiguous.
- summary: one sentence on what the contractor is advised to do, naming the location.
- page_count: how many pages the PDF has.
- sketch_pages: every page that carries a sketch or detail drawing — hand-drawn, or drawn in a tool such as Bluebeam — that shows what is to be built. Pages numbered from 1. For each, a short title for the sketch (e.g. "Lintel support at GL-Nw") and one sentence describing what it shows. A page that is only text, a title block, a signature or a cover sheet is not a sketch page; a page with text and a sketch is.`

export async function POST(request: NextRequest) {
  try {
    const { projectId, canId } = await request.json()
    const access = await requireProjectAccess(request, projectId)
    if (!access.ok) return access.response
    if (typeof canId !== 'string' || !UUID.test(canId)) {
      return NextResponse.json({ error: 'Missing or invalid canId' }, { status: 400 })
    }

    const apiKey = (process.env.ANTHROPIC_KEY ?? process.env.ANTHROPIC_API_KEY ?? '').replace(/^﻿/, '').trim()
    if (!apiKey) return NextResponse.json({ error: 'AI service not configured' }, { status: 500 })

    const supabase = createClient(supabaseUrl(), (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim())
    const { data: file, error: dlError } = await supabase.storage
      .from('observation-photos')
      .download(`cans/${projectId}/${canId}/original.pdf`)
    if (dlError || !file) return NextResponse.json({ error: 'The uploaded CAN could not be found' }, { status: 404 })
    const bytes = Buffer.from(await file.arrayBuffer())
    if (bytes.length > MAX_PDF_BYTES) {
      return NextResponse.json({ error: `The CAN is ${(bytes.length / 1e6).toFixed(0)} MB — too large to read (30 MB limit).` }, { status: 413 })
    }

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
        effort: 'medium',
        format: { type: 'json_schema', schema: SCHEMA },
      },
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bytes.toString('base64') } },
          { type: 'text', text: PROMPT },
        ],
      }],
    } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming

    const response = await client.beta.messages.create(params)

    if (response.stop_reason === 'refusal') {
      console.warn('[cans/analyse] declined:', JSON.stringify((response as any).stop_details ?? null))
      return NextResponse.json({ error: 'The AI could not read this CAN. Fill in the details by hand.' }, { status: 422 })
    }
    if (response.stop_reason === 'max_tokens') {
      return NextResponse.json({ error: 'The AI ran out of room reading this CAN. Fill in the details by hand.' }, { status: 422 })
    }

    const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')?.text ?? ''
    let reading: CanReading
    try {
      reading = JSON.parse(text)
    } catch {
      console.error('[cans/analyse] unparseable reply')
      return NextResponse.json({ error: 'The AI reply could not be read. Fill in the details by hand.' }, { status: 502 })
    }
    // Pages outside the document, or listed twice, are dropped.
    const seen = new Set<number>()
    reading.sketch_pages = reading.sketch_pages.filter(p =>
      Number.isInteger(p.page) && p.page >= 1 && (!reading.page_count || p.page <= reading.page_count) && !seen.has(p.page) && seen.add(p.page)
    )
    console.log('[cans/analyse]', canId, '| pages:', reading.page_count, '| sketches:', reading.sketch_pages.map(p => p.page).join(',') || 'none', '| model:', response.model)

    return NextResponse.json({ reading })
  } catch (err: any) {
    if (err instanceof Anthropic.APIError) {
      console.error('[cans/analyse] API error', err.status, err.message)
      return NextResponse.json({ error: 'The AI service failed to read the CAN. Fill in the details by hand.' }, { status: 502 })
    }
    console.error('[cans/analyse] error:', err)
    return NextResponse.json({ error: err?.message ?? 'Could not read the CAN' }, { status: 500 })
  }
}
