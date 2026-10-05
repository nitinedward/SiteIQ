import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { createHash } from 'crypto'
import { requireInspectionAccess, inspectionIdFromDocKey } from '@/lib/apiAuth'
import { supabaseUrl } from '@/lib/storageFetch'

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
    const host = new URL(url).host.toLowerCase()
    // This app as the browser reached it — however the platform reports
    // that — plus the configured app address and the storage host.
    const ours = new Set(
      [
        request.headers.get('host'),
        request.headers.get('x-forwarded-host'),
        request.nextUrl.host,
        safeHost(process.env.NEXT_PUBLIC_APP_URL),
        safeHost(supabaseUrl()),
      ]
        .filter((h): h is string => !!h)
        .flatMap(h => h.split(',').map(x => x.trim().toLowerCase()))
    )
    return ours.has(host)
  } catch {
    return false
  }
}

function safeHost(url: string | undefined): string | null {
  if (!url) return null
  try { return new URL(url.replace(/^﻿/, '').trim()).host } catch { return null }
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
    if (!inspectionId) {
      console.warn('[token] Refused: key names no report:', String(payload?.document?.key ?? '').slice(0, 48))
    }
    const access = await requireInspectionAccess(req, inspectionId)
    if (!access.ok) return access.response

    const callbackUrl = payload?.editorConfig?.callbackUrl
    const documentUrl = payload?.document?.url
    const callbackOk = allowedHost(callbackUrl, req) &&
      new URL(callbackUrl).pathname === `/api/docs/${inspectionId}`
    if (!callbackOk || !allowedHost(documentUrl, req)) {
      // Hosts only (no query strings, which carry signed tokens), so a
      // wrongly refused editor can be diagnosed from the logs.
      const hostOf = (u: unknown) => { try { return new URL(String(u)).host } catch { return String(u).slice(0, 40) } }
      console.warn('[token] Refused config:', JSON.stringify({
        callbackHost: hostOf(callbackUrl), callbackOk,
        documentHost: hostOf(documentUrl),
        host: req.headers.get('host'), forwardedHost: req.headers.get('x-forwarded-host'),
      }))
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
