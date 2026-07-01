import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { C, FONT, RADIUS } from '../../lib/theme';

export default function CaptureTab() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Inspection Capture</Text>
      <Text style={styles.title}>Start Inspection</Text>
      <Text style={styles.subtitle}>
        Select a project and inspection zone to begin capturing photos and voice notes.
      </Text>
      <TouchableOpacity
        style={styles.button}
        onPress={() => router.push('/(tabs)/projects')}
      >
        <Text style={styles.buttonText}>{'Go to Projects >'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: C.bgPage, alignItems: 'center', justifyContent: 'center', padding: 32 },
  icon:       { fontSize: 56, marginBottom: 20 },
  title:      { fontSize: FONT.xl, fontWeight: '700', color: C.textPrimary, marginBottom: 12, textAlign: 'center' },
  subtitle:   { fontSize: FONT.md, color: C.textSecondary, textAlign: 'center', lineHeight: 24, marginBottom: 32 },
  button:     { backgroundColor: C.blue, borderRadius: RADIUS.md, paddingVertical: 14, paddingHorizontal: 32 },
  buttonText: { color: C.textInverse, fontSize: FONT.md, fontWeight: '600' },
});