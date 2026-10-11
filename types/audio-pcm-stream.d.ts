// @fugood/react-native-audio-pcm-stream ships types under its original
// package name (react-native-live-audio-stream), so TypeScript can't find
// them for this one. The same shape, declared under the name it's imported by.
declare module '@fugood/react-native-audio-pcm-stream' {
  type Options = {
    sampleRate: number
    channels: 1 | 2
    bitsPerSample: 8 | 16
    /** Android only: a MediaRecorder.AudioSource constant (6 = VOICE_RECOGNITION). */
    audioSource?: number
    bufferSize?: number
    /** Ignored by this fork, which only streams. */
    wavFile: string
  }
  const LiveAudioStream: {
    /** Android: a promise, rejected when the microphone can't be opened
     *  (e.g. in use). iOS: nothing. */
    init: (options: Options) => Promise<void> | void
    start: () => void
    /** Returns nothing (the package's own types wrongly say a promise). */
    stop: () => void
    /** Base64 chunks of raw PCM. Replaces any earlier listener. */
    on: (event: 'data', callback: (data: string) => void) => { remove: () => void }
  }
  export default LiveAudioStream
}
