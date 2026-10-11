import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native'
import { useEffect, useState } from 'react'
import * as Network from 'expo-network'
import { theme } from '../lib/theme'
import {
  onModelState, isModelReady, downloadModel, deleteModel, chooseModel, chosenModel, recommendedModel,
  modelSizeMb, MODELS, type ModelKey, type ModelState,
} from '../lib/whisperModel'

const T = theme.colors
const R = theme.radius

/** Profile → Offline transcription: whether the Whisper model is on the
 *  phone (lib/whisperModel), which size, and its download and removal.
 *  With signal, dictation is transcribed by the server either way; this is
 *  what transcribes it with none. */
export default function OfflineTranscriptionCard() {
  const [state, setState] = useState<ModelState>({ status: 'missing' })
  const [model, setModel] = useState<ModelKey>(recommendedModel())
  const recommended = recommendedModel()

  useEffect(() => {
    const unsubscribe = onModelState(setState)
    chosenModel().then(setModel).catch(() => {})
    isModelReady().catch(() => {})
    return unsubscribe
  }, [])

  /** Asks before using mobile data for `mb` megabytes. */
  const confirmData = async (mb: number, go: () => void) => {
    const net = await Network.getNetworkStateAsync().catch(() => null)
    if (net && net.type !== Network.NetworkStateType.WIFI) {
      Alert.alert('Not on Wi-Fi', `The download is about ${mb} MB and would use mobile data. Download anyway?`,
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Download', onPress: go }])
      return
    }
    go()
  }

  const start = () => confirmData(modelSizeMb(model), () => { downloadModel().catch(() => {}) }) // the card shows a failure

  const pick = (key: ModelKey) => {
    if (key === model || state.status === 'downloading') return
    const swap = () => { setModel(key); chooseModel(key).catch(() => {}) }
    const slow = key === 'small' && recommended !== 'small'
    const go = () => confirmData(modelSizeMb(key), swap)
    if (slow) {
      Alert.alert('Slow on this phone',
        'Accurate can take several minutes per recording on this phone with no signal. (With signal, the server transcribes it either way.) Use it anyway?',
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Use Accurate', onPress: go }])
      return
    }
    go()
  }

  const remove = () => Alert.alert(
    'Remove offline transcription?',
    `Frees about ${modelSizeMb(model)} MB. Dictation then needs signal until it is downloaded again.`,
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
            {state.status === 'ready' && 'On this phone — dictation works with no signal. With signal, the server transcribes it (faster).'}
            {state.status === 'missing' && `Not downloaded (${modelSizeMb(model)} MB). Downloads by itself on Wi-Fi.`}
            {state.status === 'downloading' && `Downloading… ${Math.round(state.progress * 100)}%`}
            {state.status === 'error' && `Download failed: ${state.message}`}
          </Text>
        </View>
        {state.status === 'downloading' && <ActivityIndicator color={T.indigo} />}
      </View>

      {state.status === 'downloading' && (
        <View style={S.track}><View style={[S.fill, { width: `${Math.round(state.progress * 100)}%` }]} /></View>
      )}

      <View style={S.choices}>
        {(Object.keys(MODELS) as ModelKey[]).map(key => (
          <TouchableOpacity key={key} style={[S.choice, model === key && S.choiceOn]} onPress={() => pick(key)} activeOpacity={0.8}>
            <Text style={[S.choiceLabel, model === key && S.choiceLabelOn]}>{MODELS[key].label}</Text>
            <Text style={S.choiceMeta}>{modelSizeMb(key)} MB{key === recommended ? ' · best fit' : ''}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={S.note}>{MODELS[model].note}.</Text>

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
  choices:   { flexDirection: 'row', gap: 8 },
  choice:    { flex: 1, borderRadius: R.sm, borderWidth: 1.5, borderColor: T.line, paddingVertical: 8, alignItems: 'center' },
  choiceOn:  { borderColor: T.indigo, backgroundColor: T.indigoSoft },
  choiceLabel:   { fontSize: 13, fontWeight: '700', color: T.mid },
  choiceLabelOn: { color: T.indigo },
  choiceMeta:    { fontSize: 10, color: T.mid, marginTop: 2 },
  note:      { fontSize: 12, color: T.mid, marginTop: -4 },
  button:    { backgroundColor: T.indigo, borderRadius: R.pill, paddingVertical: 12, alignItems: 'center' },
  buttonText:{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  link:      { alignItems: 'center', paddingVertical: 4 },
  linkText:  { fontSize: 13, color: T.clay, fontWeight: '600' },
})
