import {
  View, Text, StyleSheet, TextInput,
  TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native'
import { useState } from 'react'
import { router } from 'expo-router'
import { supabase } from '../lib/supabase'
import { C, FONT, RADIUS } from '../lib/theme'

export default function LoginScreen() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  const handleLogin = async () => {
    if (!email || !password) { setError('Please enter your email and password'); return }
    setLoading(true); setError('')
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (err) { setError(err.message); return }
    router.replace('/(tabs)/projects')
  }

  return (
    <KeyboardAvoidingView style={S.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={S.scroll} keyboardShouldPersistTaps="handled">

        {/* Logo */}
        <View style={S.logoWrap}>
          <View style={S.logoIcon}>
            <Text style={S.logoIconText}>S</Text>
          </View>
          <Text style={S.logoText}>SiteIQ</Text>
          <Text style={S.logoSub}>Structural Engineering Inspection</Text>
        </View>

        {/* Card */}
        <View style={S.card}>
          <Text style={S.title}>Welcome back</Text>
          <Text style={S.subtitle}>Sign in to your account</Text>

          <View style={S.field}>
            <Text style={S.label}>Email</Text>
            <TextInput
              style={S.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@firm.com"
              placeholderTextColor={C.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={S.field}>
            <Text style={S.label}>Password</Text>
            <TextInput
              style={S.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={C.textMuted}
              secureTextEntry
            />
          </View>

          <TouchableOpacity onPress={() => router.push('/forgot-password')} style={S.forgotWrap}>
            <Text style={S.forgot}>Forgot password?</Text>
          </TouchableOpacity>

          {error ? <View style={S.errorBox}><Text style={S.errorText}>{error}</Text></View> : null}

          <TouchableOpacity style={S.btn} onPress={handleLogin} disabled={loading} activeOpacity={0.85}>
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={S.btnText}>Sign In</Text>}
          </TouchableOpacity>

          <View style={S.signupRow}>
            <Text style={S.signupText}>Don't have an account? </Text>
            <TouchableOpacity onPress={() => router.push('/signup')}>
              <Text style={S.signupLink}>Sign up</Text>
            </TouchableOpacity>
          </View>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const S = StyleSheet.create({
  container:   { flex: 1, backgroundColor: C.blue },
  scroll:      { flexGrow: 1, justifyContent: 'center', padding: 24 },
  logoWrap:    { alignItems: 'center', marginBottom: 32 },
  logoIcon:    { width: 64, height: 64, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  logoIconText:{ fontSize: 32, fontWeight: '800', color: '#fff' },
  logoText:    { fontSize: 32, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  logoSub:     { fontSize: FONT.sm, color: 'rgba(255,255,255,0.7)', marginTop: 4 },
  card:        { backgroundColor: C.bgCard, borderRadius: RADIUS.xl, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 8 },
  title:       { fontSize: FONT.xl, fontWeight: '700', color: C.textPrimary, marginBottom: 4 },
  subtitle:    { fontSize: FONT.sm, color: C.textSecondary, marginBottom: 24 },
  field:       { marginBottom: 16 },
  label:       { fontSize: FONT.sm, fontWeight: '600', color: C.textPrimary, marginBottom: 6 },
  input:       { backgroundColor: C.bgMuted, borderRadius: RADIUS.md, padding: 14, fontSize: FONT.md, color: C.textPrimary, borderWidth: 1, borderColor: C.border },
  forgotWrap:  { alignItems: 'flex-end', marginBottom: 8, marginTop: -8 },
  forgot:      { fontSize: FONT.sm, color: C.blue, fontWeight: '500' },
  errorBox:    { backgroundColor: C.dangerBg, borderRadius: RADIUS.md, padding: 12, marginBottom: 12 },
  errorText:   { fontSize: FONT.sm, color: C.danger },
  btn:         { backgroundColor: C.blue, borderRadius: RADIUS.md, padding: 16, alignItems: 'center', marginTop: 8 },
  btnText:     { fontSize: FONT.md, fontWeight: '700', color: '#fff' },
  signupRow:   { flexDirection: 'row', justifyContent: 'center', marginTop: 20 },
  signupText:  { fontSize: FONT.sm, color: C.textSecondary },
  signupLink:  { fontSize: FONT.sm, color: C.blue, fontWeight: '600' },
})