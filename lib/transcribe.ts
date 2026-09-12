/** Turning a site recording into text.
 *
 *  This goes through SiteIQ's own /api/transcribe rather than calling a
 *  speech API from the phone, because the app cannot hold a secret: anything
 *  named EXPO_PUBLIC_* is inlined into the JavaScript bundle, and a bundle
 *  can be unpacked from the installed app. A key shipped that way is a
 *  published key — it gets found and disabled, and transcription stops
 *  working until someone issues another one, which then goes the same way.
 *
 *  With the key held on the server, rotating it is a server change and never
 *  needs an app release. */

const DEFAULT_APP_URL = 'https://www.site-iq.co.nz'

function apiBase(): string {
  const raw = (process.env.EXPO_PUBLIC_APP_URL ?? DEFAULT_APP_URL).trim().replace(/\/+$/, '')
  // The apex 308-redirects to www. Go straight to www so a POST body never
  // depends on the platform re-sending it across a redirect.
  return raw.replace(/^https:\/\/site-iq\.co\.nz/i, DEFAULT_APP_URL)
}

/** Transcribes a recorded audio file and returns the text, or '' if nothing
 *  could be made out. Throws with a readable message if the request fails. */
export async function transcribeAudio(uri: string): Promise<string> {
  console.log('[transcribe] Starting:', uri)

  const formData = new FormData()
  formData.append('file', {
    uri,
    type: 'audio/m4a',
    name: 'recording.m4a',
  } as any)

  let response: Response
  try {
    response = await fetch(`${apiBase()}/api/transcribe`, {
      method: 'POST',
      body: formData,
    })
  } catch (err: any) {
    console.error('[transcribe] Request failed:', err)
    throw new Error('Could not reach the transcription service. Check your connection and try again.')
  }

  console.log('[transcribe] Response:', response.status)

  if (!response.ok) {
    const detail = await response.json().catch(() => ({} as any))
    console.error('[transcribe] Error:', response.status, detail)
    throw new Error(detail?.error ?? `Transcription failed (${response.status})`)
  }

  const data = await response.json()
  const transcript: string = (data.text ?? '').trim()
  console.log('[transcribe] Done, chars:', transcript.length)
  return transcript
}
