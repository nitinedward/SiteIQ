import {
  forceSaveAndWait,
  dropEditingSession,
  getSessionInfo,
  getDocUpdatedAt,
} from '@/lib/onlyofficeConvert'

const POLL_MS = 750
// ~4.5s of silence before calling it settled. Three polls (~2.2s) was not
// enough headroom: the Document Server's parting save can arrive several
// seconds after the editor disconnects, and anything that lands after the
// rewrite overwrites it.
const SETTLE_POLLS = 6
const MAX_POLLS = 30        // ~22s ceiling

export type QuiesceResult = {
  saved: boolean
  dropped: boolean
  settled: boolean
  waitedMs: number
  keyStillKnown: boolean
}

/** Gets a document into a state where it can safely be rewritten.
 *
 *  Rewriting while the editor holds the document loses the change: the
 *  session flushes its own copy through the save callback afterwards and
 *  overwrites what was written — the document "reverting to the original".
 *
 *  What is actually being waited for is *writes stopping*, not the session
 *  disappearing. Two things were learned the hard way here:
 *   - Dropping alone is insufficient; the server sends one last save as it
 *     disconnects, which lands after the rewrite.
 *   - Waiting for c:"info" to stop recognising the key doesn't work either:
 *     the document stays in the server's cache after the users leave, so it
 *     keeps answering error 0 long after the editor has gone.
 *  So this saves, drops, then watches the stored file's timestamp until it
 *  has been quiet for a few seconds.
 *
 *  Shared by /api/docs/quiesce and by /api/docs/ai-generate, which runs it
 *  alongside the AI call rather than before it. Nothing here reads or writes
 *  the database, only the stored file, so the two can overlap safely as long
 *  as the file is written after this returns settled. */
export async function quiesceDocument(
  inspectionId: string,
  docKey: string,
  drop: boolean,
): Promise<QuiesceResult> {
  const saved = await forceSaveAndWait(inspectionId, docKey)
  // Dropping server-side makes the still-open editor show "file cannot be
  // accessed right now", so callers that have already closed the editor
  // themselves pass drop:false and simply wait for its parting save.
  const dropped = drop ? await dropEditingSession(docKey) : { ok: false, response: { skipped: true } }

  let last = await getDocUpdatedAt(inspectionId)
  let quietFor = 0
  let polls = 0

  while (polls < MAX_POLLS && quietFor < SETTLE_POLLS) {
    await new Promise(r => setTimeout(r, POLL_MS))
    polls++
    const now = await getDocUpdatedAt(inspectionId)
    if (now !== last) {
      // A save landed — most likely the session's parting write. Start the
      // quiet period again from here.
      last = now
      quietFor = 0
    } else {
      quietFor++
    }
  }

  const settled = quietFor >= SETTLE_POLLS
  // Informational only: the key often stays known while the document sits
  // in cache, so this must not gate the rewrite.
  const info = await getSessionInfo(docKey)

  console.log('[quiesce]', docKey, JSON.stringify({
    saved: saved.saved, dropped: dropped.ok, settled, polls, keyStillKnown: info.open,
  }))

  return {
    saved: saved.saved,
    dropped: dropped.ok,
    settled,
    waitedMs: polls * POLL_MS,
    keyStillKnown: info.open,
  }
}

/** What a caller tells the user when a document would not settle. */
export const NOT_SETTLED_MESSAGE =
  'The document is still being saved, so this was stopped to avoid losing your changes. Wait a moment and try again.'

/** Thrown through a rewrite when the document never settled. Distinct from
 *  other failures because fallbacks that would still store the document —
 *  e.g. "write it without its photos" — must not run: storing anything is
 *  exactly what is unsafe. */
export class NotSettledError extends Error {
  constructor() { super(NOT_SETTLED_MESSAGE) }
}

/** A gate for a server-side rewrite: resolves once the stored file is safe to
 *  read and replace, rejects with NotSettledError if it never went quiet.
 *
 *  Started first and awaited only immediately before the file is read or
 *  written, so the wait runs alongside whatever the rewrite can do without
 *  the file — database reads, the AI call, fetching and shrinking photos.
 *
 *  No key means no editor session was open, so there is nothing to wait for.
 *  A failure inside the wait counts as not settled. */
export function quiesceGate(inspectionId: string, docKey: string | null | undefined): Promise<void> {
  if (!docKey) return Promise.resolve()
  const gate = quiesceDocument(inspectionId, docKey, false).then(
    r => { if (!r.settled) throw new NotSettledError() },
    err => {
      console.error('[quiesce] failed:', err)
      throw new NotSettledError()
    },
  )
  // A caller that returns early (bad input, AI failure) never awaits the
  // gate; without this its rejection would surface as an unhandled one.
  gate.catch(() => {})
  return gate
}
