import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { createHash } from 'crypto'
import { requireInspectionAccess, inspectionIdFromDocKey } from '@/lib/apiAuth'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function OPTIONS() {
  return new NextResponse(null,
    { status: 200, headers: cors })
}

/** Where the Document Server may fetch and save a report: this app, or the
 *  storage the report lives in. A signed config pointing anywhere else
 *  would send the document (or its saves) to whoever wrote it. */
function allowedHost(url: unknown, request: NextRequest): boolean {
  if (typeof url !== 'string') return false
  try {
    const host = new URL(url).host
    const supabaseHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co').host
    return host === request.headers.get('host') || host === supabaseHost
  } catch {
    return false
  }
}

/**
 * Signs an editor config for the Document Server.
 *
 * Only for a report the caller's firm owns (the config's document key names
 * it — doc-<inspection id>-…), and only a config whose document and save
 * callback point at this app or its storage. Anything else could be signed
 * here and used to open another firm's report, or to route a report's saves
 * elsewhere.
 */
export async function POST(req: NextRequest) {
  try {
    const payload = await req.json()

    const inspectionId = inspectionIdFromDocKey(payload?.document?.key)
    const access = await requireInspectionAccess(req, inspectionId)
    if (!access.ok) return access.response

    const callbackUrl = payload?.editorConfig?.callbackUrl
    const documentUrl = payload?.document?.url
    const callbackOk = allowedHost(callbackUrl, req) &&
      new URL(callbackUrl).pathname === `/api/docs/${inspectionId}`
    if (!callbackOk || !allowedHost(documentUrl, req)) {
      return NextResponse.json({ error: 'That editor config points somewhere this app does not serve' }, { status: 400, headers: cors })
    }

    // Strip a leading BOM (U+FEFF) + surrounding whitespace — same class of
    // bug already found in the Anthropic/Supabase keys. Here it wouldn't
    // crash (this secret signs a JWT, it's never a raw header value), but
    // it would silently change the actual bytes used for HMAC-SHA256, so
    // Vercel's stored secret and the OnlyOffice container's configured
    // secret would "look" identical while producing different signatures —
    // exactly the "document security token is not correctly formed" symptom.
    const secret = (process.env.ONLYOFFICE_JWT_SECRET ?? '').replace(/^﻿/, '').trim()

    if (!secret) {
      console.error('ONLYOFFICE_JWT_SECRET is not set')
      return NextResponse.json(
        { error: 'JWT secret not configured' },
        { status: 500, headers: cors }
      )
    }

    // Enough to tell two secrets apart when the Document Server rejects a
    // token, without writing any of the secret itself into the logs.
    console.log(
      '[token] secret length:', secret.length,
      '| fingerprint:', createHash('sha256').update(secret).digest('hex').slice(0, 8)
    )

    const token = jwt.sign(payload, secret, {
      algorithm: 'HS256',
    })

    return NextResponse.json(
      { token },
      { headers: cors }
    )

  } catch (err: any) {
    console.error('[token] error:', err.message)
    return NextResponse.json(
      { error: err.message },
      { status: 500, headers: cors }
    )
  }
}
