import type { SupabaseClient } from '@supabase/supabase-js'

/** Where a report's engineer address is built, until firms can set their own. */
const EMAIL_DOMAIN = 'silvesterclark.co.nz'

export type ReportEngineer = {
  /** "Nitin Edward" — what the report prints as the engineer. */
  name: string
  /** "nitin.edward" — for templates that append their own @domain. */
  user: string
  /** "nitin.edward@silvesterclark.co.nz" */
  email: string
}

/**
 * Who carried out the inspection: whoever started the report, else whoever
 * finalised it (inspections created before created_by existed have only
 * that). Falls back to "Site Engineer" when neither is recorded.
 */
export async function loadReportEngineer(
  supabase: SupabaseClient,
  inspection: { created_by?: string | null; user_id?: string | null; finalised_by?: string | null },
): Promise<ReportEngineer> {
  const userId = inspection.created_by ?? inspection.user_id ?? inspection.finalised_by ?? null

  const { data: member } = userId
    ? await supabase.from('firm_members').select('full_name').eq('user_id', userId).single()
    : { data: null }

  const name = member?.full_name?.trim() || 'Site Engineer'
  const user = name.toLowerCase().replace(/\s+/g, '.').replace(/[^a-z.]/g, '')
  return { name, user, email: `${user}@${EMAIL_DOMAIN}` }
}
