import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * Per-person hourly limits on the routes that cost money (AI and
 * transcription), so a leaked login or a runaway loop can't run up the bill.
 *
 * Counted in the database (web/sql/api_usage.sql) because Vercel runs many
 * short-lived copies of each route — a count kept in memory would reset
 * whenever a new copy starts. The limits are set far above what anyone does
 * by hand on site.
 *
 * Fails open: if the count can't be read (the SQL hasn't been run, or the
 * database is slow to answer), the call goes ahead. A limit that blocks real
 * work would cost more than the AI call it saves.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co'
const admin = () => createClient(SUPABASE_URL, (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim())

/** Calls per person per hour. */
export const HOURLY_LIMITS = {
  transcribe: 120,
  'ai-generate': 60,
  rewrite: 300,
  // One call per drawing page while a set uploads; large sets run to hundreds.
  'extract-info': 1500,
  'cans-analyse': 60,
  'report-summary': 120,
} as const

export type LimitedRoute = keyof typeof HOURLY_LIMITS

/**
 * Counts this call and returns a 429 response once the caller is over the
 * hour's limit, or null to carry on. `userId` is null for the phone app's
 * tokenless calls, which are counted by network address instead.
 */
export async function overHourlyLimit(
  request: NextRequest,
  route: LimitedRoute,
  userId: string | null,
  headers?: Record<string, string>,
): Promise<NextResponse | null> {
  const who = userId
    ?? `ip:${request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'}`
  try {
    const { data, error } = await admin().rpc('api_usage_hit', { p_who: who, p_route: route })
    if (error || typeof data !== 'number') return null
    if (data <= HOURLY_LIMITS[route]) return null
    console.warn(`[rate-limit] ${route}: ${who} over ${HOURLY_LIMITS[route]}/hour`)
    return NextResponse.json(
      { error: 'Too many requests in the last hour. Please try again later.' },
      { status: 429, headers: { ...headers, 'Retry-After': '600' } },
    )
  } catch {
    return null
  }
}
