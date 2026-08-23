import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Image, Alert, KeyboardAvoidingView, Platform,
  ActivityIndicator, Animated,
} from 'react-native';
import { useState, useRef, useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '../lib/supabase';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';
import { theme } from '../lib/theme';

const T = theme.colors;
const R = theme.radius;

const BAR_COUNT = 24;
const SUPABASE_URL = 'https://vbaewualqaxhbmqgnhdt.supabase.co';
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';


type Severity = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
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

const SEVERITY_OPTIONS = [
  { value: 'NONE' as Severity,     label: 'None',     colour: '#94A3B8', description: 'No defects observed' },
  { value: 'LOW' as Severity,      label: 'Low',      colour: '#16A34A', description: 'Minor — monitor only' },
  { value: 'MEDIUM' as Severity,   label: 'Medium',   colour: '#F59E0B', description: 'Moderate — action required' },
  { value: 'HIGH' as Severity,     label: 'High',     colour: '#EF4444', description: 'Serious — urgent action' },
  { value: 'CRITICAL' as Severity, label: 'Critical', colour: '#7C3AED', description: 'Immediate action required' },
];

function WaveformVisualiser({ isRecording, metering }: { isRecording: boolean; metering: number }) {
  const barAnims = useRef(Array.from({ length: BAR_COUNT }, () => new Animated.Value(0.05))).current;
  const timeRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      timeRef.current += 1;
      barAnims.forEach((anim, index) => {
        let t: number;
        if (isRecording) {
          const n = Math.max(0, Math.min(1, (metering + 60) / 60));
          const w = Math.sin(timeRef.current * 0.4 + index * 0.6) * 0.15;
          const c = 1 - Math.abs(index - BAR_COUNT / 2) / (BAR_COUNT / 2) * 0.4;
          t = Math.max(0.05, (n + w) * c);
        } else {
          t = 0.05 + (Math.sin(timeRef.current * 0.15 + index * 0.5) + 1) / 2 * 0.04;
        }
        Animated.spring(anim, { toValue: t, useNativeDriver: false, speed: 60, bounciness: 0 }).start();
      });
    }, 80);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isRecording, metering]);
  return (
    <View style={wave.container}>
      {barAnims.map((anim, i) => (
        <Animated.View key={i} style={[wave.bar, {
          height: anim.interpolate({ inputRange: [0, 1], outputRange: [3, 48] }),
          backgroundColor: isRecording
            ? anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['#FCE8C2', '#F5A524', '#F5A524'] })
            : T.line,
          opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
        }]} />
      ))}
    </View>
  );
}
const wave = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 56, gap: 3, paddingHorizontal: 8 },
  bar: { width: 3, borderRadius: 2 },
});

export default function ObservationScreen() {
  const params = useLocalSearchParams();
  const zoneLabel     = params.zone_label as string || 'General Observation';
  const zoneId        = params.zone_id as string || '';
  const projectId     = params.project_id as string || '';
  const inspectionId  = params.inspection_id as string || '';
  const observationId = params.observation_id as string || '';
  const isEditMode    = !!observationId;

  const [photos, setPhotos]         = useState<string[]>([]);
  const [transcript, setTranscript] = useState('');
  const [severity, setSeverity]     = useState<Severity>('NONE');
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
  const recordingRef                         = useRef<Audio.Recording | null>(null);

  useEffect(() => {
    return () => {
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    if (!isEditMode) return;
    (async () => {
      const { data, error } = await supabase.from('observations').select('*').eq('id', observationId).single();
      if (error || !data) { Alert.alert('Error', 'Could not load observation.'); router.back(); return; }
      setPhotos(Array.isArray(data.photos) ? data.photos : JSON.parse(data.photos || '[]'));
      setTranscript(data.transcript || '');
      setSeverity(data.severity || 'NONE');
      try { setMeasurements(typeof data.measurements === 'string' ? JSON.parse(data.measurements || '[]') : data.measurements || []); } catch {}
      setIsLoadingObs(false);
    })();
  }, [observationId]);

  const uploadPhoto = async (uri: string) => {
    setIsUploading(true);
    try {
      const fileName = `photo-${Date.now()}.jpg`;
      const fd = new FormData();
      fd.append('file', { uri, name: fileName, type: 'image/jpeg' } as any);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? SUPABASE_KEY;
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/observation-photos/${fileName}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_KEY },
        body: fd,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => res.status.toString());
        console.error('[uploadPhoto] Failed:', res.status, errText);
        Alert.alert('Upload Failed', 'Could not upload photo. Check your connection and try again.');
        return;
      }
      setPhotos(curr => [...curr, `${SUPABASE_URL}/storage/v1/object/public/observation-photos/${fileName}`]);
    } catch (e) {
      console.error('[uploadPhoto] Error:', e);
      Alert.alert('Error', 'Photo upload failed.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleTakePhoto = async () => {
    const { granted } = await ImagePicker.requestCameraPermissionsAsync();
    if (!granted) { Alert.alert('Permission Required', 'Please allow camera access.'); return; }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (!r.canceled) await uploadPhoto(r.assets[0].uri);
  };

  const handlePickPhoto = async () => {
    const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!granted) { Alert.alert('Permission Required', 'Please allow photo library access.'); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8, allowsMultipleSelection: true });
    if (!r.canceled) for (const a of r.assets) await uploadPhoto(a.uri);
  };

  const startRecording = async () => {
    try {
      console.log('[voice] Requesting permission...')

      const { granted } = await Audio.requestPermissionsAsync()

      if (!granted) {
        Alert.alert(
          'Permission Required',
          'Please allow microphone access in Settings to record voice notes.'
        )
        return
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      })

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      )

      recordingRef.current = recording
      setIsRecording(true)

      console.log('[voice] Recording started')

    } catch (err: any) {
      console.error('[voice] Start error:', err)
      setIsRecording(false)
      Alert.alert('Recording Failed', err.message || 'Could not start recording.')
    }
  };

  const stopRecording = async () => {
    try {
      setIsRecording(false)
      setIsTranscribing(true)

      if (!recordingRef.current) {
        setIsTranscribing(false)
        return
      }

      await recordingRef.current.stopAndUnloadAsync()

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
      })

      const uri = recordingRef.current.getURI()
      recordingRef.current = null

      if (!uri) {
        setIsTranscribing(false)
        Alert.alert('No Audio', 'No audio was recorded. Please try again.')
        return
      }

      console.log('[voice] Audio saved:', uri)

      const transcribed = await transcribeAudio(uri)

      if (transcribed) {
        setTranscript(prev =>
          prev ? prev + ' ' + transcribed : transcribed
        )
        console.log('[voice] Transcript updated')
      } else {
        Alert.alert(
          'No Speech Detected',
          'Could not detect speech. Please speak clearly and try again.'
        )
      }

    } catch (err: any) {
      console.error('[voice] Stop error:', err)
      Alert.alert(
        'Transcription Failed',
        err.message || 'Please try again.'
      )
    } finally {
      setIsTranscribing(false)
    }
  };

  const transcribeAudio = async (uri: string): Promise<string> => {
    try {
      console.log('[whisper] Starting:', uri)

      const apiKey = process.env.EXPO_PUBLIC_OPENAI_KEY

      if (!apiKey) {
        throw new Error(
          'OpenAI API key not configured. Please contact your administrator.'
        )
      }

      const formData = new FormData()
      formData.append('file', {
        uri,
        type: 'audio/m4a',
        name: 'recording.m4a',
      } as any)
      formData.append('model', 'whisper-1')
      formData.append('language', 'en')
      formData.append(
        'prompt',
        'This is a structural engineering site inspection recording. ' +
        'Technical terms may include: reinforcement, concrete, beam, ' +
        'column, foundation, slab, rebar, stirrup, spacing, compliance.'
      )

      console.log('[whisper] Sending to API...')

      const response = await fetch(
        'https://api.openai.com/v1/audio/transcriptions',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
          body: formData,
        }
      )

      console.log('[whisper] Response:', response.status)

      if (!response.ok) {
        const errText = await response.text()
        console.error('[whisper] Error:', errText)
        throw new Error(`Whisper API error: ${response.status}`)
      }

      const data = await response.json()
      const transcript = data.text?.trim() ?? ''

      console.log('[whisper] Transcript:', transcript.substring(0, 100))

      return transcript

    } catch (err: any) {
      console.error('[whisper] Failed:', err)
      throw err
    }
  };

  const addMeasurement = () => {
    if (!newMeasValue || isNaN(Number(newMeasValue))) { Alert.alert('Invalid', 'Please enter a valid number.'); return; }
    if (newMeasType === 'Custom' && !customLabel.trim()) { Alert.alert('Missing', 'Please enter a label.'); return; }
    setMeasurements(curr => [...curr, { id: Date.now().toString(), type: newMeasType === 'Custom' ? customLabel : newMeasType, value: newMeasValue, unit: newMeasType === 'Custom' ? customUnit : newMeasUnit }]);
    setNewMeasValue(''); setCustomLabel(''); setShowMeasForm(false);
  };

  const handleSubmit = async () => {
    if (!transcript.trim() && photos.length === 0 && measurements.length === 0) {
      Alert.alert('Nothing to Save', 'Please add at least one photo, voice note, or measurement.'); return;
    }
    setIsSubmitting(true);
    const payload = { severity, transcript: transcript.trim(), notes: '', photos, measurements };
    const { error } = isEditMode
      ? await supabase.from('observations').update(payload).eq('id', observationId)
      : await supabase.from('observations').insert({ ...payload, zone_id: zoneId !== 'general' ? zoneId : null, project_id: projectId, inspection_id: inspectionId || null, zone_label: zoneLabel });
    setIsSubmitting(false);
    if (error) { Alert.alert('Save Failed', error.message); return; }
    Alert.alert(isEditMode ? 'Updated' : 'Saved', `Observation for "${zoneLabel}" has been ${isEditMode ? 'updated' : 'recorded'}.`, [{ text: 'OK', onPress: () => router.back() }]);
  };

  const selSev = SEVERITY_OPTIONS.find(s => s.value === severity)!;

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
          <Text style={S.backArrow}>{'‹'}</Text>
          <Text style={S.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={S.headerTitle} numberOfLines={1}>{isEditMode ? 'Edit Observation' : 'New Observation'}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={S.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* Zone banner */}
        <View style={S.zoneBanner}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: T.indigo }}>Zone:</Text>
          <View style={{ flex: 1 }}>
            <Text style={S.zoneLabel}>{zoneLabel}</Text>
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
                  <Image source={{ uri }} style={S.photoThumb} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>

        {/* Voice */}
        <View style={S.section}>
          <View style={S.sectionRow}>
            <Text style={S.sectionTitle}>Voice Notes</Text>
            <TouchableOpacity style={[S.recordBtn, isRecording && S.recordBtnActive, isTranscribing && S.recordBtnTranscribing]} onPress={() => isRecording ? stopRecording() : startRecording()} disabled={isTranscribing}>
              {isTranscribing ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={S.recordBtnText}>{isRecording ? 'Stop' : 'Record'}</Text>}
            </TouchableOpacity>
          </View>
          {(isRecording || isTranscribing) && (
            <View style={S.waveBox}>
              <WaveformVisualiser isRecording={isRecording} metering={isRecording ? -20 : -60} />
              <Text style={S.waveHint}>{isRecording ? 'Listening...' : 'Processing...'}</Text>
            </View>
          )}
          {transcript ? (
            <View style={S.transcriptBox}>
              <Text style={S.transcriptLabel}>Transcribed — tap to edit:</Text>
              <TextInput style={S.transcriptInput} value={transcript} onChangeText={setTranscript} multiline textAlignVertical="top" />
            </View>
          ) : (
            <View style={S.emptyVoice}><Text style={S.emptyVoiceText}>Tap Record to dictate your observation</Text></View>
          )}
        </View>

        {/* Severity */}
        <View style={S.section}>
          <Text style={S.sectionTitle}>Severity</Text>
          <View style={S.severityGrid}>
            {SEVERITY_OPTIONS.map(opt => (
              <TouchableOpacity key={opt.value} style={[S.sevChip, severity === opt.value && { backgroundColor: opt.colour + '20', borderColor: opt.colour }]} onPress={() => setSeverity(opt.value)}>
                <View style={[S.sevDot, { backgroundColor: opt.colour }]} />
                <Text style={[S.sevLabel, severity === opt.value && { color: opt.colour }]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {severity !== 'NONE' && <Text style={[S.sevDesc, { color: selSev.colour }]}>{selSev.description}</Text>}
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
  backBtn:      { flexDirection: 'row', alignItems: 'center', gap: 4, width: 60 },
  backArrow:    { fontSize: 28, color: T.indigo, lineHeight: 32 },
  backText:     { fontSize: 16, color: T.indigo },
  headerTitle:  { fontSize: 16, fontWeight: '600', color: T.ink, flex: 1, textAlign: 'center' },
  zoneBanner:   { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: T.surface, margin: 16, borderRadius: R.md, padding: 16, borderWidth: 1, borderColor: T.line, borderLeftWidth: 4, borderLeftColor: T.marigold, shadowColor: '#2C3950', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 2 },
  zoneLabel:    { fontSize: 16, fontWeight: '700', color: T.ink, marginBottom: 2 },
  zoneSub:      { fontSize: 12, color: T.mid },
  section:      { paddingHorizontal: 16, paddingBottom: 16 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: T.mid, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
  sectionRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  photoActions: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  photoBtn:     { flex: 1, backgroundColor: T.indigo, borderRadius: R.sm, height: 48, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  photoBtnSecondary: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.indigo },
  photoBtnText: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  photoThumb:   { width: 80, height: 80, borderRadius: 8, marginRight: 8, marginBottom: 8 },
  recordBtn:    { backgroundColor: T.indigoSoft, paddingHorizontal: 14, paddingVertical: 7, borderRadius: R.pill, borderWidth: 1, borderColor: T.line, minWidth: 90, alignItems: 'center' },
  recordBtnActive: { backgroundColor: T.clay, borderColor: T.clay },
  recordBtnTranscribing: { backgroundColor: T.indigoSoft, borderColor: T.indigo },
  recordBtnText: { fontSize: 13, color: T.ink, fontWeight: '500' },
  waveBox:      { backgroundColor: T.sageSoft, borderRadius: R.md, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: T.sage, marginBottom: 10, gap: 6 },
  waveHint:     { fontSize: 12, color: T.sage },
  transcriptBox:{ backgroundColor: T.surface, borderRadius: R.sm, padding: 14, borderWidth: 1, borderColor: T.line },
  transcriptLabel:{ fontSize: 11, color: T.mid, marginBottom: 6 },
  transcriptInput:{ fontSize: 14, color: T.ink, minHeight: 80 },
  emptyVoice:   { backgroundColor: T.surface, borderRadius: R.sm, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: T.line, borderStyle: 'dashed' },
  emptyVoiceText:{ fontSize: 13, color: T.mid },
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
