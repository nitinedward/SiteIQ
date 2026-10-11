/**
 * How site notes appear in a report's Observations/Comments section, and how
 * they're read back out of it.
 *
 * Every report — plain notes text or AI-written — lists exactly one bullet
 * per site note, in the notes' order, as "<note label>: <text>". Keeping that
 * shape is what lets finalising find each note's final wording again, after
 * any edits made in the editor.
 */

export type ReportNoteSource = {
  id: string
  zone_label?: string | null
  transcript?: string | null
  notes?: string | null
}

export function noteLabel(note: ReportNoteSource): string {
  return (note.zone_label || '').trim() || 'General Observation'
}

export function noteDictation(note: ReportNoteSource): string {
  return (note.transcript || note.notes || '').trim()
}

export function noteBulletLine(note: ReportNoteSource, text: string): string {
  return `${noteLabel(note)}: ${text.trim()}`
}

/** Paragraph text from a .docx body, in document order. */
export function docxParagraphTexts(documentXml: string): string[] {
  return [...documentXml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
    .map(m => [...m[0].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map(t => t[1]).join(''))
    .map(decodeXml)
    .map(t => t.trim())
    .filter(Boolean)
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * Each note's finding in a report laid out a block per note: the paragraphs
 * between the hidden marker filling the block left around it
 * (lib/observationBlocks, findingBookmark), joined one per line. A note
 * whose marker the editor dropped is left out.
 */
export function blockNoteWording(documentXml: string, notes: ReportNoteSource[], bookmarkFor: (noteId: string) => string): Map<string, string> {
  const found = new Map<string, string>()
  for (const note of notes) {
    const start = documentXml.match(new RegExp(`<w:bookmarkStart\\b[^>]*\\bw:name="${bookmarkFor(note.id)}"[^>]*/>`))
    const id = start?.[0].match(/\bw:id="(\d+)"/)?.[1]
    if (!start || start.index === undefined || !id) continue
    const from = start.index + start[0].length
    const end = documentXml.slice(from).search(new RegExp(`<w:bookmarkEnd\\b[^>]*\\bw:id="${id}"`))
    if (end === -1) continue
    // The text between the two marks, a line per paragraph.
    const text = documentXml.slice(from, from + end)
      .split(/<\/w:p>/)
      .map(part => [...part.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map(t => t[1]).join(''))
      .map(decodeXml)
      .map(t => t.trim())
      .filter(Boolean)
      .join('\n')
    if (text) found.set(note.id, text)
  }
  return found
}

/**
 * Find each note's bullet in the report and return the text after its label.
 * Notes are matched in order, each to the first unused paragraph after the
 * previous match that starts with "<label>:", so two notes sharing a label
 * still pair up correctly. A note whose label isn't found is left out.
 */
export function matchNoteWording(paragraphs: string[], notes: ReportNoteSource[]): Map<string, string> {
  const found = new Map<string, string>()
  let from = 0
  for (const note of notes) {
    const prefix = `${noteLabel(note)}:`.toLowerCase()
    for (let i = from; i < paragraphs.length; i++) {
      const text = paragraphs[i].replace(/^[••\-–·*\s]+/, '')
      if (!text.toLowerCase().startsWith(prefix)) continue
      const wording = text.slice(prefix.length).trim()
      if (wording) found.set(note.id, wording)
      from = i + 1
      break
    }
  }
  return found
}
