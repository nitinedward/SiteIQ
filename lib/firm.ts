import { supabase } from './supabase';

const DEFAULT_APP_URL = 'https://www.site-iq.co.nz';

/** The apex 308-redirects to www; posting straight to www keeps the body
 *  off a redirect hop. Matches lib/transcribe.ts. */
function apiBase(): string {
  const raw = (process.env.EXPO_PUBLIC_APP_URL ?? DEFAULT_APP_URL).trim().replace(/\/+$/, '');
  return raw.replace(/^https:\/\/site-iq\.co\.nz/i, DEFAULT_APP_URL);
}

// ── GENERATE A RANDOM 6-DIGIT JOIN CODE ────────────────
// e.g. "ABC123" — used for engineers to join a firm
export const generateJoinCode = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

// ── GET THE CURRENT USER'S FIRM ────────────────────────
// Uses two separate queries instead of a nested join
// because Supabase nested joins can be unreliable
export const getUserFirm = async (): Promise<{
  firm: { id: string; name: string; join_code: string } | null;
  role: 'admin' | 'member' | null;
}> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { firm: null, role: null };

  // Step 1 — get the user's firm membership
  const { data: memberData } = await supabase
    .from('firm_members')
    .select('role, firm_id')
    .eq('user_id', user.id)
    .single();

  if (!memberData) return { firm: null, role: null };

  // Step 2 — get the firm details using the firm_id
  const { data: firmData } = await supabase
    .from('firms')
    .select('id, name, join_code')
    .eq('id', memberData.firm_id)
    .single();

  if (!firmData) return { firm: null, role: null };

  return {
    firm: firmData,
    role: memberData.role as 'admin' | 'member',
  };
};

// ── CHECK IF CURRENT USER IS ADMIN ─────────────────────
export const isAdmin = async (): Promise<boolean> => {
  const { role } = await getUserFirm();
  return role === 'admin';
};

// ── CREATE A NEW FIRM ──────────────────────────────────
// Called during signup when engineer chooses "Create firm"
// They automatically become admin
/** Starts a firm and makes this account its admin, through the server: the
 *  app has no session until the confirmation email is opened, and an
 *  unauthenticated insert into `firms` is rightly refused. The server
 *  allocates the join code too. */
export const createFirm = async (
  firmName: string,
  userId: string,
  userEmail: string,
  userName: string
): Promise<{ firmId: string; joinCode: string }> => {
  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(`${apiBase()}/api/firms/create`, {
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
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || 'Could not create the firm. Please try again.');
  }
  return { firmId: data.firmId, joinCode: data.joinCode };
};

// ── JOIN AN EXISTING FIRM ──────────────────────────────
// Called during signup when engineer enters a join code
/** Joins a firm by its code, through the server.
 *
 *  Doing this from the device could never work: row-level security only
 *  shows a firm to people already in it, so the code lookup came back empty
 *  and every attempt reported "invalid code" whatever was typed — and with
 *  email confirmation on there is no session yet to insert the membership
 *  with. The server checks the code and creates the membership.
 *
 *  Throws with a message worth showing: the caller no longer has to guess
 *  that any failure means a wrong code.
 */
export const joinFirm = async (
  joinCode: string,
  userId: string,
  userEmail: string,
  userName: string
): Promise<{ firmId: string; firmName: string }> => {
  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(`${apiBase()}/api/firms/join`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Present once the account is confirmed; the server falls back to
      // checking the named account otherwise.
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify({
      joinCode: joinCode.trim(),
      userId,
      email: userEmail.trim(),
      fullName: userName.trim(),
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || 'Could not join the firm. Please try again.');
  }
  return { firmId: data.firmId, firmName: data.firmName };
};