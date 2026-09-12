import { createClient } from '@supabase/supabase-js'
import { reportFileName } from './reportFileName'

/** Looks up what a report is called, from its id alone — a custom name if
 *  one has been set, otherwise "<project> - Report <no>".
 *
 *  Server-side only: it reads with the service role key. The routes that
 *  serve or build a PDF each used to carry their own copy of this query;
 *  they share this one so a report can't end up called one thing in the
 *  viewer and another inside the file. */
export async function reportFileNameFor(inspectionId: string): Promise<string> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
    (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()
  )
  // select('*') rather than naming columns, so this keeps working whether
  // or not the optional report_file_name column exists yet.
  const { data } = await supabase
    .from('inspections')
    .select('*, projects(name)')
    .eq('id', inspectionId)
    .single()

  const custom = ((data as any)?.report_file_name ?? '').trim()
  return custom || reportFileName((data as any)?.projects?.name, (data as any)?.report_no, inspectionId)
}
