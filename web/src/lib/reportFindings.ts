/** Tying the findings in a generated report back to the site notes they came
 *  from.
 *
 *  A report is written from the observations recorded on site, but the AI
 *  rewrites them into formal prose — so without something carrying identity
 *  across that step, nothing afterwards knows which sentence belongs to which
 *  note. The generator asks for each findings line to be prefixed with a
 *  reference to its observation; this reads those references back off and
 *  strips them, so the document itself is unchanged.
 *
 *  Lives here rather than in the route because a Next.js route file may only
 *  export route handlers — exporting a helper from one fails the build. */

import type { FindingLine } from './reportAnchors'

/** The observation each findings line came from, by the [#n] reference the
 *  model is asked to keep on the front of it.
 *
 *  Observations are referenced by position rather than by id: a UUID in a
 *  prompt is a long string a model can quietly mistype, and a wrong id would
 *  file a finding against the wrong note. A small integer either matches a
 *  row or doesn't.
 *
 *  Returns the lines with their references stripped — the document reads
 *  exactly as it did before — alongside the text per observation id. A line
 *  with no reference, or one pointing at nothing, still goes in the report;
 *  it simply isn't attributed. */
export function splitFindingRefs(
  lines: string[],
  observationIds: string[]
): { cleaned: FindingLine[]; byObservation: Map<string, string> } {
  const cleaned: FindingLine[] = []
  const byObservation = new Map<string, string>()

  for (const line of lines) {
    const match = line.match(/^\[?#(\d+)\]?[\s:.-]*(.*)$/)
    if (!match) {
      cleaned.push({ text: line })
      continue
    }
    const text = match[2].trim()
    if (!text) continue

    const id = observationIds[Number(match[1]) - 1]
    // The line goes in the report either way; only an attributed one carries
    // an anchor tying it back to its note.
    cleaned.push({ text, observationId: id ?? null })

    if (!id) continue
    // Two lines about the same observation read as one note, in order.
    const existing = byObservation.get(id)
    byObservation.set(id, existing ? `${existing} ${text}` : text)
  }

  return { cleaned, byObservation }
}

/** Removes the [#n] references from AI output that is used as-is rather than
 *  rendered line by line. They are working notation, never report text. */
export function stripFindingRefs(text: string): string {
  return text.replace(/^(\s*[-•]\s*)\[?#\d+\]?[\s:.-]*/gm, '$1')
}
