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
    async: false,
    filetype: 'docx',
    outputtype: 'pdf',
    key: conversionKey,
    title: `${inspectionId}.docx`,
    url: sourceUrl,
  }
  const token = jwt.sign(payload, secret, { algorithm: 'HS256' })

  let fileUrl: string | null = null
  // ConvertService can still report "still converting" even with async:
  // false on a busy server — poll the same key a few times before giving up.
  for (let attempt = 0; attempt < 5 && !fileUrl; attempt++) {
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
    // <FileResult><FileUrl>...</FileUrl><EndConvert>true</EndConvert></FileResult>),
    // not the JSON the docs imply — confirmed by direct testing against
    // this deployment. Handle both rather than assuming one.
    const parsed = parseConvertResponse(rawText)
    if (parsed.error) {
      const message = CONVERT_ERROR_MESSAGES[parsed.error] ?? `OnlyOffice conversion error code ${parsed.error}`
      throw new Error(message)
    }
    if (parsed.endConvert && parsed.fileUrl) {
      fileUrl = parsed.fileUrl
      break
    }
    await new Promise(r => setTimeout(r, 1500))
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
  const endConvertMatch = text.match(/<EndConvert>(true|false)<\/EndConvert>/)
  return {
    error: errorMatch ? Number(errorMatch[1]) : undefined,
    fileUrl: fileUrlMatch ? fileUrlMatch[1] : undefined,
    endConvert: endConvertMatch ? endConvertMatch[1] === 'true' : undefined,
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
