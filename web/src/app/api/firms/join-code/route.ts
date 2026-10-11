import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireCaller } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'

/**
 * Changing a firm's join code — the code engineers enter at signup to join.
 * Changing it stops anyone with the old code joining.
 *
 * Through the server, admins only. The settings page used to update the
 * row from the browser and report success without checking: when the
 * database refused the change, the page said "updated" and the old code
 * came back on reload. Codes are also checked against every other firm's,
 * so a code can never let an engineer into the wrong firm.
 *
 * POST { code } sets that code; POST {} makes a new random one.
 * Returns { code }.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co'
const serviceKey = () => (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()

/** Six characters an engineer can read off a screen and type without doubt:
 *  no O/0, no I/1. Matches /api/firms/create. */
function newJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

export async function POST(request: NextRequest) {
  const access = await requireCaller(request)
  if (!access.ok) return access.response
  const { caller } = access
  if (caller.role !== 'admin') {
    return NextResponse.json({ error: 'Only a firm admin can change the join code.' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const asked = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : ''
  if (asked && !/^[A-Z0-9]{4,12}$/.test(asked)) {
    return NextResponse.json({ error: 'Use 4–12 letters and numbers, with no spaces.' }, { status: 400 })
  }

  const supabase = createClient(SUPABASE_URL, serviceKey())
  const taken = async (code: string) => {
    const { data } = await supabase.from('firms').select('id').eq('join_code', code).neq('id', caller.firmId).limit(1)
    return (data ?? []).length > 0
  }

  let code = asked
  if (code) {
    if (await taken(code)) {
      return NextResponse.json({ error: 'Another firm already uses that code. Choose a different one.' }, { status: 409 })
    }
  } else {
    for (let attempt = 0; attempt < 5 && !code; attempt++) {
      const candidate = newJoinCode()
      if (!(await taken(candidate))) code = candidate
    }
    if (!code) return NextResponse.json({ error: 'Could not make a new code. Try again.' }, { status: 500 })
  }

  const { data, error } = await supabase
    .from('firms')
    .update({ join_code: code })
    .eq('id', caller.firmId)
    .select('join_code')
    .single()
  if (error || !data) {
    const duplicate = /duplicate key|unique/i.test(error?.message ?? '')
    return NextResponse.json(
      { error: duplicate ? 'Another firm already uses that code. Choose a different one.' : 'Could not change the join code. Try again.' },
      { status: duplicate ? 409 : 500 })
  }
  return NextResponse.json({ code: data.join_code })
}
