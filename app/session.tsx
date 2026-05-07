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
} from 'react-native';
import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '../lib/supabase';

// ── WEATHER OPTIONS ─────────────────────────────────────
const WEATHER_OPTIONS = [
  { label: 'Fine', icon: '☀️' },
  { label: 'Partly Cloudy', icon: '⛅' },
  { label: 'Overcast', icon: '☁️' },
  { label: 'Raining', icon: '🌧️' },
  { label: 'Windy', icon: '💨' },
  { label: 'Cold', icon: '🥶' },
];

type Step = 'details' | 'capture';

// One observation captured during this session
type Observation = {
  id: string;
  type: 'drawing' | 'general';
  label: string;
  drawing?: string;
  time: string;
};

export default function SessionScreen() {
  const { project_id, project_name } = useLocalSearchParams();

  const [step, setStep] = useState<Step>('details');
  const [isSaving, setIsSaving] = useState(false);

  // ── FORM STATE ──────────────────────────────────────────
  const [weather, setWeather] = useState('Fine');
  const [siteContact, setSiteContact] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [drawingRef, setDrawingRef] = useState('');
  const [purpose, setPurpose] = useState('');
  const [reportNo, setReportNo] = useState('');

  // ── SESSION STATE ───────────────────────────────────────
  // Once saved to Supabase, we store the session ID here
  // Every observation we capture will reference this ID
  const [inspectionId, setInspectionId] = useState<string | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);

  const today = new Date().toLocaleDateString('en-NZ', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const todayShort = new Date().toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  // ── SAVE SESSION TO SUPABASE AND START CAPTURING ────────
  // This runs when the engineer taps "Start Capturing Observations"
  // It creates a new row in the inspections table and stores the ID
  const startCapturing = async () => {
    setIsSaving(true);

    // Insert a new inspection session into Supabase
    // .select() at the end tells Supabase to return the created row
    // so we can grab its ID
    const { data, error } = await supabase
      .from('inspections')
      .insert({
        project_id: String(project_id),
        date: todayShort,
        weather,
        site_contact: siteContact.trim(),
        contact_phone: contactPhone.trim(),
        drawing_ref: drawingRef.trim(),
        report_no: reportNo.trim(),
        purpose: purpose.trim(),
        status: 'IN_PROGRESS',
      })
      .select() // ← return the created row so we get the ID
      .single(); // ← we inserted one row so expect one back

    setIsSaving(false);

    if (error) {
      Alert.alert('Error', 'Could not start inspection. Please try again.');
      console.error('Supabase error:', error);
      return;
    }

    // Store the new inspection's ID
    // We pass this ID to every observation screen so observations
    // are linked to this inspection session
    setInspectionId(data.id);
    setStep('capture');
  };

  // ── COMPLETE SESSION ────────────────────────────────────
  const completeSession = async () => {
    Alert.alert(
      'Complete Inspection Session',
      `You have captured ${observations.length} observation${observations.length !== 1 ? 's' : ''}.\n\nAre you ready to complete this session?`,
      [
        { text: 'Keep Capturing', style: 'cancel' },
        {
          text: 'Complete Session',
          onPress: async () => {
            // Update the inspection status to COMPLETED in Supabase
            // .eq('id', inspectionId) — only update THIS inspection
            if (inspectionId) {
              await supabase
                .from('inspections')
                .update({ status: 'COMPLETED' })
                .eq('id', inspectionId);
            }
            Alert.alert(
              '✅ Session Complete',
              'Your inspection session has been saved.',
              [{ text: 'OK', onPress: () => router.replace('/(tabs)/projects') }]
            );
          },
        },
      ]
    );
  };

  // ══════════════════════════════════════════════════════
  // STEP 1 — INSPECTION DETAILS FORM
  // ══════════════════════════════════════════════════════
  if (step === 'details') {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backArrow}>←</Text>
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>New Inspection</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView
          style={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
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
                  style={[
                    styles.weatherChip,
                    weather === option.label && styles.weatherChipActive,
                  ]}
                  onPress={() => setWeather(option.label)}
                >
                  <Text style={styles.weatherIcon}>{option.icon}</Text>
                  <Text style={[
                    styles.weatherLabel,
                    weather === option.label && styles.weatherLabelActive,
                  ]}>
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

            <Text style={styles.fieldLabel}>Drawing Reference</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. SK-001, SK-015"
              placeholderTextColor="#4A5568"
              value={drawingRef}
              onChangeText={setDrawingRef}
              autoCapitalize="characters"
            />

            <Text style={styles.fieldLabel}>Site Report Number</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 042"
              placeholderTextColor="#4A5568"
              value={reportNo}
              onChangeText={setReportNo}
              keyboardType="number-pad"
            />
          </View>

          {/* Purpose */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Purpose of Inspection</Text>
            <TextInput
              style={styles.textArea}
              placeholder="Describe the purpose of this inspection visit..."
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
                <Text style={styles.previewValue}>{String(project_name) || '—'}</Text>
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
                <Text style={styles.previewLabel}>Drawing Ref:</Text>
                <Text style={styles.previewValue}>{drawingRef || 'N/A'}</Text>
              </View>
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Report No:</Text>
                <Text style={styles.previewValue}>{reportNo || '—'}</Text>
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
              This saves your inspection details and opens the capture screen
            </Text>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ══════════════════════════════════════════════════════
  // STEP 2 — CAPTURE OBSERVATIONS
  // ══════════════════════════════════════════════════════
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => setStep('details')}>
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backText}>Details</Text>
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
            <Text style={styles.activeBadgeText}>Active Session</Text>
          </View>
        </View>

        {/* Observations list */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Observations ({observations.length})
          </Text>

          {observations.length === 0 && (
            <View style={styles.emptyObs}>
              <Text style={styles.emptyObsIcon}>📋</Text>
              <Text style={styles.emptyObsText}>
                No observations yet — use the buttons below to start capturing
              </Text>
            </View>
          )}

          {observations.map(obs => (
            <View key={obs.id} style={styles.obsRow}>
              <Text style={styles.obsIcon}>
                {obs.type === 'drawing' ? '📐' : '📋'}
              </Text>
              <View style={styles.obsInfo}>
                <Text style={styles.obsLabel}>{obs.label}</Text>
                {obs.drawing && (
                  <Text style={styles.obsMeta}>{obs.drawing}</Text>
                )}
              </View>
              <Text style={styles.obsTime}>{obs.time}</Text>
            </View>
          ))}
        </View>

        {/* Add observation buttons */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Add Observation</Text>

          <TouchableOpacity
            style={styles.addCard}
            onPress={() => router.push({
              pathname: '/observation',
              params: {
                // Pass the inspection ID so the observation
                // gets linked to this session in the database
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
              <Text style={styles.addCardSub}>
                Site-wide photos and notes not tied to a drawing
              </Text>
            </View>
            <Text style={styles.addCardArrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.addCard}
            onPress={() => router.push({
              pathname: '/drawings',
              params: {
                project_id: String(project_id),
                project_name: String(project_name),
                inspection_id: inspectionId,
              },
            })}
            activeOpacity={0.7}
          >
            <Text style={styles.addCardIcon}>📐</Text>
            <View style={styles.addCardText}>
              <Text style={styles.addCardTitle}>Drawing Inspection</Text>
              <Text style={styles.addCardSub}>
                Select a drawing, pick a zone, capture photos and measurements
              </Text>
            </View>
            <Text style={styles.addCardArrow}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Complete session */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.completeButton}
            activeOpacity={0.8}
            onPress={completeSession}
          >
            <Text style={styles.completeButtonText}>
              Complete Session & Generate Report
            </Text>
          </TouchableOpacity>
          <Text style={styles.completeHint}>
            Compiles all observations into a draft report for review
          </Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A1628' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1C2E44',
  },
  backButton: { flexDirection: 'row', alignItems: 'center', gap: 6, width: 60 },
  backArrow: { fontSize: 20, color: '#2563EB' },
  backText: { fontSize: 16, color: '#2563EB' },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#FFFFFF' },
  scroll: { flex: 1 },
  sessionBanner: {
    backgroundColor: '#112240',
    margin: 20,
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1C2E44',
    borderLeftWidth: 4,
    borderLeftColor: '#2563EB',
    gap: 4,
  },
  sessionProject: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  sessionDate: { fontSize: 13, color: '#8899AA' },
  activeBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#34D399' },
  activeBadgeText: { fontSize: 12, color: '#34D399', fontWeight: '500' },
  section: { paddingHorizontal: 20, paddingBottom: 16 },
  sectionTitle: {
    fontSize: 13, fontWeight: '600', color: '#8899AA',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12,
  },
  weatherGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  weatherChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#112240', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1.5, borderColor: '#1C2E44',
  },
  weatherChipActive: { borderColor: '#2563EB', backgroundColor: '#1E3A5F' },
  weatherIcon: { fontSize: 16 },
  weatherLabel: { fontSize: 13, color: '#8899AA', fontWeight: '500' },
  weatherLabelActive: { color: '#FFFFFF' },
  fieldLabel: { fontSize: 12, color: '#8899AA', marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: '#112240', borderWidth: 1,
    borderColor: '#1C2E44', borderRadius: 8,
    padding: 12, fontSize: 14, color: '#FFFFFF',
  },
  textArea: {
    backgroundColor: '#112240', borderWidth: 1,
    borderColor: '#1C2E44', borderRadius: 8,
    padding: 12, fontSize: 14, color: '#FFFFFF', height: 120,
  },
  previewSection: { paddingHorizontal: 20, paddingBottom: 16 },
  previewTitle: {
    fontSize: 13, fontWeight: '600', color: '#8899AA',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12,
  },
  previewCard: {
    backgroundColor: '#112240', borderRadius: 10,
    padding: 14, borderWidth: 1, borderColor: '#1C2E44', gap: 8,
  },
  previewRow: { flexDirection: 'row', gap: 8 },
  previewLabel: { fontSize: 12, color: '#4A5568', width: 100, flexShrink: 0 },
  previewValue: { fontSize: 12, color: '#FFFFFF', flex: 1 },
  startButton: {
    backgroundColor: '#2563EB', borderRadius: 12,
    padding: 16, alignItems: 'center',
  },
  startButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  startHint: { fontSize: 12, color: '#4A5568', textAlign: 'center', marginTop: 8 },
  emptyObs: {
    backgroundColor: '#112240', borderRadius: 12, padding: 24,
    alignItems: 'center', borderWidth: 1, borderColor: '#1C2E44',
    borderStyle: 'dashed', gap: 10,
  },
  emptyObsIcon: { fontSize: 32 },
  emptyObsText: { fontSize: 13, color: '#4A5568', textAlign: 'center', lineHeight: 20 },
  obsRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#112240', borderRadius: 10,
    padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#1C2E44', gap: 12,
  },
  obsIcon: { fontSize: 20 },
  obsInfo: { flex: 1 },
  obsLabel: { fontSize: 14, color: '#FFFFFF', fontWeight: '500', marginBottom: 2 },
  obsMeta: { fontSize: 12, color: '#8899AA' },
  obsTime: { fontSize: 12, color: '#4A5568' },
  addCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#112240', borderRadius: 12,
    padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#1C2E44', gap: 14,
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
