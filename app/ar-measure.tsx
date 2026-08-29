import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Component, Suspense, lazy, type ReactNode } from 'react';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../lib/theme';

const T = theme.colors;

// Lazily imported so this route file has zero static dependency on
// @reactvision/react-viro. expo-router evaluates every route file just to
// build its route table, and Viro's native modules aren't present in Expo
// Go, so a static import here would crash on every app load, not just when
// this screen is visited. The actual AR module only loads once this screen
// is opened.
const ARMeasureContent = lazy(() => import('../components/ARMeasureContent'));

class ARErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) {
      return (
        <View style={S.fallback}>
          <Ionicons name="cube-outline" size={40} color="#FFFFFF" style={{ marginBottom: 16 }} />
          <Text style={S.fallbackTitle}>AR Measuring Unavailable</Text>
          <Text style={S.fallbackBody}>
            This requires the SiteIQ development build. It won't work in Expo Go.
          </Text>
          <TouchableOpacity style={S.fallbackBtn} onPress={() => router.back()}>
            <Text style={S.fallbackBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function ARMeasureScreen() {
  return (
    <ARErrorBoundary>
      <Suspense fallback={
        <View style={S.fallback}>
          <ActivityIndicator color="#FFFFFF" />
        </View>
      }>
        <ARMeasureContent />
      </Suspense>
    </ARErrorBoundary>
  );
}

const S = StyleSheet.create({
  fallback:      { flex: 1, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center', padding: 32 },
  fallbackTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  fallbackBody:  { color: 'rgba(255,255,255,0.7)', fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  fallbackBtn:   { backgroundColor: T.indigo, borderRadius: 999, paddingHorizontal: 24, paddingVertical: 12 },
  fallbackBtnText:{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
