import { supabase } from './supabase';

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
export const createFirm = async (
  firmName: string,
  userId: string,
  userEmail: string,
  userName: string
): Promise<{ firmId: string; joinCode: string } | null> => {
  const joinCode = generateJoinCode();

  // Create the firm
  const { data: firm, error: firmError } = await supabase
    .from('firms')
    .insert({
      name: firmName.trim(),
      join_code: joinCode,
      created_by: userId,
    })
    .select()
    .single();

  if (firmError) {
    console.error('Create firm error:', firmError);
    return null;
  }

  // Add the creator as admin
  const { error: memberError } = await supabase
    .from('firm_members')
    .insert({
      firm_id: firm.id,
      user_id: userId,
      role: 'admin',
      full_name: userName,
      email: userEmail,
    });

  if (memberError) {
    console.error('Add admin error:', memberError);
    return null;
  }

  return { firmId: firm.id, joinCode };
};

// ── JOIN AN EXISTING FIRM ──────────────────────────────
// Called during signup when engineer enters a join code
export const joinFirm = async (
  joinCode: string,
  userId: string,
  userEmail: string,
  userName: string
): Promise<{ firmId: string; firmName: string } | null> => {
  // Find the firm with this join code
  const { data: firm, error: firmError } = await supabase
    .from('firms')
    .select('id, name')
    .eq('join_code', joinCode.toUpperCase().trim())
    .single();

  if (firmError || !firm) {
    console.error('Join firm error: invalid code');
    return null;
  }

  // Add the engineer as a member
  const { error: memberError } = await supabase
    .from('firm_members')
    .insert({
      firm_id: firm.id,
      user_id: userId,
      role: 'member',
      full_name: userName,
      email: userEmail,
    });

  if (memberError) {
    console.error('Join firm member error:', memberError);
    return null;
  }

  return { firmId: firm.id, firmName: firm.name };
};