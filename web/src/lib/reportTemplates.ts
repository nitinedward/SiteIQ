import { supabase } from './supabase'

export type ReportTemplate = {
  id: string
  firm_id: string
  name: string
  file_url: string
  is_default: boolean
  updated_at: string
}

/** A firm's named report templates, default first. Empty if none (or the migration hasn't run). */
export async function loadReportTemplates(firmId: string): Promise<ReportTemplate[]> {
  if (!firmId) return []
  const { data, error } = await supabase
    .from('report_templates')
    .select('id, firm_id, name, file_url, is_default, updated_at')
    .eq('firm_id', firmId)
    .order('is_default', { ascending: false })
    .order('name', { ascending: true })
  if (error) { console.warn('[report templates] load failed:', error.message); return [] }
  return (data ?? []) as ReportTemplate[]
}

/** Label for the "no template chosen" option in a project's picker: "Firm default (Auckland)". */
export function defaultTemplateLabel(templates: ReportTemplate[]): string {
  const def = templates.find(t => t.is_default)
  return def ? `Firm default (${def.name})` : 'Firm default'
}
