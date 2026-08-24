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
export const createFirm = async (
  firmName: string,
  userId: string,
  userEmail: string,
  userName: string
): Promise<{ firmId: string; joinCode: string } | null> => {
  const joinCode = generateJoinCode()

  const { data: firm, error: firmError } = await supabase
    .from('firms')
    .insert({ name: firmName.trim(), join_code: joinCode, created_by: userId })
    .select()
    .single()

  if (firmError) {
    console.error('[createFirm] error:', firmError)
    return null
  }

  const { error: memberError } = await supabase
    .from('firm_members')
    .insert({ firm_id: firm.id, user_id: userId, role: 'admin', full_name: userName, email: userEmail })

  if (memberError) {
    console.error('[createFirm] add admin error:', memberError)
    return null
  }

  return { firmId: firm.id, joinCode }
}

// ── JOIN AN EXISTING FIRM ────────────────────────────────────────────────────
// Called during signup when the user enters a join code.
export const joinFirm = async (
  joinCode: string,
  userId: string,
  userEmail: string,
  userName: string
): Promise<{ firmId: string; firmName: string } | null> => {
  const { data: firm, error: firmError } = await supabase
    .from('firms')
    .select('id, name')
    .eq('join_code', joinCode.toUpperCase().trim())
    .single()

  if (firmError || !firm) {
    console.error('[joinFirm] invalid code')
    return null
  }

  const { error: memberError } = await supabase
    .from('firm_members')
    .insert({ firm_id: firm.id, user_id: userId, role: 'member', full_name: userName, email: userEmail })

  if (memberError) {
    console.error('[joinFirm] add member error:', memberError)
    return null
  }

  return { firmId: firm.id, firmName: firm.name }
}
