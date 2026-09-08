import { NextRequest, NextResponse } from 'next/server'
import { forceSaveAndWait, dropEditingSession, getSessionInfo } from '@/lib/onlyofficeConvert'

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

/** Gets a document into a state where it can safely be rewritten.
 *
 *  Rewriting a document while the editor still has it open loses the
 *  changes: the session flushes its own copy back through the save callback
 *  and overwrites whatever was written, which shows up as the document
 *  "reverting to the original".
 *
 *  Dropping the session is not enough on its own — the Document Server
 *  sends one final save as it disconnects, and that save lands *after* the
 *  rewrite. So this saves, drops, and then polls c:"info" until the server
 *  no longer recognises the key (error 1 = no session), which is the point
 *  at which no further callback can arrive. */
export async function POST(request: NextRequest) {
  try {
    const { inspectionId, docKey } = await request.json()
    if (!inspectionId || !docKey) {
      return NextResponse.json({ error: 'Missing inspectionId or docKey' }, { status: 400, headers: cors })
    }

    // 1. Persist what's on screen.
    const saved = await forceSaveAndWait(inspectionId, docKey)

    // 2. Ask the session to end.
    const dropped = await dropEditingSession(docKey)

    // 3. Wait for it to actually be gone, including its parting save.
    let open = true
    let waited = 0
    for (let i = 0; i < 20 && open; i++) {
      await new Promise(r => setTimeout(r, 750))
      waited += 750
      open = (await getSessionInfo(docKey)).open
    }

    // A session that won't close is reported rather than hidden: the caller
    // can still proceed, but the overwrite risk is real and worth logging.
    console.log('[quiesce]', docKey, JSON.stringify({ saved: saved.saved, dropped: dropped.ok, stillOpen: open, waited }))

    return NextResponse.json(
      { success: true, saved: saved.saved, dropped: dropped.ok, stillOpen: open, waitedMs: waited },
      { headers: cors }
    )
  } catch (err: any) {
    console.error('[quiesce] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500, headers: cors })
  }
}
