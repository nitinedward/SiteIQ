import AdmZip from 'adm-zip'
import { createClient } from '@supabase/supabase-js'
import { xmlEscape } from './templateProcessor'

/** Keeping a finding in the report tied to the site note it describes, both
 *  ways.
 *
 *  Generation wraps each finding in a Word content control tagged with its
 *  observation id. The tag travels inside the .docx, so when the engineer
 *  rewords a finding in the editor and OnlyOffice saves, the edited sentence
 *  can be read back out and stored against the same note — which is what
 *  makes a site note track the report rather than drift away from it.
 *
 *  A content control is the right anchor here because Word and OnlyOffice
 *  both preserve one across ordinary editing: typing inside it, reflowing it,
 *  moving it. What survives nothing is deletion — if someone deletes the
 *  whole bullet and retypes it, the anchor goes with it and that note simply
 *  stops tracking. The alternative, matching paragraphs back to notes by
 *  their text, guesses, and a wrong guess writes the wrong note. */

const TAG_PREFIX = 'obs:'

/** Bullet text is written with this prefix (see templateProcessor), which is
 *  presentation, not content — it is stripped when reading back. */
const BULLET_PREFIX = /^[••]\s*/

const RUN_PROPS = `<w:rPr><w:color w:val="000000"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>`

export type FindingLine = {
  text: string
  /** The observation this line describes, if it could be attributed. */
  observationId?: string | null
}

/** Word XML for the findings list: the same bullets as buildBulletXml, with
 *  each attributed line wrapped in a content control carrying its
 *  observation id. Unattributed lines are plain bullets, exactly as before. */
export function buildAnchoredBulletXml(lines: FindingLine[]): string {
  const usable = lines
    .map(l => ({ ...l, text: l.text.trim() }))
    .filter(l => l.text.length > 0)

  if (usable.length === 0) return `<w:p><w:r><w:t></w:t></w:r></w:p>`

  return usable.map((line, i) => {
    const para =
      `<w:p><w:pPr><w:ind w:left="360"/></w:pPr>` +
      `<w:r>${RUN_PROPS}<w:t xml:space="preserve">•  ${xmlEscape(line.text)}</w:t></w:r></w:p>`

    if (!line.observationId) return para

    // w:id is required and must be unique within the document; the value
    // itself carries no meaning. No w:lock: locking the control would stop
    // the editor deleting a finding, and being able to edit the report
    // freely matters more than keeping every anchor.
    return (
      `<w:sdt><w:sdtPr>` +
      `<w:alias w:val="Site note"/>` +
      `<w:tag w:val="${xmlEscape(TAG_PREFIX + line.observationId)}"/>` +
      `<w:id w:val="${900000 + i}"/>` +
      `</w:sdtPr><w:sdtContent>${para}</w:sdtContent></w:sdt>`
    )
  }).join('')
}

function xmlUnescape(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Reads the current text of every anchored finding out of a .docx.
 *
 *  Returns observation id → the text as it now reads in the document, which
 *  may be what was generated or whatever the engineer has since edited it to.
 *  Empty controls are skipped rather than returned blank: a half-deleted
 *  bullet should not wipe the note it came from. */
export function readAnchoredText(docx: Buffer): Map<string, string> {
  const found = new Map<string, string>()

  const xml = new AdmZip(docx).getEntry('word/document.xml')?.getData().toString('utf-8')
  if (!xml) return found

  // Each anchor is one content control around one paragraph, so the
  // non-greedy match reaches its own closing tag. Anything nested inside
  // would truncate it, which is why the anchors are written flat.
  const blocks = xml.match(/<w:sdt[ >][\s\S]*?<\/w:sdt>/g) ?? []

  for (const block of blocks) {
    const tag = block.match(/<w:tag\b[^>]*w:val="([^"]*)"/)?.[1]
    if (!tag || !tag.startsWith(TAG_PREFIX)) continue
    const observationId = xmlUnescape(tag.slice(TAG_PREFIX.length))
    if (!observationId) continue

    // Word splits edited text across several runs; the visible text is every
    // <w:t> in order.
    const runs = block.match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g) ?? []
    const text = runs
      .map(r => xmlUnescape(r.replace(/<w:t\b[^>]*>/, '').replace(/<\/w:t>$/, '')))
      .join('')
      .replace(BULLET_PREFIX, '')
      .trim()

    if (text) found.set(observationId, text)
  }

  return found
}

/** Built per call, never at import — a module-scope client throws on a
 *  missing key while `next build` collects page data. */
const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
  (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()
)

/** Stores how the report words each observation.
 *
 *  Writes `report_text` and nothing else. `transcript` is what was dictated
 *  or typed on site and is never touched: the on-site record and the report's
 *  wording are different things, and the report must not rewrite what someone
 *  observed.
 *
 *  Never throws. Returns how many rows were written, so callers can log it. */
export async function storeReportText(
  byObservation: Map<string, string>
): Promise<number> {
  if (byObservation.size === 0) return 0

  try {
    const supabase = getSupabase()
    const results = await Promise.all(
      Array.from(byObservation, ([id, report_text]) =>
        supabase.from('observations').update({ report_text }).eq('id', id)
      )
    )
    const failed = results.find(r => r.error)
    if (failed?.error) {
      // Includes the column not existing yet — see
      // web/sql/observation_report_text.sql.
      console.error('[reportAnchors] Could not store report wording:', failed.error.message)
      return 0
    }
    return byObservation.size
  } catch (err) {
    console.error('[reportAnchors] Could not store report wording:', err)
    return 0
  }
}

/** Pulls the edited findings out of a saved document and back onto their site
 *  notes. Never throws: this runs on the save path, and a report being stored
 *  safely matters more than the notes tracking it. */
export async function syncReportTextFromDocx(docx: Buffer): Promise<void> {
  try {
    const edited = readAnchoredText(docx)
    if (edited.size === 0) return // no anchors: generated before Stage 2, or all deleted

    const written = await storeReportText(edited)
    console.log('[reportAnchors] Site notes updated from the report:', written)
  } catch (err) {
    console.error('[reportAnchors] Could not sync site notes from the report:', err)
  }
}
