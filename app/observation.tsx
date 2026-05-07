import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Image,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { useState, useRef, useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '../lib/supabase';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';

const OPENAI_API_KEY = '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';

const BAR_COUNT = 24;

type Severity = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type Measurement = { id: string; type: string; value: string; unit: string; };

const MEASUREMENT_TYPES = [
  { label: 'Cover Depth', unit: 'mm' },
  { label: 'Lap Length', unit: 'mm' },
  { label: 'Bar Spacing', unit: 'mm' },
  { label: 'Starter Bar Length', unit: 'mm' },
  { label: 'Crack Width', unit: 'mm' },
  { label: 'Crack Length', unit: 'mm' },
  { label: 'Crack Depth', unit: 'mm' },
  { label: 'Bar Diameter', unit: 'mm' },
  { label: 'Slab Thickness', unit: 'mm' },
  { label: 'Deflection', unit: 'mm' },
  { label: 'Settlement', unit: 'mm' },
  { label: 'Tilt / Lean', unit: 'degrees' },
  { label: 'Spalling Area', unit: 'm²' },
  { label: 'Custom', unit: 'mm' },
];

const SEVERITY_OPTIONS: { value: Severity; label: string; colour: string; description: string; }[] = [
  { value: 'NONE',     label: 'None',     colour: '#8899AA', description: 'No defects observed' },
  { value: 'LOW',      label: 'Low',      colour: '#34D399', description: 'Minor — monitor only' },
  { value: 'MEDIUM',   label: 'Medium',   colour: '#FBBF24', description: 'Moderate — action required' },
  { value: 'HIGH',     label: 'High',     colour: '#F97316', description: 'Serious — urgent action' },
  { value: 'CRITICAL', label: 'Critical', colour: '#F87171', description: 'Immediate action required' },
];

// ── WAVEFORM COMPONENT ────────────────────────────────────
// Uses a JavaScript interval to animate bars smoothly
// When recording: energetic random animation simulating voice
// When idle: gentle slow breathing animation
function WaveformVisualiser({ isRecording }: { isRecording: boolean }) {
  // One Animated.Value per bar
  const barAnims = useRef(
    Array.from({ length: BAR_COUNT }, () => new Animated.Value(0.05))
  ).current;

  // Store the interval ID so we can clear it when needed
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const animateBars = (active: boolean) => {
    // Clear any existing interval first
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // Run an animation tick every 120ms
    intervalRef.current = setInterval(() => {
      barAnims.forEach((anim, index) => {
        // Centre bars are naturally taller — mimics a real waveform shape
        const centerFactor = 1 - Math.abs(index - BAR_COUNT / 2) / (BAR_COUNT / 2) * 0.5;

        let targetValue: number;
        if (active) {
          // Recording: energetic random heights
          targetValue = (Math.random() * 0.7 + 0.15) * centerFactor;
        } else {
          // Idle: gentle slow movement
          targetValue = (Math.random() * 0.1 + 0.03) * centerFactor;
        }

        Animated.spring(anim, {
          toValue: targetValue,
          useNativeDriver: false,
          speed: active ? 25 : 8,
          bounciness: active ? 4 : 1,
        }).start();
      });
    }, 120);
  };

  useEffect(() => {
    animateBars(isRecording);
    // Cleanup when component unmounts or isRecording changes
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isRecording]);

  return (
    <View style={waveStyles.container}>
      {barAnims.map((anim, index) => (
        <Animated.View
          key={index}
          style={[
            waveStyles.bar,
            {
              height: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [3, 52],
              }),
              backgroundColor: isRecording ? '#F87171' : '#2A3F55',
              opacity: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.4, 1],
              }),
            },
          ]}
        />
      ))}
    </View>
  );
}

const waveStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    height: 64,
  },
  bar: {
    width: 3.5,
    borderRadius: 2,
    alignSelf: 'center',
  },
});

// ── MAIN SCREEN ───────────────────────────────────────────
export default function ObservationScreen() {
  const params = useLocalSearchParams();
  const zoneLabel    = params.zone_label    as string || 'General Observation';
  const zoneId       = params.zone_id       as string || 'general';
  const inspectionId = params.inspection_id as string || '';
  const projectId    = params.project_id    as string || '';

  const [measurements, setMeasurements]               = useState<Measurement[]>([]);
  const [severity, setSeverity]                       = useState<Severity>('NONE');
  const [notes, setNotes]                             = useState('');
  const [isSubmitting, setIsSubmitting]               = useState(false);
  const [showMeasurementForm, setShowMeasurementForm] = useState(false);
  const [newMeasType, setNewMeasType]                 = useState(MEASUREMENT_TYPES[0].label);
  const [newMeasValue, setNewMeasValue]               = useState('');
  const [newMeasUnit, setNewMeasUnit]                 = useState(MEASUREMENT_TYPES[0].unit);
  const [customMeasLabel, setCustomMeasLabel]         = useState('');
  const [customUnit, setCustomUnit]                   = useState('mm');
  const [photos, setPhotos]                           = useState<string[]>([]);
  const [photoUrls, setPhotoUrls]                     = useState<string[]>([]);
  const [isUploading, setIsUploading]                 = useState(false);
  const [transcript, setTranscript]                   = useState('');
  const [isRecording, setIsRecording]                 = useState(false);
  const [isTranscribing, setIsTranscribing]           = useState(false);
  const [recording, setRecording]                     = useState<Audio.Recording | null>(null);

  // ── START RECORDING ─────────────────────────────────────
  const startRecording = async () => {
    const { granted } = await Audio.requestPermissionsAsync();
    if (!granted) {
      Alert.alert('Permission Required', 'Please allow microphone access.');
      return;
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });

    const { recording: newRecording } = await Audio.Recording.createAsync({
      android: {
        extension: '.m4a',
        outputFormat: Audio.AndroidOutputFormat.MPEG_4,
        audioEncoder: Audio.AndroidAudioEncoder.AAC,
        sampleRate: 44100,
        numberOfChannels: 2,
        bitRate: 128000,
      },
      ios: {
        extension: '.m4a',
        outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
        audioQuality: Audio.IOSAudioQuality.HIGH,
        sampleRate: 44100,
        numberOfChannels: 2,
        bitRate: 128000,
        linearPCMBitDepth: 16,
        linearPCMIsBigEndian: false,
        linearPCMIsFloat: false,
      },
      web: {},
    });

    setRecording(newRecording);
    setIsRecording(true);
  };

  // ── STOP RECORDING ──────────────────────────────────────
  const stopRecording = async () => {
    if (!recording) return;
    setIsRecording(false);
    setIsTranscribing(true);

    await recording.stopAndUnloadAsync();
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

    const uri = recording.getURI();
    setRecording(null);

    if (!uri) {
      setIsTranscribing(false);
      Alert.alert('Error', 'Could not find the recording file.');
      return;
    }

    await transcribeWithWhisper(uri);
  };

  const toggleRecording = async () => {
    if (isRecording) {
      await stopRecording();
    } else {
      await startRecording();
    }
  };

  // ── SEND TO OPENAI WHISPER ──────────────────────────────
  const transcribeWithWhisper = async (uri: string) => {
    try {
      const formData = new FormData();
      formData.append('file', {
        uri,
        type: 'audio/m4a',
        name: 'audio.m4a',
      } as any);
      formData.append('model', 'whisper-1');
      formData.append('language', 'en');

      const whisperResponse = await fetch(
        'https://api.openai.com/v1/audio/transcriptions',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
          body: formData,
        }
      );

      const data = await whisperResponse.json();

      if (data.text) {
        setTranscript(prev => prev ? prev + ' ' + data.text : data.text);
      } else {
        Alert.alert('Transcription Failed', 'Could not transcribe. Please try again.');
        console.error('Whisper error:', data);
      }
    } catch (err) {
      Alert.alert('Transcription Failed', 'Something went wrong.');
      console.error('Whisper error:', err);
    } finally {
      setIsTranscribing(false);
    }
  };

  // ── ADD PHOTO ───────────────────────────────────────────
  const handleAddPhoto = () => {
    Alert.alert('Add Photo', 'Choose a source', [
      { text: 'Cancel', style: 'cancel' },
      { text: '📷 Take Photo', onPress: () => pickPhoto('camera') },
      { text: '🖼️ Photo Library', onPress: () => pickPhoto('library') },
    ]);
  };

  const pickPhoto = async (source: 'camera' | 'library') => {
    if (source === 'camera') {
      const { granted } = await ImagePicker.requestCameraPermissionsAsync();
      if (!granted) { Alert.alert('Permission Required', 'Please allow camera access.'); return; }
    } else {
      const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!granted) { Alert.alert('Permission Required', 'Please allow photo library access.'); return; }
    }

    const pickerResult = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: false })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, allowsEditing: false, mediaTypes: ImagePicker.MediaTypeOptions.Images });

    if (pickerResult.canceled) return;
    const uri = pickerResult.assets[0].uri;
    setPhotos(current => [...current, uri]);
    await uploadPhoto(uri);
  };

  // ── UPLOAD PHOTO ────────────────────────────────────────
  const uploadPhoto = async (uri: string) => {
    setIsUploading(true);
    try {
      const response = await fetch(uri);
      const blob = await response.blob();
      const fileName = `observation-${Date.now()}.jpg`;

      const { data, error } = await supabase.storage
        .from('observation-photos')
        .upload(fileName, blob, { contentType: 'image/jpeg', upsert: false });

      if (error) { Alert.alert('Upload Failed', 'Could not upload photo.'); return; }

      const { data: urlData } = supabase.storage
        .from('observation-photos')
        .getPublicUrl(data.path);

      setPhotoUrls(current => [...current, urlData.publicUrl]);
    } catch (err) {
      Alert.alert('Upload Failed', 'Something went wrong uploading the photo.');
    } finally {
      setIsUploading(false);
    }
  };

  // ── MEASUREMENTS ────────────────────────────────────────
  const addMeasurement = () => {
    if (!newMeasValue || isNaN(Number(newMeasValue))) {
      Alert.alert('Invalid Value', 'Please enter a valid number.'); return;
    }
    if (newMeasType === 'Custom' && !customMeasLabel.trim()) {
      Alert.alert('Missing Label', 'Please enter a name for this measurement.'); return;
    }
    const newMeas: Measurement = {
      id: Date.now().toString(),
      type: newMeasType === 'Custom' ? customMeasLabel : newMeasType,
      value: newMeasValue,
      unit: newMeasType === 'Custom' ? customUnit : newMeasUnit,
    };
    setMeasurements(current => [...current, newMeas]);
    setNewMeasValue('');
    setCustomMeasLabel('');
    setShowMeasurementForm(false);
  };

  const deleteMeasurement = (id: string) =>
    setMeasurements(current => current.filter(m => m.id !== id));

  const selectMeasurementType = (type: string, unit: string) => {
    setNewMeasType(type);
    setNewMeasUnit(unit);
  };

  // ── SAVE TO SUPABASE ────────────────────────────────────
  const handleSubmit = async () => {
    if (isUploading) { Alert.alert('Please wait', 'Photos are still uploading.'); return; }
    if (isRecording) { Alert.alert('Please wait', 'Stop recording before submitting.'); return; }
    if (isTranscribing) { Alert.alert('Please wait', 'Transcription is still in progress.'); return; }

    setIsSubmitting(true);
    const measurementsToSave = measurements.map(({ type, value, unit }) => ({ type, value, unit }));

    const { error } = await supabase.from('observations').insert({
      inspection_id: inspectionId || null,
      project_id:    projectId    || null,
      zone_id:       zoneId,
      zone_label:    zoneLabel,
      severity,
      notes:         notes.trim(),
      transcript:    transcript.trim(),
      measurements:  measurementsToSave,
      photos:        photoUrls,
      observed_at:   new Date().toISOString(),
    });

    setIsSubmitting(false);
    if (error) { Alert.alert('❌ Save Failed', error.message); return; }
    Alert.alert(
      '✅ Observation Saved',
      `Your inspection of "${zoneLabel}" has been recorded.`,
      [{ text: 'OK', onPress: () => router.back() }]
    );
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Observation</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.zoneBanner}>
          <Text style={styles.zoneBannerLabel}>Inspecting</Text>
          <Text style={styles.zoneBannerTitle}>{zoneLabel}</Text>
        </View>

        {/* PHOTOS */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Photos ({photos.length})</Text>
            {isUploading && <ActivityIndicator size="small" color="#2563EB" />}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoStrip}>
            {photos.map((uri, index) => (
              <Image key={index} source={{ uri }} style={styles.photoThumb} />
            ))}
            <TouchableOpacity style={styles.addPhotoButton} onPress={handleAddPhoto}>
              <Text style={styles.addPhotoIcon}>📷</Text>
              <Text style={styles.addPhotoText}>Add</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>

        {/* VOICE TRANSCRIPT */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Voice Transcript</Text>
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
                  {isRecording ? '⏹ Stop' : '🎙 Record'}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Waveform box */}
          <View style={[styles.waveformContainer, isRecording && styles.waveformContainerActive]}>
            <WaveformVisualiser isRecording={isRecording} />
            {isRecording && (
              <Text style={styles.recordingLabel}>🔴 Recording — tap Stop when finished</Text>
            )}
            {isTranscribing && (
              <Text style={styles.transcribingLabel}>✨ Transcribing with Whisper AI...</Text>
            )}
            {!isRecording && !isTranscribing && !transcript && (
              <Text style={styles.waveformHint}>Tap Record to start speaking</Text>
            )}
            {!isRecording && !isTranscribing && transcript && (
              <Text style={styles.waveformHint}>Tap Record to add more</Text>
            )}
          </View>

          {transcript ? (
            <View style={styles.transcriptBox}>
              <Text style={styles.transcriptText}>{transcript}</Text>
              <TouchableOpacity
                style={styles.clearTranscript}
                onPress={() => Alert.alert(
                  'Clear Transcript',
                  'Are you sure you want to clear the transcript?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Clear', style: 'destructive', onPress: () => setTranscript('') },
                  ]
                )}
              >
                <Text style={styles.clearTranscriptText}>Clear & re-record</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        {/* MEASUREMENTS */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Measurements ({measurements.length})</Text>
            <TouchableOpacity style={styles.addButton} onPress={() => setShowMeasurementForm(!showMeasurementForm)}>
              <Text style={styles.addButtonText}>{showMeasurementForm ? '✕ Cancel' : '+ Add'}</Text>
            </TouchableOpacity>
          </View>
          {measurements.length === 0 && !showMeasurementForm && (
            <Text style={styles.emptyText}>No measurements added yet</Text>
          )}
          {measurements.map(meas => (
            <View key={meas.id} style={styles.measurementRow}>
              <View style={styles.measurementLeft}>
                <Text style={styles.measurementType}>{meas.type}</Text>
                <Text style={styles.measurementValue}>{meas.value} {meas.unit}</Text>
              </View>
              <TouchableOpacity onPress={() => deleteMeasurement(meas.id)} style={styles.deleteButton}>
                <Text style={styles.deleteIcon}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
          {showMeasurementForm && (
            <View style={styles.measurementForm}>
              <Text style={styles.formLabel}>Measurement type</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.typeScroll}>
                {MEASUREMENT_TYPES.map(type => (
                  <TouchableOpacity
                    key={type.label}
                    style={[styles.typeChip, newMeasType === type.label && styles.typeChipActive]}
                    onPress={() => selectMeasurementType(type.label, type.unit)}
                  >
                    <Text style={[styles.typeChipText, newMeasType === type.label && styles.typeChipTextActive]}>
                      {type.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              {newMeasType === 'Custom' && (
                <>
                  <Text style={styles.formLabel}>Measurement name</Text>
                  <TextInput
                    style={styles.valueInput}
                    placeholder="e.g. Hook Extension..."
                    placeholderTextColor="#4A5568"
                    value={customMeasLabel}
                    onChangeText={setCustomMeasLabel}
                  />
                  <Text style={styles.formLabel}>Unit</Text>
                  <View style={styles.unitRow}>
                    {['mm', 'm', 'degrees', 'm²', 'kN'].map(u => (
                      <TouchableOpacity
                        key={u}
                        style={[styles.unitChip, customUnit === u && styles.unitChipActive]}
                        onPress={() => setCustomUnit(u)}
                      >
                        <Text style={[styles.unitChipText, customUnit === u && styles.unitChipTextActive]}>{u}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
              <Text style={styles.formLabel}>
                Value ({newMeasType === 'Custom' ? customUnit : newMeasUnit})
              </Text>
              <TextInput
                style={styles.valueInput}
                placeholder={`Enter value in ${newMeasType === 'Custom' ? customUnit : newMeasUnit}`}
                placeholderTextColor="#4A5568"
                value={newMeasValue}
                onChangeText={setNewMeasValue}
                keyboardType="decimal-pad"
              />
              <TouchableOpacity style={styles.confirmButton} onPress={addMeasurement}>
                <Text style={styles.confirmButtonText}>Add Measurement</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* SEVERITY */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Finding Severity</Text>
          <View style={styles.severityGrid}>
            {SEVERITY_OPTIONS.map(option => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.severityOption,
                  severity === option.value && { borderColor: option.colour, backgroundColor: option.colour + '15' },
                ]}
                onPress={() => setSeverity(option.value)}
              >
                <View style={[
                  styles.severityDot,
                  { backgroundColor: option.colour },
                  severity === option.value && styles.severityDotActive,
                ]} />
                <View style={styles.severityTextBlock}>
                  <Text style={[styles.severityLabel, severity === option.value && { color: option.colour }]}>
                    {option.label}
                  </Text>
                  <Text style={styles.severityDesc}>{option.description}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* NOTES */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Additional Notes</Text>
          <TextInput
            style={styles.notesInput}
            placeholder="Any additional observations..."
            placeholderTextColor="#4A5568"
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        {/* SUBMIT */}
        <View style={styles.submitSection}>
          <TouchableOpacity
            style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={isSubmitting}
          >
            <Text style={styles.submitButtonText}>
              {isSubmitting ? 'Saving Observation...' : 'Submit Observation'}
            </Text>
          </TouchableOpacity>
          <Text style={styles.submitHint}>This will save the observation to the project record</Text>
        </View>

        <View style={{ height: 60 }} />
      </ScrollView>
    </KeyboardAvoidingView>
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
  zoneBanner: {
    backgroundColor: '#112240', padding: 16, marginHorizontal: 20, marginTop: 16,
    borderRadius: 10, borderWidth: 1, borderColor: '#1C2E44',
    borderLeftWidth: 4, borderLeftColor: '#2563EB',
  },
  zoneBannerLabel: { fontSize: 11, color: '#8899AA', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  zoneBannerTitle: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  section: { padding: 20, paddingBottom: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#8899AA', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  photoStrip: { gap: 8, paddingRight: 8 },
  photoThumb: { width: 80, height: 80, borderRadius: 8 },
  addPhotoButton: {
    width: 80, height: 80, borderRadius: 8, backgroundColor: '#112240',
    borderWidth: 1, borderColor: '#1C2E44', borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  addPhotoIcon: { fontSize: 20 },
  addPhotoText: { fontSize: 11, color: '#8899AA' },
  recordButton: {
    backgroundColor: '#1C2E44', paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1, borderColor: '#2A3F55',
    minWidth: 90, alignItems: 'center',
  },
  recordButtonActive: { backgroundColor: '#F87171', borderColor: '#F87171' },
  recordButtonTranscribing: { backgroundColor: '#1E3A5F', borderColor: '#2563EB' },
  recordButtonText: { fontSize: 13, color: '#FFFFFF', fontWeight: '500' },
  waveformContainer: {
    backgroundColor: '#112240', borderRadius: 12, padding: 12,
    borderWidth: 1.5, borderColor: '#1C2E44', alignItems: 'center', gap: 6,
  },
  waveformContainerActive: { borderColor: '#F87171', backgroundColor: '#1A0808' },
  recordingLabel: { fontSize: 12, color: '#F87171', fontWeight: '600' },
  transcribingLabel: { fontSize: 12, color: '#2563EB' },
  waveformHint: { fontSize: 12, color: '#4A5568' },
  transcriptBox: {
    backgroundColor: '#112240', borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: '#1C2E44', gap: 10, marginTop: 8,
  },
  transcriptText: { fontSize: 14, color: '#CBD5E1', lineHeight: 22 },
  clearTranscript: { alignSelf: 'flex-end' },
  clearTranscriptText: { fontSize: 12, color: '#F87171' },
  addButton: { backgroundColor: '#1C2E44', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  addButtonText: { fontSize: 13, color: '#2563EB', fontWeight: '500' },
  emptyText: { fontSize: 13, color: '#4A5568', fontStyle: 'italic', marginBottom: 8 },
  measurementRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#112240',
    borderRadius: 8, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#1C2E44',
  },
  measurementLeft: { flex: 1 },
  measurementType: { fontSize: 12, color: '#8899AA', marginBottom: 2 },
  measurementValue: { fontSize: 15, color: '#FFFFFF', fontWeight: '500' },
  deleteButton: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#3B1A1A', alignItems: 'center', justifyContent: 'center' },
  deleteIcon: { fontSize: 12, color: '#F87171' },
  measurementForm: {
    backgroundColor: '#112240', borderRadius: 10,
    padding: 14, borderWidth: 1, borderColor: '#2563EB', gap: 10,
  },
  formLabel: { fontSize: 12, color: '#8899AA', marginBottom: 4 },
  typeScroll: { gap: 6, paddingBottom: 4 },
  typeChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#1C2E44', borderWidth: 1, borderColor: '#2A3F55' },
  typeChipActive: { backgroundColor: '#1E3A5F', borderColor: '#2563EB' },
  typeChipText: { fontSize: 12, color: '#8899AA' },
  typeChipTextActive: { color: '#FFFFFF', fontWeight: '500' },
  unitRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 8 },
  unitChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: '#1C2E44', borderWidth: 1, borderColor: '#2A3F55' },
  unitChipActive: { backgroundColor: '#1E3A5F', borderColor: '#2563EB' },
  unitChipText: { fontSize: 12, color: '#8899AA' },
  unitChipTextActive: { color: '#FFFFFF', fontWeight: '500' },
  valueInput: { backgroundColor: '#0A1628', borderWidth: 1, borderColor: '#2A3F55', borderRadius: 8, padding: 12, fontSize: 15, color: '#FFFFFF' },
  confirmButton: { backgroundColor: '#2563EB', borderRadius: 8, padding: 12, alignItems: 'center' },
  confirmButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  severityGrid: { gap: 8 },
  severityOption: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#112240', borderRadius: 10, padding: 12, borderWidth: 1.5, borderColor: '#1C2E44' },
  severityDot: { width: 12, height: 12, borderRadius: 6, opacity: 0.5 },
  severityDotActive: { opacity: 1 },
  severityTextBlock: { flex: 1 },
  severityLabel: { fontSize: 14, fontWeight: '500', color: '#8899AA', marginBottom: 1 },
  severityDesc: { fontSize: 12, color: '#4A5568' },
  notesInput: { backgroundColor: '#112240', borderWidth: 1, borderColor: '#1C2E44', borderRadius: 10, padding: 14, fontSize: 14, color: '#FFFFFF', height: 100 },
  submitSection: { padding: 20, paddingTop: 8, gap: 10 },
  submitButton: { backgroundColor: '#059669', borderRadius: 10, padding: 16, alignItems: 'center' },
  submitButtonDisabled: { opacity: 0.6 },
  submitButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  submitHint: { fontSize: 12, color: '#4A5568', textAlign: 'center' },
});
