import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native'
import { useState, useEffect } from 'react'
import { router } from 'expo-router'
import * as LocalAuthentication from 'expo-local-authentication'
import * as SecureStore from 'expo-secure-store'
import { supabase } from '../lib/supabase'
import { theme } from '../lib/theme'

const T = theme.colors
const R = theme.radius

const DIGITS = [['1','2','3'],['4','5','6'],['7','8','9'],['','0','DEL']]

export default function PinLoginScreen() {
  const [pin, setPin]     = useState('')
  const [name, setName]   = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    loadName()
    tryBiometric()
  }, [])

  const loadName = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase.from('firm_members').select('full_name').eq('user_id', user.id).single()
    setName(data?.full_name?.split(' ')[0] ?? '')
  }

  const tryBiometric = async () => {
    const available = await LocalAuthentication.hasHardwareAsync()
    if (!available) return
    const enrolled = await LocalAuthentication.isEnrolledAsync()
    if (!enrolled) return
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Sign in to SiteIQ' })
    if (result.success) router.replace('/(tabs)/projects')
  }

  const handleDigit = (d: string) => {
    if (d === 'DEL') { setPin(p => p.slice(0, -1)); setError(''); return }
    if (d === '') return
    const next = pin + d
    setPin(next)
    if (next.length === 4) verifyPin(next)
  }

  const verifyPin = async (p: string) => {
    const stored = await SecureStore.getItemAsync('stored_pin')
    if (stored === p) {
      router.replace('/(tabs)/projects')
    } else {
      setError('Incorrect PIN')
      setPin('')
    }
  }

  return (
    <View style={S.container}>
      <View style={S.top}>
        <View style={S.avatar}>
          <Text style={S.avatarText}>{name?.[0]?.toUpperCase() ?? '?'}</Text>
        </View>
        <Text style={S.greeting}>Welcome back{name ? `, ${name}` : ''}</Text>
        <Text style={S.sub}>Enter your PIN to continue</Text>
      </View>

      {/* Dots */}
      <View style={S.dots}>
        {[0,1,2,3].map(i => (
          <View key={i} style={[S.dot, pin.length > i && S.dotFilled]} />
        ))}
      </View>

      {error ? <Text style={S.error}>{error}</Text> : null}

      {/* Keypad */}
      <View style={S.keypad}>
        {DIGITS.map((row, ri) => (
          <View key={ri} style={S.row}>
            {row.map((d, di) => (
              <TouchableOpacity
                key={di}
                style={[S.key, d === '' && S.keyEmpty]}
                onPress={() => handleDigit(d)}
                disabled={d === ''}
                activeOpacity={0.7}
              >
                <Text style={[S.keyText, d === 'DEL' && S.keyBackspace]}>{d}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </View>

      <TouchableOpacity onPress={() => tryBiometric()} style={S.bioBtn}>
        <Text style={S.bioBtnText}>Use Face ID / Touch ID</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={async () => { await supabase.auth.signOut(); router.replace('/') }}>
        <Text style={S.signOut}>Sign out</Text>
      </TouchableOpacity>
    </View>
  )
}

const S = StyleSheet.create({
  container:   { flex: 1, backgroundColor: T.paper, alignItems: 'center', justifyContent: 'center', paddingBottom: 40 },
  top:         { alignItems: 'center', marginBottom: 40 },
  avatar:      { width: 72, height: 72, borderRadius: 36, backgroundColor: T.indigo, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  avatarText:  { fontSize: 32, fontWeight: '700', color: '#FFFFFF' },
  greeting:    { fontSize: 22, fontWeight: '700', color: T.ink },
  sub:         { fontSize: 14, color: T.mid, marginTop: 4 },
  dots:        { flexDirection: 'row', gap: 16, marginBottom: 16 },
  dot:         { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: T.indigo, backgroundColor: 'transparent' },
  dotFilled:   { backgroundColor: T.indigo },
  error:       { fontSize: 14, color: T.clay, marginBottom: 16 },
  keypad:      { gap: 12, marginBottom: 32 },
  row:         { flexDirection: 'row', gap: 12 },
  key:         { width: 80, height: 80, borderRadius: 40, backgroundColor: T.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: T.line, shadowColor: '#2C3950', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  keyEmpty:    { backgroundColor: 'transparent', borderColor: 'transparent', shadowOpacity: 0, elevation: 0 },
  keyText:     { fontSize: 28, fontWeight: '400', color: T.ink },
  keyBackspace:{ fontSize: 22, color: T.mid },
  bioBtn:      { backgroundColor: T.indigoSoft, borderRadius: R.pill, paddingHorizontal: 20, paddingVertical: 10, marginBottom: 20 },
  bioBtnText:  { fontSize: 14, color: T.indigo, fontWeight: '600' },
  signOut:     { fontSize: 14, color: T.mid },
})
