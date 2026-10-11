import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Image, Alert, KeyboardAvoidingView, Platform,
  ActivityIndicator,
} from 'react-native';
import { useState, useRef, useEffect, useCallback } from 'react';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../lib/theme';
import { startDictation, type Dictation, type Stage, type Transcription } from '../lib/dictation';
import { consumePendingMeasurement } from '../lib/pendingMeasurement';
import { getInspection, getObservation, photoList, saveObservation } from '../lib/offline/store';
import { discardFile, keepRecording, localFor, savePhoto } from '../lib/offline/files';
import { deferTranscription } from '../lib/transcribeJobs';
import { Waveform, useLevel } from '../components/Waveform';

const T = theme.colors;
const R = theme.radius;



// An observation is tracked as open or closed rather than graded by
// severity. It is still stored in the `observations.severity` column, so no
// database change is needed and existing reports keep working — see
// toStatus() for how older graded records are read back.
type Status = 'OPEN' | 'CLOSED';
type Measurement = { id: string; type: string; value: string; unit: string };

const MEASUREMENT_TYPES = [
  { label: 'Cover Depth', unit: 'mm' }, { label: 'Lap Length', unit: 'mm' },
  { label: 'Bar Spacing', unit: 'mm' }, { label: 'Starter Bar Length', unit: 'mm' },
  { label: 'Crack Width', unit: 'mm' }, { label: 'Crack Length', unit: 'mm' },
  { label: 'Crack Depth', unit: 'mm' }, { label: 'Bar Diameter', unit: 'mm' },
  { label: 'Slab Thickness', unit: 'mm' }, { label: 'Deflection', unit: 'mm' },
  { label: 'Settlement', unit: 'mm' }, { label: 'Tilt / Lean', unit: 'degrees' },
  { label: 'Spalling Area', unit: 'm²' }, { label: 'Custom', unit: 'mm' },
];

const STATUS_OPTIONS = [
  { value: 'OPEN'   as Status, label: 'Open',   colour: '#F59E0B', description: 'Outstanding — still to be actioned' },
  { value: 'CLOSED' as Status, label: 'Closed', colour: '#16A34A', description: 'Resolved — no further action needed' },
];

/** Reads what's stored back as a status. Only an explicit 'CLOSED' is
 *  closed; anything else — including a blank field — is open. The graded
 *  values this column used to hold were migrated to OPEN and the database
 *  no longer accepts them (web/sql/observation_status.sql), so this is just
 *  a guard now. */
function toStatus(stored: string | null | undefined): Status {
  return (stored ?? '').toUpperCase() === 'CLOSED' ? 'CLOSED' : 'OPEN';
}

export default function ObservationScreen() {
  const params = useLocalSearchParams();
  const zoneId        = params.zone_id as string || '';
  const isGeneral     = zoneId === 'general';
  const projectId     = params.project_id as string || '';
  const inspectionId  = params.inspection_id as string || '';
  const observationId = params.observation_id as string || '';
  const isEditMode    = !!observationId;

  const [zoneLabel, setZoneLabel]   = useState(params.zone_label as string || 'General Observation');
  const [photos, setPhotos]         = useState<string[]>([]);
  const [transcript, setTranscript] = useState('');
  const [reportText, setReportText] = useState('');
  const [reportRef, setReportRef]   = useState('');
  const [status, setStatus]         = useState<Status>('OPEN');
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading]   = useState(false);
  const [isLoadingObs, setIsLoadingObs] = useState(isEditMode);
  const [showMeasForm, setShowMeasForm] = useState(false);
  const [newMeasType, setNewMeasType]   = useState(MEASUREMENT_TYPES[0].label);
  const [newMeasValue, setNewMeasValue] = useState('');
  const [newMeasUnit, setNewMeasUnit]   = useState(MEASUREMENT_TYPES[0].unit);
  const [customLabel, setCustomLabel]   = useState('');
  const [customUnit, setCustomUnit]     = useState('mm');
  const [isRecording, setIsRecording]       = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [stage, setStage]                   = useState<Stage | null>(null);
  const level                                = useLevel();
  const dictationRef                         = useRef<Dictation | null>(null);
  const startingRef                          = useRef(false);
  // Recordings already on the note (edit mode), and those made on this
  // screen — kept on the phone and uploaded with the note (lib/offline).
  const [savedAudio, setSavedAudio]         = useState<string[]>([]);
  const [newRecordings, setNewRecordings]   = useState<string[]>([]);
  // A transcription still running; if the note is saved first, its text is
  // added to the note when it finishes (lib/transcribeJobs).
  const pendingRef = useRef<{ audio: string; transcription: Promise<Transcription>; deferred: boolean } | null>(null);

  useEffect(() => {
    return () => { dictationRef.current?.cancel().catch(() => {}); };
  }, []);

  useFocusEffect(useCallback(() => {
    const m = consumePendingMeasurement();
    if (m) {
      setNewMeasValue(m.value);
      setNewMeasUnit(m.unit);
      setShowMeasForm(true);
    }
  }, []));

  // Which site report the note belongs to, numbered as the report is
  // ("Site Report 005") — the same reference the web Site Notes view shows.
  const loadReportRef = async (inspId: string | null | undefined) => {
    if (!inspId) { setReportRef('Not in a site report'); return; }
    const data = await getInspection(inspId);
    setReportRef(data?.report_no ? `Site Report ${data.report_no}` : 'Site report (no number)');
  };

  useEffect(() => {
    if (!isEditMode) loadReportRef(inspectionId);
  }, [inspectionId]);

  useEffect(() => {
    if (!isEditMode) return;
    (async () => {
      const data = await getObservation(observationId);
      if (!data) { Alert.alert('Error', 'Could not load observation.'); router.back(); return; }
      if (data.zone_label) setZoneLabel(data.zone_label);
      setPhotos(photoList(data.photos));
      setTranscript(data.transcript || '');
      setSavedAudio(Array.isArray(data.audio) ? data.audio : []);
      setReportText((data.report_text || '').trim());
      loadReportRef(data.inspection_id);
      setStatus(toStatus(data.severity));
      try { setMeasurements(typeof data.measurements === 'string' ? JSON.parse(data.measurements || '[]') : data.measurements || []); } catch {}
      setIsLoadingObs(false);
    })();
  }, [observationId]);

  // Saved on the phone (scaled down) and uploaded with the note.
  const addPhoto = async (asset: ImagePicker.ImagePickerAsset) => {
    setIsUploading(true);
    try {
      const local = await savePhoto(asset.uri, { width: asset.width, height: asset.height });
      setPhotos(curr => [...curr, local]);
    } catch (e) {
      console.error('[addPhoto] Error:', e);
      Alert.alert('Error', 'Could not save the photo.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleTakePhoto = async () => {
    const { granted } = await ImagePicker.requestCameraPermissionsAsync();
    if (!granted) { Alert.alert('Permission Required', 'Please allow camera access.'); return; }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (!r.canceled) await addPhoto(r.assets[0]);
  };

  const handlePickPhoto = async () => {
    const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!granted) { Alert.alert('Permission Required', 'Please allow photo library access.'); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8, allowsMultipleSelection: true });
    if (!r.canceled) for (const a of r.assets) await addPhoto(a);
  };

  const startRecording = async () => {
    if (startingRef.current) return
    startingRef.current = true
    try {
      dictationRef.current = await startDictation({ onLevel: v => level.setValue(v), context: [zoneLabel] })
      setIsRecording(true)
    } catch (err: any) {
      console.error('[voice] Start error:', err)
      setIsRecording(false)
      Alert.alert('Recording Failed', err.message || 'Could not start recording.')
    } finally {
      startingRef.current = false
    }
  };

  const stopRecording = async () => {
    const dictation = dictationRef.current
    dictationRef.current = null
    setIsRecording(false)
    level.setValue(0)
    if (!dictation) return
    setIsTranscribing(true)
    try {
      const recording = await dictation.stop({ onStage: setStage })
      // Kept with the note whatever happens to the transcription.
      const audio = await keepRecording(recording.audioUri)
      setNewRecordings(curr => [...curr, audio])
      const pending = { audio, transcription: recording.transcription, deferred: false }
      pendingRef.current = pending
      const { text, engine, error } = await recording.transcription
      if (pending.deferred) return // the note was saved meanwhile; the text goes onto it
      pendingRef.current = null
      console.log(`[voice] ${recording.seconds.toFixed(1)}s, transcribed on the ${engine}${error ? ' — failed' : ''}`)
      if (text) {
        setTranscript(prev => prev ? prev + ' ' + text : text)
      } else if (error) {
        Alert.alert('Not transcribed yet', error)
      } else {
        setNewRecordings(curr => curr.filter(a => a !== audio))
        await discardFile(audio)
        Alert.alert('No Speech Detected', 'Could not detect speech. Please speak clearly and try again.')
      }
    } catch (err: any) {
      console.error('[voice] Stop error:', err)
      Alert.alert('Recording Failed', err.message || 'Please try again.')
    } finally {
      setIsTranscribing(false)
      setStage(null)
    }
  };

  const addMeasurement = () => {
    if (!newMeasValue || isNaN(Number(newMeasValue))) { Alert.alert('Invalid', 'Please enter a valid number.'); return; }
    if (newMeasType === 'Custom' && !customLabel.trim()) { Alert.alert('Missing', 'Please enter a label.'); return; }
    setMeasurements(curr => [...curr, { id: Date.now().toString(), type: newMeasType === 'Custom' ? customLabel : newMeasType, value: newMeasValue, unit: newMeasType === 'Custom' ? customUnit : newMeasUnit }]);
    setNewMeasValue(''); setCustomLabel(''); setShowMeasForm(false);
  };

  // Saved on the phone at once and uploaded when there's signal
  // (lib/offline/sync) — saving never waits on the connection.
  const handleSubmit = async () => {
    const pending = pendingRef.current;
    if (!transcript.trim() && photos.length === 0 && measurements.length === 0 && newRecordings.length === 0) {
      Alert.alert('Nothing to Save', 'Please add a note, photo, or measurement.'); return;
    }
    setIsSubmitting(true);
    const label = zoneLabel.trim() || 'General Site Observation';
    // Stored under the original column name — see the Status type above.
    const fields = {
      severity: status, transcript: transcript.trim(), notes: '', photos, measurements, zone_label: label,
      audio: [...savedAudio, ...newRecordings],
    };
    let id: string;
    try {
      id = await saveObservation(isEditMode
        ? { id: observationId, ...fields }
        : { ...fields, zone_id: zoneId !== 'general' ? zoneId : null, project_id: projectId, inspection_id: inspectionId || null });
    } catch (err: any) {
      setIsSubmitting(false);
      Alert.alert('Save Failed', err?.message ?? 'Please try again.');
      return;
    }
    // Still transcribing: the text is added to the saved note when it's ready.
    if (pending) {
      pending.deferred = true;
      pendingRef.current = null;
      await deferTranscription(id, pending.audio, pending.transcription);
    }
    setIsSubmitting(false);
    Alert.alert(
      isEditMode ? 'Updated' : 'Saved',
      `Observation for "${zoneLabel}" has been ${isEditMode ? 'updated' : 'recorded'}.` +
        (pending ? ' The dictation is still being transcribed and will be added to the note when it\'s ready.' : ''),
      [{ text: 'OK', onPress: () => router.back() }]);
  };

  const selStatus = STATUS_OPTIONS.find(s => s.value === status)!;

  if (isLoadingObs) return (
    <View style={[S.container, { alignItems: 'center', justifyContent: 'center' }]}>
      <ActivityIndicator size="large" color={T.indigo} />
      <Text style={{ color: T.mid, marginTop: 12 }}>Loading...</Text>
    </View>
  );

  return (
    <KeyboardAvoidingView style={S.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={S.header}>
        <TouchableOpacity style={S.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color={T.indigo} />
        </TouchableOpacity>
        <Text style={S.headerTitle} numberOfLines={1}>{isEditMode ? 'Edit Observation' : 'New Observation'}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={S.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* Zone banner */}
        <View style={S.zoneBanner}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: T.indigo }}>Zone:</Text>
          <View style={{ flex: 1 }}>
            {isGeneral ? (
              <TextInput
                style={S.zoneLabelInput}
                value={zoneLabel}
                onChangeText={setZoneLabel}
                placeholder="General Site Observation"
                placeholderTextColor={T.mid}
              />
            ) : (
              <Text style={S.zoneLabel}>{zoneLabel}</Text>
            )}
            {!!reportRef && <Text style={S.zoneSub}>{reportRef}</Text>}
            <Text style={S.zoneSub}>Tap below to capture your observations</Text>
          </View>
        </View>

        {/* Photos */}
        <View style={S.section}>
          <Text style={S.sectionTitle}>Photos ({photos.length})</Text>
          <View style={S.photoActions}>
            <TouchableOpacity style={S.photoBtn} onPress={handleTakePhoto} disabled={isUploading}>
              {isUploading ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={S.photoBtnText}>Take Photo</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[S.photoBtn, S.photoBtnSecondary]} onPress={handlePickPhoto} disabled={isUploading}>
              <Text style={[S.photoBtnText, { color: T.indigo }]}>Library</Text>
            </TouchableOpacity>
          </View>
          {photos.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {photos.map((uri, i) => (
                <TouchableOpacity key={i} onLongPress={() => Alert.alert('Remove Photo', 'Remove this photo?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => setPhotos(curr => curr.filter((_, idx) => idx !== i)) }])}>
                  <Image source={{ uri: localFor(uri) }} style={S.photoThumb} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>

        {/* Notes — typed or dictated */}
        <View style={S.section}>
          <View style={S.sectionRow}>
            <Text style={S.sectionTitle}>Notes</Text>
            <TouchableOpacity style={[S.recordBtn, isRecording && S.recordBtnActive, isTranscribing && S.recordBtnTranscribing]} onPress={() => isRecording ? stopRecording() : startRecording()} disabled={isTranscribing}>
              {isTranscribing ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={S.recordBtnText}>{isRecording ? 'Stop' : 'Record'}</Text>}
            </TouchableOpacity>
          </View>
          {(isRecording || isTranscribing) && (
            <View style={S.waveBox}>
              <Waveform level={level} active={isRecording} />
              <Text style={S.waveHint}>
                {isRecording ? 'Listening...'
                  : stage?.engine === 'phone' ? `Transcribing on the phone… ${Math.round(stage.progress * 100)}%`
                  : 'Transcribing…'}
              </Text>
              {isTranscribing && <Text style={S.waveSub}>You can save the note now — the text is added when it's ready.</Text>}
            </View>
          )}
          {!!reportText && (
            <View style={[S.transcriptBox, S.reportBox]}>
              <Text style={S.transcriptLabel}>In the report (from the finalised report — editing below doesn’t change it):</Text>
              <Text style={S.reportText}>{reportText}</Text>
            </View>
          )}
          <View style={S.transcriptBox}>
            <Text style={S.transcriptLabel}>Type your observation, or tap Record to dictate:</Text>
            <TextInput
              style={S.transcriptInput}
              value={transcript}
              onChangeText={setTranscript}
              placeholder="e.g. Hairline cracking to the south face of the column, approx 0.2 mm wide."
              placeholderTextColor={T.mid}
              multiline
              textAlignVertical="top"
              editable={!isRecording && !isTranscribing}
            />
          </View>
        </View>

        {/* Status */}
        <View style={S.section}>
          <Text style={S.sectionTitle}>Status</Text>
          <View style={S.severityGrid}>
            {STATUS_OPTIONS.map(opt => (
              <TouchableOpacity key={opt.value} style={[S.sevChip, status === opt.value && { backgroundColor: opt.colour + '20', borderColor: opt.colour }]} onPress={() => setStatus(opt.value)}>
                <View style={[S.sevDot, { backgroundColor: opt.colour }]} />
                <Text style={[S.sevLabel, status === opt.value && { color: opt.colour }]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[S.sevDesc, { color: selStatus.colour }]}>{selStatus.description}</Text>
        </View>

        {/* Measurements */}
        <View style={S.section}>
          <View style={S.sectionRow}>
            <Text style={S.sectionTitle}>Measurements ({measurements.length})</Text>
            <TouchableOpacity style={S.addMeasBtn} onPress={() => setShowMeasForm(!showMeasForm)}>
              <Text style={S.addMeasBtnText}>{showMeasForm ? 'Cancel' : '+ Add'}</Text>
            </TouchableOpacity>
          </View>
          {showMeasForm && (
            <View style={S.measForm}>
              <Text style={S.measLabel}>Type</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {MEASUREMENT_TYPES.map(t => (
                  <TouchableOpacity key={t.label} style={[S.measTypeChip, newMeasType === t.label && S.measTypeChipActive]} onPress={() => { setNewMeasType(t.label); setNewMeasUnit(t.unit); }}>
                    <Text style={[S.measTypeText, newMeasType === t.label && { color: '#FFFFFF' }]}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              {newMeasType === 'Custom' && (
                <><Text style={S.measLabel}>Label</Text><TextInput style={S.measInput} placeholder="e.g. Beam depth" placeholderTextColor={T.mid} value={customLabel} onChangeText={setCustomLabel} /></>
              )}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={S.measLabel}>Value</Text>
                  <TextInput style={S.measInput} placeholder="0" placeholderTextColor={T.mid} value={newMeasValue} onChangeText={setNewMeasValue} keyboardType="decimal-pad" />
                </View>
                <View style={{ width: 80 }}>
                  <Text style={S.measLabel}>Unit</Text>
                  <TextInput style={S.measInput} value={newMeasType === 'Custom' ? customUnit : newMeasUnit} onChangeText={newMeasType === 'Custom' ? setCustomUnit : undefined} editable={newMeasType === 'Custom'} placeholderTextColor={T.mid} />
                </View>
              </View>
              <TouchableOpacity style={S.arMeasureBtn} onPress={() => router.push('/ar-measure')}>
                <Ionicons name="scan-outline" size={16} color={T.indigo} />
                <Text style={S.arMeasureBtnText}>Measure with AR</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.measSaveBtn} onPress={addMeasurement}>
                <Text style={S.measSaveBtnText}>Add Measurement</Text>
              </TouchableOpacity>
            </View>
          )}
          {measurements.map(m => (
            <View key={m.id} style={S.measRow}>
              <Text style={S.measType}>{m.type}</Text>
              <Text style={S.measValue}>{m.value} {m.unit}</Text>
              <TouchableOpacity onPress={() => setMeasurements(curr => curr.filter(x => x.id !== m.id))}>
                <Text style={S.measDelete}>x</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        {/* Submit */}
        <View style={S.section}>
          <TouchableOpacity style={[S.submitBtn, isSubmitting && { opacity: 0.6 }]} onPress={handleSubmit} disabled={isSubmitting} activeOpacity={0.85}>
            {isSubmitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={S.submitBtnText}>{isEditMode ? 'Update Observation' : 'Save Observation'}</Text>}
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const S = StyleSheet.create({
  container:    { flex: 1, backgroundColor: T.paper },
  scroll:       { flex: 1 },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12, backgroundColor: T.surface, borderBottomWidth: 1, borderBottomColor: T.line },
  backBtn:      {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: T.paper, alignItems: 'center', justifyContent: 'center',
  },
  headerTitle:  { fontSize: 16, fontWeight: '600', color: T.ink, flex: 1, textAlign: 'center' },
  zoneBanner:   { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: T.surface, margin: 16, borderRadius: R.md, padding: 16, borderWidth: 1, borderColor: T.line, borderLeftWidth: 4, borderLeftColor: T.marigold, shadowColor: '#2C3950', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 2 },
  zoneLabel:    { fontSize: 16, fontWeight: '700', color: T.ink, marginBottom: 2 },
  zoneLabelInput: { fontSize: 16, fontWeight: '700', color: T.ink, marginBottom: 2, padding: 0 },
  zoneSub:      { fontSize: 12, color: T.mid },
  section:      { paddingHorizontal: 16, paddingBottom: 16 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: T.mid, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
  sectionRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  photoActions: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  photoBtn:     { flex: 1, backgroundColor: T.indigo, borderRadius: R.pill, height: 48, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  photoBtnSecondary: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.indigo },
  photoBtnText: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  photoThumb:   { width: 80, height: 80, borderRadius: 8, marginRight: 8, marginBottom: 8 },
  recordBtn:    { backgroundColor: T.indigoSoft, paddingHorizontal: 14, paddingVertical: 7, borderRadius: R.pill, borderWidth: 1, borderColor: T.line, minWidth: 90, alignItems: 'center' },
  recordBtnActive: { backgroundColor: T.clay, borderColor: T.clay },
  recordBtnTranscribing: { backgroundColor: T.indigoSoft, borderColor: T.indigo },
  recordBtnText: { fontSize: 13, color: T.ink, fontWeight: '500' },
  waveBox:      { backgroundColor: T.sageSoft, borderRadius: R.md, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: T.sage, marginBottom: 10, gap: 6 },
  waveHint:     { fontSize: 12, color: T.sage },
  waveSub:      { fontSize: 11, color: T.mid, textAlign: 'center' },
  transcriptBox:{ backgroundColor: T.surface, borderRadius: R.sm, padding: 14, borderWidth: 1, borderColor: T.line },
  transcriptLabel:{ fontSize: 11, color: T.mid, marginBottom: 6 },
  transcriptInput:{ fontSize: 14, color: T.ink, minHeight: 80 },
  reportBox:    { backgroundColor: T.indigoSoft, marginBottom: 10 },
  reportText:   { fontSize: 14, color: T.ink, lineHeight: 20 },
  severityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  sevChip:      { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: T.surface, borderRadius: R.pill, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1.5, borderColor: T.line },
  sevDot:       { width: 8, height: 8, borderRadius: 4 },
  sevLabel:     { fontSize: 13, color: T.mid, fontWeight: '500' },
  sevDesc:      { fontSize: 12, fontStyle: 'italic', marginTop: 4 },
  addMeasBtn:   { backgroundColor: T.indigoSoft, paddingHorizontal: 14, paddingVertical: 7, borderRadius: R.sm },
  addMeasBtnText:{ fontSize: 13, color: T.indigo, fontWeight: '600' },
  measForm:     { backgroundColor: T.surface, borderRadius: R.md, padding: 14, borderWidth: 1, borderColor: T.line, marginBottom: 10, gap: 8, shadowColor: '#2C3950', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 2 },
  measLabel:    { fontSize: 12, color: T.mid, marginBottom: 4 },
  measTypeChip: { backgroundColor: T.indigoSoft, borderRadius: R.pill, paddingHorizontal: 12, paddingVertical: 6, marginRight: 6 },
  measTypeChipActive:{ backgroundColor: T.indigo },
  measTypeText: { fontSize: 12, color: T.mid },
  measInput:    { backgroundColor: T.paper, borderWidth: 1, borderColor: T.line, borderRadius: 8, padding: 10, fontSize: 14, color: T.ink },
  arMeasureBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: T.indigoSoft, borderRadius: R.sm, height: 40, marginBottom: 10 },
  arMeasureBtnText: { color: T.indigo, fontSize: 13, fontWeight: '700' },
  measSaveBtn:  { backgroundColor: T.indigo, borderRadius: R.sm, height: 44, alignItems: 'center', justifyContent: 'center' },
  measSaveBtnText:{ color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  measRow:      { flexDirection: 'row', alignItems: 'center', backgroundColor: T.surface, borderRadius: R.sm, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: T.line },
  measType:     { flex: 1, fontSize: 13, color: T.mid },
  measValue:    { fontSize: 14, color: T.ink, fontWeight: '600', marginRight: 12 },
  measDelete:   { fontSize: 16, color: T.clay },
  notesInput:   { backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: R.sm, padding: 14, fontSize: 14, color: T.ink, minHeight: 100 },
  submitBtn:    { backgroundColor: T.sage, borderRadius: R.pill, height: 54, alignItems: 'center', justifyContent: 'center', shadowColor: '#3A6B59', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.2, shadowRadius: 16, elevation: 5 },
  submitBtnText:{ color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
