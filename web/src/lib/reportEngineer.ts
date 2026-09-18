import type { SupabaseClient } from '@supabase/supabase-js'

/** Used only for a firm that hasn't set its own domain and has no row to read
 *  (the column arrives with sql/firm_email_domain.sql). */
const FALLBACK_EMAIL_DOMAIN = ''

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
  firmId?: string | null,
): Promise<ReportEngineer> {
  const userId = inspection.created_by ?? inspection.user_id ?? inspection.finalised_by ?? null

  const [{ data: member }, { data: firm }] = await Promise.all([
    userId
      ? supabase.from('firm_members').select('full_name').eq('user_id', userId).single()
      : Promise.resolve({ data: null }),
    firmId
      ? supabase.from('firms').select('report_email_domain').eq('id', firmId).single()
      : Promise.resolve({ data: null }),
  ])

  const name = member?.full_name?.trim() || 'Site Engineer'
  const user = name.toLowerCase().replace(/\s+/g, '.').replace(/[^a-z.]/g, '')
  // A firm that hasn't set a domain gets no address, rather than one at
  // somebody else's company.
  const domain = (firm as any)?.report_email_domain?.trim() || FALLBACK_EMAIL_DOMAIN
  return { name, user, email: domain ? `${user}@${domain}` : '' }
}

/**
 * The time a report prints against its date: the time recorded when the
 * inspection was started, else when the report row was created, read in
 * New Zealand time. Blank if there's neither.
 */
export function inspectionTime(inspection: { start_time?: string | null; created_at?: string | null }): string {
  const recorded = inspection.start_time?.trim()
  if (recorded) return recorded
  if (!inspection.created_at) return ''
  const d = new Date(inspection.created_at)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-NZ', {
    timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}
