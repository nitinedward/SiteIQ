/** Profile → Offline & uploads: when to upload (the engineer's choice, to
 *  save mobile data), what's waiting and anything that couldn't upload,
 *  and the projects kept on this phone. */

import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native'
import { useCallback, useEffect, useState } from 'react'
import { router, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { theme } from '../lib/theme'
import { SyncStatus } from './SyncStatus'
import { failedFiles, getSyncStatus, onSyncStatus, removeFailedFile, retryFailedFiles, syncNow } from '../lib/offline/sync'
import { failedOps, removeFailed, retryFailed } from '../lib/offline/outbox'
import { offlineProjects, onOfflineProjectsChange, removeOfflineProject } from '../lib/offline/download'
import { getRow } from '../lib/offline/db'
import { myId } from '../lib/offline/store'
import { setUploadMode, uploadMode, UPLOAD_MODES, type UploadMode } from '../lib/offline/uploadMode'

const T = theme.colors
const R = theme.radius

const WHAT: Record<string, string> = {
  'inspection.insert': 'New site visit', 'inspection.update': 'Site visit details', 'inspection.delete': 'Discarded visit',
  'zone.insert': 'Drawing mark-up', 'zone.delete': 'Deleted mark-up',
  'observation.insert': 'New site note', 'observation.update': 'Site note changes', 'observation.delete': 'Deleted site note',
  photo: 'Photo', audio: 'Recording',
}

type Failed = { key: string; what: string; why: string; lost: boolean; remove: () => Promise<void> }

export default function OfflineCard() {
  const [status, setStatus] = useState(getSyncStatus())
  const [mode, setMode] = useState<UploadMode>('auto')
  const [failed, setFailed] = useState<Failed[]>([])
  const [projects, setProjects] = useState<{ id: string; name: string; mb: number }[]>([])

  const load = async () => {
    setMode(await uploadMode())
    const ops = await failedOps(await myId())
    const files = await failedFiles()
    setFailed([
      ...ops.map(o => ({
        key: `op${o.seq}`, what: WHAT[o.kind] ?? o.kind, why: o.last_error ?? '',
        // A delete's item is already off the phone: removing it only stops
        // the server delete. Anything else won't reach the office.
        lost: !o.kind.endsWith('.delete'), remove: () => removeFailed(o.seq),
      })),
      ...files.map(f => ({
        key: f.local, what: WHAT[f.kind] ?? f.kind, why: f.last_error ?? '',
        lost: true, remove: () => removeFailedFile(f.local),
      })),
    ])
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

  const choose = (m: UploadMode) => { setMode(m); setUploadMode(m) }

  const retry = async () => {
    await retryFailed()
    await retryFailedFiles()
    syncNow({ manual: true })
  }

  // Something the server will never accept would otherwise stay listed
  // forever, however often "Try again" is tapped.
  const giveUp = (f: Failed) => Alert.alert(
    `Remove "${f.what}"?`,
    f.lost
      ? "It stops trying to upload. It won't reach the office, and it can't be got back."
      : "It's already gone from this phone. This only stops trying to delete it on the server.",
    [{ text: 'Keep', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { f.remove().then(load).catch(() => {}) } }])

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
        <TouchableOpacity style={S.button} onPress={() => syncNow({ manual: true })} activeOpacity={0.8}>
          <Text style={S.buttonText}>Upload now</Text>
        </TouchableOpacity>
      )}

      {failed.length > 0 && (
        <View style={S.failBox}>
          <Text style={S.failTitle}>Couldn't upload</Text>
          {failed.slice(0, 6).map(f => (
            <View key={f.key} style={S.failRow}>
              <Text style={[S.failLine, { flex: 1 }]} numberOfLines={3}>• {f.what}: {f.why}</Text>
              <TouchableOpacity onPress={() => giveUp(f)} hitSlop={8} accessibilityLabel={`Remove ${f.what}`}>
                <Text style={S.failRemove}>Remove</Text>
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity onPress={retry} activeOpacity={0.7}>
            <Text style={S.retry}>Try again</Text>
          </TouchableOpacity>
        </View>
      )}

      <Text style={S.section}>Upload</Text>
      {UPLOAD_MODES.map(m => (
        <TouchableOpacity key={m.key} style={S.modeRow} onPress={() => choose(m.key)} activeOpacity={0.7}>
          <Ionicons name={mode === m.key ? 'radio-button-on' : 'radio-button-off'} size={20} color={mode === m.key ? T.indigo : T.mid} />
          <View style={{ flex: 1 }}>
            <Text style={[S.modeLabel, mode === m.key && { color: T.indigo }]}>{m.label}</Text>
            <Text style={S.modeDetail}>{m.detail}</Text>
          </View>
        </TouchableOpacity>
      ))}

      <Text style={S.section}>Kept on this phone</Text>
      {projects.length === 0 ? (
        <Text style={S.detail}>None yet. Turn on “Available offline” on a project to carry it to site.</Text>
      ) : projects.map(p => (
        <View key={p.id} style={S.projectRow}>
          <Ionicons name="cloud-done-outline" size={16} color={T.sage} />
          <Text style={S.projectName} numberOfLines={1}>{p.name}</Text>
          <Text style={S.detail}>{p.mb} MB</Text>
          <TouchableOpacity onPress={() => router.push({ pathname: '/offline-setup/[id]', params: { id: p.id } })} hitSlop={8}>
            <Text style={S.manage}>Manage</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => remove(p)} hitSlop={10} accessibilityLabel={`Remove ${p.name} from this phone`}>
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
  failRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  failRemove:{ fontSize: 12, fontWeight: '700', color: T.clay, textDecorationLine: 'underline' },
  failTitle: { fontSize: 13, fontWeight: '700', color: T.clay },
  failLine:  { fontSize: 12, color: T.ink },
  retry:     { fontSize: 13, fontWeight: '700', color: T.indigo, marginTop: 4 },
  modeRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  modeLabel: { fontSize: 14, fontWeight: '600', color: T.ink },
  modeDetail:{ fontSize: 12, color: T.mid, marginTop: 1 },
  projectRow:{ flexDirection: 'row', alignItems: 'center', gap: 8 },
  manage:    { fontSize: 13, fontWeight: '700', color: T.indigo },
  projectName:{ flex: 1, fontSize: 14, color: T.ink, fontWeight: '500' },
})
