import { createClient } from '@supabase/supabase-js'
import AdmZip from 'adm-zip'
import { loadDoc } from './docStorage'
import { docxParagraphTexts, matchNoteWording, noteLabel } from './reportNotes'

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
  (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()
)

export type WordingSyncResult = { updated: number; unmatched: string[] }

/**
 * Copy each site note's final wording out of a finalised report onto the
 * note (observations.report_text), including any edits made in the editor.
 * The dictated text is left as it was. Notes whose "<label>:" bullet can't
 * be found in the report are returned by label and left unchanged.
 */
export async function syncReportWordingToNotes(inspectionId: string): Promise<WordingSyncResult> {
  const supabase = getSupabase()

  const { data: notes, error } = await supabase
    .from('observations')
    .select('id, zone_label, transcript, notes')
    .eq('inspection_id', inspectionId)
    .order('id', { ascending: true })
  if (error) throw new Error('Could not load site notes: ' + error.message)
  if (!notes || notes.length === 0) return { updated: 0, unmatched: [] }

  const zip = new AdmZip(await loadDoc(inspectionId))
  const xml = zip.getEntry('word/document.xml')?.getData().toString('utf-8') ?? ''
  const wording = matchNoteWording(docxParagraphTexts(xml), notes)

  const now = new Date().toISOString()
  let updated = 0
  for (const note of notes) {
    const text = wording.get(note.id)
    if (!text) continue
    const { error: updateError } = await supabase
      .from('observations')
      .update({ report_text: text, report_text_updated_at: now })
      .eq('id', note.id)
    if (updateError) throw new Error('Could not save report wording: ' + updateError.message)
    updated++
  }

  return { updated, unmatched: notes.filter(n => !wording.has(n.id)).map(noteLabel) }
}
