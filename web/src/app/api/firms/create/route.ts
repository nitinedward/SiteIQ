import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

/**
 * Starting a firm at signup, and becoming its admin.
 *
 * Same trouble as joining: the browser and the app have no session until the
 * confirmation email is opened, and row-level security rightly refuses an
 * unauthenticated insert into `firms`. So the first firm a new customer
 * creates could never be created from the client.
 *
 * The account named must exist with the email claimed, and must not already
 * belong to a firm.
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

/** Six characters an engineer can read off a screen and type without doubt:
 *  no O/0, no I/1. */
function newJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

export async function POST(request: NextRequest) {
  try {
    const { firmName, userId, email, fullName } = await request.json()
    if (!String(firmName ?? '').trim()) {
      return NextResponse.json({ error: 'Enter a name for your firm.' }, { status: 400, headers: cors })
    }

    const supabase = createClient(SUPABASE_URL, serviceKey())

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
      return NextResponse.json({ error: 'Sign up first, then create your firm.' }, { status: 401, headers: cors })
    }

    const { data: existing } = await supabase
      .from('firm_members')
      .select('id')
      .eq('user_id', member.id)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ error: 'This account already belongs to a firm.' }, { status: 409, headers: cors })
    }

    // Retry on the astronomically unlikely duplicate rather than handing out
    // a code that already belongs to someone else.
    let firm: { id: string; name: string; join_code: string } | null = null
    for (let attempt = 0; attempt < 5 && !firm; attempt++) {
      const joinCode = newJoinCode()
      const { data, error } = await supabase
        .from('firms')
        .insert({ name: String(firmName).trim(), join_code: joinCode, created_by: member.id })
        .select('id, name, join_code')
        .single()
      if (!error) { firm = data; break }
      if (!/duplicate key|unique/i.test(error.message)) throw error
    }
    if (!firm) throw new Error('Could not allocate a join code. Try again.')

    const { error: memberError } = await supabase.from('firm_members').insert({
      firm_id: firm.id,
      user_id: member.id,
      role: 'admin',
      full_name: String(fullName ?? '').trim() || member.email,
      email: member.email,
    })
    if (memberError) {
      // Don't leave a firm nobody can reach.
      await supabase.from('firms').delete().eq('id', firm.id)
      throw memberError
    }

    console.log('[create-firm]', member.email, 'created', firm.name)
    return NextResponse.json(
      { success: true, firmId: firm.id, firmName: firm.name, joinCode: firm.join_code },
      { headers: cors }
    )
  } catch (err: any) {
    console.error('[create-firm] error:', err)
    return NextResponse.json(
      { error: err?.message || 'Could not create the firm. Try again.' },
      { status: 500, headers: cors }
    )
  }
}
