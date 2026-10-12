import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';
import { downloadModelOnWifi } from '../lib/whisperModel';
import { startSync } from '../lib/offline/sync';
import { loadFileIndex, tidyFiles } from '../lib/offline/files';
import { refreshOfflineProjects } from '../lib/offline/download';
import { startTranscriptionJobs } from '../lib/transcribeJobs';

export default function RootLayout() {
  useEffect(() => {
    // Offline transcription's model downloads itself the first time the app
    // is opened on Wi-Fi (lib/whisperModel), so it's there before site.
    downloadModelOnWifi();
    // Changes saved on the phone upload whenever there's signal, and
    // projects kept offline are brought up to date (lib/offline).
    loadFileIndex().then(() => {
      startSync();
      startTranscriptionJobs();
      tidyFiles().catch(() => {});
      refreshOfflineProjects().catch(() => {});
    });
    // The sign-in token only refreshes while the app is in front.
    supabase.auth.startAutoRefresh();
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    });
    return () => sub.remove();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="project/[id]" />
          <Stack.Screen name="drawing/[id]" />
          <Stack.Screen name="can/[id]" />
          <Stack.Screen name="drawings" options={{ presentation: 'modal' }} />
          <Stack.Screen name="camera" />
          <Stack.Screen name="ar-measure" />
          <Stack.Screen name="recorder" />
          <Stack.Screen name="observation" />
          <Stack.Screen name="session" />
          <Stack.Screen name="signup" />
          <Stack.Screen name="forgot-password" />
          <Stack.Screen name="pin-login" />
          <Stack.Screen name="setup-pin" />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
