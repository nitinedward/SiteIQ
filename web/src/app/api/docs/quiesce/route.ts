import { NextRequest, NextResponse } from 'next/server'
import {
  forceSaveAndWait,
  dropEditingSession,
  getSessionInfo,
  getDocUpdatedAt,
} from '@/lib/onlyofficeConvert'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: cors })
}

const POLL_MS = 750
const SETTLE_POLLS = 3      // ~2.2s of silence before calling it settled
const MAX_POLLS = 20        // ~15s ceiling

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
 *  has been quiet for a couple of seconds. */
export async function POST(request: NextRequest) {
  try {
    const { inspectionId, docKey, drop = true } = await request.json()
    if (!inspectionId || !docKey) {
      return NextResponse.json({ error: 'Missing inspectionId or docKey' }, { status: 400, headers: cors })
    }

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

    return NextResponse.json(
      {
        success: true,
        saved: saved.saved,
        dropped: dropped.ok,
        settled,
        waitedMs: polls * POLL_MS,
        keyStillKnown: info.open,
      },
      { headers: cors }
    )
  } catch (err: any) {
    console.error('[quiesce] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500, headers: cors })
  }
}
