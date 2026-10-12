import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Image, Modal,
  TextInput, Alert, KeyboardAvoidingView, Platform, Dimensions,
} from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../lib/theme';
import { getInspection, getObservation, listResponses, photoList, respondToNote, zoneAndDrawing, type NoteResponse } from '../../lib/offline/store';
import { discardFile, localFor, savePhoto, isLocal } from '../../lib/offline/files';
import { thumbFor } from '../../lib/thumbs';
import { SyncStatus } from '../../components/SyncStatus';

const T = theme.colors;
const R = theme.radius;
const SW = Dimensions.get('window').width;

const isClosed = (severity?: string | null) => (severity ?? '').toUpperCase() === 'CLOSED';
const when = (iso?: string | null) => iso
  ? new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
  : '';

type Mode = 'close' | 'reopen' | 'comment';

/**
 * One site note from a finalised report, on site: the wording the report
 * gave it, its photos and where it was marked, its history — and closing it
 * (or reopening it) with photos and a comment, which reaches the web as a
 * comment in the note's history and the note's status (lib/offline/store
 * respondToNote).
 */
export default function SiteNoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [note, setNote]           = useState<any | null>(null);
  const [reportNo, setReportNo]   = useState('');
  const [history, setHistory]     = useState<NoteResponse[]>([]);
  const [drawing, setDrawing]     = useState<any | null>(null);
  const [loading, setLoading]     = useState(true);
  const [viewing, setViewing]     = useState<string | null>(null);
  // The close / reopen / comment form.
  const [mode, setMode]           = useState<Mode | null>(null);
  const [comment, setComment]     = useState('');
  const [photos, setPhotos]       = useState<string[]>([]);
  const [busy, setBusy]           = useState(false);

  const load = async () => {
    const n = await getObservation(String(id));
    setNote(n);
    if (n?.inspection_id) setReportNo((await getInspection(n.inspection_id))?.report_no ?? '');
    // Where it was marked: its zone's drawing, for "View on drawing".
    setDrawing(n?.zone_id ? (await zoneAndDrawing(n.zone_id, n.project_id ?? null))?.drawing ?? null : null);
    setHistory(await listResponses(String(id), setHistory));
    setLoading(false);
  };
  useFocusEffect(useCallback(() => { load(); }, [id]));

  const addPhoto = async (camera: boolean) => {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', camera ? 'Please allow camera access.' : 'Please allow photo library access.'); return; }
    const r = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8, allowsMultipleSelection: true });
    if (r.canceled) return;
    setBusy(true);
    try {
      for (const a of r.assets) {
        const local = await savePhoto(a.uri, { width: a.width, height: a.height }, `note-responses/${id}`);
        setPhotos(p => [...p, local]);
      }
    } catch { Alert.alert('Error', 'Could not save the photo.'); }
    finally { setBusy(false); }
  };

  const cancelForm = async () => {
    for (const p of photos) await discardFile(p);
    setPhotos([]); setComment(''); setMode(null);
  };

  const submit = async () => {
    if (!note || !mode) return;
    if (mode === 'reopen' && !comment.trim()) { Alert.alert('Add a reason', 'Say why the item is being reopened.'); return; }
    if (!comment.trim() && photos.length === 0) { Alert.alert('Nothing to save', 'Add a comment or a photo.'); return; }
    setBusy(true);
    try {
      await respondToNote(note, {
        comment, photos,
        status: mode === 'close' ? 'CLOSED' : mode === 'reopen' ? 'OPEN' : null,
      });
      setPhotos([]); setComment(''); setMode(null);
      await load();
    } catch (err: any) {
      Alert.alert('Could not save', err?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <View style={S.centred}><ActivityIndicator size="large" color={T.indigo} /></View>;
  if (!note) return (
    <View style={S.centred}>
      <Text style={S.muted}>This site note isn't on the phone.</Text>
      <TouchableOpacity onPress={() => router.back()}><Text style={S.link}>Go back</Text></TouchableOpacity>
    </View>
  );

  const closed = isClosed(note.severity);
  const wording = String(note.report_text || note.transcript || note.notes || '').trim();
  const notePhotos = photoList(note.photos);
  const formTitle = mode === 'close' ? 'Close this item' : mode === 'reopen' ? 'Reopen this item' : 'Add a comment';

  return (
    <KeyboardAvoidingView style={S.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={S.header}>
        <TouchableOpacity style={S.backBtn} onPress={() => router.back()} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={22} color={T.indigo} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={S.title} numberOfLines={1}>{note.zone_label || 'Site note'}</Text>
          <Text style={S.sub}>{reportNo ? `SR ${reportNo}` : 'Site note'}{note.observed_at ? ` · ${when(note.observed_at)}` : ''}</Text>
        </View>
        <View style={[S.pill, { backgroundColor: closed ? T.sageSoft : T.goldSoft }]}>
          <Text style={[S.pillText, { color: closed ? '#3F6F5A' : T.marigoldDeep }]}>{closed ? 'Closed' : 'Open'}</Text>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={S.body} keyboardShouldPersistTaps="handled">
        {note._pending && <View style={{ marginBottom: 12 }}><SyncStatus /></View>}

        <Text style={S.label}>In the report</Text>
        <Text style={S.wording}>{wording || 'No wording recorded.'}</Text>
        {closed && note.closed_at && <Text style={S.muted}>Closed {when(note.closed_at)}</Text>}

        {notePhotos.length > 0 && (
          <>
            <Text style={S.label}>Photos</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {notePhotos.map((url, i) => (
                <TouchableOpacity key={i} onPress={() => setViewing(url)} accessibilityLabel={`Photo ${i + 1}`}>
                  <Image source={{ uri: thumbFor(url) ?? url }} style={S.photo} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}

        {drawing && (
          <TouchableOpacity
            style={S.drawingBtn}
            activeOpacity={0.8}
            onPress={() => router.push({ pathname: '/drawing/[id]', params: {
              id: drawing.id, title: drawing.title, number: drawing.number ?? '', revision: drawing.revision ?? '',
              file_url: drawing.file_url, preview_url: drawing.preview_url ?? '', project_id: note.project_id ?? '',
              inspection_id: note.inspection_id ?? '', view_only: 'true',
            } })}
          >
            <Ionicons name="map-outline" size={18} color={T.indigo} />
            <Text style={S.drawingBtnText}>View on drawing {drawing.number ? `· ${drawing.number}` : ''}</Text>
            <Ionicons name="chevron-forward" size={16} color={T.mid} />
          </TouchableOpacity>
        )}

        <Text style={S.label}>History</Text>
        {history.length === 0 ? (
          <Text style={S.muted}>No comments yet.</Text>
        ) : history.map(h => (
          <View key={h.id} style={S.entry}>
            <Text style={S.entryWhen}>{when(h.created_at)}{h._pending ? ' · waiting to upload' : ''}</Text>
            {!!h.comment && <Text style={S.entryText}>{h.comment}</Text>}
            {h.files.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginTop: 6 }}>
                {h.files.map((f, i) => (
                  <TouchableOpacity key={i} onPress={() => setViewing(f.url)}>
                    <Image source={{ uri: isLocal(f.url) ? f.url : (thumbFor(f.url) ?? f.url) }} style={S.entryPhoto} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        ))}

        {mode ? (
          <View style={S.form}>
            <Text style={S.formTitle}>{formTitle}</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={S.photoBtn} onPress={() => addPhoto(true)} disabled={busy}>
                <Ionicons name="camera-outline" size={18} color="#FFFFFF" />
                <Text style={S.photoBtnText}>Take photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[S.photoBtn, S.photoBtnAlt]} onPress={() => addPhoto(false)} disabled={busy}>
                <Ionicons name="images-outline" size={18} color={T.indigo} />
                <Text style={[S.photoBtnText, { color: T.indigo }]}>Library</Text>
              </TouchableOpacity>
            </View>
            {photos.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {photos.map(p => (
                  <View key={p}>
                    <Image source={{ uri: p }} style={S.photo} />
                    <TouchableOpacity
                      style={S.removePhoto}
                      onPress={async () => { await discardFile(p); setPhotos(curr => curr.filter(x => x !== p)); }}
                      accessibilityLabel="Remove photo"
                    >
                      <Ionicons name="close" size={14} color="#FFFFFF" />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}
            <TextInput
              style={S.input}
              value={comment}
              onChangeText={setComment}
              placeholder={mode === 'close' ? 'e.g. Bolts installed, torqued and marked.' : mode === 'reopen' ? 'Why is it being reopened?' : 'Comment'}
              placeholderTextColor={T.mid}
              multiline
              textAlignVertical="top"
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={[S.formBtn, S.formCancel]} onPress={cancelForm} disabled={busy}>
                <Text style={[S.formBtnText, { color: T.mid }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[S.formBtn, mode === 'reopen' ? S.formReopen : S.formSave]} onPress={submit} disabled={busy}>
                {busy ? <ActivityIndicator color="#FFFFFF" /> : (
                  <Text style={S.formBtnText}>{mode === 'close' ? 'Close item' : mode === 'reopen' ? 'Reopen item' : 'Save comment'}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={{ gap: 10, marginTop: 18 }}>
            {closed ? (
              <TouchableOpacity style={[S.action, S.actionReopen]} onPress={() => setMode('reopen')} activeOpacity={0.85}>
                <Ionicons name="refresh" size={18} color={T.clay} />
                <Text style={[S.actionText, { color: T.clay }]}>Reopen item</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[S.action, S.actionClose]} onPress={() => setMode('close')} activeOpacity={0.85}>
                <Ionicons name="checkmark-circle-outline" size={20} color="#FFFFFF" />
                <Text style={[S.actionText, { color: '#FFFFFF' }]}>Close item</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[S.action, S.actionComment]} onPress={() => setMode('comment')} activeOpacity={0.85}>
              <Ionicons name="chatbubble-outline" size={18} color={T.indigo} />
              <Text style={[S.actionText, { color: T.indigo }]}>Add a comment</Text>
            </TouchableOpacity>
          </View>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal visible={!!viewing} animationType="fade" onRequestClose={() => setViewing(null)}>
        <View style={S.viewer}>
          <TouchableOpacity style={S.viewerClose} onPress={() => setViewing(null)} accessibilityLabel="Close">
            <Ionicons name="close" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          {viewing && <Image source={{ uri: localFor(viewing) }} style={S.viewerImage} resizeMode="contain" />}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.paper },
  centred:   { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: T.paper },
  header:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 60, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: T.line },
  backBtn:   { width: 44, height: 44, borderRadius: 22, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, alignItems: 'center', justifyContent: 'center' },
  title:     { fontSize: 18, fontWeight: '800', color: T.indigo },
  sub:       { fontSize: 12, color: T.mid, marginTop: 1 },
  pill:      { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  pillText:  { fontSize: 13, fontWeight: '700' },
  body:      { padding: 16 },
  label:     { fontSize: 11, fontWeight: '700', color: T.mid, textTransform: 'uppercase', letterSpacing: 1, marginTop: 18, marginBottom: 8 },
  wording:   { fontSize: 15, color: T.ink, lineHeight: 22 },
  muted:     { fontSize: 13, color: T.mid, marginTop: 4 },
  link:      { fontSize: 15, color: T.indigo, fontWeight: '600' },
  photo:     { width: 96, height: 96, borderRadius: 10, backgroundColor: '#FFFFFF' },
  drawingBtn:{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, padding: 14, borderRadius: R.md, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line },
  drawingBtnText: { flex: 1, fontSize: 14, fontWeight: '600', color: T.indigo },
  entry:     { backgroundColor: T.surface, borderRadius: R.md, borderWidth: 1, borderColor: T.line, padding: 12, marginBottom: 8 },
  entryWhen: { fontSize: 11, color: T.mid },
  entryText: { fontSize: 14, color: T.ink, marginTop: 4, lineHeight: 20 },
  entryPhoto:{ width: 64, height: 64, borderRadius: 8, backgroundColor: '#FFFFFF' },
  form:      { marginTop: 18, gap: 12, backgroundColor: T.surface, borderRadius: R.md, borderWidth: 1, borderColor: T.line, padding: 14 },
  formTitle: { fontSize: 16, fontWeight: '800', color: T.indigoDeep },
  photoBtn:  { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', height: 46, borderRadius: R.pill, backgroundColor: T.indigo },
  photoBtnAlt: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.indigo },
  photoBtnText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  removePhoto: { position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(42,46,55,0.78)', alignItems: 'center', justifyContent: 'center' },
  input:     { minHeight: 90, borderRadius: 12, borderWidth: 1, borderColor: T.line, backgroundColor: T.paper, padding: 12, fontSize: 15, color: T.ink },
  formBtn:   { flex: 1, height: 50, borderRadius: R.pill, alignItems: 'center', justifyContent: 'center' },
  formCancel:{ backgroundColor: T.paper, borderWidth: 1, borderColor: T.line },
  formSave:  { backgroundColor: '#3F6F5A' },
  formReopen:{ backgroundColor: T.clay },
  formBtnText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  action:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 54, borderRadius: R.pill },
  actionClose:   { backgroundColor: '#3F6F5A' },
  actionReopen:  { backgroundColor: T.surface, borderWidth: 1.5, borderColor: T.clay },
  actionComment: { backgroundColor: T.surface, borderWidth: 1.5, borderColor: T.indigo },
  actionText:{ fontSize: 16, fontWeight: '700' },
  viewer:    { flex: 1, backgroundColor: '#000000', justifyContent: 'center' },
  viewerClose: { position: 'absolute', top: 56, right: 16, zIndex: 2, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  viewerImage: { width: SW, height: '80%' },
});
