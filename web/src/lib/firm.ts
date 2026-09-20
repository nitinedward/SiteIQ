import { supabase } from '@/lib/supabase'

// ── GENERATE A RANDOM 6-CHARACTER JOIN CODE ────────────────────────────────
// e.g. "ABC123" — used for engineers to join a firm. Ported from the mobile
// app's lib/firm.ts so web and mobile signup share identical logic.
export const generateJoinCode = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

// ── CREATE A NEW FIRM ───────────────────────────────────────────────────────
// Called during signup when the user chooses "Create firm". They become admin.
/** Starts a firm and makes this account its admin, through the server —
 *  the browser has no session until the confirmation email is opened, and
 *  an unauthenticated insert into `firms` is rightly refused. The server
 *  allocates the join code too. See api/firms/create. */
export const createFirm = async (
  firmName: string,
  userId: string,
  userEmail: string,
  userName: string
): Promise<{ firmId: string; joinCode: string }> => {
  const { data: { session } } = await supabase.auth.getSession()

  const res = await fetch('/api/firms/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify({
      firmName: firmName.trim(),
      userId,
      email: userEmail.trim(),
      fullName: userName.trim(),
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || 'Could not create the firm. Please try again.')
  }
  return { firmId: data.firmId, joinCode: data.joinCode }
}

// ── JOIN AN EXISTING FIRM ────────────────────────────────────────────────────
// Called during signup when the user enters a join code.
/** Joins a firm by its code, through the server.
 *
 *  This can't be done from the browser: row-level security only shows a firm
 *  to people already in it, so the code lookup came back empty and every
 *  attempt reported "that join code is incorrect" whatever was typed — and
 *  with email confirmation on there is no session yet to insert the
 *  membership with either. See api/firms/join.
 *
 *  Throws with a message worth showing, so a wrong code, an account already
 *  in a firm and a connection problem no longer read the same. */
export const joinFirm = async (
  joinCode: string,
  userId: string,
  userEmail: string,
  userName: string
): Promise<{ firmId: string; firmName: string }> => {
  const { data: { session } } = await supabase.auth.getSession()

  const res = await fetch('/api/firms/join', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify({
      joinCode: joinCode.trim(),
      userId,
      email: userEmail.trim(),
      fullName: userName.trim(),
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || 'Could not join the firm. Please try again.')
  }
  return { firmId: data.firmId, firmName: data.firmName }
}
