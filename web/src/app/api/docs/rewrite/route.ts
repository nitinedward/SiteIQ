import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: cors })
}

/** Rewrites a selected passage of report text via Claude — tone/instruction
 *  optional. Never invents facts: the prompt instructs the model to
 *  preserve technical content and only adjust wording. Returns { rewrite }
 *  on success; the caller shows it as a PREVIEW and only replaces the
 *  document's selection if the user explicitly accepts it — this route
 *  never touches the document itself. */
export async function POST(request: NextRequest) {
  try {
    const { selectedText, tone, instruction, context } = await request.json()
    if (!selectedText || typeof selectedText !== 'string' || !selectedText.trim()) {
      return NextResponse.json({ error: 'Missing selectedText' }, { status: 400, headers: cors })
    }

    const anthropicKey = (process.env.ANTHROPIC_KEY ?? process.env.ANTHROPIC_API_KEY ?? '')
      .replace(/^﻿/, '').trim()
    if (!anthropicKey) {
      console.error('[rewrite] No Anthropic API key set (ANTHROPIC_KEY / ANTHROPIC_API_KEY)')
      return NextResponse.json({ error: 'AI service not configured' }, { status: 500, headers: cors })
    }

    const instructions: string[] = []
    if (tone) instructions.push(`Tone: ${tone}.`)
    if (instruction) instructions.push(`Specific instruction: ${instruction}`)

    const prompt = `You are a senior structural engineer editing a site inspection report. Rewrite ONLY the passage given below as "PASSAGE TO REWRITE". Preserve all technical meaning, measurements, findings, and factual content exactly — do not invent, add, remove, or alter any numbers, observations, or conclusions. Only adjust wording, tone, and phrasing as instructed.
${instructions.length > 0 ? '\n' + instructions.join('\n') + '\n' : ''}
${context ? `\nSurrounding context (for coherence only — do not rewrite this part):\n"""${context}"""\n` : ''}
PASSAGE TO REWRITE:
"""${selectedText}"""

Respond with ONLY the rewritten passage. No preamble, no explanation, no quotes around it.`

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
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      })
    } catch (fetchErr: any) {
      if (fetchErr?.name === 'AbortError') {
        return NextResponse.json({ error: 'Rewrite timed out' }, { status: 504, headers: cors })
      }
      throw fetchErr
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      const err = await response.text()
      console.error('[rewrite] Anthropic error:', err)
      return NextResponse.json({ error: 'AI rewrite failed' }, { status: 500, headers: cors })
    }

    const aiData = await response.json()
    const rewrite: string = (aiData.content?.[0]?.text ?? '').trim()
    if (!rewrite) {
      return NextResponse.json({ error: 'Empty response from AI' }, { status: 500, headers: cors })
    }

    return NextResponse.json({ rewrite }, { headers: cors })
  } catch (err: any) {
    console.error('[rewrite] error:', err)
    return NextResponse.json({ error: err.message || 'Rewrite failed' }, { status: 500, headers: cors })
  }
}
