import { theme } from '../lib/theme'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, TouchableWithoutFeedback, Keyboard,
  Platform, Alert, ActivityIndicator,
} from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';

const T = theme.colors;
const R = theme.radius;

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
            <Text style={styles.successIconText}>Email</Text>
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
            <Text style={styles.backArrow}>{'‹'}</Text>
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
            placeholderTextColor={T.mid}
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
  container:       { flex: 1, backgroundColor: T.paper },
  inner:           { flex: 1, paddingHorizontal: 28, paddingTop: 60 },
  backArrowBtn:    { marginBottom: 32 },
  backArrow:       { fontSize: 28, color: T.indigo },
  logoMark:        { width: 48, height: 48, borderRadius: 14, backgroundColor: T.marigold, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  logoMarkText:    { fontSize: 24, fontWeight: '900', color: '#FFFFFF' },
  title:           { fontSize: 28, fontWeight: '800', color: T.ink, letterSpacing: -0.5, marginBottom: 10 },
  subtitle:        { fontSize: 14, color: T.mid, lineHeight: 20, marginBottom: 32 },
  fieldLabel:      { fontSize: 11, color: T.mid, fontWeight: '600', letterSpacing: 1.5, marginBottom: 8 },
  input:           { backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 14, paddingHorizontal: 16, height: 52, fontSize: 15, color: T.ink, marginBottom: 20 },
  inputFocused:    { borderColor: T.indigo },
  submitBtn:       { backgroundColor: T.indigo, borderRadius: R.pill, height: 54, alignItems: 'center', justifyContent: 'center', marginBottom: 14, shadowColor: T.indigoDeep, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.22, shadowRadius: 16, elevation: 6 },
  submitBtnText:   { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  cancelBtn:       { alignItems: 'center', padding: 12 },
  cancelBtnText:   { fontSize: 14, color: T.mid },
  centred:         { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 16 },
  successIcon:     { width: 72, height: 72, borderRadius: 36, backgroundColor: T.indigoSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 8, borderWidth: 2, borderColor: T.indigo },
  successIconText: { fontSize: 14, color: T.indigo, fontWeight: '700' },
  successTitle:    { fontSize: 24, fontWeight: '800', color: T.ink, textAlign: 'center' },
  successBody:     { fontSize: 14, color: T.mid, textAlign: 'center', lineHeight: 22 },
  backBtn:         { backgroundColor: T.indigo, borderRadius: R.pill, paddingHorizontal: 32, height: 54, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  backBtnText:     { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
