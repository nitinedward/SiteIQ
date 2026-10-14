import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { requireInspectionAccess } from '@/lib/apiAuth'
import { overHourlyLimit } from '@/lib/rateLimit'
import { tidySummary, writeReportSummary } from '@/lib/reportSummary'

export const dynamic = 'force-dynamic'

/**
 * A report's short description, shown under its name in a project's Reports
 * list (lib/reportSummary).
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
export async function POST(request: NextRequest) {
  try {
    const { inspectionId, regenerate, summary } = await request.json()
    if (!inspectionId) return NextResponse.json({ error: 'Missing inspectionId' }, { status: 400 })
    const access = await requireInspectionAccess(request, inspectionId)
    if (!access.ok) return access.response
    const limited = await overHourlyLimit(request, 'report-summary', access.caller?.userId ?? null)
    if (limited) return limited

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
      (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()
    )

    // The engineer's own wording.
    if (typeof summary === 'string' && summary.trim()) {
      const own = tidySummary(summary)
      const { error } = await supabase.from('inspections').update({ summary: own, summary_edited: true }).eq('id', inspectionId)
      if (error) throw new Error(error.message)
      return NextResponse.json({ summary: own })
    }

    // An emptied description goes back to the AI.
    if (typeof summary === 'string') {
      await supabase.from('inspections').update({ summary: null, summary_edited: false }).eq('id', inspectionId)
    } else if (!regenerate) {
      const { data } = await supabase.from('inspections').select('summary').eq('id', inspectionId).single()
      if (data?.summary) return NextResponse.json({ summary: data.summary })
    }

    return NextResponse.json({ summary: await writeReportSummary(supabase, inspectionId, { keepEdited: false }) })
  } catch (err: any) {
    if (err instanceof Anthropic.APIError) {
      console.error('[reports/summary] API error', err.status, err.message)
      return NextResponse.json({ error: 'The AI could not write a description' }, { status: 502 })
    }
    console.error('[reports/summary] error:', err)
    return NextResponse.json({ error: err?.message ?? 'Could not save the description' }, { status: 500 })
  }
}
