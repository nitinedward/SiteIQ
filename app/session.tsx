import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { useState, useEffect, useRef } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '../lib/supabase';
import * as SecureStore from 'expo-secure-store';
import { Audio } from 'expo-av';

const SITE_CONTACT_KEY  = 'last_site_contact';
const CONTACT_PHONE_KEY = 'last_contact_phone';
const OPENAI_API_KEY    = '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';

const BAR_COUNT = 24;

const WEATHER_OPTIONS = [
  { label: 'Fine',          icon: '☀️' },
  { label: 'Partly Cloudy', icon: '⛅' },
  { label: 'Overcast',      icon: '☁️' },
  { label: 'Raining',       icon: '🌧️' },
  { label: 'Windy',         icon: '💨' },
  { label: 'Cold',          icon: '🥶' },
];

type Step = 'details' | 'capture';

type Drawing = {
  id: string;
  title: string;
  number: string;
  revision: string;
  file_url: string;
};

type Observation = {
  id: string;
  zone_label: string;
  time: string;
};

// ── WAVEFORM COMPONENT ─────────────────────────────────
function WaveformVisualiser({
  isRecording,
  metering,
}: {
  isRecording: boolean;
  metering: number;
}) {
  const barAnims = useRef(
    Array.from({ length: BAR_COUNT }, () => new Animated.Value(0.05))
  ).current;
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
        Animated.spring(anim, {
          toValue: targetValue,
          useNativeDriver: false,
          speed: 60,
          bounciness: 0,
        }).start();
      });
    }, 80);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isRecording, metering]);

  return (
    <View style={waveStyles.container}>
      {barAnims.map((anim, index) => (
        <Animated.View
          key={index}
          style={[
            waveStyles.bar,
            {
              height: anim.interpolate({ inputRange: [0, 1], outputRange: [3, 48] }),
              backgroundColor: isRecording
                ? anim.interpolate({
                    inputRange: [0, 0.5, 1],
                    outputRange: ['#4A5568', '#F87171', '#F87171'],
                  })
                : '#2A3F55',
              opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
            },
          ]}
        />
      ))}
    </View>
  );
}

const waveStyles = StyleSheet.create({
  container: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: 56, gap: 3, paddingHorizontal: 8,
  },
  bar: { width: 3, borderRadius: 2 },
});

export default function SessionScreen() {
  const { project_id, project_name } = useLocalSearchParams();

  const [step, setStep]               = useState<Step>('details');
  const [isSaving, setIsSaving]       = useState(false);
  const [inspectionId, setInspectionId] = useState<string | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);

  // Form state
  const [weather, setWeather]           = useState('Fine');
  const [siteContact, setSiteContact]   = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [purpose, setPurpose]           = useState('');
  const [reportNo, setReportNo]         = useState('');

  // Drawings state
  const [allDrawings, setAllDrawings]         = useState<Drawing[]>([]);
  const [selectedDrawings, setSelectedDrawings] = useState<string[]>([]);

  // Voice state
  const [isRecording, setIsRecording]       = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recording, setRecording]           = useState<Audio.Recording | null>(null);
  const [metering, setMetering]             = useState(-60);

  const today = new Date().toLocaleDateString('en-NZ', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const todayShort = new Date().toLocaleDateString('en-NZ', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  useEffect(() => {
    loadSavedDetails();
    generateReportNumber();
    fetchDrawings();
  }, []);

  const loadSavedDetails = async () => {
    const savedContact = await SecureStore.getItemAsync(SITE_CONTACT_KEY);
    const savedPhone   = await SecureStore.getItemAsync(CONTACT_PHONE_KEY);
    if (savedContact) setSiteContact(savedContact);
    if (savedPhone) setContactPhone(savedPhone);
  };

  const generateReportNumber = async () => {
    const { count } = await supabase
      .from('inspections')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', String(project_id));
    const nextNumber = ((count ?? 0) + 1).toString().padStart(3, '0');
    setReportNo(nextNumber);
  };

  const fetchDrawings = async () => {
    const { data } = await supabase
      .from('drawings')
      .select('id, title, number, revision, file_url')
      .eq('project_id', String(project_id))
      .order('number', { ascending: true });
    setAllDrawings(data as Drawing[] ?? []);
  };

  const toggleDrawing = (drawingId: string) => {
    setSelectedDrawings(current =>
      current.includes(drawingId)
        ? current.filter(id => id !== drawingId)
        : [...current, drawingId]
    );
  };

  // ── VOICE ──────────────────────────────────────────────
  const startRecording = async () => {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert('Permission Required', 'Please allow microphone access.');
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: newRecording } = await Audio.Recording.createAsync(
        {
          android: {
            extension: '.m4a', outputFormat: Audio.AndroidOutputFormat.MPEG_4,
            audioEncoder: Audio.AndroidAudioEncoder.AAC, sampleRate: 44100,
            numberOfChannels: 2, bitRate: 128000,
          },
          ios: {
            extension: '.m4a', outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
            audioQuality: Audio.IOSAudioQuality.HIGH, sampleRate: 44100,
            numberOfChannels: 2, bitRate: 128000, linearPCMBitDepth: 16,
            linearPCMIsBigEndian: false, linearPCMIsFloat: false,
          },
          web: {},
        },
        (status) => { if (status.metering !== undefined) setMetering(status.metering); },
        100
      );
      setRecording(newRecording);
      setIsRecording(true);
    } catch (err) {
      console.error('Start recording error:', err);
      Alert.alert('Error', 'Could not start recording.');
    }
  };

  const stopRecording = async () => {
    if (!recording) return;
    setIsRecording(false);
    setIsTranscribing(true);
    try {
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = recording.getURI();
      setRecording(null);
      if (!uri) { setIsTranscribing(false); return; }

      const formData = new FormData();
      formData.append('file', { uri, type: 'audio/m4a', name: 'audio.m4a' } as any);
      formData.append('model', 'whisper-1');
      formData.append('language', 'en');

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: formData,
      });

      const data = await response.json();
      if (data.text) setPurpose(prev => prev ? prev + ' ' + data.text : data.text);
    } catch (err) {
      console.error('Transcription error:', err);
    } finally {
      setIsTranscribing(false);
    }
  };

  const toggleRecording = async () => {
    if (isRecording) await stopRecording();
    else await startRecording();
  };

  // ── BACK HANDLERS ─────────────────────────────────────
  // Details page — if inspection started, warn and delete everything
  const handleBack = () => {
    if (inspectionId) {
      Alert.alert(
        'Terminate Inspection?',
        'Are you sure? This will permanently delete this inspection and all captured observations.',
        [
          { text: 'Keep Going', style: 'cancel' },
          {
            text: 'Delete & Leave',
            style: 'destructive',
            onPress: async () => {
              await supabase.from('observations').delete().eq('inspection_id', inspectionId);
              await supabase.from('inspections').delete().eq('id', inspectionId);
              router.back();
            },
          },
        ]
      );
    } else {
      router.back();
    }
  };

  // Capture page — just go back to details, no warning
  const handleBackFromCapture = () => {
    setStep('details');
  };

  // ── START CAPTURING ────────────────────────────────────
  const startCapturing = async () => {
    setIsSaving(true);

    if (siteContact.trim()) await SecureStore.setItemAsync(SITE_CONTACT_KEY, siteContact.trim());
    if (contactPhone.trim()) await SecureStore.setItemAsync(CONTACT_PHONE_KEY, contactPhone.trim());

    const selectedDrawingRefs = allDrawings
      .filter(d => selectedDrawings.includes(d.id))
      .map(d => d.number || d.title)
      .join(', ');

    const { data, error } = await supabase
      .from('inspections')
      .insert({
        project_id:    String(project_id),
        date:          todayShort,
        weather,
        site_contact:  siteContact.trim(),
        contact_phone: contactPhone.trim(),
        drawing_ref:   selectedDrawingRefs,
        report_no:     reportNo.trim(),
        purpose:       purpose.trim(),
        status:        'IN_PROGRESS',
      })
      .select()
      .single();

    setIsSaving(false);

    if (error) {
      Alert.alert('Error', 'Could not start inspection. Please try again.');
      return;
    }

    setInspectionId(data.id);
    setStep('capture');
  };

  // ── COMPLETE SESSION ───────────────────────────────────
  const completeSession = async () => {
    Alert.alert(
      'Complete Inspection?',
      `Are you ready to complete this session?`,
      [
        { text: 'Keep Capturing', style: 'cancel' },
        {
          text: 'Complete',
          onPress: async () => {
            if (inspectionId) {
              await supabase.from('inspections').update({ status: 'COMPLETED' }).eq('id', inspectionId);
            }
            Alert.alert('✅ Session Complete', 'Your inspection has been saved.',
              [{ text: 'OK', onPress: () => router.replace('/(tabs)/projects') }]
            );
          },
        },
      ]
    );
  };

  // ══════════════════════════════════════════════════════
  // STEP 1 — DETAILS
  // ══════════════════════════════════════════════════════
  if (step === 'details') {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <Text style={styles.backArrow}>←</Text>
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>New Inspection</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          <View style={styles.sessionBanner}>
            <Text style={styles.sessionProject}>{project_name}</Text>
            <Text style={styles.sessionDate}>{today}</Text>
          </View>

          {/* Weather */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Weather Conditions</Text>
            <View style={styles.weatherGrid}>
              {WEATHER_OPTIONS.map(option => (
                <TouchableOpacity
                  key={option.label}
                  style={[styles.weatherChip, weather === option.label && styles.weatherChipActive]}
                  onPress={() => setWeather(option.label)}
                >
                  <Text style={styles.weatherIcon}>{option.icon}</Text>
                  <Text style={[styles.weatherLabel, weather === option.label && styles.weatherLabelActive]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Site details */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Site Details</Text>

            <Text style={styles.fieldLabel}>Site Contact Name</Text>
            <Text style={styles.fieldHint}>Auto-filled from your last inspection</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. John Smith"
              placeholderTextColor="#4A5568"
              value={siteContact}
              onChangeText={setSiteContact}
              autoCapitalize="words"
            />

            <Text style={styles.fieldLabel}>Contact Phone</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 021 123 4567"
              placeholderTextColor="#4A5568"
              value={contactPhone}
              onChangeText={setContactPhone}
              keyboardType="phone-pad"
            />

            <Text style={styles.fieldLabel}>Report Number</Text>
            <Text style={styles.fieldHint}>Auto-generated — edit if needed</Text>
            <TextInput
              style={styles.input}
              placeholderTextColor="#4A5568"
              value={reportNo}
              onChangeText={setReportNo}
              keyboardType="number-pad"
            />
          </View>

          {/* Drawing selector */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              Select Drawings ({selectedDrawings.length} selected)
            </Text>
            <Text style={styles.fieldHint}>
              Tick the drawings relevant to today's inspection
            </Text>

            {allDrawings.length === 0 ? (
              <View style={styles.emptyDrawings}>
                <Text style={styles.emptyDrawingsText}>
                  No drawings uploaded for this project yet
                </Text>
              </View>
            ) : (
              allDrawings.map(drawing => {
                const selected = selectedDrawings.includes(drawing.id);
                return (
                  <TouchableOpacity
                    key={drawing.id}
                    style={[styles.drawingCheckRow, selected && styles.drawingCheckRowActive]}
                    onPress={() => toggleDrawing(drawing.id)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.checkbox, selected && styles.checkboxActive]}>
                      {selected && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                    <View style={styles.drawingCheckInfo}>
                      <Text style={styles.drawingCheckTitle}>{drawing.title}</Text>
                      <Text style={styles.drawingCheckMeta}>
                        {drawing.number ? `${drawing.number} · ` : ''}Rev {drawing.revision}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </View>

          {/* Purpose with voice */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Purpose of Inspection</Text>
              <TouchableOpacity
                style={[
                  styles.recordButton,
                  isRecording && styles.recordButtonActive,
                  isTranscribing && styles.recordButtonTranscribing,
                ]}
                onPress={toggleRecording}
                disabled={isTranscribing}
              >
                {isTranscribing ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={[styles.recordButtonText, isRecording && { color: '#000000' }]}>
                    {isRecording ? '⏹ Stop' : '🎙 Dictate'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            {(isRecording || isTranscribing) && (
              <View style={styles.waveformContainer}>
                <WaveformVisualiser isRecording={isRecording} metering={metering} />
                {isRecording && <Text style={styles.recordingHint}>🔴 Recording — tap Stop when finished</Text>}
                {isTranscribing && <Text style={styles.recordingHint}>⏳ Transcribing...</Text>}
              </View>
            )}

            <TextInput
              style={styles.textArea}
              placeholder="Describe the purpose of this inspection, or tap Dictate to speak it..."
              placeholderTextColor="#4A5568"
              value={purpose}
              onChangeText={setPurpose}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </View>

          {/* Report preview */}
          <View style={styles.previewSection}>
            <Text style={styles.previewTitle}>Report Header Preview</Text>
            <View style={styles.previewCard}>
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Job:</Text>
                <Text style={styles.previewValue}>{String(project_name)}</Text>
              </View>
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Date:</Text>
                <Text style={styles.previewValue}>{todayShort}</Text>
              </View>
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Weather:</Text>
                <Text style={styles.previewValue}>{weather}</Text>
              </View>
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Site Contact:</Text>
                <Text style={styles.previewValue}>{siteContact || '—'}</Text>
              </View>
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Drawings:</Text>
                <Text style={styles.previewValue}>
                  {selectedDrawings.length > 0
                    ? allDrawings.filter(d => selectedDrawings.includes(d.id)).map(d => d.number || d.title).join(', ')
                    : 'None selected'}
                </Text>
              </View>
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Report No:</Text>
                <Text style={styles.previewValue}>{reportNo}</Text>
              </View>
            </View>
          </View>

          {/* Start button */}
          <View style={styles.section}>
            <TouchableOpacity
              style={[styles.startButton, isSaving && { opacity: 0.6 }]}
              onPress={startCapturing}
              disabled={isSaving}
              activeOpacity={0.8}
            >
              {isSaving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.startButtonText}>
                  Start Capturing Observations →
                </Text>
              )}
            </TouchableOpacity>
            <Text style={styles.startHint}>
              Site contact details saved automatically for next time
            </Text>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ══════════════════════════════════════════════════════
  // STEP 2 — CAPTURE
  // ══════════════════════════════════════════════════════
  const inspectionDrawings = allDrawings.filter(d => selectedDrawings.includes(d.id));

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBackFromCapture}>
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Capturing</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>

        <View style={styles.sessionBanner}>
          <Text style={styles.sessionProject}>{project_name}</Text>
          <Text style={styles.sessionDate}>{todayShort} · {weather}</Text>
          <View style={styles.activeBadge}>
            <View style={styles.activeDot} />
            <Text style={styles.activeBadgeText}>Active Session · Report #{reportNo}</Text>
          </View>
        </View>

        {/* Selected drawings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Drawings ({inspectionDrawings.length})</Text>
          <Text style={styles.fieldHint}>Tap a drawing to open the PDF and mark inspection zones</Text>

          {inspectionDrawings.map(drawing => (
            <TouchableOpacity
              key={drawing.id}
              style={styles.captureDrawingRow}
              onPress={() => router.push({
                pathname: '/drawing/[id]',
                params: {
                  id: drawing.id,
                  title: drawing.title,
                  file_url: drawing.file_url,
                  project_id: String(project_id),
                  inspection_id: inspectionId,
                  view_only: 'false',
                },
              })}
              activeOpacity={0.7}
            >
              <View style={styles.drawingBadge}>
                <Text style={styles.drawingBadgeText}>{drawing.number || '—'}</Text>
              </View>
              <View style={styles.drawingCheckInfo}>
                <Text style={styles.drawingCheckTitle}>{drawing.title}</Text>
                <Text style={styles.drawingCheckMeta}>Rev {drawing.revision} · Tap to inspect</Text>
              </View>
              <Text style={styles.drawingArrow}>›</Text>
            </TouchableOpacity>
          ))}

          <TouchableOpacity
            style={styles.addDrawingButton}
            onPress={() => {
              const unselected = allDrawings.filter(d => !selectedDrawings.includes(d.id));
              if (unselected.length === 0) {
                Alert.alert('All drawings added', 'All project drawings are already in this inspection.');
                return;
              }
              Alert.alert(
                'Add Drawing',
                'Select an additional drawing:',
                [
                  ...unselected.map(d => ({
                    text: `${d.number ? d.number + ' · ' : ''}${d.title}`,
                    onPress: () => setSelectedDrawings(current => [...current, d.id]),
                  })),
                  { text: 'Cancel', style: 'cancel' as const },
                ]
              );
            }}
          >
            <Text style={styles.addDrawingText}>+ Add another drawing</Text>
          </TouchableOpacity>
        </View>

        {/* General observation */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>General Observations</Text>
          <TouchableOpacity
            style={styles.addCard}
            onPress={() => router.push({
              pathname: '/observation',
              params: {
                inspection_id: inspectionId,
                project_id: String(project_id),
                zone_id: 'general',
                zone_label: 'General Site Observation',
              },
            })}
            activeOpacity={0.7}
          >
            <Text style={styles.addCardIcon}>📋</Text>
            <View style={styles.addCardText}>
              <Text style={styles.addCardTitle}>General Observation</Text>
              <Text style={styles.addCardSub}>Site-wide notes not tied to a specific drawing</Text>
            </View>
            <Text style={styles.addCardArrow}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Complete */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.completeButton} onPress={completeSession} activeOpacity={0.8}>
            <Text style={styles.completeButtonText}>Complete Session & Generate Report</Text>
          </TouchableOpacity>
          <Text style={styles.completeHint}>Compiles all observations into a draft report</Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A1628' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: '#1C2E44',
  },
  backButton: { flexDirection: 'row', alignItems: 'center', gap: 6, width: 60 },
  backArrow: { fontSize: 20, color: '#2563EB' },
  backText: { fontSize: 16, color: '#2563EB' },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#FFFFFF' },
  scroll: { flex: 1 },
  sessionBanner: {
    backgroundColor: '#112240', margin: 20, borderRadius: 14, padding: 18,
    borderWidth: 1, borderColor: '#1C2E44', borderLeftWidth: 4, borderLeftColor: '#2563EB', gap: 4,
  },
  sessionProject: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  sessionDate: { fontSize: 13, color: '#8899AA' },
  activeBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#34D399' },
  activeBadgeText: { fontSize: 12, color: '#34D399', fontWeight: '500' },
  section: { paddingHorizontal: 20, paddingBottom: 16 },
  sectionTitle: {
    fontSize: 13, fontWeight: '600', color: '#8899AA',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 8,
  },
  weatherGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  weatherChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#112240', borderRadius: 20, paddingHorizontal: 14,
    paddingVertical: 8, borderWidth: 1.5, borderColor: '#1C2E44',
  },
  weatherChipActive: { borderColor: '#2563EB', backgroundColor: '#1E3A5F' },
  weatherIcon: { fontSize: 16 },
  weatherLabel: { fontSize: 13, color: '#8899AA', fontWeight: '500' },
  weatherLabelActive: { color: '#FFFFFF' },
  fieldLabel: { fontSize: 12, color: '#8899AA', marginBottom: 4, marginTop: 12 },
  fieldHint: { fontSize: 11, color: '#4A5568', marginBottom: 8, fontStyle: 'italic' },
  input: {
    backgroundColor: '#112240', borderWidth: 1, borderColor: '#1C2E44',
    borderRadius: 8, padding: 12, fontSize: 14, color: '#FFFFFF',
  },
  textArea: {
    backgroundColor: '#112240', borderWidth: 1, borderColor: '#1C2E44',
    borderRadius: 8, padding: 12, fontSize: 14, color: '#FFFFFF', height: 120,
  },
  recordButton: {
    backgroundColor: '#1C2E44', paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1, borderColor: '#2A3F55', minWidth: 90, alignItems: 'center',
  },
  recordButtonActive: { backgroundColor: '#F87171', borderColor: '#F87171' },
  recordButtonTranscribing: { backgroundColor: '#1E3A5F', borderColor: '#2563EB' },
  recordButtonText: { fontSize: 13, color: '#FFFFFF', fontWeight: '500' },
  waveformContainer: {
    backgroundColor: '#112240', borderRadius: 12, padding: 12,
    alignItems: 'center', borderWidth: 1, borderColor: '#1C2E44', marginBottom: 8, gap: 6,
  },
  recordingHint: { fontSize: 12, color: '#F87171' },
  drawingCheckRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#112240',
    borderRadius: 10, padding: 12, marginBottom: 8,
    borderWidth: 1.5, borderColor: '#1C2E44', gap: 12,
  },
  drawingCheckRowActive: { borderColor: '#2563EB', backgroundColor: '#1E3A5F' },
  checkbox: {
    width: 24, height: 24, borderRadius: 6, borderWidth: 2,
    borderColor: '#2A3F55', alignItems: 'center', justifyContent: 'center',
  },
  checkboxActive: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  checkmark: { fontSize: 14, color: '#FFFFFF', fontWeight: '700' },
  drawingCheckInfo: { flex: 1 },
  drawingCheckTitle: { fontSize: 14, color: '#FFFFFF', fontWeight: '500', marginBottom: 2 },
  drawingCheckMeta: { fontSize: 12, color: '#4A5568' },
  emptyDrawings: {
    backgroundColor: '#112240', borderRadius: 10, padding: 16,
    borderWidth: 1, borderColor: '#1C2E44', alignItems: 'center',
  },
  emptyDrawingsText: { fontSize: 13, color: '#4A5568', textAlign: 'center' },
  previewSection: { paddingHorizontal: 20, paddingBottom: 16 },
  previewTitle: {
    fontSize: 13, fontWeight: '600', color: '#8899AA',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12,
  },
  previewCard: {
    backgroundColor: '#112240', borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: '#1C2E44', gap: 8,
  },
  previewRow: { flexDirection: 'row', gap: 8 },
  previewLabel: { fontSize: 12, color: '#4A5568', width: 100, flexShrink: 0 },
  previewValue: { fontSize: 12, color: '#FFFFFF', flex: 1 },
  startButton: {
    backgroundColor: '#2563EB', borderRadius: 12, padding: 16, alignItems: 'center',
  },
  startButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  startHint: { fontSize: 12, color: '#4A5568', textAlign: 'center', marginTop: 8 },
  captureDrawingRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#112240',
    borderRadius: 10, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: '#1C2E44', gap: 12,
  },
  drawingBadge: {
    backgroundColor: '#1C2E44', borderRadius: 8, paddingHorizontal: 10,
    paddingVertical: 6, minWidth: 52, alignItems: 'center',
    borderWidth: 1, borderColor: '#2A3F55',
  },
  drawingBadgeText: { fontSize: 11, color: '#2563EB', fontWeight: '700', letterSpacing: 0.5 },
  drawingArrow: { fontSize: 20, color: '#4A5568' },
  addDrawingButton: {
    backgroundColor: '#112240', borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: '#1C2E44', borderStyle: 'dashed',
    alignItems: 'center', marginTop: 4,
  },
  addDrawingText: { fontSize: 13, color: '#2563EB', fontWeight: '500' },
  addCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#112240',
    borderRadius: 12, padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: '#1C2E44', gap: 14,
  },
  addCardIcon: { fontSize: 24 },
  addCardText: { flex: 1 },
  addCardTitle: { fontSize: 15, fontWeight: '600', color: '#FFFFFF', marginBottom: 3 },
  addCardSub: { fontSize: 12, color: '#8899AA', lineHeight: 18 },
  addCardArrow: { fontSize: 20, color: '#4A5568' },
  completeButton: {
    backgroundColor: '#059669', borderRadius: 12,
    padding: 16, alignItems: 'center', marginBottom: 8,
  },
  completeButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  completeHint: { fontSize: 12, color: '#4A5568', textAlign: 'center' },
});
