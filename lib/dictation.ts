/** Dictation: recording a voice note and turning it into text.
 *
 *  Automatic: with signal the server transcribes it (a few seconds, most
 *  accurate); with none, Whisper on the phone does (lib/whisperModel). On a
 *  weak signal the server gets a head start, then the phone starts too and
 *  whichever finishes first is used — so a poor signal is never slower than
 *  no signal at all.
 *
 *  Stopping hands back the recording at once and its transcription as a
 *  promise, so a note can be saved while the text is still coming; it's
 *  added to the note when it arrives (lib/transcribeJobs).
 *
 *  Whisper on the phone reads 16 kHz, mono, 16-bit WAV and nothing else —
 *  it doesn't convert — so the microphone is read as raw audio in exactly
 *  that shape and written out as a WAV here. */

import * as FileSystem from 'expo-file-system/legacy'
import { Audio } from 'expo-av'
import LiveAudioStream from '@fugood/react-native-audio-pcm-stream'
import { isModelReady, whisperContext } from './whisperModel'
import { transcribeAudio } from './transcribe'
import { whisperPrompt } from './vocabulary'
import { isOnline } from './offline/net'

const SAMPLE_RATE = 16000
const BYTES_PER_SECOND = SAMPLE_RATE * 2 // mono, 16-bit
const DIR = `${FileSystem.documentDirectory}recordings/`

/** Vercel accepts request bodies up to 4.5 MB, so the server can only take
 *  a WAV of about two minutes; longer ones are transcribed on the phone. */
const SERVER_MAX_BYTES = 4_300_000
/** How long the server has before the phone starts transcribing as well. */
const SERVER_HEAD_START_MS = 15_000

export type Transcription = {
  /** What was said; '' when nothing could be made out. */
  text: string
  /** Where it was transcribed. */
  engine: 'phone' | 'server'
  /** Why it couldn't be transcribed, readable. The recording is kept. */
  error?: string
}

export type Recording = {
  /** The recording, a WAV in the app's documents folder. */
  audioUri: string
  seconds: number
  transcription: Promise<Transcription>
}

/** What's happening to a recording, for the screen to show. */
export type Stage = { engine: 'server' } | { engine: 'phone'; progress: number }

export type Dictation = {
  /** Stops recording. Throws only if the recording couldn't be saved. */
  stop: (options?: { onStage?: (stage: Stage) => void }) => Promise<Recording>
  /** Stops and throws the recording away. */
  cancel: () => Promise<void>
}

type Options = {
  /** Loudness while recording, 0 (silence) … 1 (loud speech), for the waveform. */
  onLevel?: (level: number) => void
  /** Words likely in this note — the zone, drawing and project names — so
   *  Whisper spells them as the engineer means them. */
  context?: string[]
}

let active: Dictation | null = null

/** The microphone's native reader stops a moment after it is told to (it
 *  finishes the read it is in, then lets go of the microphone). Starting
 *  again before then hands the new recording to the old reader, which then
 *  releases the microphone mid-recording — so a new dictation waits for it. */
let released: Promise<void> = Promise.resolve()
const RELEASE_MS = 400

/** Below this peak the recording is turned up before transcription: some
 *  Android phones give the speech-recognition microphone very little gain. */
const QUIET_PEAK = 0.5
const MAX_GAIN = 8

/** Starts recording. One dictation at a time: starting another cancels it. */
export async function startDictation({ onLevel, context = [] }: Options = {}): Promise<Dictation> {
  if (active) await active.cancel().catch(() => {})
  await released

  const { granted } = await Audio.requestPermissionsAsync()
  if (!granted) throw new Error('Please allow microphone access in Settings to record voice notes.')

  const chunks: Uint8Array[] = []
  let bytes = 0
  let lastLevelAt = 0

  let finished = false
  // Native init returns a promise on Android (it fails if the microphone is
  // busy) and nothing on iOS; start and stop return nothing.
  await LiveAudioStream.init({
    sampleRate: SAMPLE_RATE,
    channels: 1,
    bitsPerSample: 16,
    audioSource: 6, // Android VOICE_RECOGNITION: tuned for speech
    bufferSize: 4096,
    wavFile: '',
  })
  LiveAudioStream.on('data', (base64: string) => {
    if (finished) return
    const chunk = base64ToBytes(base64)
    chunks.push(chunk)
    bytes += chunk.length
    const now = Date.now()
    if (onLevel && now - lastLevelAt > 120) {
      lastLevelAt = now
      // Speech sits around -45…-10 dB on phone microphones.
      onLevel(Math.max(0, Math.min(1, (levelDb(chunk) + 50) / 40)))
    }
  })
  LiveAudioStream.start()

  const finish = () => {
    if (finished) return
    finished = true
    active = null
    try { LiveAudioStream.stop() } catch {}
    released = new Promise(resolve => setTimeout(resolve, RELEASE_MS))
  }

  const dictation: Dictation = {
    stop: async ({ onStage } = {}) => {
      finish()
      const seconds = bytes / BYTES_PER_SECOND
      const audioUri = await writeWav(chunks, bytes)
      chunks.length = 0
      const transcription = seconds < 0.5
        ? Promise.resolve<Transcription>({ text: '', engine: 'phone' })
        : transcribeRecording(audioUri, { context, onStage })
      return { audioUri, seconds, transcription }
    },
    cancel: async () => {
      finish()
    },
  }
  active = dictation
  return dictation
}

/** Turns a recording into text — server or phone, as described above.
 *  Never rejects: a failure comes back as `error`. */
export async function transcribeRecording(
  audioUri: string,
  { context = [], onStage }: { context?: string[]; onStage?: (stage: Stage) => void } = {},
): Promise<Transcription> {
  const info = await FileSystem.getInfoAsync(audioUri)
  if (!info.exists) return { text: '', engine: 'phone', error: 'The recording is no longer on the phone.' }
  const size = info.size ?? 0
  const serverUsable = isOnline() && size <= SERVER_MAX_BYTES
  const phoneReady = await isModelReady()

  if (!serverUsable && !phoneReady) {
    return {
      text: '', engine: 'phone',
      error: isOnline()
        ? 'This recording is too long to send for transcription; it is kept with the note. Download offline transcription (Profile → Offline transcription) to transcribe recordings of any length on the phone.'
        : 'No signal, and offline transcription isn\'t on this phone yet. The recording is kept with the note and will be transcribed when there\'s signal.',
    }
  }
  if (!serverUsable) return onPhone(audioUri, context, onStage)

  const abort = new AbortController()
  onStage?.({ engine: 'server' })
  const server: Promise<Transcription> = transcribeAudio(audioUri, 'audio/wav', abort.signal)
    .then(text => ({ text: cleanTranscript(text), engine: 'server' as const }))

  if (!phoneReady) {
    return server.catch((err: any) => ({
      text: '', engine: 'server' as const,
      error: `${err?.message ?? 'Transcription failed.'} The recording is kept with the note.`,
    }))
  }

  // The server's head start.
  const early = await Promise.race([
    server.then(v => ({ ok: true as const, v }), () => ({ ok: false as const })),
    new Promise<'slow'>(resolve => setTimeout(() => resolve('slow'), SERVER_HEAD_START_MS)),
  ])
  if (early !== 'slow') return early.ok ? early.v : onPhone(audioUri, context, onStage)

  // Slow: the phone starts too, and the first to finish is used.
  let stopPhone: (() => void) | null = null
  const phone = onPhone(audioUri, context, onStage, stop => { stopPhone = stop })
  const winner = await firstSuccess(server, phone)
  if (winner.engine === 'server') (stopPhone as (() => void) | null)?.()
  else abort.abort()
  return winner
}

/** The first of the two to succeed; if both fail, the phone's result. */
function firstSuccess(server: Promise<Transcription>, phone: Promise<Transcription>): Promise<Transcription> {
  return new Promise(resolve => {
    let failures = 0
    const failed = () => { if (++failures === 2) phone.then(resolve) }
    server.then(r => r.error ? failed() : resolve(r), failed)
    phone.then(r => r.error ? failed() : resolve(r))
  })
}

/** On-phone transcriptions run one at a time — the model can only do one. */
let phoneQueue: Promise<unknown> = Promise.resolve()

function onPhone(
  audioUri: string,
  context: string[],
  onStage?: (stage: Stage) => void,
  register?: (stop: () => void) => void,
): Promise<Transcription> {
  let cancelled = false
  register?.(() => { cancelled = true })
  const run = async (): Promise<Transcription> => {
    if (cancelled) return { text: '', engine: 'phone', error: 'Cancelled' }
    const whisper = await whisperContext()
    if (!whisper) return { text: '', engine: 'phone', error: 'Could not load offline transcription on this phone. The recording is kept with the note.' }
    onStage?.({ engine: 'phone', progress: 0 })
    try {
      const { stop, promise } = whisper.transcribe(audioUri, {
        language: 'en',
        prompt: whisperPrompt(context),
        onProgress: (p: number) => onStage?.({ engine: 'phone', progress: p / 100 }),
      })
      register?.(() => { cancelled = true; stop().catch(() => {}) })
      const { result, isAborted } = await promise
      if (isAborted || cancelled) return { text: '', engine: 'phone', error: 'Cancelled' }
      return { text: cleanTranscript(result), engine: 'phone' }
    } catch (err: any) {
      console.warn('[dictation] on-phone transcription failed:', err)
      return { text: '', engine: 'phone', error: 'Could not transcribe this recording on the phone. It is kept with the note.' }
    }
  }
  const job = phoneQueue.then(run, run)
  phoneQueue = job.catch(() => {})
  return job
}

/** Whisper marks stretches without speech as [BLANK_AUDIO], (wind), [Music]…
 *  Only those go: a bracket the engineer dictated, "(galvanised)", stays. */
function cleanTranscript(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:[a-z_ ]*\b(?:music|wind|noise|silence|inaudible|blank|background|static|beep|laugh|cough|applause|sigh|breath)[a-z_ ]*)\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Writes the raw audio out as a 16 kHz mono 16-bit WAV. */
async function writeWav(chunks: Uint8Array[], dataBytes: number): Promise<string> {
  const wav = new Uint8Array(44 + dataBytes)
  const view = new DataView(wav.buffer)
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) wav[at + i] = s.charCodeAt(i) }
  text(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)          // fmt chunk size
  view.setUint16(20, 1, true)           // PCM
  view.setUint16(22, 1, true)           // mono
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, BYTES_PER_SECOND, true)
  view.setUint16(32, 2, true)           // bytes per frame
  view.setUint16(34, 16, true)          // bits per sample
  text(36, 'data')
  view.setUint32(40, dataBytes, true)
  let at = 44
  for (const chunk of chunks) { wav.set(chunk, at); at += chunk.length }
  turnUpIfQuiet(new Int16Array(wav.buffer, 44, Math.floor(dataBytes / 2)))

  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {})
  const uri = `${DIR}dictation-${Date.now()}.wav`
  await FileSystem.writeAsStringAsync(uri, bytesToBase64(wav), { encoding: FileSystem.EncodingType.Base64 })
  return uri
}

/** Scales quiet audio up so its loudest moment is near full volume — but
 *  never more than MAX_GAIN, so silence isn't turned into hiss. (The phones
 *  this runs on are little-endian, as WAV is, so the samples are read in
 *  place.) */
function turnUpIfQuiet(samples: Int16Array) {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] < 0 ? -samples[i] : samples[i]
    if (v > peak) peak = v
  }
  if (peak === 0 || peak >= QUIET_PEAK * 32767) return
  const gain = Math.min(MAX_GAIN, (0.9 * 32767) / peak)
  for (let i = 0; i < samples.length; i++) samples[i] = Math.round(samples[i] * gain)
}

/** Loudness of a chunk of 16-bit audio, in dB below full scale. */
function levelDb(chunk: Uint8Array): number {
  const samples = new Int16Array(chunk.buffer, chunk.byteOffset, Math.floor(chunk.byteLength / 2))
  let sum = 0
  let n = 0
  for (let i = 0; i < samples.length; i += 4) { // every 4th sample is plenty
    const s = samples[i] / 32768
    sum += s * s
    n++
  }
  const rms = Math.sqrt(sum / Math.max(1, n))
  return Math.max(-60, 20 * Math.log10(rms || 1e-6))
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = []
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + step) as unknown as number[]))
  }
  return btoa(parts.join(''))
}

/** Deletes a recording kept on the phone that isn't wanted. */
export async function deleteRecording(uri: string): Promise<void> {
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {})
}
