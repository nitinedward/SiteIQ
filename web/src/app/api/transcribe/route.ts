import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS })
}

/** Turns a site recording into text.
 *
 *  Speech-to-text runs on OpenAI Whisper. Claude has no audio input — the
 *  Messages API takes text, images, PDFs and files, and this route's earlier
 *  attempt to send audio was rejected outright ("Unexpected value(s)
 *  `audio-20250501` for the `anthropic-beta` header"), so it never worked.
 *
 *  What matters is that the key lives HERE rather than in the app. The
 *  mobile app used to call Whisper directly with EXPO_PUBLIC_OPENAI_KEY,
 *  which Expo inlines into the JavaScript bundle — a published key, found
 *  and disabled, over and over. Rotating it is now a server change with no
 *  app release. */
export async function POST(request: NextRequest) {
  // Strip a leading BOM (U+FEFF) — see extract-info/route.ts for why.
  const openaiKey = (process.env.OPENAI_KEY ?? process.env.OPENAI_API_KEY ?? '').replace(/^﻿/, '').trim()
  if (!openaiKey) {
    console.error('[transcribe] OPENAI_KEY not set')
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

  const upstream = new FormData()
  upstream.append('file', file, file.name || 'recording.m4a')
  upstream.append('model', 'whisper-1')
  upstream.append('language', 'en')
  // The vocabulary of a structural inspection, so the terms an engineer
  // actually dictates come back spelled as they mean them.
  upstream.append(
    'prompt',
    'This is a structural engineering site inspection recording. ' +
    'Technical terms may include: reinforcement, concrete, beam, column, ' +
    'foundation, slab, rebar, stirrup, spacing, cover, lap length, ' +
    'gridline, cleat, bolt, weld, compliance.'
  )

  let response: Response
  try {
    response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: upstream,
    })
  } catch (err: any) {
    console.error('[transcribe] Upstream request failed:', err)
    return NextResponse.json({ error: 'Could not reach the transcription service' }, { status: 502, headers: CORS })
  }

  if (!response.ok) {
    const detail = await response.text()
    console.error('[transcribe] Whisper error:', response.status, detail)
    // 401 here means the server's key is bad — worth naming, because the
    // fix is a server credential, not anything the caller can do.
    const message = response.status === 401
      ? 'Transcription service rejected the server key'
      : `Transcription failed (${response.status})`
    return NextResponse.json({ error: message }, { status: 502, headers: CORS })
  }

  const data = await response.json()
  const text: string = (data.text ?? '').trim()
  console.log('[transcribe] Done, chars:', text.length)

  return NextResponse.json({ text }, { headers: CORS })
}
