/** Dictation still being transcribed when its note was saved.
 *
 *  The engineer needn't wait: the note is saved with its recording, and the
 *  text is added to it when the transcription finishes. A job is kept on the
 *  phone until then, so one that couldn't run (no signal, and no offline
 *  model) or was cut off by the app closing is picked up again when the app
 *  opens or the signal returns. */

import { db } from './offline/db'
import { onConnectivity } from './offline/net'
import { appendTranscript } from './offline/store'
import { transcribeRecording, type Transcription } from './dictation'

const running = new Set<string>()
const key = (observationId: string, audio: string) => `${observationId}|${audio}`

/** Adds `transcription`'s text to the note when it arrives. */
export async function deferTranscription(observationId: string, audio: string, transcription: Promise<Transcription>): Promise<void> {
  const d = await db()
  await d.runAsync(
    'INSERT OR REPLACE INTO transcribe_jobs (observation_id, audio, created_at) VALUES (?, ?, ?)',
    observationId, audio, Date.now())
  follow(observationId, audio, transcription)
}

function follow(observationId: string, audio: string, transcription: Promise<Transcription>) {
  const k = key(observationId, audio)
  running.add(k)
  transcription
    .then(async r => {
      if (r.text) await appendTranscript(observationId, r.text)
      // Done unless it couldn't run at all; then it's tried again later.
      if (r.text || !r.error) {
        const d = await db()
        await d.runAsync('DELETE FROM transcribe_jobs WHERE observation_id = ? AND audio = ?', observationId, audio)
      }
    })
    .catch(err => console.warn('[transcribeJobs]', err))
    .finally(() => running.delete(k))
}

/** Runs any jobs left waiting. */
export async function resumeTranscriptionJobs(): Promise<void> {
  const d = await db()
  const jobs = await d.getAllAsync<{ observation_id: string; audio: string }>(
    'SELECT observation_id, audio FROM transcribe_jobs ORDER BY created_at')
  for (const j of jobs) {
    if (running.has(key(j.observation_id, j.audio))) continue
    follow(j.observation_id, j.audio, transcribeRecording(j.audio))
  }
}

let started = false
export function startTranscriptionJobs(): void {
  if (started) return
  started = true
  resumeTranscriptionJobs().catch(() => {})
  onConnectivity(online => { if (online) resumeTranscriptionJobs().catch(() => {}) })
}
