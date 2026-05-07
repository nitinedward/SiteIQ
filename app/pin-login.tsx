import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';
import { verifyPin, loginWithStoredCredentials } from '../lib/auth';

// This screen shows when Face ID fails or is skipped
// Engineer enters their 4-digit PIN to log in

export default function PinLoginScreen() {
  const [pin, setPin]           = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // Shake animation state for wrong PIN
  const [error, setError]       = useState('');

  // ── HANDLE NUMBER PRESS ────────────────────────────────
  const handlePress = async (digit: string) => {
    if (pin.length >= 4) return;

    const newPin = pin + digit;
    setPin(newPin);
    setError('');

    // Auto-submit when 4 digits entered
    if (newPin.length === 4) {
      await handleVerify(newPin);
    }
  };

  // ── DELETE LAST DIGIT ──────────────────────────────────
  const handleDelete = () => {
    setPin(current => current.slice(0, -1));
    setError('');
  };

  // ── VERIFY PIN ─────────────────────────────────────────
  const handleVerify = async (enteredPin: string) => {
    setIsLoading(true);

    const correct = await verifyPin(enteredPin);

    if (!correct) {
      setIsLoading(false);
      setPin('');
      setError('Incorrect PIN. Please try again.');
      return;
    }

    // PIN correct — log in with stored credentials
    const result = await loginWithStoredCredentials();
    setIsLoading(false);

    if (result.success) {
      router.replace('/(tabs)/projects');
    } else {
      setPin('');
      setError('Login failed. Please use email and password.');
    }
  };

  // PIN dots display
  const dots = [0, 1, 2, 3];

  // Number pad layout
  const keys = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['', '0', '⌫'],
  ];

  return (
    <View style={styles.container}>

      <Text style={styles.appName}>SiteIQ</Text>
      <Text style={styles.title}>Enter PIN</Text>

      {/* PIN dots */}
      <View style={styles.dotsRow}>
        {dots.map(i => (
          <View
            key={i}
            style={[
              styles.dot,
              pin.length > i && styles.dotFilled,
              error && styles.dotError,
            ]}
          />
        ))}
      </View>

      {/* Error message */}
      {error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : (
        <Text style={styles.errorText}> </Text>
      )}

      {/* Loading spinner while verifying */}
      {isLoading ? (
        <ActivityIndicator size="large" color="#2563EB" style={{ marginTop: 20 }} />
      ) : (
        /* Number pad */
        <View style={styles.keypad}>
          {keys.map((row, rowIndex) => (
            <View key={rowIndex} style={styles.keyRow}>
              {row.map((key, keyIndex) => (
                <TouchableOpacity
                  key={keyIndex}
                  style={[styles.key, key === '' && styles.keyEmpty]}
                  onPress={() => {
                    if (key === '⌫') handleDelete();
                    else if (key !== '') handlePress(key);
                  }}
                  disabled={key === ''}
                  activeOpacity={0.6}
                >
                  <Text style={[styles.keyText, key === '⌫' && styles.keyDelete]}>
                    {key}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}
        </View>
      )}

      {/* Use email/password instead */}
      <TouchableOpacity
        style={styles.emailLogin}
        onPress={() => router.replace('/')}
      >
        <Text style={styles.emailLoginText}>Use email & password instead</Text>
      </TouchableOpacity>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: '#0A1628',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  appName: { fontSize: 32, fontWeight: 'bold', color: '#FFFFFF', letterSpacing: 4, marginBottom: 8 },
  title: { fontSize: 16, color: '#8899AA', marginBottom: 40, letterSpacing: 1 },
  dotsRow: { flexDirection: 'row', gap: 20, marginBottom: 12 },
  dot: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 2, borderColor: '#2A3F55', backgroundColor: 'transparent',
  },
  dotFilled: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  dotError: { borderColor: '#F87171' },
  errorText: { fontSize: 13, color: '#F87171', marginBottom: 32, height: 18 },
  keypad: { width: '80%', gap: 12 },
  keyRow: { flexDirection: 'row', justifyContent: 'space-between' },
  key: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: '#112240', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#1C2E44',
  },
  keyEmpty: { backgroundColor: 'transparent', borderColor: 'transparent' },
  keyText: { fontSize: 24, fontWeight: '300', color: '#FFFFFF' },
  keyDelete: { fontSize: 20 },
  emailLogin: { marginTop: 40 },
  emailLoginText: { fontSize: 14, color: '#4A5568' },
});
