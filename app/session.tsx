import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, Alert,
  ActivityIndicator, Animated,
} from 'react-native';
import { useState, useEffect, useRef } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '../lib/supabase';
import * as SecureStore from 'expo-secure-store';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

const SITE_CONTACT_KEY  = 'last_site_contact';
const CONTACT_PHONE_KEY = 'last_contact_phone';

const BAR_COUNT = 24;

const WEATHER_OPTIONS = [
  { label: 'Fine', icon: '☀️' },
  { label: 'Partly Cloudy', icon: '⛅' },
  { label: 'Overcast', icon: '☁️' },
  { label: 'Raining', icon: '🌧️' },
  { label: 'Windy', icon: '💨' },
  { label: 'Cold', icon: '🥶' },
];

type Step = 'details' | 'capture';
type Drawing = { id: string; title: string; number: string; revision: string; file_url: string };

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
            ? anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['#BFDBFE', '#2563EB', '#2563EB'] })
            : '#BFDBFE',
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
  const isRecordingRef                       = useRef(false);
  const baseTextRef                          = useRef('');

  const today      = new Date().toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const todayShort = new Date().toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });

  useEffect(() => {
    loadSavedDetails();
    generateReportNumber();
    fetchDrawings();
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
    const { data } = await supabase.from('drawings').select('id,title,number,revision,file_url').eq('project_id', String(project_id)).order('number', { ascending: true });
    setAllDrawings(data as Drawing[] ?? []);
  };

  const toggleDrawing = (id: string) => setSelectedDrawings(curr => curr.includes(id) ? curr.filter(d => d !== id) : [...curr, id]);

  useSpeechRecognitionEvent('result', (event) => {
    if (!isRecordingRef.current) return;
    const text = event.results[0]?.transcript ?? '';
    if (event.isFinal) {
      baseTextRef.current = (baseTextRef.current + ' ' + text).trim();
      setPurpose(baseTextRef.current);
    } else {
      setPurpose((baseTextRef.current + ' ' + text).trim());
    }
  });

  useSpeechRecognitionEvent('end', () => {
    isRecordingRef.current = false;
    setIsRecording(false);
    setIsTranscribing(false);
  });

  useSpeechRecognitionEvent('error', (event) => {
    if (!isRecordingRef.current) return;
    console.error('[speech] Session error:', event.error);
    isRecordingRef.current = false;
    setIsRecording(false);
    setIsTranscribing(false);
    if (event.error !== 'aborted') {
      Alert.alert('Transcription Failed', 'Could not recognise speech. Please try again.');
    }
  });

  const startRecording = async () => {
    try {
      const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!granted) { Alert.alert('Permission Required', 'Please allow microphone and speech recognition access.'); return; }
      baseTextRef.current = purpose.trim();
      isRecordingRef.current = true;
      setIsRecording(true);
      ExpoSpeechRecognitionModule.start({ lang: 'en-US', interimResults: true, continuous: true });
    } catch { Alert.alert('Error', 'Could not start speech recognition.'); }
  };

  const stopRecording = () => {
    setIsRecording(false);
    setIsTranscribing(true);
    ExpoSpeechRecognitionModule.stop();
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
        Alert.alert('✅ Session Complete', 'Your inspection has been saved.', [{ text: 'OK', onPress: () => router.replace('/(tabs)/projects') }]);
      }},
    ]);
  };

  // ── STEP 1: DETAILS ─────────────────────────────────
  if (step === 'details') {
    return (
      <KeyboardAvoidingView style={S.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={S.header}>
          <TouchableOpacity style={S.backBtn} onPress={handleBack}>
            <Text style={S.backArrow}>←</Text>
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
            <TextInput style={S.input} placeholder="e.g. John Smith" placeholderTextColor="#94A3B8" value={siteContact} onChangeText={setSiteContact} autoCapitalize="words" />
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
                    {sel && <Text style={S.checkmark}>✓</Text>}
                  </View>
                  <View style={S.checkInfo}>
                    <Text style={S.checkTitle}>{drawing.title}</Text>
                    <Text style={S.checkMeta}>{drawing.number ? `${drawing.number} · ` : ''}Rev {drawing.revision}</Text>
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
            <TextInput style={S.textArea} placeholder="Describe the purpose of this inspection..." placeholderTextColor="#94A3B8" value={purpose} onChangeText={setPurpose} multiline numberOfLines={4} textAlignVertical="top" />
          </View>

          {/* Start */}
          <View style={S.section}>
            <TouchableOpacity style={[S.startBtn, isSaving && { opacity: 0.6 }]} onPress={startCapturing} disabled={isSaving} activeOpacity={0.85}>
              {isSaving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={S.startBtnText}>Start Capturing Observations →</Text>}
            </TouchableOpacity>
            <Text style={S.startHint}>Site contact details saved automatically for next time</Text>
          </View>

          <View style={{ height: 40 }} />
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
          <Text style={S.backArrow}>←</Text>
          <Text style={S.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={S.headerTitle}>Capturing</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={S.scroll} showsVerticalScrollIndicator={false}>
        <View style={S.banner}>
          <Text style={S.bannerProject}>{project_name}</Text>
          <Text style={S.bannerDate}>{todayShort} · {weather}</Text>
          <View style={S.activeBadge}>
            <View style={S.activeDot} />
            <Text style={S.activeBadgeText}>Active Session · Report #{reportNo}</Text>
          </View>
        </View>

        <View style={S.section}>
          <Text style={S.sectionTitle}>Drawings ({inspDrawings.length})</Text>
          <Text style={S.hint}>Tap a drawing to open the PDF and mark inspection zones</Text>
          {inspDrawings.map(drawing => (
            <TouchableOpacity key={drawing.id} style={S.drawingRow}
              onPress={() => router.push({ pathname: '/drawing/[id]', params: { id: drawing.id, title: drawing.title, file_url: drawing.file_url, project_id: String(project_id), inspection_id: inspectionId, view_only: 'false' } })}
              activeOpacity={0.7}>
              <View style={S.drawBadge}><Text style={S.drawBadgeText}>{drawing.number || '—'}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={S.drawTitle}>{drawing.title}</Text>
                <Text style={S.drawMeta}>Rev {drawing.revision} · Tap to inspect</Text>
              </View>
              <Text style={S.arrow}>›</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={S.addDrawBtn} onPress={() => {
            const unsel = allDrawings.filter(d => !selectedDrawings.includes(d.id));
            if (!unsel.length) { Alert.alert('All drawings added', 'All project drawings are already in this inspection.'); return; }
            Alert.alert('Add Drawing', 'Select an additional drawing:', [...unsel.map(d => ({ text: `${d.number ? d.number + ' · ' : ''}${d.title}`, onPress: () => setSelectedDrawings(curr => [...curr, d.id]) })), { text: 'Cancel', style: 'cancel' as const }]);
          }}>
            <Text style={S.addDrawText}>+ Add another drawing</Text>
          </TouchableOpacity>
        </View>

        <View style={S.section}>
          <Text style={S.sectionTitle}>General Observations</Text>
          <TouchableOpacity style={S.addCard} onPress={() => router.push({ pathname: '/observation', params: { inspection_id: inspectionId, project_id: String(project_id), zone_id: 'general', zone_label: 'General Site Observation' } })} activeOpacity={0.7}>
            <Text style={S.addCardIcon}>📋</Text>
            <View style={{ flex: 1 }}>
              <Text style={S.addCardTitle}>General Observation</Text>
              <Text style={S.addCardSub}>Site-wide notes not tied to a specific drawing</Text>
            </View>
            <Text style={S.arrow}>›</Text>
          </TouchableOpacity>
        </View>

        <View style={S.section}>
          <TouchableOpacity style={S.completeBtn} onPress={completeSession} activeOpacity={0.85}>
            <Text style={S.completeBtnText}>Complete Session & Generate Report</Text>
          </TouchableOpacity>
          <Text style={S.completeHint}>Compiles all observations into a draft report</Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const S = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#F8FAFC' },
  scroll:       { flex: 1 },

  // Header
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  backBtn:      { flexDirection: 'row', alignItems: 'center', gap: 6, width: 60 },
  backArrow:    { fontSize: 20, color: '#2563EB' },
  backText:     { fontSize: 16, color: '#2563EB' },
  headerTitle:  { fontSize: 18, fontWeight: '600', color: '#0F172A' },

  // Banner
  banner:       { backgroundColor: '#FFFFFF', margin: 16, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#E2E8F0', borderLeftWidth: 4, borderLeftColor: '#2563EB', gap: 4 },
  bannerProject:{ fontSize: 16, fontWeight: '700', color: '#0F172A' },
  bannerDate:   { fontSize: 13, color: '#64748B' },
  activeBadge:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  activeDot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: '#16A34A' },
  activeBadgeText:{ fontSize: 12, color: '#16A34A', fontWeight: '500' },

  // Section
  section:      { paddingHorizontal: 16, paddingBottom: 16 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: '#64748B', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  sectionRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  label:        { fontSize: 13, color: '#0F172A', fontWeight: '600', marginBottom: 4, marginTop: 12 },
  hint:         { fontSize: 11, color: '#94A3B8', marginBottom: 8, fontStyle: 'italic' },

  // Weather
  weatherGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:         { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFFFFF', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1.5, borderColor: '#E2E8F0' },
  chipActive:   { borderColor: '#2563EB', backgroundColor: '#EFF6FF' },
  chipIcon:     { fontSize: 16 },
  chipLabel:    { fontSize: 13, color: '#64748B', fontWeight: '500' },
  chipLabelActive:{ color: '#2563EB' },

  // Inputs
  input:        { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, padding: 13, fontSize: 14, color: '#0F172A', marginBottom: 4 },
  textArea:     { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, padding: 13, fontSize: 14, color: '#0F172A', height: 120 },

  // Drawing checkboxes
  checkRow:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1.5, borderColor: '#E2E8F0', gap: 12 },
  checkRowActive:{ borderColor: '#2563EB', backgroundColor: '#EFF6FF' },
  checkbox:     { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center' },
  checkboxActive:{ backgroundColor: '#2563EB', borderColor: '#2563EB' },
  checkmark:    { fontSize: 14, color: '#FFFFFF', fontWeight: '700' },
  checkInfo:    { flex: 1 },
  checkTitle:   { fontSize: 14, color: '#0F172A', fontWeight: '500', marginBottom: 2 },
  checkMeta:    { fontSize: 12, color: '#64748B' },
  emptyBox:     { backgroundColor: '#FFFFFF', borderRadius: 10, padding: 16, borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center' },
  emptyText:    { fontSize: 13, color: '#64748B', textAlign: 'center' },

  // Voice
  recordBtn:    { backgroundColor: '#F1F5F9', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: '#E2E8F0', minWidth: 90, alignItems: 'center' },
  recordBtnActive:{ backgroundColor: '#EF4444', borderColor: '#EF4444' },
  recordBtnTranscribing:{ backgroundColor: '#EFF6FF', borderColor: '#2563EB' },
  recordBtnText:{ fontSize: 13, color: '#0F172A', fontWeight: '500' },
  waveBox:      { backgroundColor: '#EFF6FF', borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#BFDBFE', marginBottom: 8, gap: 6 },
  recordHint:   { fontSize: 12, color: '#2563EB' },

  // Preview
  previewCard:  { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#E2E8F0', gap: 8 },
  previewRow:   { flexDirection: 'row', gap: 8 },
  previewLabel: { fontSize: 12, color: '#94A3B8', width: 100, flexShrink: 0 },
  previewValue: { fontSize: 12, color: '#0F172A', flex: 1 },

  // Start button
  startBtn:     { backgroundColor: '#2563EB', borderRadius: 12, padding: 16, alignItems: 'center' },
  startBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  startHint:    { fontSize: 12, color: '#94A3B8', textAlign: 'center', marginTop: 8 },

  // Drawing rows in capture
  drawingRow:   { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#E2E8F0', gap: 12 },
  drawBadge:    { backgroundColor: '#EFF6FF', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minWidth: 52, alignItems: 'center' },
  drawBadgeText:{ fontSize: 11, color: '#2563EB', fontWeight: '700' },
  drawTitle:    { fontSize: 14, color: '#0F172A', fontWeight: '500', marginBottom: 2 },
  drawMeta:     { fontSize: 12, color: '#64748B' },
  arrow:        { fontSize: 20, color: '#94A3B8' },
  addDrawBtn:   { backgroundColor: '#FFFFFF', borderRadius: 10, padding: 14, borderWidth: 1.5, borderColor: '#2563EB', borderStyle: 'dashed', alignItems: 'center', marginTop: 4 },
  addDrawText:  { fontSize: 13, color: '#2563EB', fontWeight: '500' },

  // Add card
  addCard:      { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 12, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#E2E8F0', gap: 14 },
  addCardIcon:  { fontSize: 24 },
  addCardTitle: { fontSize: 15, fontWeight: '600', color: '#0F172A', marginBottom: 3 },
  addCardSub:   { fontSize: 12, color: '#64748B', lineHeight: 18 },

  // Complete
  completeBtn:  { backgroundColor: '#16A34A', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 8 },
  completeBtnText:{ color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  completeHint: { fontSize: 12, color: '#94A3B8', textAlign: 'center' },
});