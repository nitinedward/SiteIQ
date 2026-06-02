import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { prompt } = await req.json()
  const key = process.env.ANTHROPIC_KEY ?? ''
  console.log('Anthropic key present:', key.length > 0, 'starts with:', key.substring(0, 10))

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.ANTHROPIC_KEY ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-5',
      max_tokens: 4000,
      messages:   [{ role: 'user', content: prompt }],
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    return NextResponse.json({ error: err }, { status: 500 })
  }

  const data = await response.json()
  return NextResponse.json({ content: data.content[0].text })
}