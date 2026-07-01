import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
  Easing,
} from 'react-native';
import { useState, useEffect, useRef } from 'react';
import { Audio } from 'expo-av';
import { router } from 'expo-router';
import { C, FONT, RADIUS } from '../lib/theme';

export default function RecorderScreen() {
  // Permission to use microphone
  const [permission, setPermission] = useState<boolean | null>(null);

  // Is the app currently recording?
  const [isRecording, setIsRecording] = useState(false);

  // The recording object — we need this to stop it later
  const [recording, setRecording] = useState<Audio.Recording | null>(null);

  // How many seconds have we been recording?
  const [duration, setDuration] = useState(0);

  // The file path of the recorded audio
  const [audioUri, setAudioUri] = useState<string | null>(null);

  // Fake transcript — later this will come from Whisper API
  const [transcript, setTranscript] = useState<string>('');

  // Are we "transcribing" (fake loading state for now)
  const [isTranscribing, setIsTranscribing] = useState(false);

  // Timer reference — so we can clear it when recording stops
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Animation value for the pulsing record button
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Waveform bar animations — 5 bars that animate while recording
  const waveAnims = useRef(
    Array.from({ length: 5 }, () => new Animated.Value(0.3))
  ).current;

  // ── REQUEST PERMISSION ON LOAD ──────────────────────
  useEffect(() => {
    requestMicrophonePermission();
  }, []);

  const requestMicrophonePermission = async () => {
    const { granted } = await Audio.requestPermissionsAsync();
    setPermission(granted);
  };

  // ── PULSE ANIMATION ─────────────────────────────────
  // Makes the record button slowly pulse while recording
  const startPulse = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  };

  const stopPulse = () => {
    pulseAnim.stopAnimation();
    pulseAnim.setValue(1);
  };

  // ── WAVEFORM ANIMATION ──────────────────────────────
  // Makes 5 bars animate at different speeds — looks like audio waveform
  const startWaveform = () => {
    waveAnims.forEach((anim, index) => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, {
            toValue: 1,
            duration: 300 + index * 100,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(anim, {
            toValue: 0.2,
            duration: 300 + index * 100,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
        ])
      ).start();
    });
  };

  const stopWaveform = () => {
    waveAnims.forEach(anim => {
      anim.stopAnimation();
      anim.setValue(0.3);
    });
  };

  // ── FORMAT DURATION ─────────────────────────────────
  // Converts seconds to MM:SS format
  // e.g. 65 seconds → "01:05"
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // ── START RECORDING ─────────────────────────────────
  const startRecording = async () => {
    if (!permission) {
      await requestMicrophonePermission();
      return;
    }

    try {
      // Set audio mode — this tells iOS to use the microphone
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      // Create a new recording with HIGH_QUALITY preset
      const { recording: newRecording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      setRecording(newRecording);
      setIsRecording(true);
      setDuration(0);
      setTranscript('');
      setAudioUri(null);

      // Start the timer — adds 1 second every second
      timerRef.current = setInterval(() => {
        setDuration(d => d + 1);
      }, 1000);

      // Start animations
      startPulse();
      startWaveform();

    } catch (error) {
      console.error('Failed to start recording:', error);
    }
  };

  // ── STOP RECORDING ──────────────────────────────────
  const stopRecording = async () => {
    if (!recording) return;

    try {
      // Stop the timer
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }

      // Stop the recording and get the file URI
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();

      setRecording(null);
      setIsRecording(false);
      stopPulse();
      stopWaveform();

      if (uri) {
        setAudioUri(uri);
        // Simulate transcription (fake for now)
        await simulateTranscription();
      }

    } catch (error) {
      console.error('Failed to stop recording:', error);
    }
  };

  // ── SIMULATE TRANSCRIPTION ───────────────────────────
  // This is a fake transcription for now.
  // Later we will send the audio to Whisper API and get real text back.
  const simulateTranscription = async () => {
    setIsTranscribing(true);

    // Wait 2 seconds to simulate API call
    await new Promise(resolve => setTimeout(resolve, 2000));

    setTranscript(
      'Column C3 on Level 2 shows minor vertical surface cracking approximately 0.2mm width running for 300mm. No spalling observed. Reinforcement not exposed. Recommend monitoring at next inspection.'
    );
    setIsTranscribing(false);
  };

  // ── CLEAN UP TIMER ON UNMOUNT ────────────────────────
  // If the engineer navigates away while recording, stop the timer
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  // ── PERMISSION DENIED ───────────────────────────────
  if (permission === false) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionTitle}>Microphone Access Required</Text>
        <Text style={styles.permissionText}>
          SiteIQ needs microphone access to record inspection notes.
        </Text>
        <TouchableOpacity
          style={styles.permissionButton}
          onPress={requestMicrophonePermission}
        >
          <Text style={styles.permissionButtonText}>Allow Microphone</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── MAIN UI ─────────────────────────────────────────
  return (
    <View style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Text style={styles.backArrow}>{'<'}</Text>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Voice Notes</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >

        {/* Microphone icon */}
        <View style={styles.micContainer} />

        {/* Waveform */}
        <View style={styles.waveform}>
          {waveAnims.map((anim, index) => (
            <Animated.View
              key={index}
              style={[
                styles.waveBar,
                {
                  height: anim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [8, 40],
                  }),
                  backgroundColor: isRecording ? '#2563EB' : '#1C2E44',
                },
              ]}
            />
          ))}
        </View>

        {/* Timer */}
        <Text style={styles.timer}>
          {formatDuration(duration)}
        </Text>

        {/* Status text */}
        <Text style={styles.statusText}>
          {isRecording
            ? 'Recording - speak clearly...'
            : audioUri
            ? 'Recording complete'
            : 'Tap to start recording'}
        </Text>

        {/* Record / Stop button */}
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <TouchableOpacity
            style={[
              styles.recordButton,
              isRecording && styles.recordButtonActive,
            ]}
            onPress={isRecording ? stopRecording : startRecording}
            activeOpacity={0.8}
          >
            <Text style={styles.recordButtonText}>
              {isRecording ? 'Stop' : 'Record'}
            </Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Transcript section */}
        {(isTranscribing || transcript) && (
          <View style={styles.transcriptContainer}>
            <Text style={styles.transcriptLabel}>
              {isTranscribing ? 'Transcribing...' : 'Transcript'}
            </Text>

            {isTranscribing ? (
              <View style={styles.transcribingContainer}>
                <Text style={styles.transcribingDots}>...</Text>
                <Text style={styles.transcribingText}>
                  Processing audio...
                </Text>
              </View>
            ) : (
              <Text style={styles.transcriptText}>{transcript}</Text>
            )}
          </View>
        )}

        {/* Save button — shows when transcript is ready */}
        {transcript && !isTranscribing && (
          <TouchableOpacity style={styles.saveButton}>
            <Text style={styles.saveButtonText}>
              Save to Observation
            </Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 40 }} />

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container:            { flex: 1, backgroundColor: C.bgPage },
  header:               { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.bgCard },
  backButton:           { flexDirection: 'row', alignItems: 'center', gap: 6, width: 60 },
  backArrow:            { fontSize: 20, color: C.blue },
  backText:             { fontSize: 16, color: C.blue },
  headerTitle:          { fontSize: 18, fontWeight: '600', color: C.textPrimary },
  scroll:               { flex: 1 },
  scrollContent:        { alignItems: 'center', paddingTop: 40, paddingHorizontal: 24 },
  micContainer:         { width: 80, height: 80, borderRadius: 40, backgroundColor: C.blueLight, alignItems: 'center', justifyContent: 'center', marginBottom: 32, borderWidth: 1, borderColor: C.blueMid },
  micIcon:              { fontSize: 36 },
  waveform:             { flexDirection: 'row', alignItems: 'center', gap: 6, height: 50, marginBottom: 20 },
  waveBar:              { width: 6, borderRadius: 3 },
  timer:                { fontSize: 48, fontWeight: '200', color: C.textPrimary, fontVariant: ['tabular-nums'], marginBottom: 8, letterSpacing: 2 },
  statusText:           { fontSize: 14, color: C.textSecondary, marginBottom: 40, textAlign: 'center' },
  recordButton:         { width: 120, height: 120, borderRadius: 60, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center', marginBottom: 40, gap: 4, shadowColor: C.blue, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8 },
  recordButtonActive:   { backgroundColor: C.danger, shadowColor: C.danger },
  recordButtonIcon:     { fontSize: 32 },
  recordButtonText:     { fontSize: 13, color: C.textInverse, fontWeight: '600', letterSpacing: 1 },
  transcriptContainer:  { width: '100%', backgroundColor: C.bgCard, borderRadius: RADIUS.md, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: C.border },
  transcriptLabel:      { fontSize: 11, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10, fontWeight: '600' },
  transcribingContainer:{ alignItems: 'center', paddingVertical: 12 },
  transcribingDots:     { fontSize: 24, color: C.blue, letterSpacing: 8, marginBottom: 8 },
  transcribingText:     { fontSize: 13, color: C.textSecondary },
  transcriptText:       { fontSize: 14, color: C.textPrimary, lineHeight: 22 },
  saveButton:           { backgroundColor: C.success, borderRadius: RADIUS.md, paddingVertical: 14, paddingHorizontal: 32, width: '100%', alignItems: 'center' },
  saveButtonText:       { color: C.textInverse, fontSize: 16, fontWeight: '600' },
  permissionContainer:  { flex: 1, backgroundColor: C.bgPage, alignItems: 'center', justifyContent: 'center', padding: 32 },
  permissionIcon:       { fontSize: 56, marginBottom: 20 },
  permissionTitle:      { fontSize: 22, fontWeight: '700', color: C.textPrimary, marginBottom: 12, textAlign: 'center' },
  permissionText:       { fontSize: 15, color: C.textSecondary, textAlign: 'center', lineHeight: 24, marginBottom: 32 },
  permissionButton:     { backgroundColor: C.blue, borderRadius: RADIUS.md, paddingVertical: 14, paddingHorizontal: 32 },
  permissionButtonText: { color: C.textInverse, fontSize: 16, fontWeight: '600' },
});