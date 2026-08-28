import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="project/[id]" />
      <Stack.Screen name="drawing/[id]" />
      <Stack.Screen name="drawings" options={{ presentation: 'modal' }} />
      <Stack.Screen name="reports" options={{ presentation: 'modal' }} />
      <Stack.Screen name="camera" />
      <Stack.Screen name="recorder" />
      <Stack.Screen name="observation" />
      <Stack.Screen name="session" />
      <Stack.Screen name="project/create" />
      <Stack.Screen name="signup" />
      <Stack.Screen name="forgot-password" />
      <Stack.Screen name="pin-login" />
      <Stack.Screen name="setup-pin" />
    </Stack>
  );
}