import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';
import { verifyPin, loginWithStoredCredentials } from '../lib/auth';

export default function PinLoginScreen() {
  const [pin, setPin]         = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError]     = useState('');
  const [shake, setShake]     = useState(false);

  const handlePress = async (digit: string) => {
    if (pin.length >= 4) return;
    const newPin = pin + digit;
    setPin(newPin);
    setError('');
    if (newPin.length === 4) await handleVerify(newPin);
  };

  const handleDelete = () => {
    setPin(current => current.slice(0, -1));
    setError('');
  };

  const handleVerify = async (enteredPin: string) => {
    setIsLoading(true);
    const correct = await verifyPin(enteredPin);
    if (!correct) {
      setIsLoading(false);
      setPin('');
      setError('Incorrect PIN');
      return;
    }
    const result = await loginWithStoredCredentials();
    setIsLoading(false);
    if (result.success) router.replace('/(tabs)/projects');
    else { setPin(''); setError('Login failed. Use email instead.'); }
  };

  const keys = [['1','2','3'],['4','5','6'],['7','8','9'],['','0','⌫']];

  return (
    <View style={styles.container}>
      {/* Logo */}
      <View style={styles.top}>
        <View style={styles.logoMark}>
          <Text style={styles.logoMarkText}>S</Text>
        </View>
        <Text style={styles.appName}>SiteIQ</Text>
        <Text style={styles.subtitle}>Enter your PIN to continue</Text>
      </View>

      {/* Dots */}
      <View style={styles.dotsRow}>
        {[0,1,2,3].map(i => (
          <View key={i} style={[
            styles.dot,
            pin.length > i && styles.dotFilled,
            error && styles.dotError,
          ]} />
        ))}
      </View>

      <Text style={styles.errorText}>{error || ' '}</Text>

      {isLoading ? (
        <ActivityIndicator size="large" color="#0EA5E9" style={{ marginTop: 32 }} />
      ) : (
        <View style={styles.keypad}>
          {keys.map((row, ri) => (
            <View key={ri} style={styles.keyRow}>
              {row.map((key, ki) => (
                <TouchableOpacity
                  key={ki}
                  style={[styles.key, key === '' && styles.keyEmpty]}
                  onPress={() => key === '⌫' ? handleDelete() : key !== '' && handlePress(key)}
                  disabled={key === ''}
                  activeOpacity={0.6}
                >
                  <Text style={[styles.keyText, key === '⌫' && styles.keyDelete]}>{key}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}
        </View>
      )}

      <TouchableOpacity style={styles.altLogin} onPress={() => router.replace('/')}>
        <Text style={styles.altLoginText}>Use email & password</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: '#080C14',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40,
  },
  top: { alignItems: 'center', marginBottom: 48 },
  logoMark: {
    width: 56, height: 56, borderRadius: 16, backgroundColor: '#0EA5E9',
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
    shadowColor: '#0EA5E9', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 16, elevation: 10,
  },
  logoMarkText: { fontSize: 28, fontWeight: '900', color: '#FFFFFF' },
  appName: { fontSize: 28, fontWeight: '800', color: '#F8FAFC', letterSpacing: -0.5, marginBottom: 6 },
  subtitle: { fontSize: 14, color: '#475569' },
  dotsRow: { flexDirection: 'row', gap: 18, marginBottom: 10 },
  dot: {
    width: 14, height: 14, borderRadius: 7,
    borderWidth: 2, borderColor: '#1E293B', backgroundColor: 'transparent',
  },
  dotFilled: { backgroundColor: '#0EA5E9', borderColor: '#0EA5E9' },
  dotError: { borderColor: '#F87171' },
  errorText: { fontSize: 13, color: '#F87171', marginBottom: 32, height: 18 },
  keypad: { width: '100%', gap: 14 },
  keyRow: { flexDirection: 'row', justifyContent: 'space-between' },
  key: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: '#0D1520', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#1E293B',
  },
  keyEmpty: { backgroundColor: 'transparent', borderColor: 'transparent' },
  keyText: { fontSize: 26, fontWeight: '300', color: '#F8FAFC' },
  keyDelete: { fontSize: 20, color: '#64748B' },
  altLogin: { marginTop: 40 },
  altLoginText: { fontSize: 14, color: '#334155' },
});
