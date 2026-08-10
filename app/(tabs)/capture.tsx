import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { theme } from '../../lib/theme';

const T = theme.colors;
const R = theme.radius;

export default function CaptureTab() {
  return (
    <View style={S.root}>
      <View style={S.card}>
        <Text style={S.icon}>📋</Text>
        <Text style={S.title}>Start an Inspection</Text>
        <Text style={S.sub}>
          Select a project from your list to begin capturing observations, photos, and voice notes.
        </Text>
        <TouchableOpacity style={S.btn} onPress={() => router.push('/(tabs)/projects')} activeOpacity={0.85}>
          <Text style={S.btnText}>Go to Projects</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paper, alignItems: 'center', justifyContent: 'center', padding: 32 },
  card: {
    backgroundColor: T.surface,
    borderRadius: R.lg,
    padding: 32,
    alignItems: 'center',
    width: '100%',
    shadowColor: '#2C3950',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 3,
  },
  icon:  { fontSize: 48, marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '800', color: T.indigo, marginBottom: 10, textAlign: 'center', letterSpacing: -0.3 },
  sub:   { fontSize: 14, color: T.mid, textAlign: 'center', lineHeight: 22, marginBottom: 28 },
  btn:   {
    backgroundColor: T.indigo,
    borderRadius: R.pill,
    paddingVertical: 14,
    paddingHorizontal: 32,
    shadowColor: T.indigoDeep,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 4,
  },
  btnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
