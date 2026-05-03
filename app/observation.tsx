import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

// ── TYPES ──────────────────────────────────────────────

type Severity = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

type Measurement = {
  id: string;
  type: string;
  value: string;
  unit: string;
};

// ── MEASUREMENT TYPES ───────────────────────────────────
// Common measurements structural engineers take on site

const MEASUREMENT_TYPES = [
  { label: 'Crack Width', unit: 'mm' },
  { label: 'Crack Length', unit: 'mm' },
  { label: 'Crack Depth', unit: 'mm' },
  { label: 'Deflection', unit: 'mm' },
  { label: 'Cover Depth', unit: 'mm' },
  { label: 'Settlement', unit: 'mm' },
  { label: 'Tilt / Lean', unit: 'degrees' },
  { label: 'Spalling Area', unit: 'm²' },
];

// ── SEVERITY CONFIG ─────────────────────────────────────

const SEVERITY_OPTIONS: {
  value: Severity;
  label: string;
  colour: string;
  description: string;
}[] = [
  {
    value: 'NONE',
    label: 'None',
    colour: '#8899AA',
    description: 'No defects observed',
  },
  {
    value: 'LOW',
    label: 'Low',
    colour: '#34D399',
    description: 'Minor — monitor only',
  },
  {
    value: 'MEDIUM',
    label: 'Medium',
    colour: '#FBBF24',
    description: 'Moderate — action required',
  },
  {
    value: 'HIGH',
    label: 'High',
    colour: '#F97316',
    description: 'Serious — urgent action',
  },
  {
    value: 'CRITICAL',
    label: 'Critical',
    colour: '#F87171',
    description: 'Immediate action required',
  },
];

// ── MAIN SCREEN ─────────────────────────────────────────

export default function ObservationScreen() {
  const params = useLocalSearchParams();

  // These params come from the capture screen
  // For now we use mock values — later they come from real capture
  const zoneLabel = params.zone_label as string || 'Column C3 — Level 1';
  const zoneId = params.zone_id as string || 'z1';

  // ── STATE ─────────────────────────────────────────────
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [severity, setSeverity] = useState<Severity>('NONE');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Measurement form state
  const [showMeasurementForm, setShowMeasurementForm] = useState(false);
  const [newMeasType, setNewMeasType] = useState(MEASUREMENT_TYPES[0].label);
  const [newMeasValue, setNewMeasValue] = useState('');
  const [newMeasUnit, setNewMeasUnit] = useState(MEASUREMENT_TYPES[0].unit);

  // Mock photos — later these come from the camera screen
  const mockPhotos = [
    'https://picsum.photos/200/200?random=1',
    'https://picsum.photos/200/200?random=2',
    'https://picsum.photos/200/200?random=3',
  ];

  // Mock transcript — later this comes from the voice recorder
  const mockTranscript = 'Column C3 shows minor vertical surface cracking approximately 0.2mm width running for 300mm. No spalling observed. Reinforcement not exposed. Recommend monitoring at next inspection.';

  // ── ADD MEASUREMENT ───────────────────────────────────
  const addMeasurement = () => {
    if (!newMeasValue || isNaN(Number(newMeasValue))) {
      Alert.alert('Invalid Value', 'Please enter a valid number.');
      return;
    }

    const newMeas: Measurement = {
      id: Date.now().toString(),
      type: newMeasType,
      value: newMeasValue,
      unit: newMeasUnit,
    };

    setMeasurements(current => [...current, newMeas]);
    setNewMeasValue('');
    setShowMeasurementForm(false);
  };

  // ── DELETE MEASUREMENT ────────────────────────────────
  const deleteMeasurement = (id: string) => {
    setMeasurements(current => current.filter(m => m.id !== id));
  };

  // ── SELECT MEASUREMENT TYPE ───────────────────────────
  const selectMeasurementType = (type: string, unit: string) => {
    setNewMeasType(type);
    setNewMeasUnit(unit);
  };

  // ── SUBMIT OBSERVATION ────────────────────────────────
  const handleSubmit = async () => {
    // Build the observation object
    const observation = {
      zone_id: zoneId,
      zone_label: zoneLabel,
      photos: mockPhotos,
      transcript: mockTranscript,
      measurements,
      severity,
      notes,
      observed_at: new Date().toISOString(),
    };

    console.log('Submitting observation:', observation);

    setIsSubmitting(true);

    // Simulate API call — later this is POST /api/observations
    await new Promise(resolve => setTimeout(resolve, 1500));

    setIsSubmitting(false);

    // Show success and go back to projects
    Alert.alert(
      '✅ Observation Saved',
      `Your inspection of "${zoneLabel}" has been recorded successfully.`,
      [
        {
          text: 'View Projects',
          onPress: () => router.replace('/(tabs)/projects'),
        },
      ]
    );
  };

  // ── RENDER ────────────────────────────────────────────
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
        <Text style={styles.headerTitle}>Observation</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* Zone label */}
        <View style={styles.zoneBanner}>
          <Text style={styles.zoneBannerLabel}>Inspecting</Text>
          <Text style={styles.zoneBannerTitle}>{zoneLabel}</Text>
        </View>

        {/* Photos section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Photos ({mockPhotos.length})
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.photoStrip}
          >
            {mockPhotos.map((uri, index) => (
              <Image
                key={index}
                source={{ uri }}
                style={styles.photoThumb}
              />
            ))}
            <TouchableOpacity style={styles.addPhotoButton}>
              <Text style={styles.addPhotoIcon}>📷</Text>
              <Text style={styles.addPhotoText}>Add</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>

        {/* Transcript section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Voice Transcript</Text>
          <View style={styles.transcriptBox}>
            <Text style={styles.transcriptText}>{mockTranscript}</Text>
          </View>
        </View>

        {/* Measurements section */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>
              Measurements ({measurements.length})
            </Text>
            <TouchableOpacity
              style={styles.addButton}
              onPress={() => setShowMeasurementForm(!showMeasurementForm)}
            >
              <Text style={styles.addButtonText}>
                {showMeasurementForm ? '✕ Cancel' : '+ Add'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Measurement list */}
          {measurements.length === 0 && !showMeasurementForm && (
            <Text style={styles.emptyText}>
              No measurements added yet
            </Text>
          )}

          {measurements.map(meas => (
            <View key={meas.id} style={styles.measurementRow}>
              <View style={styles.measurementLeft}>
                <Text style={styles.measurementType}>{meas.type}</Text>
                <Text style={styles.measurementValue}>
                  {meas.value} {meas.unit}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => deleteMeasurement(meas.id)}
                style={styles.deleteButton}
              >
                <Text style={styles.deleteIcon}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}

          {/* Add measurement form */}
          {showMeasurementForm && (
            <View style={styles.measurementForm}>

              <Text style={styles.formLabel}>Measurement type</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.typeScroll}
              >
                {MEASUREMENT_TYPES.map(type => (
                  <TouchableOpacity
                    key={type.label}
                    style={[
                      styles.typeChip,
                      newMeasType === type.label && styles.typeChipActive,
                    ]}
                    onPress={() =>
                      selectMeasurementType(type.label, type.unit)
                    }
                  >
                    <Text style={[
                      styles.typeChipText,
                      newMeasType === type.label &&
                        styles.typeChipTextActive,
                    ]}>
                      {type.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={styles.formLabel}>
                Value ({newMeasUnit})
              </Text>
              <TextInput
                style={styles.valueInput}
                placeholder={`Enter value in ${newMeasUnit}`}
                placeholderTextColor="#4A5568"
                value={newMeasValue}
                onChangeText={setNewMeasValue}
                keyboardType="decimal-pad"
              />

              <TouchableOpacity
                style={styles.confirmButton}
                onPress={addMeasurement}
              >
                <Text style={styles.confirmButtonText}>
                  Add Measurement
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Severity section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Finding Severity</Text>
          <View style={styles.severityGrid}>
            {SEVERITY_OPTIONS.map(option => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.severityOption,
                  severity === option.value && {
                    borderColor: option.colour,
                    backgroundColor: option.colour + '15',
                  },
                ]}
                onPress={() => setSeverity(option.value)}
              >
                <View style={[
                  styles.severityDot,
                  { backgroundColor: option.colour },
                  severity === option.value && styles.severityDotActive,
                ]} />
                <View style={styles.severityTextBlock}>
                  <Text style={[
                    styles.severityLabel,
                    severity === option.value && { color: option.colour },
                  ]}>
                    {option.label}
                  </Text>
                  <Text style={styles.severityDesc}>
                    {option.description}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Additional notes */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Additional Notes</Text>
          <TextInput
            style={styles.notesInput}
            placeholder="Any additional observations not captured in the voice recording..."
            placeholderTextColor="#4A5568"
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        {/* Submit button */}
        <View style={styles.submitSection}>
          <TouchableOpacity
            style={[
              styles.submitButton,
              isSubmitting && styles.submitButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={isSubmitting}
          >
            <Text style={styles.submitButtonText}>
              {isSubmitting
                ? 'Saving Observation...'
                : 'Submit Observation'}
            </Text>
          </TouchableOpacity>

          <Text style={styles.submitHint}>
            This will save the observation to the project record
          </Text>
        </View>

        <View style={{ height: 60 }} />
      </ScrollView>
    </KeyboardAvoidingView>
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
  zoneBanner: {
    backgroundColor: '#112240',
    padding: 16,
    marginHorizontal: 20,
    marginTop: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1C2E44',
    borderLeftWidth: 4,
    borderLeftColor: '#2563EB',
  },
  zoneBannerLabel: {
    fontSize: 11,
    color: '#8899AA',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  zoneBannerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  section: {
    padding: 20,
    paddingBottom: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8899AA',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  photoStrip: {
    gap: 8,
    paddingRight: 8,
  },
  photoThumb: {
    width: 80,
    height: 80,
    borderRadius: 8,
  },
  addPhotoButton: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: '#112240',
    borderWidth: 1,
    borderColor: '#1C2E44',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  addPhotoIcon: {
    fontSize: 20,
  },
  addPhotoText: {
    fontSize: 11,
    color: '#8899AA',
  },
  transcriptBox: {
    backgroundColor: '#112240',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1C2E44',
  },
  transcriptText: {
    fontSize: 14,
    color: '#CBD5E1',
    lineHeight: 22,
  },
  addButton: {
    backgroundColor: '#1C2E44',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  addButtonText: {
    fontSize: 13,
    color: '#2563EB',
    fontWeight: '500',
  },
  emptyText: {
    fontSize: 13,
    color: '#4A5568',
    fontStyle: 'italic',
    marginBottom: 8,
  },
  measurementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#112240',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1C2E44',
  },
  measurementLeft: {
    flex: 1,
  },
  measurementType: {
    fontSize: 12,
    color: '#8899AA',
    marginBottom: 2,
  },
  measurementValue: {
    fontSize: 15,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  deleteButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#3B1A1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteIcon: {
    fontSize: 12,
    color: '#F87171',
  },
  measurementForm: {
    backgroundColor: '#112240',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2563EB',
    gap: 10,
  },
  formLabel: {
    fontSize: 12,
    color: '#8899AA',
    marginBottom: 4,
  },
  typeScroll: {
    gap: 6,
    paddingBottom: 4,
  },
  typeChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#1C2E44',
    borderWidth: 1,
    borderColor: '#2A3F55',
  },
  typeChipActive: {
    backgroundColor: '#1E3A5F',
    borderColor: '#2563EB',
  },
  typeChipText: {
    fontSize: 12,
    color: '#8899AA',
  },
  typeChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '500',
  },
  valueInput: {
    backgroundColor: '#0A1628',
    borderWidth: 1,
    borderColor: '#2A3F55',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: '#FFFFFF',
  },
  confirmButton: {
    backgroundColor: '#2563EB',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  confirmButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  severityGrid: {
    gap: 8,
  },
  severityOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#112240',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1.5,
    borderColor: '#1C2E44',
  },
  severityDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    opacity: 0.5,
  },
  severityDotActive: {
    opacity: 1,
    transform: [{ scale: 1.3 }],
  },
  severityTextBlock: {
    flex: 1,
  },
  severityLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#8899AA',
    marginBottom: 1,
  },
  severityDesc: {
    fontSize: 12,
    color: '#4A5568',
  },
  notesInput: {
    backgroundColor: '#112240',
    borderWidth: 1,
    borderColor: '#1C2E44',
    borderRadius: 10,
    padding: 14,
    fontSize: 14,
    color: '#FFFFFF',
    height: 100,
  },
  submitSection: {
    padding: 20,
    paddingTop: 8,
    gap: 10,
  },
  submitButton: {
    backgroundColor: '#059669',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  submitHint: {
    fontSize: 12,
    color: '#4A5568',
    textAlign: 'center',
  },
});