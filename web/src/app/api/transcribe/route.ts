import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS })
}

export async function POST(request: NextRequest) {
  const anthropicKey = process.env.ANTHROPIC_KEY ?? ''
  if (!anthropicKey) {
    console.error('[transcribe] ANTHROPIC_KEY not set')
    return NextResponse.json({ error: 'Transcription service not configured' }, { status: 500, headers: CORS })
  }

  let file: File | null = null
  try {
    const formData = await request.formData()
    file = formData.get('file') as File | null
  } catch {
    return NextResponse.json({ error: 'Invalid request — expected multipart/form-data with file field' }, { status: 400, headers: CORS })
  }

  if (!file) {
    return NextResponse.json({ error: 'No audio file provided' }, { status: 400, headers: CORS })
  }

  console.log('[transcribe] Received audio:', file.name, file.type, Math.round(file.size / 1024), 'KB')

  const arrayBuffer = await file.arrayBuffer()
  const base64Audio = Buffer.from(arrayBuffer).toString('base64')

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'audio-20250501',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'input_audio',
            input_audio: {
              data: base64Audio,
              format: 'mp4',
            },
          },
          {
            type: 'text',
            text: 'Transcribe this audio recording exactly as spoken. Return only the transcribed text with no commentary, labels, timestamps, or formatting.',
          },
        ],
      }],
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    console.error('[transcribe] Anthropic error:', response.status, err)
    return NextResponse.json({ error: `Transcription failed (${response.status})` }, { status: 502, headers: CORS })
  }

  const data = await response.json()
  const text: string = data.content?.[0]?.text ?? ''
  console.log('[transcribe] Done, chars:', text.length)

  return NextResponse.json({ text }, { headers: CORS })
}
