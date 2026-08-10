import {
  View, Text, StyleSheet, TextInput,
  TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native'
import { useState } from 'react'
import { router } from 'expo-router'
import { supabase } from '../lib/supabase'
import { theme } from '../lib/theme'

const T = theme.colors
const R = theme.radius

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
    <KeyboardAvoidingView style={S.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={S.scroll} keyboardShouldPersistTaps="handled">

        {/* Logo */}
        <View style={S.logoBlock}>
          <View style={S.logoMark}>
            <Text style={S.logoLetter}>S</Text>
          </View>
          <Text style={S.wordmark}>SiteIQ</Text>
          <Text style={S.tagline}>Structural inspection, simplified</Text>
        </View>

        {/* Form */}
        <View style={S.form}>

          <View style={S.field}>
            <Text style={S.label}>Email</Text>
            <TextInput
              style={S.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@firm.com"
              placeholderTextColor={T.mid}
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
              placeholder="Password"
              placeholderTextColor={T.mid}
              secureTextEntry
            />
          </View>

          <TouchableOpacity onPress={() => router.push('/forgot-password')} style={S.forgotWrap}>
            <Text style={S.forgot}>Forgot password?</Text>
          </TouchableOpacity>

          {error ? (
            <View style={S.errorBox}>
              <Text style={S.errorText}>{error}</Text>
            </View>
          ) : null}

          <TouchableOpacity style={S.signInBtn} onPress={handleLogin} disabled={loading} activeOpacity={0.85}>
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={S.signInText}>Sign in</Text>}
          </TouchableOpacity>

          <View style={S.signupRow}>
            <Text style={S.signupText}>New to SiteIQ? </Text>
            <TouchableOpacity onPress={() => router.push('/signup')}>
              <Text style={S.signupLink}>Create an account</Text>
            </TouchableOpacity>
          </View>

        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const S = StyleSheet.create({
  root:       { flex: 1, backgroundColor: T.paper },
  scroll:     { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 48 },

  // Logo block
  logoBlock:  { alignItems: 'center', marginBottom: 44 },
  logoMark:   {
    width: 72, height: 72, borderRadius: 20,
    backgroundColor: T.marigold,
    alignItems: 'center', justifyContent: 'center', marginBottom: 18,
    shadowColor: T.marigoldDeep,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.32,
    shadowRadius: 20,
    elevation: 6,
  },
  logoLetter: { fontSize: 36, fontWeight: '800', color: '#FFFFFF' },
  wordmark:   { fontSize: 32, fontWeight: '800', color: T.indigo, letterSpacing: -0.5 },
  tagline:    { fontSize: 14, color: T.mid, marginTop: 6 },

  // Form fields
  form:       { gap: 0 },
  field:      { marginBottom: 16 },
  label:      { fontSize: 13, fontWeight: '700', color: T.mid, marginBottom: 6 },
  input:      {
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.line,
    borderRadius: 14,
    height: 52,
    paddingHorizontal: 16,
    fontSize: 15,
    color: T.ink,
  },

  forgotWrap: { alignItems: 'flex-end', marginBottom: 8, marginTop: -4 },
  forgot:     { fontSize: 13, color: T.indigo, fontWeight: '500' },

  errorBox:   { backgroundColor: '#FFF1F2', borderRadius: 12, padding: 12, marginBottom: 12 },
  errorText:  { fontSize: 13, color: '#C0392B' },

  signInBtn:  {
    backgroundColor: T.indigo,
    borderRadius: R.pill,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    shadowColor: T.indigoDeep,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 20,
    elevation: 4,
  },
  signInText: { fontSize: 16, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.2 },

  signupRow:  { flexDirection: 'row', justifyContent: 'center', marginTop: 24 },
  signupText: { fontSize: 14, color: T.mid },
  signupLink: { fontSize: 14, color: T.indigo, fontWeight: '600' },
})
