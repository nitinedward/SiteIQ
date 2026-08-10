import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, Alert,
  ActivityIndicator, Animated,
} from 'react-native';
import { useState, useEffect, useRef } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '../lib/supabase';
import * as SecureStore from 'expo-secure-store';
import { Audio } from 'expo-av';
import { theme } from '../lib/theme';

const T = theme.colors;
const R = theme.radius;

const SITE_CONTACT_KEY  = 'last_site_contact';
const CONTACT_PHONE_KEY = 'last_contact_phone';

const BAR_COUNT = 24;

const WEATHER_OPTIONS = [
  { label: 'Fine',         icon: '☀️' },
  { label: 'Partly Cloudy', icon: '⛅' },
  { label: 'Overcast',    icon: '☁️' },
  { label: 'Raining',     icon: '🌧️' },
  { label: 'Windy',       icon: '💨' },
  { label: 'Cold',        icon: '🥶' },
];

type Step = 'details' | 'capture';
type Drawing = { id: string; title: string; number: string; revision: string; file_url: string; preview_url: string | null };

function WaveformVisualiser({ isRecording, metering }: { isRecording: boolean; metering: number }) {
  const barAnims = useRef(Array.from({ length: BAR_COUNT }, () => new Animated.Value(0.05))).current;
  const timeRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      timeRef.current += 1;
      barAnims.forEach((anim, index) => {
        let targetValue: number;
        if (isRecording) {
          const normalised = Math.max(0, Math.min(1, (metering + 60) / 60));
          const wave = Math.sin(timeRef.current * 0.4 + index * 0.6) * 0.15;
          const centreBoost = 1 - Math.abs(index - BAR_COUNT / 2) / (BAR_COUNT / 2) * 0.4;
          targetValue = Math.max(0.05, (normalised + wave) * centreBoost);
        } else {
          const wave = Math.sin(timeRef.current * 0.15 + index * 0.5);
          targetValue = 0.05 + (wave + 1) / 2 * 0.04;
        }
        Animated.spring(anim, { toValue: targetValue, useNativeDriver: false, speed: 60, bounciness: 0 }).start();
      });
    }, 80);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isRecording, metering]);

  return (
    <View style={waveStyles.container}>
      {barAnims.map((anim, index) => (
        <Animated.View key={index} style={[waveStyles.bar, {
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

const waveStyles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 56, gap: 3, paddingHorizontal: 8 },
  bar: { width: 3, borderRadius: 2 },
});

export default function SessionScreen() {
  const { project_id, project_name } = useLocalSearchParams();
  const [step, setStep]                 = useState<Step>('details');
  const [isSaving, setIsSaving]         = useState(false);
  const [inspectionId, setInspectionId] = useState<string | null>(null);
  const [weather, setWeather]           = useState('Fine');
  const [siteContact, setSiteContact]   = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [purpose, setPurpose]           = useState('');
  const [reportNo, setReportNo]         = useState('');
  const [allDrawings, setAllDrawings]         = useState<Drawing[]>([]);
  const [selectedDrawings, setSelectedDrawings] = useState<string[]>([]);
  const [isRecording, setIsRecording]       = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recordingRef                         = useRef<Audio.Recording | null>(null);

  const today      = new Date().toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const todayShort = new Date().toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });

  useEffect(() => {
    loadSavedDetails();
    generateReportNumber();
    fetchDrawings();
    return () => {
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
      }
    };
  }, []);

  const loadSavedDetails = async () => {
    const sc = await SecureStore.getItemAsync(SITE_CONTACT_KEY);
    const cp = await SecureStore.getItemAsync(CONTACT_PHONE_KEY);
    if (sc) setSiteContact(sc);
    if (cp) setContactPhone(cp);
  };

  const generateReportNumber = async () => {
    const { count } = await supabase.from('inspections').select('*', { count: 'exact', head: true }).eq('project_id', String(project_id));
    setReportNo(((count ?? 0) + 1).toString().padStart(3, '0'));
  };

  const fetchDrawings = async () => {
    const { data } = await supabase.from('drawings').select('id,title,number,revision,file_url,preview_url').eq('project_id', String(project_id)).order('number', { ascending: true });
    setAllDrawings(data as Drawing[] ?? []);
  };

  const toggleDrawing = (id: string) => setSelectedDrawings(curr => curr.includes(id) ? curr.filter(d => d !== id) : [...curr, id]);

  const startRecording = async () => {
    try {
      console.log('[dictate] Requesting permission...')

      const { granted } = await Audio.requestPermissionsAsync()

      if (!granted) {
        Alert.alert(
          'Permission Required',
          'Please allow microphone access in Settings to use dictation.'
        )
        return
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      })

      console.log('[dictate] Starting recording...')

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      )

      recordingRef.current = recording
      setIsRecording(true)

      console.log('[dictate] Recording started')

    } catch (err: any) {
      console.error('[dictate] Start error:', err)
      setIsRecording(false)
      Alert.alert(
        'Recording Failed',
        err.message || 'Could not start recording.'
      )
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
        Alert.alert(
          'No Audio',
          'No audio was recorded. Please try again.'
        )
        return
      }

      console.log('[dictate] Audio saved:', uri)

      const transcript = await transcribeAudio(uri)

      if (transcript) {
        setPurpose(prev =>
          prev ? prev + ' ' + transcript : transcript
        )
        console.log('[dictate] Purpose updated')
      } else {
        Alert.alert(
          'No Speech Detected',
          'Could not detect speech. Please speak clearly and try again.'
        )
      }

    } catch (err: any) {
      console.error('[dictate] Stop error:', err)
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

  const toggleRecording = () => { if (isRecording) stopRecording(); else startRecording(); };

  const handleBack = () => Alert.alert('Leave Inspection?', 'Your inspection details will be lost.', [
    { text: 'Stay', style: 'cancel' },
    { text: 'Leave', style: 'destructive', onPress: () => router.back() },
  ]);

  const startCapturing = async () => {
    setIsSaving(true);
    if (siteContact.trim()) await SecureStore.setItemAsync(SITE_CONTACT_KEY, siteContact.trim());
    if (contactPhone.trim()) await SecureStore.setItemAsync(CONTACT_PHONE_KEY, contactPhone.trim());
    const drawingRef = allDrawings.filter(d => selectedDrawings.includes(d.id)).map(d => d.number || d.title).join(', ');
    const { data, error } = await supabase.from('inspections').insert({
      project_id: String(project_id), date: todayShort, weather,
      site_contact: siteContact.trim(), contact_phone: contactPhone.trim(),
      drawing_ref: drawingRef, report_no: reportNo.trim(), purpose: purpose.trim(), status: 'IN_PROGRESS',
    }).select().single();
    setIsSaving(false);
    if (error) { Alert.alert('Error', 'Could not start inspection.'); return; }
    setInspectionId(data.id); setStep('capture');
  };

  const completeSession = async () => {
    Alert.alert('Complete Inspection?', 'Are you ready to complete this session?', [
      { text: 'Keep Capturing', style: 'cancel' },
      { text: 'Complete', onPress: async () => {
        if (inspectionId) await supabase.from('inspections').update({ status: 'COMPLETED' }).eq('id', inspectionId);
        Alert.alert('Session Complete', 'Your inspection has been saved.', [{ text: 'OK', onPress: () => router.replace('/(tabs)/projects') }]);
      }},
    ]);
  };

  // ── STEP 1: DETAILS ─────────────────────────────────
  if (step === 'details') {
    return (
      <KeyboardAvoidingView style={S.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={S.header}>
          <TouchableOpacity style={S.backBtn} onPress={handleBack}>
            <Text style={S.backArrow}>{'←'}</Text>
            <Text style={S.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={S.headerTitle}>New Inspection</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView style={S.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={S.banner}>
            <Text style={S.bannerProject}>{project_name}</Text>
            <Text style={S.bannerDate}>{today}</Text>
          </View>

          {/* Weather */}
          <View style={S.section}>
            <Text style={S.sectionTitle}>Weather Conditions</Text>
            <View style={S.weatherGrid}>
              {WEATHER_OPTIONS.map(opt => (
                <TouchableOpacity key={opt.label} style={[S.chip, weather === opt.label && S.chipActive]} onPress={() => setWeather(opt.label)}>
                  <Text style={S.chipIcon}>{opt.icon}</Text>
                  <Text style={[S.chipLabel, weather === opt.label && S.chipLabelActive]}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Site Details */}
          <View style={S.section}>
            <Text style={S.sectionTitle}>Site Details</Text>
            <Text style={S.label}>Site Contact Name</Text>
            <Text style={S.hint}>Auto-filled from your last inspection</Text>
            <TextInput style={S.input} placeholder="e.g. John Smith" placeholderTextColor={T.mid} value={siteContact} onChangeText={setSiteContact} autoCapitalize="words" />
          </View>

          {/* Drawings */}
          <View style={S.section}>
            <Text style={S.sectionTitle}>Select Drawings ({selectedDrawings.length} selected)</Text>
            <Text style={S.hint}>Tick the drawings relevant to today's inspection</Text>
            {allDrawings.length === 0 ? (
              <View style={S.emptyBox}><Text style={S.emptyText}>No drawings uploaded yet</Text></View>
            ) : allDrawings.map(drawing => {
              const sel = selectedDrawings.includes(drawing.id);
              return (
                <TouchableOpacity key={drawing.id} style={[S.checkRow, sel && S.checkRowActive]} onPress={() => toggleDrawing(drawing.id)} activeOpacity={0.7}>
                  <View style={[S.checkbox, sel && S.checkboxActive]}>
                    {sel && <Text style={S.checkmark}>{'v'}</Text>}
                  </View>
                  <View style={S.checkInfo}>
                    <Text style={S.checkTitle}>{drawing.title}</Text>
                    <Text style={S.checkMeta}>{drawing.number ? `${drawing.number} - ` : ''}Rev {drawing.revision}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Purpose */}
          <View style={S.section}>
            <View style={S.sectionRow}>
              <Text style={S.sectionTitle}>Purpose of Inspection</Text>
              <TouchableOpacity style={[S.recordBtn, isRecording && S.recordBtnActive, isTranscribing && S.recordBtnTranscribing]} onPress={toggleRecording} disabled={isTranscribing}>
                {isTranscribing ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={S.recordBtnText}>{isRecording ? '⏹ Stop' : '🎙 Dictate'}</Text>}
              </TouchableOpacity>
            </View>
            {(isRecording || isTranscribing) && (
              <View style={S.waveBox}>
                <WaveformVisualiser isRecording={isRecording} metering={isRecording ? -20 : -60} />
                <Text style={S.recordHint}>{isRecording ? '🔴 Listening — tap Stop when finished' : '⏳ Processing...'}</Text>
              </View>
            )}
            <TextInput style={S.textArea} placeholder="Describe the purpose of this inspection..." placeholderTextColor={T.mid} value={purpose} onChangeText={setPurpose} multiline numberOfLines={4} textAlignVertical="top" />
          </View>

          {/* Start */}
          <View style={S.section}>
            <TouchableOpacity style={[S.startBtn, isSaving && { opacity: 0.6 }]} onPress={startCapturing} disabled={isSaving} activeOpacity={0.85}>
              {isSaving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={S.startBtnText}>{'Start Capturing Observations →'}</Text>}
            </TouchableOpacity>
            <Text style={S.startHint}>Site contact details saved automatically for next time</Text>
          </View>

          <View style={{ height: 48 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── STEP 2: CAPTURE ─────────────────────────────────
  const inspDrawings = allDrawings.filter(d => selectedDrawings.includes(d.id));
  return (
    <View style={S.container}>
      <View style={S.header}>
        <TouchableOpacity style={S.backBtn} onPress={() => setStep('details')}>
          <Text style={S.backArrow}>{'←'}</Text>
          <Text style={S.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={S.headerTitle}>Capturing</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={S.scroll} showsVerticalScrollIndicator={false}>
        <View style={S.banner}>
          <Text style={S.bannerProject}>{project_name}</Text>
          <Text style={S.bannerDate}>{todayShort} - {weather}</Text>
          <View style={S.activeBadge}>
            <View style={S.activeDot} />
            <Text style={S.activeBadgeText}>Active Session - Report #{reportNo}</Text>
          </View>
        </View>

        <View style={S.section}>
          <Text style={S.sectionTitle}>Drawings ({inspDrawings.length})</Text>
          <Text style={S.hint}>Tap a drawing to open the PDF and mark inspection zones</Text>
          {inspDrawings.map(drawing => (
            <TouchableOpacity key={drawing.id} style={S.drawingRow}
              onPress={() => router.push({ pathname: '/drawing/[id]', params: { id: drawing.id, title: drawing.title, file_url: drawing.file_url, preview_url: drawing.preview_url ?? '', project_id: String(project_id), inspection_id: inspectionId, view_only: 'false' } })}
              activeOpacity={0.7}>
              <View style={S.drawBadge}><Text style={S.drawBadgeText}>{drawing.number || '-'}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={S.drawTitle}>{drawing.title}</Text>
                <Text style={S.drawMeta}>Rev {drawing.revision} - Tap to inspect</Text>
              </View>
              <Text style={S.arrow}>{'→'}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={S.addDrawBtn} onPress={() => {
            const unsel = allDrawings.filter(d => !selectedDrawings.includes(d.id));
            if (!unsel.length) { Alert.alert('All drawings added', 'All project drawings are already in this inspection.'); return; }
            Alert.alert('Add Drawing', 'Select an additional drawing:', [...unsel.map(d => ({ text: `${d.number ? d.number + ' -' : ''}${d.title}`, onPress: () => setSelectedDrawings(curr => [...curr, d.id]) })), { text: 'Cancel', style: 'cancel' as const }]);
          }}>
            <Text style={S.addDrawText}>+ Add another drawing</Text>
          </TouchableOpacity>
        </View>

        <View style={S.section}>
          <Text style={S.sectionTitle}>General Observations</Text>
          <TouchableOpacity style={S.addCard} onPress={() => router.push({ pathname: '/observation', params: { inspection_id: inspectionId, project_id: String(project_id), zone_id: 'general', zone_label: 'General Site Observation' } })} activeOpacity={0.7}>
            <View style={{ flex: 1 }}>
              <Text style={S.addCardTitle}>General Observation</Text>
              <Text style={S.addCardSub}>Site-wide notes not tied to a specific drawing</Text>
            </View>
            <Text style={S.arrow}>{'>'}</Text>
          </TouchableOpacity>
        </View>

        <View style={S.section}>
          <TouchableOpacity style={S.completeBtn} onPress={completeSession} activeOpacity={0.85}>
            <Text style={S.completeBtnText}>Complete Session & Generate Report</Text>
          </TouchableOpacity>
          <Text style={S.completeHint}>Compiles all observations into a draft report</Text>
        </View>

        <View style={{ height: 96 }} />
      </ScrollView>
    </View>
  );
}

const S = StyleSheet.create({
  container:    { flex: 1, backgroundColor: T.paper },
  scroll:       { flex: 1 },

  // Header
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16, backgroundColor: T.surface, borderBottomWidth: 1, borderBottomColor: T.line },
  backBtn:      { flexDirection: 'row', alignItems: 'center', gap: 6, width: 60 },
  backArrow:    { fontSize: 20, color: T.indigo },
  backText:     { fontSize: 16, color: T.indigo },
  headerTitle:  { fontSize: 18, fontWeight: '700', color: T.ink },

  // Banner
  banner:       {
    backgroundColor: T.surface,
    margin: 16,
    borderRadius: R.md,
    padding: 16,
    gap: 4,
    borderLeftWidth: 4,
    borderLeftColor: T.marigold,
    shadowColor: '#2C3950',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  bannerProject:{ fontSize: 16, fontWeight: '700', color: T.ink },
  bannerDate:   { fontSize: 13, color: T.mid },
  activeBadge:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  activeDot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: T.sage },
  activeBadgeText:{ fontSize: 12, color: T.sage, fontWeight: '600' },

  // Section
  section:      { paddingHorizontal: 16, paddingBottom: 16 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: T.mid, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  sectionRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  label:        { fontSize: 13, color: T.ink, fontWeight: '600', marginBottom: 4, marginTop: 12 },
  hint:         { fontSize: 11, color: T.mid, marginBottom: 8, fontStyle: 'italic' },

  // Weather chips
  weatherGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:         { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: T.surface, borderRadius: R.pill, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1.5, borderColor: T.line },
  chipActive:   { borderColor: T.indigo, backgroundColor: T.indigoSoft },
  chipIcon:     { fontSize: 16 },
  chipLabel:    { fontSize: 13, color: T.mid, fontWeight: '500' },
  chipLabelActive:{ color: T.indigo },

  // Inputs
  input:        { backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 14, height: 52, paddingHorizontal: 16, fontSize: 15, color: T.ink },
  textArea:     { backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 14, padding: 14, fontSize: 15, color: T.ink, height: 120 },

  // Drawing checkboxes
  checkRow:     { flexDirection: 'row', alignItems: 'center', backgroundColor: T.surface, borderRadius: 14, padding: 14, marginBottom: 8, borderWidth: 1.5, borderColor: T.line, gap: 12 },
  checkRowActive:{ borderColor: T.indigo, backgroundColor: T.indigoSoft },
  checkbox:     { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: T.line, alignItems: 'center', justifyContent: 'center' },
  checkboxActive:{ backgroundColor: T.indigo, borderColor: T.indigo },
  checkmark:    { fontSize: 14, color: '#FFFFFF', fontWeight: '700' },
  checkInfo:    { flex: 1 },
  checkTitle:   { fontSize: 14, color: T.ink, fontWeight: '500', marginBottom: 2 },
  checkMeta:    { fontSize: 12, color: T.mid },
  emptyBox:     { backgroundColor: T.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: T.line, alignItems: 'center' },
  emptyText:    { fontSize: 13, color: T.mid, textAlign: 'center' },

  // Voice
  recordBtn:    { backgroundColor: T.indigoSoft, paddingHorizontal: 14, paddingVertical: 7, borderRadius: R.pill, borderWidth: 1, borderColor: T.line, minWidth: 90, alignItems: 'center' },
  recordBtnActive:{ backgroundColor: T.clay, borderColor: T.clay },
  recordBtnTranscribing:{ backgroundColor: T.indigo, borderColor: T.indigo },
  recordBtnText:{ fontSize: 13, color: T.ink, fontWeight: '500' },
  waveBox:      { backgroundColor: T.sageSoft, borderRadius: 14, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: T.line, marginBottom: 8, gap: 6 },
  recordHint:   { fontSize: 12, color: T.sage },

  // Preview (kept for compatibility)
  previewCard:  { backgroundColor: T.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: T.line, gap: 8 },
  previewRow:   { flexDirection: 'row', gap: 8 },
  previewLabel: { fontSize: 12, color: T.mid, width: 100, flexShrink: 0 },
  previewValue: { fontSize: 12, color: T.ink, flex: 1 },

  // Start button
  startBtn:     { backgroundColor: T.indigo, borderRadius: R.pill, height: 54, alignItems: 'center', justifyContent: 'center' },
  startBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  startHint:    { fontSize: 12, color: T.mid, textAlign: 'center', marginTop: 8 },

  // Drawing rows in capture
  drawingRow:   {
    flexDirection: 'row', alignItems: 'center', backgroundColor: T.surface,
    borderRadius: R.md, padding: 14, marginBottom: 8, gap: 12,
    shadowColor: '#2C3950', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 2,
  },
  drawBadge:    { backgroundColor: T.indigoSoft, borderRadius: R.sm, paddingHorizontal: 10, paddingVertical: 6, minWidth: 52, alignItems: 'center' },
  drawBadgeText:{ fontSize: 11, color: T.indigo, fontWeight: '700' },
  drawTitle:    { fontSize: 14, color: T.ink, fontWeight: '500', marginBottom: 2 },
  drawMeta:     { fontSize: 12, color: T.mid },
  arrow:        { fontSize: 20, color: T.mid },
  addDrawBtn:   { backgroundColor: T.surface, borderRadius: R.md, padding: 14, borderWidth: 1.5, borderColor: T.indigo, borderStyle: 'dashed', alignItems: 'center', marginTop: 4 },
  addDrawText:  { fontSize: 13, color: T.indigo, fontWeight: '500' },

  // General observation card
  addCard:      {
    flexDirection: 'row', alignItems: 'center', backgroundColor: T.surface,
    borderRadius: R.md, padding: 16, marginBottom: 10, gap: 14,
    shadowColor: '#2C3950', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 2,
  },
  addCardIcon:  { fontSize: 24 },
  addCardTitle: { fontSize: 15, fontWeight: '600', color: T.ink, marginBottom: 3 },
  addCardSub:   { fontSize: 12, color: T.mid, lineHeight: 18 },

  // Complete
  completeBtn:  { backgroundColor: T.sage, borderRadius: R.pill, height: 54, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  completeBtnText:{ color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  completeHint: { fontSize: 12, color: T.mid, textAlign: 'center' },
});
