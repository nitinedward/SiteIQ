/** A one-line note of where uploads stand — "Offline · 3 saved on this
 *  phone", "Uploading 3…", "All uploaded" — so the engineer knows when the
 *  office can see their notes. Hidden when there's nothing to say, unless
 *  `always` asks for the all-clear too. */

import { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { getSyncStatus, onSyncStatus, syncNow, type SyncStatus as Status } from '../lib/offline/sync'
import { theme } from '../lib/theme'

const T = theme.colors

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function SyncStatus({ always = false }: { always?: boolean }) {
  const [s, setS] = useState<Status>(getSyncStatus())
  useEffect(() => onSyncStatus(setS), [])

  let icon: keyof typeof Ionicons.glyphMap
  let text: string
  let colour: string
  let bg: string
  if (s.failed > 0) {
    icon = 'alert-circle'; colour = T.clay; bg = '#FDECEA'
    text = `${plural(s.failed, 'change', 'changes')} couldn't upload — tap to see`
  } else if (s.waiting > 0 && !s.online) {
    icon = 'cloud-offline-outline'; colour = T.marigoldDeep; bg = T.goldSoft
    text = `Offline · ${plural(s.waiting, 'change', 'changes')} saved on this phone`
  } else if (s.waiting > 0 && s.uploading) {
    icon = 'cloud-upload-outline'; colour = T.indigo; bg = T.indigoSoft
    text = `Uploading ${plural(s.waiting, 'change', 'changes')}…`
  } else if (s.waiting > 0) {
    icon = 'time-outline'; colour = T.marigoldDeep; bg = T.goldSoft
    text = `${plural(s.waiting, 'change', 'changes')} waiting to upload${s.problem ? ' · weak signal' : ''}`
  } else if (!s.online) {
    if (!always) return null
    icon = 'cloud-offline-outline'; colour = T.mid; bg = '#EEF0F2'
    text = 'Offline · everything is saved on this phone'
  } else {
    if (!always) return null
    icon = 'checkmark-circle'; colour = T.sage; bg = T.sageSoft
    text = 'All uploaded'
  }

  const onPress = () => {
    if (s.failed > 0) router.push('/(tabs)/profile')
    else if (s.waiting > 0 && s.online) syncNow(true)
  }

  return (
    <TouchableOpacity activeOpacity={0.8} onPress={onPress} style={[S.pill, { backgroundColor: bg }]}>
      <Ionicons name={icon} size={15} color={colour} />
      <Text style={[S.text, { color: colour }]} numberOfLines={1}>{text}</Text>
    </TouchableOpacity>
  )
}

const S = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  text: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
})

export const SyncStatusRow = ({ always }: { always?: boolean }) => (
  <View style={{ paddingHorizontal: 16, paddingTop: 10 }}><SyncStatus always={always} /></View>
)
