import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import jwt from 'jsonwebtoken'

/**
 * Who is calling an API route, and whether they may touch what they asked
 * for.
 *
 * The routes use the service key, which sees every firm's rows, so the
 * database's own firm rules (access_rules.sql) don't protect them: each
 * route has to check the caller itself. Several firms share this
 * deployment, and a report's id turns up in addresses, history and shared
 * links — knowing it must not be enough to read, rewrite or replace that
 * firm's report.
 *
 * Three kinds of caller:
 *  - the web app: sends the signed-in user's Supabase token as
 *    `Authorization: Bearer …` (see lib/apiFetch); checked against the firm
 *    that owns the report or project
 *  - the OnlyOffice Document Server: can't sign in, but signs its requests
 *    with the shared JWT secret (token.enable.request.outbox is on)
 *  - the phone app, as shipped before it sent a token — see
 *    legacyMobileAllowed()
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co'
const admin = () => createClient(SUPABASE_URL, (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim())

export type Caller = { userId: string; firmId: string; role: string }

/** Route outcome: either who was let in, or the response to send back. */
export type Authorised<T> = { ok: true } & T | { ok: false; response: NextResponse }

const deny = (status: number, error: string): { ok: false; response: NextResponse } =>
  ({ ok: false, response: NextResponse.json({ error }, { status }) })

/**
 * The phone app in the stores calls /api/docs/ai-generate, the report
 * download and /api/transcribe without a token. Until a build that sends
 * one is out, those three still accept tokenless calls — every other route
 * refuses them. Set ALLOW_LEGACY_MOBILE_API=false in Vercel once phones have
 * updated, and they are closed too.
 */
export function legacyMobileAllowed(): boolean {
  return (process.env.ALLOW_LEGACY_MOBILE_API ?? 'true').trim().toLowerCase() !== 'false'
}

function bearer(request: NextRequest): string | null {
  return request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || null
}

/** The signed-in user and their firm, or null without a valid token. */
export async function getCaller(request: NextRequest): Promise<Caller | null> {
  const token = bearer(request)
  if (!token) return null
  const supabase = admin()
  const { data: { user } } = await supabase.auth.getUser(token)
  if (!user) return null
  const { data: member } = await supabase
    .from('firm_members')
    .select('firm_id, role')
    .eq('user_id', user.id)
    .single()
  if (!member?.firm_id) return null
  return { userId: user.id, firmId: member.firm_id, role: member.role ?? '' }
}

/** Any signed-in member of a firm — for routes that touch no one firm's
 *  records but cost money (AI calls). */
export async function requireCaller(request: NextRequest): Promise<Authorised<{ caller: Caller }>> {
  const caller = await getCaller(request)
  return caller ? { ok: true, caller } : deny(401, 'Not signed in')
}

/** A signed-in member of any firm — or, while legacyMobileAllowed(), a call
 *  with no token at all (`caller` null), for the shipped phone app. */
export async function requireCallerOrLegacyMobile(request: NextRequest): Promise<Authorised<{ caller: Caller | null }>> {
  if (!bearer(request)) {
    if (legacyMobileAllowed()) {
      console.warn('[auth] tokenless call let through for the shipped phone app:', request.nextUrl.pathname)
      return { ok: true, caller: null }
    }
    return deny(401, 'Not signed in')
  }
  const caller = await getCaller(request)
  return caller ? { ok: true, caller } : deny(401, 'Not signed in')
}

async function inspectionFirm(inspectionId: string): Promise<string | null> {
  const { data } = await admin()
    .from('inspections')
    .select('projects(firm_id)')
    .eq('id', inspectionId)
    .maybeSingle()
  return (data as any)?.projects?.firm_id ?? null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A signed-in member of the firm that owns the report. With `legacyMobile`,
 * a call with no token at all is let through while legacyMobileAllowed() —
 * `caller` is then null. A token that is present but invalid is always
 * refused.
 */
export async function requireInspectionAccess(
  request: NextRequest,
  inspectionId: string | null | undefined,
  { legacyMobile = false }: { legacyMobile?: boolean } = {},
): Promise<Authorised<{ caller: Caller | null }>> {
  if (!inspectionId || !UUID.test(inspectionId)) return deny(400, 'Missing or invalid inspectionId')

  if (!bearer(request)) {
    if (legacyMobile && legacyMobileAllowed()) {
      console.warn('[auth] tokenless call let through for the shipped phone app:', request.nextUrl.pathname)
      return { ok: true, caller: null }
    }
    return deny(401, 'Not signed in')
  }

  const caller = await getCaller(request)
  if (!caller) return deny(401, 'Not signed in')
  const firmId = await inspectionFirm(inspectionId)
  if (!firmId) return deny(404, 'Report not found')
  // Not found rather than forbidden, so a guess learns nothing about
  // whether another firm's report exists.
  if (firmId !== caller.firmId) return deny(404, 'Report not found')
  return { ok: true, caller }
}

/** A signed-in member of the firm that owns the project. */
export async function requireProjectAccess(
  request: NextRequest,
  projectId: string | null | undefined,
): Promise<Authorised<{ caller: Caller }>> {
  if (!projectId || !UUID.test(projectId)) return deny(400, 'Missing or invalid projectId')
  const caller = await getCaller(request)
  if (!caller) return deny(401, 'Not signed in')
  const { data: project } = await admin().from('projects').select('firm_id').eq('id', projectId).maybeSingle()
  if (!project || project.firm_id !== caller.firmId) return deny(404, 'Project not found')
  return { ok: true, caller }
}

/** A signed-in member of the firm that owns a site note. A note reaches its
 *  firm through its project or, for an older row with no project, its
 *  report — the same two routes access_rules.sql takes. */
export async function requireNoteAccess(
  request: NextRequest,
  observationId: string | null | undefined,
): Promise<Authorised<{ caller: Caller }>> {
  if (!observationId || !UUID.test(observationId)) return deny(400, 'Missing or invalid observationId')
  const caller = await getCaller(request)
  if (!caller) return deny(401, 'Not signed in')
  // Plain lookups rather than embedded selects, which depend on the
  // database declaring those relationships.
  const supabase = admin()
  const { data: note } = await supabase
    .from('observations')
    .select('project_id, inspection_id')
    .eq('id', observationId)
    .maybeSingle()
  if (!note) return deny(404, 'Site note not found')
  const [{ data: project }, inspectionFirmId] = await Promise.all([
    note.project_id
      ? supabase.from('projects').select('firm_id').eq('id', note.project_id).maybeSingle()
      : Promise.resolve({ data: null }),
    note.inspection_id ? inspectionFirm(note.inspection_id) : Promise.resolve(null),
  ])
  if (![(project as any)?.firm_id, inspectionFirmId].includes(caller.firmId)) return deny(404, 'Site note not found')
  return { ok: true, caller }
}

/** A signed-in member of `firmId` — and an admin of it, with `admin`. */
export async function requireFirmAccess(
  request: NextRequest,
  firmId: string | null | undefined,
  { admin: mustBeAdmin = false }: { admin?: boolean } = {},
): Promise<Authorised<{ caller: Caller }>> {
  const caller = await getCaller(request)
  if (!caller) return deny(401, 'Not signed in')
  if (!firmId || caller.firmId !== firmId) return deny(403, 'Not a member of this firm')
  if (mustBeAdmin && caller.role !== 'admin') return deny(403, 'Only a firm admin can do this')
  return { ok: true, caller }
}

/** The report a Document Server key belongs to: keys are
 *  doc-<inspection id>-<version> (getDocKey in lib/docStorage). */
export function inspectionIdFromDocKey(key: unknown): string | null {
  const m = typeof key === 'string' ? key.match(/^doc-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-/i) : null
  return m ? m[1] : null
}

/** For a request naming both a report and a Document Server key: the key
 *  must be that report's, or a caller could pass their own report's id with
 *  another firm's key. An absent key is fine. */
export function docKeyMismatch(docKey: unknown, inspectionId: string): { ok: false; response: NextResponse } | null {
  if (docKey === undefined || docKey === null || docKey === '') return null
  return inspectionIdFromDocKey(docKey) === inspectionId ? null : deny(400, 'That document key belongs to another report')
}

const onlyofficeSecret = () => (process.env.ONLYOFFICE_JWT_SECRET ?? '').replace(/^﻿/, '').trim()

/**
 * A request from the Document Server, verified by its signature, or null.
 * It signs with the shared secret, in the Authorization header or — for
 * save callbacks — also as `token` in the body. Returns what was signed:
 * the callback itself for a callback, so the route acts on that rather than
 * on an unsigned body that could say anything.
 */
export function verifyOnlyOfficeRequest(request: NextRequest, body?: any): Record<string, any> | null {
  const secret = onlyofficeSecret()
  if (!secret) return null
  const candidates = [body?.token, bearer(request)].filter((t): t is string => typeof t === 'string' && t.length > 0)
  for (const token of candidates) {
    try {
      const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as any
      // The header form wraps what was signed in `payload`.
      return (decoded?.payload && typeof decoded.payload === 'object') ? decoded.payload : decoded
    } catch {
      // try the next one
    }
  }
  return null
}
