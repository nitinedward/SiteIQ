/** The Whisper model that transcribes dictation on the phone itself, so
 *  recording works with no signal on site (lib/dictation).
 *
 *  Three sizes, from fast to accurate. The phone gets the one it can run at
 *  a usable speed: a budget Android took five minutes over 35 seconds of
 *  speech with the accurate model, where an iPhone uses its graphics chip
 *  and copes easily. The engineer can choose another in Profile → Offline
 *  transcription.
 *
 *  Too large to ship inside the app, the model is downloaded once — by
 *  itself the first time the app is opened on Wi-Fi, or from Profile — and
 *  kept in the app's documents folder. Until it is there, dictation is
 *  transcribed by the server. */

import { Platform } from 'react-native'
import * as Device from 'expo-device'
import * as FileSystem from 'expo-file-system/legacy'
import * as Network from 'expo-network'
import { initWhisper, type WhisperContext } from 'whisper.rn'
import { getMeta, setMeta } from './offline/db'

export type ModelKey = 'tiny' | 'base' | 'small'

export const MODELS: Record<ModelKey, { name: string; bytes: number; label: string; note: string }> = {
  tiny:  { name: 'ggml-tiny.en-q5_1.bin',  bytes: 32_166_155,  label: 'Fast',     note: 'Quickest; fine for clear speech' },
  base:  { name: 'ggml-base.en-q5_1.bin',  bytes: 59_721_011,  label: 'Balanced', note: 'Good accuracy, moderate speed' },
  small: { name: 'ggml-small.en-q5_1.bin', bytes: 190_098_681, label: 'Accurate', note: 'Best with technical terms; needs a fast phone' },
}
const BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/'
const DIR = `${FileSystem.documentDirectory}whisper/`
const CHOICE_KEY = 'device:whisperModel'

export const modelSizeMb = (key: ModelKey) => Math.round(MODELS[key].bytes / 1e6)

/** The model this phone can run at a usable speed. */
export function recommendedModel(): ModelKey {
  const memory = Device.totalMemory ?? 0
  if (Platform.OS === 'ios') return memory && memory < 3.5e9 ? 'base' : 'small'
  const archs = Device.supportedCpuArchitectures ?? []
  const is64 = archs.some(a => /arm64|x86_64/i.test(a))
  if (!is64 || memory < 3.5e9) return 'tiny'
  if (memory < 7e9) return 'base'
  return 'small'
}

let chosen: ModelKey | null = null

/** The model in use: the engineer's choice, or the one recommended. */
export async function chosenModel(): Promise<ModelKey> {
  if (!chosen) chosen = (await getMeta<ModelKey>(CHOICE_KEY)) ?? recommendedModel()
  return chosen
}

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

const pathOf = (key: ModelKey) => `${DIR}${MODELS[key].name}`

/** Whether the model in use is fully on the phone. */
export async function isModelReady(): Promise<boolean> {
  const key = await chosenModel()
  const info = await FileSystem.getInfoAsync(pathOf(key))
  const ready = info.exists && !info.isDirectory && info.size === MODELS[key].bytes
  if (ready && state.status !== 'ready') setState({ status: 'ready' })
  if (!ready && state.status === 'ready') setState({ status: 'missing' })
  return ready
}

/** Switches model: the new one downloads, and the old one is removed once
 *  it has (so dictation keeps working meanwhile). */
export async function chooseModel(key: ModelKey): Promise<void> {
  if (key === (await chosenModel())) return
  chosen = key
  await setMeta(CHOICE_KEY, key)
  await releaseContext()
  setState({ status: 'missing' })
  await downloadModel()
}

/** Downloads the model in use. One download at a time: a second call joins
 *  the first. A download cut short leaves only the .part file, never a
 *  model that looks complete. */
export function downloadModel(): Promise<void> {
  if (download) return download
  download = (async () => {
    const key = await chosenModel()
    const model = MODELS[key]
    const path = pathOf(key)
    const partial = `${path}.part`
    try {
      if (await isModelReady()) return
      const free = await FileSystem.getFreeDiskStorageAsync()
      if (free < model.bytes + 150 * 1024 * 1024) {
        throw new Error(`Not enough space on the phone — ${modelSizeMb(key)} MB is needed, plus some to spare.`)
      }
      await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {})
      setState({ status: 'downloading', progress: 0 })
      const task = FileSystem.createDownloadResumable(`${BASE_URL}${model.name}`, partial, {}, p => {
        const total = p.totalBytesExpectedToWrite > 0 ? p.totalBytesExpectedToWrite : model.bytes
        setState({ status: 'downloading', progress: Math.min(1, p.totalBytesWritten / total) })
      })
      const result = await task.downloadAsync()
      if (!result || result.status !== 200) throw new Error(`Download failed (${result?.status ?? 'no response'})`)
      const info = await FileSystem.getInfoAsync(partial)
      if (!info.exists || info.isDirectory || info.size !== model.bytes) {
        throw new Error('The download was incomplete. Please try again.')
      }
      await FileSystem.deleteAsync(path, { idempotent: true })
      await FileSystem.moveAsync({ from: partial, to: path })
      await removeOtherModels(key)
      setState({ status: 'ready' })
    } catch (err: any) {
      await FileSystem.deleteAsync(partial, { idempotent: true }).catch(() => {})
      setState({ status: 'error', message: err?.message ?? 'Download failed' })
      throw err
    } finally {
      download = null
    }
  })()
  return download
}

async function removeOtherModels(keep: ModelKey) {
  for (const key of Object.keys(MODELS) as ModelKey[]) {
    if (key !== keep) await FileSystem.deleteAsync(pathOf(key), { idempotent: true }).catch(() => {})
  }
}

/** Starts the download if the model is missing and the phone is on Wi-Fi —
 *  never over mobile data. Called when the app opens; any failure is left
 *  for Profile to show. */
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

async function releaseContext() {
  const ctx = context
  context = null
  if (ctx) await ctx.then(c => c.release()).catch(() => {})
}

export async function deleteModel(): Promise<void> {
  await releaseContext()
  await FileSystem.deleteAsync(DIR, { idempotent: true })
  setState({ status: 'missing' })
}

/** The loaded model, ready to transcribe; null when it isn't downloaded or
 *  can't be loaded on this phone. Loading takes a few seconds, so it is
 *  done once and kept. */
export async function whisperContext(): Promise<WhisperContext | null> {
  if (!(await isModelReady())) return null
  if (!context) {
    const key = await chosenModel()
    // The GPU on iPhones (Metal); Android runs it on the CPU.
    const loading = initWhisper({ filePath: pathOf(key), useGpu: true })
    context = loading
    loading.catch(err => {
      console.warn('[whisperModel] could not load the model:', err)
      if (context === loading) context = null
    })
  }
  return context.catch(() => null)
}
