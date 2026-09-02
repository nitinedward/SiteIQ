import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** Best-effort extraction of a drawing's number/revision/title from its title
 *  block. Non-authoritative — callers should fall back to their own defaults
 *  when a field comes back null or the request fails. */
export async function POST(request: NextRequest) {
  const anthropicKey = process.env.ANTHROPIC_KEY ?? process.env.ANTHROPIC_API_KEY ?? ''
  if (!anthropicKey) {
    console.error('[extract-drawing-info] No Anthropic API key set (ANTHROPIC_KEY / ANTHROPIC_API_KEY)')
    return NextResponse.json({ error: 'AI service not configured' }, { status: 500 })
  }

  try {
    const { imageBase64, mediaType } = await request.json()
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return NextResponse.json({ error: 'Missing imageBase64' }, { status: 400 })
    }
    const imageMediaType = mediaType === 'image/jpeg' ? 'image/jpeg' : 'image/png'

    const prompt = `This image is one sheet of a structural/architectural drawing set. Look at its title block (usually bottom-right or bottom edge of the sheet) and read off:
- drawing_number: the sheet's own drawing/sheet number (e.g. "S-101", "A-201", "DWG-04")
- revision: the current revision marker (e.g. "A", "B", "P1", "2") — use the LATEST revision if a revision history table is shown
- title: the short drawing title (e.g. "Level 1 Floor Plan", "Foundation Details")

Respond with ONLY a JSON object, no other text, in exactly this shape:
{"drawing_number": string|null, "revision": string|null, "title": string|null}

Use null for any field you cannot read with confidence. Do not guess.`

    // Bound the Anthropic call server-side, where the connection is fast
    // and stable, rather than relying solely on the client's own timeout —
    // the client's request to us can then be a short-lived, well-defined
    // round trip instead of racing an open-ended upstream call.
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)

    let response: Response
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model:      'claude-sonnet-4-6',
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: imageMediaType, data: imageBase64 } },
              { type: 'text', text: prompt },
            ],
          }],
        }),
        signal: controller.signal,
      })
    } catch (fetchErr: any) {
      if (fetchErr?.name === 'AbortError') {
        console.error('[extract-drawing-info] Anthropic call timed out after 30s')
        // 200, not 504 — a timeout is a normal "couldn't read it" outcome the
        // client should handle the same way as any other failed read, not a
        // transport-level error.
        return NextResponse.json({ drawing_number: null, revision: null, title: null, status: 'timeout' })
      }
      throw fetchErr
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      const err = await response.text()
      console.error('[extract-drawing-info] Anthropic error:', err)
      return NextResponse.json({ drawing_number: null, revision: null, title: null, status: 'failed' })
    }

    const aiData = await response.json()
    const rawText: string = aiData.content?.[0]?.text ?? ''
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error('[extract-drawing-info] No JSON in AI response:', rawText)
      return NextResponse.json({ drawing_number: null, revision: null, title: null, status: 'failed' })
    }

    let parsed: { drawing_number?: string | null; revision?: string | null; title?: string | null }
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch (e) {
      console.error('[extract-drawing-info] JSON parse failed:', jsonMatch[0])
      return NextResponse.json({ drawing_number: null, revision: null, title: null, status: 'failed' })
    }

    return NextResponse.json({
      drawing_number: parsed.drawing_number || null,
      revision:       parsed.revision || null,
      title:          parsed.title || null,
      status: 'ok',
    })
  } catch (err) {
    console.error('[extract-drawing-info] error:', err)
    return NextResponse.json({ error: 'AI extraction failed' }, { status: 500 })
  }
}
