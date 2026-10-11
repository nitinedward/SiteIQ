import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native'
import { useEffect, useState } from 'react'
import * as Network from 'expo-network'
import { theme } from '../lib/theme'
import { onModelState, isModelReady, downloadModel, deleteModel, MODEL_SIZE_MB, type ModelState } from '../lib/whisperModel'

const T = theme.colors
const R = theme.radius

/** Profile → Offline transcription: whether the Whisper model is on the
 *  phone (lib/whisperModel), with its download and removal. */
export default function OfflineTranscriptionCard() {
  const [state, setState] = useState<ModelState>({ status: 'missing' })

  useEffect(() => {
    const unsubscribe = onModelState(setState)
    isModelReady().catch(() => {})
    return unsubscribe
  }, [])

  const start = async () => {
    const net = await Network.getNetworkStateAsync().catch(() => null)
    const go = () => downloadModel().catch(() => {}) // the card shows a failure
    if (net && net.type !== Network.NetworkStateType.WIFI) {
      Alert.alert(
        'Not on Wi-Fi',
        `The download is about ${MODEL_SIZE_MB} MB and would use mobile data. Download anyway?`,
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Download', onPress: go }],
      )
      return
    }
    go()
  }

  const remove = () => Alert.alert(
    'Remove offline transcription?',
    `Frees about ${MODEL_SIZE_MB} MB. Dictation then needs signal until it is downloaded again.`,
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { deleteModel().catch(() => {}) } }],
  )

  return (
    <View style={S.card}>
      <View style={S.row}>
        <View style={[S.badge, { backgroundColor: state.status === 'ready' ? T.sageSoft : T.indigoSoft }]}>
          <Text style={[S.badgeText, { color: state.status === 'ready' ? T.sage : T.indigo }]}>Voice</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={S.title}>Offline transcription</Text>
          <Text style={S.detail}>
            {state.status === 'ready' && 'On this phone — dictation works with no signal.'}
            {state.status === 'missing' && `Not downloaded (${MODEL_SIZE_MB} MB). Downloads by itself on Wi-Fi.`}
            {state.status === 'downloading' && `Downloading… ${Math.round(state.progress * 100)}%`}
            {state.status === 'error' && `Download failed: ${state.message}`}
          </Text>
        </View>
        {state.status === 'downloading' && <ActivityIndicator color={T.indigo} />}
      </View>

      {state.status === 'downloading' && (
        <View style={S.track}><View style={[S.fill, { width: `${Math.round(state.progress * 100)}%` }]} /></View>
      )}

      {(state.status === 'missing' || state.status === 'error') && (
        <TouchableOpacity style={S.button} onPress={start} activeOpacity={0.8}>
          <Text style={S.buttonText}>{state.status === 'error' ? 'Try again' : 'Download now'}</Text>
        </TouchableOpacity>
      )}
      {state.status === 'ready' && (
        <TouchableOpacity style={S.link} onPress={remove} activeOpacity={0.7}>
          <Text style={S.linkText}>Remove from this phone</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

const S = StyleSheet.create({
  card: {
    backgroundColor: T.surface,
    borderRadius: R.md,
    padding: 16,
    gap: 12,
    shadowColor: '#2C3950',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 3,
  },
  row:       { flexDirection: 'row', alignItems: 'center', gap: 14 },
  badge:     { borderRadius: R.sm, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  title:     { fontSize: 15, color: T.ink, fontWeight: '600' },
  detail:    { fontSize: 13, color: T.mid, marginTop: 2, lineHeight: 18 },
  track:     { height: 6, borderRadius: 3, backgroundColor: T.line, overflow: 'hidden' },
  fill:      { height: 6, borderRadius: 3, backgroundColor: T.indigo },
  button:    { backgroundColor: T.indigo, borderRadius: R.pill, paddingVertical: 12, alignItems: 'center' },
  buttonText:{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  link:      { alignItems: 'center', paddingVertical: 4 },
  linkText:  { fontSize: 13, color: T.clay, fontWeight: '600' },
})
