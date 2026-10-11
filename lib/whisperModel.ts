/** The Whisper model that transcribes dictation on the phone itself, so
 *  recording works with no signal on site (lib/dictation).
 *
 *  Whisper small.en, quantised (q5_1): about 190 MB. Too large to ship
 *  inside the app, so it is downloaded once — by itself the first time the
 *  app is opened on Wi-Fi, or from Profile → Offline transcription — and
 *  kept in the app's documents folder. Until it is there, dictation is
 *  transcribed by the server as before. */

import * as FileSystem from 'expo-file-system/legacy'
import * as Network from 'expo-network'
import { initWhisper, type WhisperContext } from 'whisper.rn'

const MODEL = {
  name: 'ggml-small.en-q5_1.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q5_1.bin',
  bytes: 190_098_681,
}

const DIR = `${FileSystem.documentDirectory}whisper/`
const PATH = `${DIR}${MODEL.name}`
const PARTIAL = `${PATH}.part`

/** Room for the model plus some to spare, so the download can't fill the phone. */
const SPACE_NEEDED = MODEL.bytes + 150 * 1024 * 1024

export const MODEL_SIZE_MB = Math.round(MODEL.bytes / 1e6)

export type ModelState =
  | { status: 'missing' }
  | { status: 'downloading'; progress: number }
  | { status: 'ready' }
  | { status: 'error'; message: string }

let state: ModelState = { status: 'missing' }
const listeners = new Set<(s: ModelState) => void>()
let download: Promise<void> | null = null
let context: Promise<WhisperContext> | null = null

function setState(next: ModelState) {
  state = next
  listeners.forEach(l => l(next))
}

/** Follows the model's state; returns the unsubscribe. */
export function onModelState(listener: (s: ModelState) => void): () => void {
  listeners.add(listener)
  listener(state)
  return () => { listeners.delete(listener) }
}

/** Whether the whole model is on the phone. */
export async function isModelReady(): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(PATH)
  const ready = info.exists && !info.isDirectory && info.size === MODEL.bytes
  if (ready && state.status !== 'ready') setState({ status: 'ready' })
  return ready
}

/** Downloads the model. One download at a time: a second call joins the
 *  first. A download cut short leaves only the .part file, never a model
 *  that looks complete. */
export function downloadModel(): Promise<void> {
  if (download) return download
  download = (async () => {
    try {
      if (await isModelReady()) return
      const free = await FileSystem.getFreeDiskStorageAsync()
      if (free < SPACE_NEEDED) {
        throw new Error(`Not enough space on the phone — ${MODEL_SIZE_MB} MB is needed, plus some to spare.`)
      }
      await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {})
      setState({ status: 'downloading', progress: 0 })
      const task = FileSystem.createDownloadResumable(MODEL.url, PARTIAL, {}, p => {
        const total = p.totalBytesExpectedToWrite > 0 ? p.totalBytesExpectedToWrite : MODEL.bytes
        setState({ status: 'downloading', progress: Math.min(1, p.totalBytesWritten / total) })
      })
      const result = await task.downloadAsync()
      if (!result || result.status !== 200) throw new Error(`Download failed (${result?.status ?? 'no response'})`)
      const info = await FileSystem.getInfoAsync(PARTIAL)
      if (!info.exists || info.isDirectory || info.size !== MODEL.bytes) {
        throw new Error('The download was incomplete. Please try again.')
      }
      await FileSystem.deleteAsync(PATH, { idempotent: true })
      await FileSystem.moveAsync({ from: PARTIAL, to: PATH })
      setState({ status: 'ready' })
    } catch (err: any) {
      await FileSystem.deleteAsync(PARTIAL, { idempotent: true }).catch(() => {})
      setState({ status: 'error', message: err?.message ?? 'Download failed' })
      throw err
    } finally {
      download = null
    }
  })()
  return download
}

/** Starts the download if the model is missing and the phone is on Wi-Fi —
 *  never over mobile data, which a 190 MB download could eat into. Called
 *  when the app opens; any failure is left for Profile to show. */
export async function downloadModelOnWifi(): Promise<void> {
  try {
    if (await isModelReady()) return
    const net = await Network.getNetworkStateAsync()
    if (net.type !== Network.NetworkStateType.WIFI || net.isInternetReachable === false) return
    await downloadModel()
  } catch (err) {
    console.warn('[whisperModel] background download:', err)
  }
}

export async function deleteModel(): Promise<void> {
  const ctx = context
  context = null
  if (ctx) await ctx.then(c => c.release()).catch(() => {})
  await FileSystem.deleteAsync(DIR, { idempotent: true })
  setState({ status: 'missing' })
}

/** The loaded model, ready to transcribe; null when it isn't downloaded or
 *  can't be loaded on this phone (then the server transcribes instead).
 *  Loading takes a few seconds, so it is done once and kept. */
export async function whisperContext(): Promise<WhisperContext | null> {
  if (!(await isModelReady())) return null
  if (!context) {
    // The GPU on iPhones (Metal); Android runs it on the CPU.
    const loading = initWhisper({ filePath: PATH, useGpu: true })
    context = loading
    loading.catch(err => {
      console.warn('[whisperModel] could not load the model:', err)
      if (context === loading) context = null
    })
  }
  return context.catch(() => null)
}
