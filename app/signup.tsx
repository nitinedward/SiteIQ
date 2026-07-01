import { C } from '../lib/theme'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, TouchableWithoutFeedback, Keyboard,
  Platform, ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import { createFirm, joinFirm } from '../lib/firm';

type Mode = 'create' | 'join';

export default function SignupScreen() {
  const [mode, setMode]                       = useState<Mode>('create');
  const [fullName, setFullName]               = useState('');
  const [email, setEmail]                     = useState('');
  const [password, setPassword]               = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firmName, setFirmName]               = useState('');
  const [joinCode, setJoinCode]               = useState('');
  const [isLoading, setIsLoading]             = useState(false);
  const [focusedField, setFocusedField]       = useState<string | null>(null);

  const handleSignup = async () => {
    if (!fullName.trim()) { Alert.alert('Missing Field', 'Please enter your full name.'); return; }
    if (!email.trim()) { Alert.alert('Missing Field', 'Please enter your email.'); return; }
    if (!password) { Alert.alert('Missing Field', 'Please enter a password.'); return; }
    if (password.length < 6) { Alert.alert('Weak Password', 'Password must be at least 6 characters.'); return; }
    if (password !== confirmPassword) { Alert.alert('Password Mismatch', 'Passwords do not match.'); return; }
    if (mode === 'create' && !firmName.trim()) { Alert.alert('Missing Field', 'Please enter your firm name.'); return; }
    if (mode === 'join' && !joinCode.trim()) { Alert.alert('Missing Field', 'Please enter the join code.'); return; }

    Keyboard.dismiss();
    setIsLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(), password,
      options: { data: { full_name: fullName.trim(), firm_name: mode === 'create' ? firmName.trim() : '' } },
    });

    if (error) { setIsLoading(false); Alert.alert('Sign Up Failed', error.message); return; }

    const userId = data.user?.id;
    if (!userId) { setIsLoading(false); Alert.alert('Error', 'Could not create account.'); return; }

    if (mode === 'create') {
      const result = await createFirm(firmName.trim(), userId, email.trim(), fullName.trim());
      setIsLoading(false);
      if (!result) { Alert.alert('Error', 'Account created but could not set up firm.'); return; }
      Alert.alert(
        'Firm Created!',
        `Welcome to SiteIQ!\n\nYour join code is: ${result.joinCode}\n\nShare this with your engineers.`,
        [{ text: 'Continue', onPress: () => router.replace('/(tabs)/projects') }]
      );
    } else {
      const result = await joinFirm(joinCode.trim(), userId, email.trim(), fullName.trim());
      setIsLoading(false);
      if (!result) { Alert.alert('Invalid Code', 'The join code is incorrect. Please check with your admin.'); return; }
      Alert.alert('Joined!', `Welcome to ${result.firmName}!`,
        [{ text: 'Continue', onPress: () => router.replace('/(tabs)/projects') }]
      );
    }
  };

  const inputStyle = (field: string) => [
    styles.input, focusedField === field && styles.inputFocused,
  ];

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
              <Text style={styles.backArrow}>{'<'}</Text>
            </TouchableOpacity>
            <View style={styles.logoMark}>
              <Text style={styles.logoMarkText}>S</Text>
            </View>
          </View>

          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Join SiteIQ to start capturing inspections</Text>

          {/* Mode toggle */}
          <View style={styles.modeToggle}>
            <TouchableOpacity
              style={[styles.modeBtn, mode === 'create' && styles.modeBtnActive]}
              onPress={() => setMode('create')}
            >
              <Text style={[styles.modeBtnText, mode === 'create' && styles.modeBtnTextActive]}>
                Create Firm
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, mode === 'join' && styles.modeBtnActive]}
              onPress={() => setMode('join')}
            >
              <Text style={[styles.modeBtnText, mode === 'join' && styles.modeBtnTextActive]}>
                Join Firm
              </Text>
            </TouchableOpacity>
          </View>

          {mode === 'create' && (
            <View style={styles.adminNote}>
              <Text style={styles.adminNoteText}>
                You'll be the Admin - create projects and manage your team
              </Text>
            </View>
          )}

          {/* Fields */}
          <View style={styles.form}>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>FULL NAME</Text>
              <TextInput style={inputStyle('name')} placeholder="Sarah Chen" placeholderTextColor={C.textMuted}
                value={fullName} onChangeText={setFullName} autoCapitalize="words"
                onFocus={() => setFocusedField('name')} onBlur={() => setFocusedField(null)} />
            </View>

            {mode === 'create' ? (
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>FIRM NAME</Text>
                <TextInput style={inputStyle('firm')} placeholder="Chen Structural Engineers" placeholderTextColor={C.textMuted}
                  value={firmName} onChangeText={setFirmName} autoCapitalize="words"
                  onFocus={() => setFocusedField('firm')} onBlur={() => setFocusedField(null)} />
              </View>
            ) : (
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>JOIN CODE</Text>
                <Text style={styles.fieldHint}>6-digit code from your firm admin</Text>
                <TextInput style={[inputStyle('code'), styles.joinCodeInput]}
                  placeholder="ABC123" placeholderTextColor={C.textMuted}
                  value={joinCode} onChangeText={t => setJoinCode(t.toUpperCase())}
                  autoCapitalize="characters" maxLength={6}
                  onFocus={() => setFocusedField('code')} onBlur={() => setFocusedField(null)} />
              </View>
            )}

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>EMAIL</Text>
              <TextInput style={inputStyle('email')} placeholder="engineer@yourfirm.com" placeholderTextColor={C.textMuted}
                value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none"
                onFocus={() => setFocusedField('email')} onBlur={() => setFocusedField(null)} />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>PASSWORD</Text>
              <TextInput style={inputStyle('pass')} placeholder="At least 6 characters" placeholderTextColor={C.textMuted}
                value={password} onChangeText={setPassword} secureTextEntry
                onFocus={() => setFocusedField('pass')} onBlur={() => setFocusedField(null)} />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>CONFIRM PASSWORD</Text>
              <TextInput style={inputStyle('confirm')} placeholder="Re-enter password" placeholderTextColor={C.textMuted}
                value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry
                onFocus={() => setFocusedField('confirm')} onBlur={() => setFocusedField(null)} />
            </View>

            <TouchableOpacity
              style={[styles.submitBtn, isLoading && { opacity: 0.6 }]}
              onPress={handleSignup} disabled={isLoading} activeOpacity={0.9}
            >
              {isLoading ? <ActivityIndicator color="#FFFFFF" /> : (
                <Text style={styles.submitBtnText}>
                  {mode === 'create' ? 'Create Firm & Account' : 'Join Firm & Sign Up'}
                </Text>
              )}
            </TouchableOpacity>

            <View style={styles.loginRow}>
              <Text style={styles.loginPrompt}>Already have an account? </Text>
              <TouchableOpacity onPress={() => router.replace('/')}>
                <Text style={styles.loginLink}>Sign in</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:         { flex: 1, backgroundColor: C.bgPage },
  scrollContent:     { flexGrow: 1, paddingHorizontal: 28, paddingBottom: 40 },
  header:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 60, marginBottom: 32 },
  backBtn:           { padding: 8 },
  backArrow:         { fontSize: 22, color: C.blue },
  logoMark:          { width: 40, height: 40, borderRadius: 12, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center' },
  logoMarkText:      { fontSize: 20, fontWeight: '900', color: C.textInverse },
  title:             { fontSize: 30, fontWeight: '800', color: C.textPrimary, letterSpacing: -0.5, marginBottom: 8 },
  subtitle:          { fontSize: 14, color: C.textSecondary, marginBottom: 28, lineHeight: 20 },
  modeToggle:        { flexDirection: 'row', backgroundColor: C.bgMuted, borderRadius: 14, padding: 4, marginBottom: 16, borderWidth: 1, borderColor: C.border },
  modeBtn:           { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  modeBtnActive:     { backgroundColor: C.blue },
  modeBtnText:       { fontSize: 14, fontWeight: '600', color: C.textSecondary },
  modeBtnTextActive: { color: C.textInverse },
  adminNote:         { backgroundColor: C.blueLight, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.blueMid, marginBottom: 20 },
  adminNoteText:     { fontSize: 13, color: C.blue, lineHeight: 18 },
  form:              { gap: 18 },
  fieldGroup:        { gap: 8 },
  fieldLabel:        { fontSize: 11, color: C.textSecondary, fontWeight: '600', letterSpacing: 1.5 },
  fieldHint:         { fontSize: 12, color: C.textMuted, fontStyle: 'italic' },
  input:             { backgroundColor: C.bgMuted, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: C.textPrimary },
  inputFocused:      { borderColor: C.borderFocus, backgroundColor: C.bgCard },
  joinCodeInput:     { fontSize: 22, fontWeight: '700', letterSpacing: 10, textAlign: 'center', color: C.blue },
  submitBtn:         { backgroundColor: C.blue, borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 8, shadowColor: C.blue, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 8 },
  submitBtnText:     { color: C.textInverse, fontSize: 16, fontWeight: '700' },
  loginRow:          { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  loginPrompt:       { fontSize: 14, color: C.textSecondary },
  loginLink:         { fontSize: 14, color: C.blue, fontWeight: '600' },
});