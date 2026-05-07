import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useState, useEffect } from 'react';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import {
  isBiometricAvailable,
  isBiometricEnabled,
  isPinEnabled,
  authenticateWithBiometric,
} from '../lib/auth';

export default function LoginScreen() {
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showBiometric, setShowBiometric]     = useState(false);
  const [showPinOption, setShowPinOption]     = useState(false);
  const [isBiometricLoading, setIsBiometricLoading] = useState(false);

  useEffect(() => {
    checkAuthOptions();
  }, []);

  const checkAuthOptions = async () => {
    const biometricAvailable = await isBiometricAvailable();
    const biometricOn        = await isBiometricEnabled();
    const pinOn              = await isPinEnabled();

    setShowBiometric(biometricAvailable && biometricOn);
    setShowPinOption(pinOn);

    // Auto-trigger Face ID if enabled
    if (biometricAvailable && biometricOn) {
      setTimeout(() => handleBiometricLogin(), 500);
    }
  };

  // ── FACE ID LOGIN ──────────────────────────────────────
  const handleBiometricLogin = async () => {
    setIsBiometricLoading(true);
    const result = await authenticateWithBiometric();
    setIsBiometricLoading(false);

    if (result.success) {
      router.replace('/(tabs)/projects');
    } else if (!result.cancelled) {
      // Face ID failed — offer PIN as fallback
      router.push('/pin-login');
    }
    // If cancelled, just let them use email/password
  };

  // ── EMAIL/PASSWORD LOGIN ───────────────────────────────
  const handleLogin = async () => {
    if (!email) { Alert.alert('Missing Email', 'Please enter your email.'); return; }
    if (!password) { Alert.alert('Missing Password', 'Please enter your password.'); return; }

    Keyboard.dismiss();
    setIsLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    setIsLoading(false);

    if (error) { Alert.alert('Login Failed', error.message); return; }

    // Check if they've already set up PIN
    const pinOn = await isPinEnabled();

    if (!pinOn) {
      // First time — take them to PIN setup
      router.replace({
        pathname: '/setup-pin',
        params: { email, password },
      });
    } else {
      router.replace('/(tabs)/projects');
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">

          <Text style={styles.appName}>SiteIQ</Text>
          <Text style={styles.tagline}>Structural Site Inspections</Text>

          {/* Face ID button */}
          {showBiometric && (
            <TouchableOpacity
              style={styles.biometricButton}
              onPress={handleBiometricLogin}
              disabled={isBiometricLoading}
            >
              {isBiometricLoading ? (
                <ActivityIndicator color="#2563EB" />
              ) : (
                <>
                  <Text style={styles.biometricIcon}>🔒</Text>
                  <Text style={styles.biometricText}>Log in with Face ID</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {/* PIN button */}
          {showPinOption && (
            <TouchableOpacity
              style={styles.pinButton}
              onPress={() => router.push('/pin-login')}
            >
              <Text style={styles.pinIcon}>🔢</Text>
              <Text style={styles.pinText}>Log in with PIN</Text>
            </TouchableOpacity>
          )}

          {(showBiometric || showPinOption) && (
            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or use email</Text>
              <View style={styles.dividerLine} />
            </View>
          )}

          <View style={styles.form}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              placeholder="engineer@yourfirm.com"
              placeholderTextColor="#4A5568"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your password"
              placeholderTextColor="#4A5568"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            <TouchableOpacity
              style={styles.forgotPassword}
              onPress={() => router.push('/forgot-password')}
            >
              <Text style={styles.forgotPasswordText}>Forgot password?</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, isLoading && styles.buttonDisabled]}
              onPress={handleLogin}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.buttonText}>Log In</Text>
              )}
            </TouchableOpacity>

            <View style={styles.signupRow}>
              <Text style={styles.signupText}>Don't have an account? </Text>
              <TouchableOpacity onPress={() => router.push('/signup')}>
                <Text style={styles.signupLink}>Sign up</Text>
              </TouchableOpacity>
            </View>
          </View>

        </ScrollView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A1628' },
  scrollContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  appName: { fontSize: 48, fontWeight: 'bold', color: '#FFFFFF', letterSpacing: 4, marginBottom: 8 },
  tagline: { fontSize: 14, color: '#8899AA', marginBottom: 48, letterSpacing: 2 },
  biometricButton: {
    width: '100%', backgroundColor: '#112240', borderRadius: 12,
    padding: 16, alignItems: 'center', borderWidth: 1.5,
    borderColor: '#2563EB', gap: 8, marginBottom: 10, flexDirection: 'row',
    justifyContent: 'center',
  },
  biometricIcon: { fontSize: 20 },
  biometricText: { fontSize: 16, fontWeight: '600', color: '#2563EB' },
  pinButton: {
    width: '100%', backgroundColor: '#112240', borderRadius: 12,
    padding: 16, alignItems: 'center', borderWidth: 1,
    borderColor: '#1C2E44', gap: 8, marginBottom: 10, flexDirection: 'row',
    justifyContent: 'center',
  },
  pinIcon: { fontSize: 20 },
  pinText: { fontSize: 16, fontWeight: '600', color: '#8899AA' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', width: '100%', marginVertical: 20, gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#1C2E44' },
  dividerText: { fontSize: 12, color: '#4A5568' },
  form: { width: '100%' },
  label: { fontSize: 13, color: '#8899AA', marginBottom: 6, letterSpacing: 1 },
  input: {
    backgroundColor: '#1C2E44', borderWidth: 1, borderColor: '#2A3F55',
    borderRadius: 8, padding: 14, fontSize: 15, color: '#FFFFFF', marginBottom: 16,
  },
  forgotPassword: { alignSelf: 'flex-end', marginBottom: 16, marginTop: -8 },
  forgotPasswordText: { fontSize: 13, color: '#2563EB' },
  button: { backgroundColor: '#2563EB', borderRadius: 8, padding: 16, alignItems: 'center', marginBottom: 20 },
  buttonDisabled: { backgroundColor: '#1A3A7A', opacity: 0.7 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600', letterSpacing: 1 },
  signupRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  signupText: { fontSize: 14, color: '#8899AA' },
  signupLink: { fontSize: 14, color: '#2563EB', fontWeight: '600' },
});
