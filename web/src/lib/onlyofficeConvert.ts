import jwt from 'jsonwebtoken'
import { createClient } from '@supabase/supabase-js'

const getSecret = () =>
  (process.env.ONLYOFFICE_JWT_SECRET ?? '').replace(/^﻿/, '').trim()

const getOoUrl = () => process.env.ONLYOFFICE_SERVER_URL ?? 'http://localhost'

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
  (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()
)

/** Reads the current `reports/{inspectionId}.docx` object's last-modified
 *  timestamp, or null if it doesn't exist yet. Used to detect whether a
 *  force-save actually landed a new version. */
async function getDocUpdatedAt(inspectionId: string): Promise<string | null> {
  const supabase = getSupabase()
  const { data } = await supabase.storage
    .from('reports')
    .list('', { search: `${inspectionId}.docx` })
  const entry = data?.find(f => f.name === `${inspectionId}.docx`)
  return entry?.updated_at ?? null
}

/** Issues an OnlyOffice force-save command (signed with the JWT the
 *  Document Server requires for inbound requests — see
 *  local.json's token.enable.request.inbox), then polls storage for the
 *  resulting save callback to actually land, up to ~10s. Returns true if a
 *  new version was observed, false if it timed out (the caller should
 *  proceed cautiously — the doc may already have been current via normal
 *  autosave, or there may be no active editing session to save from).
 *
 *  docKey must match the `key` OnlyOffice was given when the editor was
 *  opened (the client uses `doc-${inspectionId}-${editorKey}`). */
export async function forceSaveAndWait(inspectionId: string, docKey: string): Promise<{ saved: boolean; commandOk: boolean; commandResponse: any }> {
  const secret = getSecret()
  const before = await getDocUpdatedAt(inspectionId)

  const payload = { c: 'forcesave', key: docKey }
  let commandResponse: any = null
  let commandOk = false
  try {
    const token = jwt.sign(payload, secret, { algorithm: 'HS256' })
    const res = await fetch(`${getOoUrl()}/coauthoring/CommandService.ashx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, token }),
    })
    commandResponse = await res.json().catch(() => ({}))
    // OnlyOffice's CommandService returns {error: 0} on success. Non-zero
    // commonly means "no active session for this key" (error 1) — the
    // document was likely already saved via normal autosave/close, so this
    // isn't necessarily fatal, just means there's nothing new to force-save.
    commandOk = commandResponse?.error === 0
    console.log('[forceSaveAndWait] Command response:', JSON.stringify(commandResponse))
  } catch (err) {
    console.error('[forceSaveAndWait] Command failed:', err)
  }

  // Poll for the save callback to persist a new version, regardless of
  // commandOk — an already-current doc means "before" never changes, which
  // is fine; we just don't want to convert mid-save.
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 1000))
    const after = await getDocUpdatedAt(inspectionId)
    if (after && after !== before) {
      console.log('[forceSaveAndWait] New version observed after', i + 1, 's')
      return { saved: true, commandOk, commandResponse }
    }
  }
  console.warn('[forceSaveAndWait] No new version observed within 10s — proceeding with whatever is currently stored')
  return { saved: false, commandOk, commandResponse }
}

/** Asks the Document Server about a document key. error 0 means a session
 *  is still open; error 1 means it knows nothing about the key, i.e. the
 *  session is gone and the file is safe to rewrite. */
export async function getSessionInfo(docKey: string): Promise<{ open: boolean; response: any }> {
  const secret = getSecret()
  if (!secret) return { open: false, response: { error: 'ONLYOFFICE_JWT_SECRET not configured' } }

  const payload = { c: 'info', key: docKey }
  try {
    const token = jwt.sign(payload, secret, { algorithm: 'HS256' })
    const res = await fetch(`${getOoUrl()}/coauthoring/CommandService.ashx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, token }),
    })
    const response = await res.json().catch(() => ({}))
    return { open: response?.error === 0, response }
  } catch (err: any) {
    return { open: false, response: { error: err.message } }
  }
}

/** Disconnects the open editing session for a document key.
 *
 *  Needed before rewriting a document underneath the editor: the open
 *  session still holds the pre-edit copy and flushes it back through the
 *  save callback afterwards, overwriting whatever was just written — which
 *  looks like the document "reverting to the original".
 *
 *  The `users` array is required. Verified against this build: c:"drop"
 *  without it answers error 5 (bad params), with it answers error 0;
 *  c:"forceclose" is not supported here at all. The id must match the one
 *  the editor was opened with (editorConfig.user.id). */
export async function dropEditingSession(
  docKey: string,
  userId = 'siteiq-user'
): Promise<{ ok: boolean; response: any }> {
  const secret = getSecret()
  if (!secret) return { ok: false, response: { error: 'ONLYOFFICE_JWT_SECRET not configured' } }

  const payload = { c: 'drop', key: docKey, users: [userId] }
  try {
    const token = jwt.sign(payload, secret, { algorithm: 'HS256' })
    const res = await fetch(`${getOoUrl()}/coauthoring/CommandService.ashx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, token }),
    })
    const response = await res.json().catch(() => ({}))
    console.log('[dropEditingSession]', docKey, JSON.stringify(response))
    return { ok: response?.error === 0, response }
  } catch (err: any) {
    console.error('[dropEditingSession] failed:', err)
    return { ok: false, response: { error: err.message } }
  }
}

/** Pushes a new title into a live editing session via the Document
 *  Server's `meta` command.
 *
 *  Without this, renaming from the editor's own title bar appears to work
 *  and then snaps back: onRequestRename only tells the integrator what the
 *  user typed, it does not change the open document, so the editor keeps
 *  showing the title it was opened with. (Verified against this build:
 *  CommandService accepts c:"meta" — it answers error 0 where the known
 *  c:"info" answers error 1 for the same key.)
 *
 *  Non-fatal by design: the name is already persisted by the caller, so a
 *  failure here only means the tab keeps the old label until reload. */
export async function setDocumentMeta(docKey: string, title: string): Promise<{ ok: boolean; response: any }> {
  const secret = getSecret()
  if (!secret) return { ok: false, response: { error: 'ONLYOFFICE_JWT_SECRET not configured' } }

  const payload = { c: 'meta', key: docKey, meta: { title } }
  try {
    const token = jwt.sign(payload, secret, { algorithm: 'HS256' })
    const res = await fetch(`${getOoUrl()}/coauthoring/CommandService.ashx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, token }),
    })
    const response = await res.json().catch(() => ({}))
    return { ok: response?.error === 0, response }
  } catch (err: any) {
    console.error('[setDocumentMeta] failed:', err)
    return { ok: false, response: { error: err.message } }
  }
}

/** Converts the currently-stored .docx for an inspection to PDF via
 *  OnlyOffice's ConvertService.ashx, and returns the PDF as a Buffer.
 *  Throws on failure — callers must not treat a thrown error as success. */
export async function convertDocxToPdf(inspectionId: string, appUrl: string): Promise<Buffer> {
  const secret = getSecret()
  if (!secret) throw new Error('ONLYOFFICE_JWT_SECRET not configured')

  // Same source the editor itself uses — already proven reliable and
  // cache-busted (see api/docs/[...path]/route.ts).
  const sourceUrl = `${appUrl}/api/docs/${inspectionId}?t=${Date.now()}`
  const conversionKey = `convert-${inspectionId}-${Date.now()}`

  const payload = {
    // async: true — a large, photo-heavy report can take 15s+ to convert on
    // this single-CPU server (confirmed by direct testing: 14.25s for a
    // 13MB docx with async:false, which blocks the whole request for that
    // long per attempt). async:true makes the server queue the job and
    // return immediately every time, so each poll below is fast — we
    // supply our own, much more generous, overall wait budget instead.
    async: true,
    filetype: 'docx',
    outputtype: 'pdf',
    key: conversionKey,
    title: `${inspectionId}.docx`,
    url: sourceUrl,
  }
  const token = jwt.sign(payload, secret, { algorithm: 'HS256' })

  let fileUrl: string | null = null
  // Up to ~90s total — generous headroom for a large, image-heavy report
  // on a single-CPU conversion server.
  for (let attempt = 0; attempt < 30 && !fileUrl; attempt++) {
    const res = await fetch(`${getOoUrl()}/ConvertService.ashx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, token }),
    })
    const rawText = await res.text().catch(() => '')
    if (!res.ok) {
      throw new Error(`OnlyOffice conversion request failed (${res.status}): ${rawText}`)
    }

    // OnlyOffice's actual response is XML by default
    // (<FileResult><Error>N</Error></FileResult> or
    // <FileResult><FileUrl>...</FileUrl><EndConvert>True</EndConvert></FileResult>
    // — capitalised "True", confirmed by direct testing), not the JSON the
    // docs imply. Handle both rather than assuming one.
    const parsed = parseConvertResponse(rawText)
    if (parsed.error) {
      const message = CONVERT_ERROR_MESSAGES[parsed.error] ?? `OnlyOffice conversion error code ${parsed.error}`
      throw new Error(message)
    }
    if (parsed.endConvert && parsed.fileUrl) {
      fileUrl = parsed.fileUrl
      break
    }
    await new Promise(r => setTimeout(r, 3000))
  }

  if (!fileUrl) throw new Error('OnlyOffice conversion did not complete in time')

  const pdfRes = await fetch(fileUrl)
  if (!pdfRes.ok) throw new Error(`Failed to fetch converted PDF (${pdfRes.status})`)
  return Buffer.from(await pdfRes.arrayBuffer())
}

function parseConvertResponse(text: string): { error?: number; fileUrl?: string; endConvert?: boolean } {
  // Try JSON first in case a different OnlyOffice version/config responds
  // that way, then fall back to the XML shape actually observed.
  try {
    const data = JSON.parse(text)
    return { error: data.error, fileUrl: data.fileUrl, endConvert: data.endConvert }
  } catch { /* not JSON — parse as XML below */ }

  const errorMatch      = text.match(/<Error>(-?\d+)<\/Error>/)
  const fileUrlMatch    = text.match(/<FileUrl>([^<]+)<\/FileUrl>/)
  // Case-insensitive — the real response capitalises it as "True"/"False".
  const endConvertMatch = text.match(/<EndConvert>(true|false)<\/EndConvert>/i)
  return {
    error: errorMatch ? Number(errorMatch[1]) : undefined,
    // XML-unescape — the real response entity-encodes the query string
    // (e.g. "&amp;" for "&").
    fileUrl: fileUrlMatch ? fileUrlMatch[1].replace(/&amp;/g, '&') : undefined,
    endConvert: endConvertMatch ? endConvertMatch[1].toLowerCase() === 'true' : undefined,
  }
}

// Empirically confirmed against this deployment: an invalid/mismatched JWT
// signature surfaces here as -8, not a generic auth code. Mapped explicitly
// so a future secret mismatch produces a message that actually points at
// the cause instead of a generic timeout.
const CONVERT_ERROR_MESSAGES: Record<number, string> = {
  [-8]: "Authentication failed — ONLYOFFICE_JWT_SECRET does not match the Document Server's configured secret",
  [-4]: 'OnlyOffice could not download the source document',
  [-3]: 'OnlyOffice conversion error (unsupported or corrupt document)',
  [-2]: 'OnlyOffice conversion timed out',
  [-1]: 'Unknown OnlyOffice conversion error',
}
