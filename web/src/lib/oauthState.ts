import { createHmac, timingSafeEqual } from 'crypto'

/**
 * The `state` that carries a firm through the Microsoft 365 sign-in.
 *
 * It used to be the bare firm id, so anyone could start the sign-in with
 * another firm's id and link their own Microsoft account to that firm —
 * whose reports would then be uploaded to the stranger's OneDrive. It is now
 * issued by the server, only to an admin of that firm, signed so it can't be
 * altered, and short-lived.
 *
 * Signed with a key derived from the service key, which only the server
 * holds — no extra secret to configure.
 */

const TTL_MS = 15 * 60 * 1000

function signingKey(): Buffer {
  const service = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()
  if (!service) throw new Error('Server key not configured')
  return createHmac('sha256', service).update('siteiq:ms-oauth-state').digest()
}

const mac = (body: string) => createHmac('sha256', signingKey()).update(body).digest('base64url')

export function signOAuthState(firmId: string, userId: string): string {
  const body = Buffer.from(JSON.stringify({ f: firmId, u: userId, e: Date.now() + TTL_MS })).toString('base64url')
  return `${body}.${mac(body)}`
}

/** The firm a state was issued for, or null if it was altered or expired. */
export function verifyOAuthState(state: string | null): { firmId: string; userId: string } | null {
  if (!state) return null
  const [body, sig] = state.split('.')
  if (!body || !sig) return null
  const expected = Buffer.from(mac(body))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  try {
    const { f, u, e } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (typeof f !== 'string' || typeof u !== 'string' || typeof e !== 'number' || e < Date.now()) return null
    return { firmId: f, userId: u }
  } catch {
    return null
  }
}
