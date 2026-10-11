/** A one-line note of where uploads stand — "Offline · 3 saved on this
 *  phone", "Uploading 3…", "2 photos waiting for Wi-Fi", "All uploaded" —
 *  so the engineer knows when the office can see their notes. Tapping it
 *  uploads now (whatever the setting) or, if something failed, opens
 *  Profile. Hidden when there's nothing to say, unless `always`. */

import { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { getSyncStatus, onSyncStatus, syncNow, type SyncStatus as Status } from '../lib/offline/sync'
import { theme } from '../lib/theme'

const T = theme.colors

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "3 changes and 2 photos" — what's waiting, in words. */
function waitingWords(s: Status): string {
  const parts: string[] = []
  if (s.changes) parts.push(plural(s.changes, 'change', 'changes'))
  if (s.files) parts.push(plural(s.files, 'photo/recording', 'photos/recordings'))
  return parts.join(' and ')
}

export function SyncStatus({ always = false }: { always?: boolean }) {
  const [s, setS] = useState<Status>(getSyncStatus())
  useEffect(() => onSyncStatus(setS), [])

  let icon: keyof typeof Ionicons.glyphMap
  let text: string
  let colour: string
  let bg: string
  if (s.failed > 0) {
    icon = 'alert-circle'; colour = T.clay; bg = '#FDECEA'
    text = `${plural(s.failed, 'item', 'items')} couldn't upload — tap to see why`
  } else if (s.waiting > 0 && !s.online) {
    icon = 'cloud-offline-outline'; colour = T.marigoldDeep; bg = T.goldSoft
    text = `Offline · ${waitingWords(s)} saved on this phone`
  } else if (s.waiting > 0 && s.uploading) {
    icon = 'cloud-upload-outline'; colour = T.indigo; bg = T.indigoSoft
    text = `Uploading ${waitingWords(s)}…`
  } else if (s.waiting > 0 && s.held === 'manual') {
    icon = 'pause-circle-outline'; colour = T.indigo; bg = T.indigoSoft
    text = `${waitingWords(s)} on this phone · tap to upload`
  } else if (s.waiting > 0 && s.held === 'wifi') {
    icon = 'wifi-outline'; colour = T.indigo; bg = T.indigoSoft
    text = `${waitingWords(s)} waiting for Wi-Fi · tap to upload now`
  } else if (s.waiting > 0) {
    icon = 'time-outline'; colour = T.marigoldDeep; bg = T.goldSoft
    text = `${waitingWords(s)} waiting to upload${s.problem ? ' · weak signal' : ''}`
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
    else if (s.waiting > 0 && s.online) syncNow({ manual: true })
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
