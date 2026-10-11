/** Profile → Offline & uploads: what's waiting to upload (and anything that
 *  couldn't), and the projects kept on this phone. */

import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native'
import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { theme } from '../lib/theme'
import { SyncStatus } from './SyncStatus'
import { getSyncStatus, onSyncStatus, syncNow } from '../lib/offline/sync'
import { failedOps, retryFailed, type Op } from '../lib/offline/outbox'
import { offlineProjects, onOfflineProjectsChange, removeOfflineProject } from '../lib/offline/download'
import { getRow } from '../lib/offline/db'
import { myId } from '../lib/offline/store'

const T = theme.colors
const R = theme.radius

const WHAT: Record<string, string> = {
  'inspection.insert': 'New site visit', 'inspection.update': 'Site visit details', 'inspection.delete': 'Discarded visit',
  'zone.insert': 'Drawing mark-up', 'zone.delete': 'Deleted mark-up',
  'observation.insert': 'New site note', 'observation.update': 'Site note changes', 'observation.delete': 'Deleted site note',
}

export default function OfflineCard() {
  const [status, setStatus] = useState(getSyncStatus())
  const [failed, setFailed] = useState<Op[]>([])
  const [projects, setProjects] = useState<{ id: string; name: string; mb: number }[]>([])

  const load = async () => {
    setFailed(await failedOps(await myId()))
    const rows = await offlineProjects()
    setProjects(await Promise.all(rows.map(async r => ({
      id: r.project_id,
      name: (await getRow('projects', r.project_id))?.name ?? 'Project',
      mb: Math.max(1, Math.round(r.bytes / 1e6)),
    }))))
  }

  useEffect(() => onSyncStatus(s => { setStatus(s); load().catch(() => {}) }), [])
  useEffect(() => onOfflineProjectsChange(() => { load() }), [])
  useFocusEffect(useCallback(() => { load() }, []))

  const remove = (p: { id: string; name: string }) => Alert.alert(
    'Remove from this phone?', `${p.name}'s drawings are removed from the phone. Anything not yet uploaded stays and still uploads.`,
    [{ text: 'Keep', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { removeOfflineProject(p.id) } }])

  return (
    <View style={S.card}>
      <View style={S.row}>
        <View style={[S.badge, { backgroundColor: T.indigoSoft }]}>
          <Text style={[S.badgeText, { color: T.indigo }]}>Sync</Text>
        </View>
        <Text style={[S.title, { flex: 1 }]}>Offline & uploads</Text>
      </View>

      <SyncStatus always />

      {status.waiting > 0 && status.online && !status.uploading && (
        <TouchableOpacity style={S.button} onPress={() => syncNow(true)} activeOpacity={0.8}>
          <Text style={S.buttonText}>Upload now</Text>
        </TouchableOpacity>
      )}

      {failed.length > 0 && (
        <View style={S.failBox}>
          <Text style={S.failTitle}>Couldn't upload</Text>
          {failed.slice(0, 5).map(op => (
            <Text key={op.seq} style={S.failLine} numberOfLines={2}>• {WHAT[op.kind] ?? op.kind}: {op.last_error}</Text>
          ))}
          <TouchableOpacity onPress={() => retryFailed().then(() => syncNow(true))} activeOpacity={0.7}>
            <Text style={S.retry}>Try again</Text>
          </TouchableOpacity>
        </View>
      )}

      <Text style={S.section}>Kept on this phone</Text>
      {projects.length === 0 ? (
        <Text style={S.detail}>None yet. Turn on “Available offline” on a project to carry it to site.</Text>
      ) : projects.map(p => (
        <View key={p.id} style={S.projectRow}>
          <Ionicons name="cloud-done-outline" size={16} color={T.sage} />
          <Text style={S.projectName} numberOfLines={1}>{p.name}</Text>
          <Text style={S.detail}>{p.mb} MB</Text>
          <TouchableOpacity onPress={() => remove(p)} hitSlop={10}>
            <Ionicons name="close-circle-outline" size={20} color={T.mid} />
          </TouchableOpacity>
        </View>
      ))}
    </View>
  )
}

const S = StyleSheet.create({
  card: {
    backgroundColor: T.surface, borderRadius: R.md, padding: 16, gap: 12,
    shadowColor: '#2C3950', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.08, shadowRadius: 24, elevation: 3,
  },
  row:       { flexDirection: 'row', alignItems: 'center', gap: 14 },
  badge:     { borderRadius: R.sm, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  title:     { fontSize: 15, color: T.ink, fontWeight: '600' },
  detail:    { fontSize: 13, color: T.mid, lineHeight: 18 },
  section:   { fontSize: 11, fontWeight: '700', color: T.mid, textTransform: 'uppercase', letterSpacing: 1, marginTop: 4 },
  button:    { backgroundColor: T.indigo, borderRadius: R.pill, paddingVertical: 10, alignItems: 'center' },
  buttonText:{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  failBox:   { backgroundColor: '#FDECEA', borderRadius: R.sm, padding: 12, gap: 4 },
  failTitle: { fontSize: 13, fontWeight: '700', color: T.clay },
  failLine:  { fontSize: 12, color: T.ink },
  retry:     { fontSize: 13, fontWeight: '700', color: T.indigo, marginTop: 4 },
  projectRow:{ flexDirection: 'row', alignItems: 'center', gap: 8 },
  projectName:{ flex: 1, fontSize: 14, color: T.ink, fontWeight: '500' },
})
