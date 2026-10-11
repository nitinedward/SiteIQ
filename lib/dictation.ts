/** Dictation: recording a voice note and turning it into text.
 *
 *  Transcribed on the phone by Whisper (lib/whisperModel), so it works with
 *  no signal on site. Until the model has been downloaded, the recording
 *  goes to SiteIQ's server instead (lib/transcribe), as it always has.
 *
 *  Whisper on the phone reads 16 kHz, mono, 16-bit WAV and nothing else —
 *  it doesn't convert — so the microphone is read as raw audio in exactly
 *  that shape and written out as a WAV here. That file is kept: it goes
 *  up with the site note (see uploadRecording), as a record of what was
 *  said and so it can be transcribed again later. */

import * as FileSystem from 'expo-file-system/legacy'
import { Audio } from 'expo-av'
import LiveAudioStream from '@fugood/react-native-audio-pcm-stream'
import { whisperContext } from './whisperModel'
import { transcribeAudio } from './transcribe'
import { whisperPrompt } from './vocabulary'

const SAMPLE_RATE = 16000
const BYTES_PER_SECOND = SAMPLE_RATE * 2 // mono, 16-bit
const DIR = `${FileSystem.documentDirectory}recordings/`

/** Vercel accepts request bodies up to 4.5 MB, so the server can only take
 *  a WAV of about two minutes; longer ones need the model on the phone. */
const SERVER_MAX_BYTES = 4_300_000

export type DictationResult = {
  /** What was said; '' when nothing could be made out. */
  text: string
  /** The recording, a WAV in the app's documents folder. */
  audioUri: string
  seconds: number
  /** Where it was transcribed. */
  engine: 'phone' | 'server'
  /** Why it couldn't be transcribed, readable. The recording is still there
   *  to keep with the note. */
  error?: string
}

export type Dictation = {
  /** Stops recording and transcribes. Throws only if the recording itself
   *  couldn't be saved; a failed transcription comes back as `error`. */
  stop: () => Promise<DictationResult>
  /** Stops and throws the recording away. */
  cancel: () => Promise<void>
}

type Options = {
  /** Loudness while recording, in dB (-60 quiet … 0 loud), for the waveform. */
  onLevel?: (db: number) => void
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
  // Native init returns a promise (it fails if the microphone is busy);
  // start and stop return nothing.
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
    if (onLevel && now - lastLevelAt > 150) {
      lastLevelAt = now
      onLevel(levelDb(chunk))
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
    stop: async () => {
      finish()
      const seconds = bytes / BYTES_PER_SECOND
      const audioUri = await writeWav(chunks, bytes)
      if (seconds < 0.5) return { text: '', audioUri, seconds, engine: 'phone' }

      const whisper = await whisperContext()
      if (whisper) {
        try {
          const { promise } = whisper.transcribe(audioUri, {
            language: 'en',
            prompt: whisperPrompt(context),
          })
          const { result } = await promise
          return { text: cleanTranscript(result), audioUri, seconds, engine: 'phone' }
        } catch (err: any) {
          console.warn('[dictation] on-phone transcription failed:', err)
          return { text: '', audioUri, seconds, engine: 'phone', error: 'Could not transcribe this recording on the phone. It is kept with the note.' }
        }
      }

      // No model on the phone yet: the server, as before.
      if (bytes + 44 > SERVER_MAX_BYTES) {
        return {
          text: '', audioUri, seconds, engine: 'server',
          error: 'This recording is too long to send for transcription; it is kept with the note. ' +
            'Download offline transcription (Profile → Offline transcription) to transcribe recordings of any length on the phone.',
        }
      }
      try {
        const text = await transcribeAudio(audioUri, 'audio/wav')
        return { text: cleanTranscript(text), audioUri, seconds, engine: 'server' }
      } catch (err: any) {
        return {
          text: '', audioUri, seconds, engine: 'server',
          error: `${err?.message ?? 'Transcription failed.'} The recording is kept with the note. ` +
            'Download offline transcription (Profile → Offline transcription) to transcribe without signal.',
        }
      }
    },
    cancel: async () => {
      finish()
    },
  }
  active = dictation
  return dictation
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
  turnUpIfQuiet(new DataView(wav.buffer, 44, dataBytes - (dataBytes % 2)))

  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {})
  const uri = `${DIR}dictation-${Date.now()}.wav`
  await FileSystem.writeAsStringAsync(uri, bytesToBase64(wav), { encoding: FileSystem.EncodingType.Base64 })
  return uri
}

/** Scales quiet audio up so its loudest moment is near full volume — but
 *  never more than MAX_GAIN, so silence isn't turned into hiss. */
function turnUpIfQuiet(samples: DataView) {
  let peak = 0
  for (let i = 0; i < samples.byteLength; i += 2) {
    const v = Math.abs(samples.getInt16(i, true))
    if (v > peak) peak = v
  }
  if (peak === 0 || peak >= QUIET_PEAK * 32767) return
  const gain = Math.min(MAX_GAIN, (0.9 * 32767) / peak)
  for (let i = 0; i < samples.byteLength; i += 2) {
    samples.setInt16(i, Math.round(samples.getInt16(i, true) * gain), true)
  }
}

/** Loudness of a chunk of 16-bit audio, in dB below full scale. */
function levelDb(chunk: Uint8Array): number {
  const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength)
  let sum = 0
  let n = 0
  for (let i = 0; i + 1 < chunk.length; i += 8) { // every 4th sample is plenty
    const s = view.getInt16(i, true) / 32768
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
  let binary = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + step)))
  }
  return btoa(binary)
}

/** Deletes a recording kept on the phone, once it has been uploaded or
 *  isn't wanted. */
export async function deleteRecording(uri: string): Promise<void> {
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {})
}
