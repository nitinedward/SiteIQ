/**
 * Which of a report's sketches it holds when nobody has just ticked them:
 * the ones recorded as in the report, plus any that are new since its
 * sketch section was last written — a sketch attached to a site note should
 * turn up in the report without anyone hunting for it. One left out on
 * purpose (seen, but not in the report) stays out.
 *
 * Before anything has been recorded, every sketch is in.
 *
 * Pure, so the server (rebuilds without a fresh selection) and the report
 * page (what to tick on opening) apply the same rule.
 */
export function sketchesHeldByDefault(
  candidateIds: string[],
  recorded: { sketches: string[] | null; sketchesSeen: string[] | null },
): string[] {
  if (!recorded.sketches) return candidateIds
  const held = new Set(recorded.sketches)
  const seen = new Set(recorded.sketchesSeen ?? recorded.sketches)
  return candidateIds.filter(id => held.has(id) || !seen.has(id))
}

/** True for a sketch the report hasn't seen yet — shown as "New" on the
 *  report page, and offered with "Add to report". A report whose sketch
 *  section has never been written has seen none of them. */
export function isNewSketch(
  id: string,
  recorded: { sketches: string[] | null; sketchesSeen: string[] | null },
): boolean {
  if (!recorded.sketches) return true
  return !new Set(recorded.sketchesSeen ?? recorded.sketches).has(id)
}
