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
  ActivityIndicator,
  Animated,
} from 'react-native';
import { useState, useRef, useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '../lib/supabase';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';
import Constants from 'expo-constants';

const BAR_COUNT = 24;

// ── WAVEFORM COMPONENT ─────────────────────────────────
// Renders animated bars that react to the actual microphone level
// metering comes from expo-av's onRecordingStatusUpdate callback
function WaveformVisualiser({
  isRecording,
  metering,
}: {
  isRecording: boolean;
  metering: number; // dB value from -160 to 0
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
          // Convert dB metering to 0-1 range
          // metering is typically -160 (silence) to 0 (max)
          // We clamp to -60 to 0 for practical use
          const normalised = Math.max(0, Math.min(1, (metering + 60) / 60));

          // Add wave ripple on top of the voice level
          const wave = Math.sin(timeRef.current * 0.4 + index * 0.6) * 0.15;

          // Centre bars react more strongly than edge bars
          const centreBoost = 1 - Math.abs(index - BAR_COUNT / 2) / (BAR_COUNT / 2) * 0.4;

          targetValue = Math.max(0.05, (normalised + wave) * centreBoost);
        } else {
          // Idle — very subtle breathing wave
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

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRecording, metering]);

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
                outputRange: [3, 48],
              }),
              backgroundColor: isRecording
                ? anim.interpolate({
                    inputRange: [0, 0.5, 1],
                    outputRange: ['#4A5568', '#F87171', '#F87171'],
                  })
                : '#2A3F55',
              opacity: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.3, 1],
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
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: 56, gap: 3, paddingHorizontal: 8,
  },
  bar: { width: 3, borderRadius: 2 },
});

// Hardcoded fallback ensures the key is always available
// regardless of whether Constants.expoConfig has loaded
const OPENAI_API_KEY = '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';

const SUPABASE_URL = 'https://vbaewualqaxhbmqgnhdt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZiYWV3dWFscWF4aGJtcWduaGR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4NzAzNjMsImV4cCI6MjA5MzQ0NjM2M30.8s39SZtGq4r_0NXYhsAU0WdPSGqLfefm2YYK_JXjZbg';

type Severity = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

type Measurement = {
  id: string;
  type: string;
  value: string;
  unit: string;
};

const MEASUREMENT_TYPES = [
  { label: 'Cover Depth',        unit: 'mm' },
  { label: 'Lap Length',         unit: 'mm' },
  { label: 'Bar Spacing',        unit: 'mm' },
  { label: 'Starter Bar Length', unit: 'mm' },
  { label: 'Bar Diameter',       unit: 'mm' },
  { label: 'Custom',             unit: 'mm' },
];

const SEVERITY_OPTIONS: {
  value: Severity; label: string; colour: string; description: string;
}[] = [
  { value: 'NONE',     label: 'None',     colour: '#8899AA', description: 'No defects observed' },
  { value: 'LOW',      label: 'Low',      colour: '#34D399', description: 'Minor — monitor only' },
  { value: 'MEDIUM',   label: 'Medium',   colour: '#FBBF24', description: 'Moderate — action required' },
  { value: 'HIGH',     label: 'High',     colour: '#F97316', description: 'Serious — urgent action' },
  { value: 'CRITICAL', label: 'Critical', colour: '#F87171', description: 'Immediate action required' },
];

export default function ObservationScreen() {
  const params       = useLocalSearchParams();
  const zoneLabel    = params.zone_label as string || 'General Observation';
  const zoneId       = params.zone_id as string || '';
  const projectId    = params.project_id as string || '';
  const inspectionId = params.inspection_id as string || '';

  const [photos, setPhotos]         = useState<string[]>([]);
  const [transcript, setTranscript] = useState('');
  const [notes, setNotes]           = useState('');
  const [severity, setSeverity]     = useState<Severity>('NONE');
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading]   = useState(false);

  // Measurement form
  const [showMeasurementForm, setShowMeasurementForm] = useState(false);
  const [newMeasType, setNewMeasType]   = useState(MEASUREMENT_TYPES[0].label);
  const [newMeasValue, setNewMeasValue] = useState('');
  const [newMeasUnit, setNewMeasUnit]   = useState(MEASUREMENT_TYPES[0].unit);
  const [customMeasLabel, setCustomMeasLabel] = useState('');
  const [customUnit, setCustomUnit]     = useState('mm');

  // Voice
  const [isRecording, setIsRecording]       = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recording, setRecording]           = useState<Audio.Recording | null>(null);
  const [metering, setMetering]             = useState(-60); // dB level from mic

  // ── TAKE PHOTO ─────────────────────────────────────────
  const handleTakePhoto = async () => {
    const { granted } = await ImagePicker.requestCameraPermissionsAsync();
    if (!granted) {
      Alert.alert('Permission Required', 'Please allow camera access in Settings.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: false,
    });

    if (result.canceled) return;
    await uploadPhoto(result.assets[0].uri);
  };

  // ── PICK FROM LIBRARY ──────────────────────────────────
  const handlePickPhoto = async () => {
    const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!granted) {
      Alert.alert('Permission Required', 'Please allow photo library access in Settings.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsMultipleSelection: true,
    });

    if (result.canceled) return;
    for (const asset of result.assets) {
      await uploadPhoto(asset.uri);
    }
  };

  // ── UPLOAD PHOTO ───────────────────────────────────────
  const uploadPhoto = async (uri: string) => {
    setIsUploading(true);
    try {
      const fileName = `photo-${Date.now()}-${Math.random().toString(36).substring(2)}.jpg`;

      const formData = new FormData();
      formData.append('file', {
        uri,
        name: fileName,
        type: 'image/jpeg',
      } as any);

      const uploadResponse = await fetch(
        `${SUPABASE_URL}/storage/v1/object/observation-photos/${fileName}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'apikey': SUPABASE_KEY,
          },
          body: formData,
        }
      );

      if (!uploadResponse.ok) {
        const errText = await uploadResponse.text();
        console.error('Photo upload error:', errText);
        Alert.alert('Upload Failed', 'Could not upload photo. Please try again.');
        return;
      }

      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/observation-photos/${fileName}`;
      setPhotos(current => [...current, publicUrl]);
    } catch (err) {
      console.error('Photo upload error:', err);
      Alert.alert('Upload Failed', 'Something went wrong uploading the photo.');
    } finally {
      setIsUploading(false);
    }
  };

  // ── VOICE RECORDING ────────────────────────────────────
  const startRecording = async () => {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert('Permission Required', 'Please allow microphone access in Settings.');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording: newRecording } = await Audio.Recording.createAsync(
        {
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
        },
        // onRecordingStatusUpdate fires every 100ms with live metering data
        (status) => {
          if (status.metering !== undefined) {
            setMetering(status.metering);
          }
        },
        100 // update interval in ms
      );

      setRecording(newRecording);
      setIsRecording(true);
    } catch (err) {
      console.error('Start recording error:', err);
      Alert.alert('Error', 'Could not start recording. Please try again.');
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

      if (!uri) {
        setIsTranscribing(false);
        Alert.alert('Error', 'Could not get recording. Please try again.');
        return;
      }

      // Check API key is available
      if (!OPENAI_API_KEY) {
        setIsTranscribing(false);
        Alert.alert('Configuration Error', 'OpenAI API key is not configured. Please check your .env file.');
        return;
      }

      const formData = new FormData();
      formData.append('file', { uri, type: 'audio/m4a', name: 'audio.m4a' } as any);
      formData.append('model', 'whisper-1');
      formData.append('language', 'en');

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('Transcription API error:', errText);
        Alert.alert('Transcription Failed', 'Could not transcribe audio. Please check your API key or try again.');
        return;
      }

      const data = await response.json();
      if (data.text) {
        setTranscript(prev => prev ? prev + ' ' + data.text : data.text);
      } else {
        Alert.alert('Transcription Failed', 'No text was detected. Please try speaking clearly.');
      }
    } catch (err) {
      console.error('Transcription error:', err);
      Alert.alert('Transcription Failed', 'Could not connect to transcription service. Check your internet connection.');
    } finally {
      setIsTranscribing(false);
    }
  };

  const toggleRecording = async () => {
    if (isRecording) await stopRecording();
    else await startRecording();
  };

  // ── MEASUREMENTS ───────────────────────────────────────
  const addMeasurement = () => {
    if (!newMeasValue || isNaN(Number(newMeasValue))) {
      Alert.alert('Invalid Value', 'Please enter a valid number.');
      return;
    }
    if (newMeasType === 'Custom' && !customMeasLabel.trim()) {
      Alert.alert('Missing Label', 'Please enter a name for this measurement.');
      return;
    }

    setMeasurements(current => [...current, {
      id:    Date.now().toString(),
      type:  newMeasType === 'Custom' ? customMeasLabel : newMeasType,
      value: newMeasValue,
      unit:  newMeasType === 'Custom' ? customUnit : newMeasUnit,
    }]);

    setNewMeasValue('');
    setCustomMeasLabel('');
    setShowMeasurementForm(false);
  };

  const deleteMeasurement = (id: string) => {
    setMeasurements(current => current.filter(m => m.id !== id));
  };

  // ── SAVE OBSERVATION ───────────────────────────────────
  const handleSubmit = async () => {
    if (!transcript.trim() && !notes.trim() && photos.length === 0 && measurements.length === 0) {
      Alert.alert('Nothing to Save', 'Please add at least one photo, voice note, or measurement.');
      return;
    }

    setIsSubmitting(true);

    const { error } = await supabase.from('observations').insert({
      zone_id:       zoneId !== 'general' ? zoneId : null,
      project_id:    projectId,
      inspection_id: inspectionId || null,
      zone_label:    zoneLabel,
      severity,
      transcript:    transcript.trim(),
      notes:         notes.trim(),
      photos,
      measurements:  JSON.stringify(measurements),
    });

    setIsSubmitting(false);

    if (error) {
      Alert.alert('Save Failed', error.message);
      return;
    }

    Alert.alert(
      '✅ Observation Saved',
      `Observation for "${zoneLabel}" has been recorded.`,
      [{ text: 'OK', onPress: () => router.back() }]
    );
  };

  const selectedSeverity = SEVERITY_OPTIONS.find(s => s.value === severity)!;

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
        <Text style={styles.headerTitle} numberOfLines={1}>Observation</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* Zone label */}
        <View style={styles.zoneBanner}>
          <Text style={styles.zoneIcon}>📍</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.zoneLabel}>{zoneLabel}</Text>
            <Text style={styles.zoneSub}>Tap below to capture your observations</Text>
          </View>
        </View>

        {/* PHOTOS */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Photos ({photos.length})</Text>
          <View style={styles.photoActions}>
            <TouchableOpacity
              style={styles.photoButton}
              onPress={handleTakePhoto}
              disabled={isUploading}
            >
              {isUploading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Text style={styles.photoButtonIcon}>📷</Text>
                  <Text style={styles.photoButtonText}>Take Photo</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.photoButton, styles.photoButtonSecondary]}
              onPress={handlePickPhoto}
              disabled={isUploading}
            >
              <Text style={styles.photoButtonIcon}>🖼️</Text>
              <Text style={[styles.photoButtonText, { color: '#2563EB' }]}>From Library</Text>
            </TouchableOpacity>
          </View>

          {photos.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoStrip}>
              {photos.map((uri, index) => (
                <TouchableOpacity
                  key={index}
                  onLongPress={() => {
                    Alert.alert('Remove Photo', 'Remove this photo?', [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Remove', style: 'destructive',
                        onPress: () => setPhotos(current => current.filter((_, i) => i !== index)),
                      },
                    ]);
                  }}
                >
                  <Image source={{ uri }} style={styles.photoThumb} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>

        {/* VOICE NOTES */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Voice Notes</Text>
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

          {/* Waveform — shows when recording or transcribing */}
          {(isRecording || isTranscribing) && (
            <View style={styles.waveformContainer}>
              <WaveformVisualiser isRecording={isRecording} metering={metering} />
              {isRecording && (
                <Text style={styles.recordingHint}>🔴 Recording — speak clearly, tap Stop when done</Text>
              )}
              {isTranscribing && (
                <Text style={styles.transcribingHint}>⏳ Transcribing your recording...</Text>
              )}
            </View>
          )}

          {transcript ? (
            <View style={styles.transcriptBox}>
              <Text style={styles.transcriptLabel}>Transcribed — tap to edit:</Text>
              <TextInput
                style={styles.transcriptInput}
                value={transcript}
                onChangeText={setTranscript}
                multiline
                textAlignVertical="top"
              />
            </View>
          ) : (
            <View style={styles.emptyVoice}>
              <Text style={styles.emptyVoiceText}>
                Tap Record to dictate your observation
              </Text>
            </View>
          )}
        </View>

        {/* SEVERITY */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Severity</Text>
          <View style={styles.severityGrid}>
            {SEVERITY_OPTIONS.map(option => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.severityChip,
                  severity === option.value && {
                    backgroundColor: option.colour + '25',
                    borderColor: option.colour,
                  },
                ]}
                onPress={() => setSeverity(option.value)}
              >
                <View style={[styles.severityDot, { backgroundColor: option.colour }]} />
                <Text style={[
                  styles.severityLabel,
                  severity === option.value && { color: option.colour },
                ]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {severity !== 'NONE' && (
            <Text style={[styles.severityDesc, { color: selectedSeverity.colour }]}>
              {selectedSeverity.description}
            </Text>
          )}
        </View>

        {/* MEASUREMENTS */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Measurements ({measurements.length})</Text>
            <TouchableOpacity
              style={styles.addMeasButton}
              onPress={() => setShowMeasurementForm(!showMeasurementForm)}
            >
              <Text style={styles.addMeasButtonText}>
                {showMeasurementForm ? 'Cancel' : '+ Add'}
              </Text>
            </TouchableOpacity>
          </View>

          {showMeasurementForm && (
            <View style={styles.measForm}>
              <Text style={styles.measLabel}>Measurement Type</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.measTypeScroll}>
                {MEASUREMENT_TYPES.map(type => (
                  <TouchableOpacity
                    key={type.label}
                    style={[styles.measTypeChip, newMeasType === type.label && styles.measTypeChipActive]}
                    onPress={() => {
                      setNewMeasType(type.label);
                      setNewMeasUnit(type.unit);
                    }}
                  >
                    <Text style={[styles.measTypeText, newMeasType === type.label && { color: '#FFFFFF' }]}>
                      {type.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {newMeasType === 'Custom' && (
                <>
                  <Text style={styles.measLabel}>Custom Label</Text>
                  <TextInput
                    style={styles.measInput}
                    placeholder="e.g. Beam depth"
                    placeholderTextColor="#4A5568"
                    value={customMeasLabel}
                    onChangeText={setCustomMeasLabel}
                  />
                </>
              )}

              <View style={styles.measValueRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.measLabel}>Value</Text>
                  <TextInput
                    style={styles.measInput}
                    placeholder="0"
                    placeholderTextColor="#4A5568"
                    value={newMeasValue}
                    onChangeText={setNewMeasValue}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={{ width: 80 }}>
                  <Text style={styles.measLabel}>Unit</Text>
                  <TextInput
                    style={styles.measInput}
                    value={newMeasType === 'Custom' ? customUnit : newMeasUnit}
                    onChangeText={newMeasType === 'Custom' ? setCustomUnit : undefined}
                    editable={newMeasType === 'Custom'}
                    placeholderTextColor="#4A5568"
                  />
                </View>
              </View>

              <TouchableOpacity style={styles.addMeasSave} onPress={addMeasurement}>
                <Text style={styles.addMeasSaveText}>Add Measurement</Text>
              </TouchableOpacity>
            </View>
          )}

          {measurements.map(m => (
            <View key={m.id} style={styles.measRow}>
              <Text style={styles.measType}>{m.type}</Text>
              <Text style={styles.measValue}>{m.value} {m.unit}</Text>
              <TouchableOpacity onPress={() => deleteMeasurement(m.id)}>
                <Text style={styles.measDelete}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        {/* ADDITIONAL NOTES */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Additional Notes</Text>
          <TextInput
            style={styles.notesInput}
            placeholder="Any additional observations not captured above..."
            placeholderTextColor="#4A5568"
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        {/* SUBMIT */}
        <View style={styles.section}>
          <TouchableOpacity
            style={[styles.submitButton, isSubmitting && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={isSubmitting}
            activeOpacity={0.8}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.submitText}>Save Observation</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A1628' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1C2E44',
  },
  backButton: { flexDirection: 'row', alignItems: 'center', gap: 6, width: 60 },
  backArrow: { fontSize: 20, color: '#2563EB' },
  backText: { fontSize: 16, color: '#2563EB' },
  headerTitle: { fontSize: 16, fontWeight: '600', color: '#FFFFFF', flex: 1, textAlign: 'center' },
  scroll: { flex: 1 },
  zoneBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#112240', margin: 20, borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: '#1C2E44', borderLeftWidth: 4, borderLeftColor: '#2563EB',
  },
  zoneIcon: { fontSize: 24 },
  zoneLabel: { fontSize: 16, fontWeight: '700', color: '#FFFFFF', marginBottom: 2 },
  zoneSub: { fontSize: 12, color: '#4A5568' },
  section: { paddingHorizontal: 20, paddingBottom: 16 },
  sectionTitle: {
    fontSize: 13, fontWeight: '600', color: '#8899AA',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12,
  },
  sectionHeaderRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 12,
  },
  photoActions: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  photoButton: {
    flex: 1, backgroundColor: '#2563EB', borderRadius: 10,
    padding: 14, alignItems: 'center', flexDirection: 'row',
    justifyContent: 'center', gap: 8,
  },
  photoButtonSecondary: {
    backgroundColor: '#112240', borderWidth: 1, borderColor: '#2563EB',
  },
  photoButtonIcon: { fontSize: 18 },
  photoButtonText: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  photoStrip: { marginBottom: 4 },
  photoThumb: { width: 80, height: 80, borderRadius: 8, marginRight: 8 },
  recordButton: {
    backgroundColor: '#1C2E44', paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1, borderColor: '#2A3F55', minWidth: 90, alignItems: 'center',
  },
  recordButtonActive: { backgroundColor: '#F87171', borderColor: '#F87171' },
  recordButtonTranscribing: { backgroundColor: '#1E3A5F', borderColor: '#2563EB' },
  recordButtonText: { fontSize: 13, color: '#FFFFFF', fontWeight: '500' },
  waveformContainer: {
    backgroundColor: '#112240', borderRadius: 12, padding: 12,
    alignItems: 'center', borderWidth: 1, borderColor: '#1C2E44', marginBottom: 10, gap: 6,
  },
  recordingHint: { fontSize: 12, color: '#F87171' },
  transcribingHint: { fontSize: 12, color: '#2563EB' },
  transcriptBox: {
    backgroundColor: '#112240', borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: '#1C2E44',
  },
  transcriptLabel: { fontSize: 11, color: '#4A5568', marginBottom: 6 },
  transcriptInput: { fontSize: 14, color: '#FFFFFF', minHeight: 80 },
  emptyVoice: {
    backgroundColor: '#112240', borderRadius: 10, padding: 16,
    alignItems: 'center', borderWidth: 1, borderColor: '#1C2E44', borderStyle: 'dashed',
  },
  emptyVoiceText: { fontSize: 13, color: '#4A5568' },
  severityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  severityChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#112240', borderRadius: 20, paddingHorizontal: 14,
    paddingVertical: 8, borderWidth: 1.5, borderColor: '#1C2E44',
  },
  severityDot: { width: 8, height: 8, borderRadius: 4 },
  severityLabel: { fontSize: 13, color: '#8899AA', fontWeight: '500' },
  severityDesc: { fontSize: 12, fontStyle: 'italic' },
  addMeasButton: {
    backgroundColor: '#1C2E44', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8,
  },
  addMeasButtonText: { fontSize: 13, color: '#2563EB', fontWeight: '600' },
  measForm: {
    backgroundColor: '#112240', borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: '#1C2E44', marginBottom: 10, gap: 8,
  },
  measLabel: { fontSize: 12, color: '#8899AA', marginBottom: 4 },
  measTypeScroll: { marginBottom: 4 },
  measTypeChip: {
    backgroundColor: '#1C2E44', borderRadius: 20, paddingHorizontal: 12,
    paddingVertical: 6, marginRight: 6,
  },
  measTypeChipActive: { backgroundColor: '#2563EB' },
  measTypeText: { fontSize: 12, color: '#8899AA' },
  measInput: {
    backgroundColor: '#0A1628', borderWidth: 1, borderColor: '#2A3F55',
    borderRadius: 8, padding: 10, fontSize: 14, color: '#FFFFFF',
  },
  measValueRow: { flexDirection: 'row', gap: 10 },
  addMeasSave: {
    backgroundColor: '#2563EB', borderRadius: 8, padding: 12, alignItems: 'center',
  },
  addMeasSaveText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  measRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#112240',
    borderRadius: 8, padding: 12, marginBottom: 6,
    borderWidth: 1, borderColor: '#1C2E44',
  },
  measType: { flex: 1, fontSize: 13, color: '#8899AA' },
  measValue: { fontSize: 14, color: '#FFFFFF', fontWeight: '600', marginRight: 12 },
  measDelete: { fontSize: 16, color: '#F87171' },
  notesInput: {
    backgroundColor: '#112240', borderWidth: 1, borderColor: '#1C2E44',
    borderRadius: 10, padding: 14, fontSize: 14, color: '#FFFFFF', minHeight: 100,
  },
  submitButton: {
    backgroundColor: '#059669', borderRadius: 12, padding: 16, alignItems: 'center',
  },
  submitText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
