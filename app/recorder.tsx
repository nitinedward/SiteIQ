import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
  Easing,
  Alert,
} from 'react-native';
import { useState, useEffect, useRef } from 'react';
import { Audio } from 'expo-av';
import { router } from 'expo-router';
import { theme } from '../lib/theme';

const T = theme.colors;
const R = theme.radius;

export default function RecorderScreen() {
  const [permission, setPermission] = useState<boolean | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [duration, setDuration] = useState(0);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const waveAnims = useRef(
    Array.from({ length: 5 }, () => new Animated.Value(0.3))
  ).current;

  useEffect(() => {
    requestMicrophonePermission();
  }, []);

  const requestMicrophonePermission = async () => {
    const { granted } = await Audio.requestPermissionsAsync();
    setPermission(granted);
  };

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

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const startRecording = async () => {
    if (!permission) {
      await requestMicrophonePermission();
      return;
    }

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording: newRecording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      setRecording(newRecording);
      setIsRecording(true);
      setDuration(0);
      setTranscript('');
      setAudioUri(null);

      timerRef.current = setInterval(() => {
        setDuration(d => d + 1);
      }, 1000);

      startPulse();
      startWaveform();

    } catch (error) {
      console.error('Failed to start recording:', error);
    }
  };

  const stopRecording = async () => {
    if (!recording) return;

    try {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }

      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();

      setRecording(null);
      setIsRecording(false);
      stopPulse();
      stopWaveform();

      if (uri) {
        setAudioUri(uri);
        setIsTranscribing(true);
        try {
          const result = await transcribeAudio(uri);
          if (result) {
            setTranscript(result);
          } else {
            Alert.alert(
              'No Speech Detected',
              'Could not detect speech. Please speak clearly and try again.'
            );
          }
        } catch (err: any) {
          Alert.alert('Transcription Failed', err.message || 'Please try again.');
        } finally {
          setIsTranscribing(false);
        }
      }

    } catch (error) {
      console.error('Failed to stop recording:', error);
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

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

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

  return (
    <View style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Text style={styles.backArrow}>{'‹'}</Text>
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
                  backgroundColor: isRecording ? T.marigold : T.line,
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
            ? 'Recording — speak clearly...'
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
            <Text style={styles.recordButtonIcon}>
              {isRecording ? 'stop' : 'rec'}
            </Text>
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

        {/* Save button */}
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
  container:            { flex: 1, backgroundColor: T.paper },
  header:               { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: T.line, backgroundColor: T.surface },
  backButton:           { flexDirection: 'row', alignItems: 'center', gap: 4, width: 60 },
  backArrow:            { fontSize: 28, color: T.indigo, lineHeight: 32 },
  backText:             { fontSize: 16, color: T.indigo, fontWeight: '500' },
  headerTitle:          { fontSize: 18, fontWeight: '600', color: T.ink },
  scroll:               { flex: 1 },
  scrollContent:        { alignItems: 'center', paddingTop: 40, paddingHorizontal: 24 },
  micContainer:         { width: 80, height: 80, borderRadius: 40, backgroundColor: T.indigoSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 32, borderWidth: 1, borderColor: T.line },
  waveform:             { flexDirection: 'row', alignItems: 'center', gap: 6, height: 50, marginBottom: 20 },
  waveBar:              { width: 6, borderRadius: 3 },
  timer:                { fontSize: 48, fontWeight: '200', color: T.ink, fontVariant: ['tabular-nums'], marginBottom: 8, letterSpacing: 2 },
  statusText:           { fontSize: 14, color: T.mid, marginBottom: 40, textAlign: 'center' },
  recordButton:         { width: 120, height: 120, borderRadius: 60, backgroundColor: T.indigo, alignItems: 'center', justifyContent: 'center', marginBottom: 40, gap: 4, shadowColor: T.indigoDeep, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 8 },
  recordButtonActive:   { backgroundColor: T.clay },
  recordButtonIcon:     { fontSize: 13, color: '#FFFFFF', fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
  recordButtonText:     { fontSize: 13, color: '#FFFFFF', fontWeight: '600', letterSpacing: 1 },
  transcriptContainer:  { width: '100%', backgroundColor: T.surface, borderRadius: R.md, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: T.line, shadowColor: '#2C3950', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 2 },
  transcriptLabel:      { fontSize: 11, color: T.mid, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10, fontWeight: '600' },
  transcribingContainer:{ alignItems: 'center', paddingVertical: 12 },
  transcribingDots:     { fontSize: 24, color: T.marigold, letterSpacing: 8, marginBottom: 8 },
  transcribingText:     { fontSize: 13, color: T.mid },
  transcriptText:       { fontSize: 14, color: T.ink, lineHeight: 22 },
  saveButton:           { backgroundColor: T.sage, borderRadius: R.pill, height: 54, paddingHorizontal: 32, width: '100%', alignItems: 'center', justifyContent: 'center', shadowColor: '#3A6B59', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 4 },
  saveButtonText:       { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  permissionContainer:  { flex: 1, backgroundColor: T.paper, alignItems: 'center', justifyContent: 'center', padding: 32 },
  permissionTitle:      { fontSize: 22, fontWeight: '700', color: T.ink, marginBottom: 12, textAlign: 'center' },
  permissionText:       { fontSize: 15, color: T.mid, textAlign: 'center', lineHeight: 24, marginBottom: 32 },
  permissionButton:     { backgroundColor: T.indigo, borderRadius: R.pill, height: 54, paddingHorizontal: 32, alignItems: 'center', justifyContent: 'center' },
  permissionButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
});
