import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

/**
 * Joining a firm with its code.
 *
 * The app used to do this from the device: look the code up in `firms`, then
 * insert into `firm_members`. Neither half can work for someone signing up.
 * Row-level security only shows a firm to people already in it, so the
 * lookup returned nothing and every attempt reported "invalid code" whatever
 * the engineer typed; and with email confirmation on, signUp returns no
 * session, so the insert had no authenticated caller either.
 *
 * Doing it here keeps the codes unreadable from the client — nothing about
 * any firm is exposed until the right code is presented — and works before
 * the confirmation email is opened.
 *
 * What stops someone adding themselves to a firm: they need the code, and
 * the account they name has to exist with the email they claim.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co'
const serviceKey = () => (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: cors })
}

export async function POST(request: NextRequest) {
  try {
    const { joinCode, userId, email, fullName } = await request.json()
    if (!joinCode?.trim()) {
      return NextResponse.json({ error: 'Enter the join code your admin gave you.' }, { status: 400, headers: cors })
    }

    const supabase = createClient(SUPABASE_URL, serviceKey())

    // Who is joining. A signed-in caller proves it with their token;
    // otherwise the account they name must exist and match the email given,
    // because a brand-new signup has no session until the email is confirmed.
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    let member: { id: string; email: string } | null = null

    if (token) {
      const { data } = await supabase.auth.getUser(token)
      if (data?.user) member = { id: data.user.id, email: data.user.email ?? '' }
    }
    if (!member && userId) {
      const { data } = await supabase.auth.admin.getUserById(userId)
      const claimed = String(email ?? '').trim().toLowerCase()
      if (data?.user && claimed && data.user.email?.toLowerCase() === claimed) {
        member = { id: data.user.id, email: data.user.email ?? '' }
      }
    }
    if (!member) {
      return NextResponse.json({ error: 'Sign up first, then join the firm.' }, { status: 401, headers: cors })
    }

    // The code is matched case-insensitively and trimmed: it is read off a
    // screen or a message, and "siteiq " should not be a failure.
    const { data: firms, error: firmError } = await supabase
      .from('firms')
      .select('id, name, join_code')
    if (firmError) throw firmError

    const wanted = String(joinCode).trim().toLowerCase()
    const firm = (firms ?? []).find(f => String(f.join_code ?? '').trim().toLowerCase() === wanted)
    if (!firm) {
      return NextResponse.json(
        { error: 'That join code does not match any firm. Check it with your admin.' },
        { status: 404, headers: cors }
      )
    }

    // Already in a firm? Say so plainly rather than making a second row.
    const { data: existing } = await supabase
      .from('firm_members')
      .select('id, firm_id')
      .eq('user_id', member.id)
      .maybeSingle()

    if (existing) {
      const sameFirm = existing.firm_id === firm.id
      return NextResponse.json(
        sameFirm
          ? { success: true, firmId: firm.id, firmName: firm.name, alreadyMember: true }
          : { error: 'This account already belongs to another firm.' },
        { status: sameFirm ? 200 : 409, headers: cors }
      )
    }

    const { error: insertError } = await supabase.from('firm_members').insert({
      firm_id: firm.id,
      user_id: member.id,
      role: 'member',
      full_name: String(fullName ?? '').trim() || member.email,
      email: member.email,
    })
    if (insertError) throw insertError

    console.log('[join-firm]', member.email, 'joined', firm.name)
    return NextResponse.json({ success: true, firmId: firm.id, firmName: firm.name }, { headers: cors })
  } catch (err: any) {
    console.error('[join-firm] error:', err)
    return NextResponse.json(
      { error: err?.message || 'Could not join the firm. Try again.' },
      { status: 500, headers: cors }
    )
  }
}
