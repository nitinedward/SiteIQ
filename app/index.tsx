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
  Dimensions,
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

const { width } = Dimensions.get('window');

export default function LoginScreen() {
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showBiometric, setShowBiometric]         = useState(false);
  const [showPinOption, setShowPinOption]         = useState(false);
  const [isBiometricLoading, setIsBiometricLoading] = useState(false);
  const [focusedField, setFocusedField]           = useState<string | null>(null);

  useEffect(() => { checkAuthOptions(); }, []);

  const checkAuthOptions = async () => {
    const biometricAvailable = await isBiometricAvailable();
    const biometricOn        = await isBiometricEnabled();
    const pinOn              = await isPinEnabled();
    setShowBiometric(biometricAvailable && biometricOn);
    setShowPinOption(pinOn);
    if (biometricAvailable && biometricOn) {
      setTimeout(() => handleBiometricLogin(), 600);
    }
  };

  const handleBiometricLogin = async () => {
    setIsBiometricLoading(true);
    const result = await authenticateWithBiometric();
    setIsBiometricLoading(false);
    if (result.success) router.replace('/(tabs)/projects');
    else if (!result.cancelled) router.push('/pin-login');
  };

  const handleLogin = async () => {
    if (!email) { Alert.alert('Missing Email', 'Please enter your email.'); return; }
    if (!password) { Alert.alert('Missing Password', 'Please enter your password.'); return; }
    Keyboard.dismiss();
    setIsLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setIsLoading(false);
    if (error) { Alert.alert('Login Failed', error.message); return; }
    const pinOn = await isPinEnabled();
    if (!pinOn) {
      router.replace({ pathname: '/setup-pin', params: { email, password } });
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
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Logo area */}
          <View style={styles.logoArea}>
            <View style={styles.logoMark}>
              <Text style={styles.logoMarkText}>S</Text>
            </View>
            <Text style={styles.appName}>SiteIQ</Text>
            <Text style={styles.tagline}>Structural Inspection Platform</Text>
          </View>

          {/* Biometric buttons */}
          {(showBiometric || showPinOption) && (
            <View style={styles.biometricArea}>
              {showBiometric && (
                <TouchableOpacity
                  style={styles.biometricBtn}
                  onPress={handleBiometricLogin}
                  disabled={isBiometricLoading}
                  activeOpacity={0.8}
                >
                  {isBiometricLoading ? (
                    <ActivityIndicator color="#0EA5E9" size="small" />
                  ) : (
                    <>
                      <Text style={styles.biometricBtnIcon}>🔒</Text>
                      <Text style={styles.biometricBtnText}>Continue with Face ID</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
              {showPinOption && (
                <TouchableOpacity
                  style={styles.pinBtn}
                  onPress={() => router.push('/pin-login')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.pinBtnIcon}>⠿</Text>
                  <Text style={styles.pinBtnText}>Use PIN</Text>
                </TouchableOpacity>
              )}
              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or sign in with email</Text>
                <View style={styles.dividerLine} />
              </View>
            </View>
          )}

          {/* Form */}
          <View style={styles.form}>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>EMAIL</Text>
              <TextInput
                style={[styles.input, focusedField === 'email' && styles.inputFocused]}
                placeholder="engineer@yourfirm.com"
                placeholderTextColor="#334155"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                onFocus={() => setFocusedField('email')}
                onBlur={() => setFocusedField(null)}
              />
            </View>

            <View style={styles.fieldGroup}>
              <View style={styles.labelRow}>
                <Text style={styles.fieldLabel}>PASSWORD</Text>
                <TouchableOpacity onPress={() => router.push('/forgot-password')}>
                  <Text style={styles.forgotText}>Forgot?</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={[styles.input, focusedField === 'password' && styles.inputFocused]}
                placeholder="••••••••"
                placeholderTextColor="#334155"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                onFocus={() => setFocusedField('password')}
                onBlur={() => setFocusedField(null)}
              />
            </View>

            <TouchableOpacity
              style={[styles.loginBtn, isLoading && styles.loginBtnDisabled]}
              onPress={handleLogin}
              disabled={isLoading}
              activeOpacity={0.9}
            >
              {isLoading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.loginBtnText}>Sign In</Text>
              )}
            </TouchableOpacity>

            <View style={styles.signupRow}>
              <Text style={styles.signupPrompt}>New to SiteIQ? </Text>
              <TouchableOpacity onPress={() => router.push('/signup')}>
                <Text style={styles.signupLink}>Create account</Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={styles.footer}>Structural Inspection Software · NZ</Text>
        </ScrollView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080C14' },
  scrollContent: {
    flexGrow: 1, paddingHorizontal: 28,
    paddingTop: 80, paddingBottom: 40,
  },
  logoArea: { alignItems: 'center', marginBottom: 48 },
  logoMark: {
    width: 64, height: 64, borderRadius: 18,
    backgroundColor: '#0EA5E9',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
    shadowColor: '#0EA5E9',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 12,
  },
  logoMarkText: {
    fontSize: 32, fontWeight: '900', color: '#FFFFFF', letterSpacing: -1,
  },
  appName: {
    fontSize: 34, fontWeight: '800', color: '#F8FAFC',
    letterSpacing: -0.5, marginBottom: 6,
  },
  tagline: { fontSize: 13, color: '#475569', letterSpacing: 1.5 },
  biometricArea: { marginBottom: 32, gap: 10 },
  biometricBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#0F1923', borderRadius: 14, padding: 16, gap: 10,
    borderWidth: 1.5, borderColor: '#0EA5E9',
  },
  biometricBtnIcon: { fontSize: 18 },
  biometricBtnText: { fontSize: 15, fontWeight: '600', color: '#0EA5E9' },
  pinBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#0F1923', borderRadius: 14, padding: 14, gap: 10,
    borderWidth: 1, borderColor: '#1E293B',
  },
  pinBtnIcon: { fontSize: 16, color: '#64748B' },
  pinBtnText: { fontSize: 14, fontWeight: '500', color: '#64748B' },
  dividerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#1E293B' },
  dividerText: { fontSize: 11, color: '#334155', letterSpacing: 0.5 },
  form: { gap: 20 },
  fieldGroup: { gap: 8 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fieldLabel: { fontSize: 11, color: '#475569', fontWeight: '600', letterSpacing: 1.5 },
  forgotText: { fontSize: 12, color: '#0EA5E9', fontWeight: '500' },
  input: {
    backgroundColor: '#0D1520', borderWidth: 1, borderColor: '#1E293B',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 15, color: '#F8FAFC',
  },
  inputFocused: { borderColor: '#0EA5E9', backgroundColor: '#0F1E30' },
  loginBtn: {
    backgroundColor: '#0EA5E9', borderRadius: 14, padding: 16,
    alignItems: 'center', marginTop: 4,
    shadowColor: '#0EA5E9',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  loginBtnDisabled: { opacity: 0.6 },
  loginBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
  signupRow: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 4,
  },
  signupPrompt: { fontSize: 14, color: '#475569' },
  signupLink: { fontSize: 14, color: '#0EA5E9', fontWeight: '600' },
  footer: { fontSize: 11, color: '#1E293B', textAlign: 'center', marginTop: 48, letterSpacing: 1 },
});
