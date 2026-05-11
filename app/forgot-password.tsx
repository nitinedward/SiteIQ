import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, TouchableWithoutFeedback, Keyboard,
  Platform, Alert, ActivityIndicator,
} from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';

export default function ForgotPasswordScreen() {
  const [email, setEmail]         = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [focused, setFocused]     = useState(false);

  const handleReset = async () => {
    if (!email.trim()) { Alert.alert('Missing Email', 'Please enter your email address.'); return; }
    Keyboard.dismiss();
    setIsLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    setIsLoading(false);
    if (error) { Alert.alert('Error', error.message); return; }
    setEmailSent(true);
  };

  if (emailSent) {
    return (
      <View style={styles.container}>
        <View style={styles.centred}>
          <View style={styles.successIcon}>
            <Text style={styles.successIconText}>✉</Text>
          </View>
          <Text style={styles.successTitle}>Check your inbox</Text>
          <Text style={styles.successBody}>
            If an account exists for {email}, we've sent a password reset link.
            Check your inbox and spam folder.
          </Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.replace('/')}>
            <Text style={styles.backBtnText}>Back to Sign In</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.inner}>
          <TouchableOpacity style={styles.backArrowBtn} onPress={() => router.back()}>
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>

          <View style={styles.logoMark}>
            <Text style={styles.logoMarkText}>S</Text>
          </View>

          <Text style={styles.title}>Reset Password</Text>
          <Text style={styles.subtitle}>
            Enter your email and we'll send you a link to reset your password.
          </Text>

          <Text style={styles.fieldLabel}>EMAIL</Text>
          <TextInput
            style={[styles.input, focused && styles.inputFocused]}
            placeholder="engineer@yourfirm.com"
            placeholderTextColor="#334155"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoFocus
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />

          <TouchableOpacity
            style={[styles.submitBtn, isLoading && { opacity: 0.6 }]}
            onPress={handleReset}
            disabled={isLoading}
            activeOpacity={0.9}
          >
            {isLoading ? <ActivityIndicator color="#FFFFFF" /> : (
              <Text style={styles.submitBtnText}>Send Reset Link</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080C14' },
  inner: { flex: 1, paddingHorizontal: 28, paddingTop: 60 },
  backArrowBtn: { marginBottom: 32 },
  backArrow: { fontSize: 24, color: '#0EA5E9' },
  logoMark: {
    width: 48, height: 48, borderRadius: 14, backgroundColor: '#0EA5E9',
    alignItems: 'center', justifyContent: 'center', marginBottom: 24,
  },
  logoMarkText: { fontSize: 24, fontWeight: '900', color: '#FFFFFF' },
  title: { fontSize: 28, fontWeight: '800', color: '#F8FAFC', letterSpacing: -0.5, marginBottom: 10 },
  subtitle: { fontSize: 14, color: '#475569', lineHeight: 20, marginBottom: 32 },
  fieldLabel: { fontSize: 11, color: '#475569', fontWeight: '600', letterSpacing: 1.5, marginBottom: 8 },
  input: {
    backgroundColor: '#0D1520', borderWidth: 1, borderColor: '#1E293B',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 15, color: '#F8FAFC', marginBottom: 20,
  },
  inputFocused: { borderColor: '#0EA5E9', backgroundColor: '#0F1E30' },
  submitBtn: {
    backgroundColor: '#0EA5E9', borderRadius: 14, padding: 16,
    alignItems: 'center', marginBottom: 14,
    shadowColor: '#0EA5E9', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 8,
  },
  submitBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  cancelBtn: { alignItems: 'center', padding: 12 },
  cancelBtnText: { fontSize: 14, color: '#475569' },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 16 },
  successIcon: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: '#0F2A3F',
    alignItems: 'center', justifyContent: 'center', marginBottom: 8,
    borderWidth: 2, borderColor: '#0EA5E9',
  },
  successIconText: { fontSize: 32, color: '#0EA5E9' },
  successTitle: { fontSize: 24, fontWeight: '800', color: '#F8FAFC', textAlign: 'center' },
  successBody: { fontSize: 14, color: '#475569', textAlign: 'center', lineHeight: 22 },
  backBtn: {
    backgroundColor: '#0EA5E9', borderRadius: 14, paddingHorizontal: 32, paddingVertical: 14, marginTop: 8,
  },
  backBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});