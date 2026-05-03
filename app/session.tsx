import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert
} from 'react-native';
import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

// Mock drawings for this project
// Later this comes from GET /api/projects/:id/drawings
const projectDrawings = [
  { id: 'd1', title: 'Ground Floor Plan', number: 'SK-001' },
  { id: 'd2', title: 'Level 2 Structural', number: 'SK-002' },
  { id: 'd3', title: 'Column Schedule', number: 'SK-003' },
];

// ── WEATHER OPTIONS ─────────────────────────────────────
const WEATHER_OPTIONS = [
  { label: 'Fine', icon: '☀️' },
  { label: 'Partly Cloudy', icon: '⛅' },
  { label: 'Overcast', icon: '☁️' },
  { label: 'Raining', icon: '🌧️' },
  { label: 'Windy', icon: '💨' },
  { label: 'Cold', icon: '🥶' },
];

// ── SESSION STEPS ───────────────────────────────────────
type Step = 'details' | 'capture';

export default function SessionScreen() {
  const { project_id, project_name } = useLocalSearchParams();

  const [step, setStep] = useState<Step>('details');

  // ── INSPECTION DETAILS FORM STATE ──────────────────────
  const [weather, setWeather] = useState('Fine');
  const [siteContact, setSiteContact] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [drawingRef, setDrawingRef] = useState('');
  const [purpose, setPurpose] = useState('');
  const [reportNo, setReportNo] = useState('');

  // ── OBSERVATIONS STATE ──────────────────────────────────
  type Observation = {
    id: string;
    type: 'drawing' | 'general';
    label: string;
    drawing?: string;
    time: string;
  };
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

  // ── VALIDATE AND START CAPTURING ────────────────────────
  const startCapturing = () => {
    if (!siteContact.trim()) {
      // Site contact is the only required field
      // Others can be filled in later
    }
    setStep('capture');
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
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
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

          {/* Session banner */}
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

          {/* Site contact */}
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
            <Text style={styles.fieldHint}>
               Select from uploaded drawings or type a reference
            </Text>

            {/* Drawing chips from project drawings */}
            <View style={styles.drawingChips}>
            <TouchableOpacity
                style={[
                  styles.drawingChip,
                drawingRef === 'N/A' && styles.drawingChipActive,
                ]}
                onPress={() => setDrawingRef('N/A')}
            >
                <Text style={[
                styles.drawingChipText,
                drawingRef === 'N/A' && styles.drawingChipTextActive,
                ]}>N/A</Text>
            </TouchableOpacity>
            {projectDrawings.map(d => (
                <TouchableOpacity
                key={d.id}
                style={[
                    styles.drawingChip,
                    drawingRef === d.number && styles.drawingChipActive,
                ]}
                onPress={() => setDrawingRef(
                    drawingRef === d.number
                    ? drawingRef + ', '
                    : d.number
                )}
                >
                <Text style={[
                    styles.drawingChipText,
                    drawingRef === d.number && styles.drawingChipTextActive,
                ]}>
                    {d.number}
                </Text>
                </TouchableOpacity>
            ))}
            </View>

            <TextInput
            style={[styles.input, { marginTop: 8 }]}
            placeholder="Or type references manually e.g. SK-001, SK-015"
            placeholderTextColor="#4A5568"
            value={drawingRef}
            onChangeText={setDrawingRef}
            autoCapitalize="characters"
            />

            <Text style={styles.fieldLabel}>
              Site Report Number
            </Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Enter report number"
              placeholderTextColor="#4A5568"
              value={reportNo}
              onChangeText={setReportNo}
              keyboardType="number-pad"
            />
          </View>

          {/* Purpose */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Purpose of Inspection</Text>
            <Text style={styles.fieldHint}>
              Brief description of why this inspection is being carried out
            </Text>
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
                <Text style={styles.previewValue}>
                  {String(project_name) || '—'}
                </Text>
              </View>
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Date/Time:</Text>
                <Text style={styles.previewValue}>{todayShort}</Text>
              </View>
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Weather:</Text>
                <Text style={styles.previewValue}>{weather}</Text>
              </View>
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Site Contact:</Text>
                <Text style={styles.previewValue}>
                  {siteContact || '—'}
                </Text>
              </View>
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Drawing Ref:</Text>
                <Text style={styles.previewValue}>
                  {drawingRef || 'N/A'}
                </Text>
              </View>
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Report No:</Text>
                <Text style={styles.previewValue}>
                  {reportNo || '—'}
                </Text>
              </View>
            </View>
          </View>

          {/* Start button */}
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.startButton}
              onPress={startCapturing}
              activeOpacity={0.8}
            >
              <Text style={styles.startButtonText}>
                Start Capturing Observations →
              </Text>
            </TouchableOpacity>
            <Text style={styles.startHint}>
              You can edit these details before generating the report
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

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => setStep('details')}
        >
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backText}>Details</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Capturing</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
      >

        {/* Session summary */}
        <View style={styles.sessionBanner}>
          <Text style={styles.sessionProject}>{project_name}</Text>
          <Text style={styles.sessionDate}>{todayShort} · {weather}</Text>
          <View style={styles.activeBadge}>
            <View style={styles.activeDot} />
            <Text style={styles.activeBadgeText}>Active Session</Text>
          </View>
        </View>

        {/* Observations */}
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

        {/* Add observation */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Add Observation</Text>

          <TouchableOpacity
            style={styles.addCard}
            onPress={() => router.push('/drawing/d1')}
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

          <TouchableOpacity
            style={styles.addCard}
            onPress={() => router.push({
              pathname: '/camera',
              params: {
                zone_id: 'general',
                zone_label: 'General Site Observation',
                drawing_id: 'none',
                project_id: String(project_id),
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
        </View>

        {/* Complete session */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.completeButton}
            activeOpacity={0.8}
                onPress={() => {
                    Alert.alert(
                    'Complete Inspection Session',
                    `You have captured ${observations.length} observation${observations.length !== 1 ? 's' : ''}.\n\nAre you ready to generate the site report?`,
                    [
                        { text: 'Keep Capturing', style: 'cancel' },
                        {
                        text: 'Generate Report',
                        onPress: () => {
                            Alert.alert(
                            '📄 Report Generation',
                            'In the full app, Claude AI will now compile all your observations, photos and voice transcripts into a professional site report matching your firm\'s template.\n\nThis feature is enabled in Phase 2.',
                            [{ text: 'OK', onPress: () => router.replace('/(tabs)/projects') }]
                            );
                        },
                        },
                    ]
                    );
                }}
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

// ── STYLES ──────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A1628',
  },
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
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    width: 60,
  },
  backArrow: {
    fontSize: 20,
    color: '#2563EB',
  },
  backText: {
    fontSize: 16,
    color: '#2563EB',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  scroll: {
    flex: 1,
  },
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
  sessionProject: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  sessionDate: {
    fontSize: 13,
    color: '#8899AA',
  },
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#34D399',
  },
  activeBadgeText: {
    fontSize: 12,
    color: '#34D399',
    fontWeight: '500',
  },
  section: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8899AA',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  weatherGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  weatherChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#112240',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderColor: '#1C2E44',
  },
  weatherChipActive: {
    borderColor: '#2563EB',
    backgroundColor: '#1E3A5F',
  },
  weatherIcon: {
    fontSize: 16,
  },
  weatherLabel: {
    fontSize: 13,
    color: '#8899AA',
    fontWeight: '500',
  },
  weatherLabelActive: {
    color: '#FFFFFF',
  },
  fieldLabel: {
    fontSize: 12,
    color: '#8899AA',
    marginBottom: 6,
    marginTop: 12,
  },
  fieldHint: {
    fontSize: 12,
    color: '#4A5568',
    marginBottom: 8,
    fontStyle: 'italic',
  },
  input: {
    backgroundColor: '#112240',
    borderWidth: 1,
    borderColor: '#1C2E44',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#FFFFFF',
  },
  textArea: {
    backgroundColor: '#112240',
    borderWidth: 1,
    borderColor: '#1C2E44',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#FFFFFF',
    height: 120,
  },
  previewSection: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  previewTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8899AA',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  previewCard: {
    backgroundColor: '#112240',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1C2E44',
    gap: 8,
  },
  previewRow: {
    flexDirection: 'row',
    gap: 8,
  },
  previewLabel: {
    fontSize: 12,
    color: '#4A5568',
    width: 100,
    flexShrink: 0,
  },
  previewValue: {
    fontSize: 12,
    color: '#FFFFFF',
    flex: 1,
  },
  startButton: {
    backgroundColor: '#2563EB',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  startButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  startHint: {
    fontSize: 12,
    color: '#4A5568',
    textAlign: 'center',
    marginTop: 8,
  },
  emptyObs: {
    backgroundColor: '#112240',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1C2E44',
    borderStyle: 'dashed',
    gap: 10,
  },
  emptyObsIcon: {
    fontSize: 32,
  },
  emptyObsText: {
    fontSize: 13,
    color: '#4A5568',
    textAlign: 'center',
    lineHeight: 20,
  },
  obsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#112240',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1C2E44',
    gap: 12,
  },
  obsIcon: {
    fontSize: 20,
  },
  obsInfo: {
    flex: 1,
  },
  obsLabel: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '500',
    marginBottom: 2,
  },
  obsMeta: {
    fontSize: 12,
    color: '#8899AA',
  },
  obsTime: {
    fontSize: 12,
    color: '#4A5568',
  },
  addCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#112240',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1C2E44',
    gap: 14,
  },
  addCardIcon: {
    fontSize: 24,
  },
  addCardText: {
    flex: 1,
  },
  addCardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 3,
  },
  addCardSub: {
    fontSize: 12,
    color: '#8899AA',
    lineHeight: 18,
  },
  addCardArrow: {
    fontSize: 20,
    color: '#4A5568',
  },
  completeButton: {
    backgroundColor: '#059669',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 8,
  },
  completeButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  completeHint: {
    fontSize: 12,
    color: '#4A5568',
    textAlign: 'center',
  },
  drawingChips: {
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: 8,
  marginBottom: 4,
},
drawingChip: {
  paddingHorizontal: 12,
  paddingVertical: 6,
  borderRadius: 20,
  backgroundColor: '#112240',
  borderWidth: 1.5,
  borderColor: '#1C2E44',
},
drawingChipActive: {
  borderColor: '#2563EB',
  backgroundColor: '#1E3A5F',
},
drawingChipText: {
  fontSize: 12,
  color: '#8899AA',
  fontWeight: '500',
},
drawingChipTextActive: {
  color: '#FFFFFF',
},
});