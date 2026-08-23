import { theme } from '../lib/theme'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { enableBiometric, enablePin, isBiometricAvailable } from '../lib/auth';

const T = theme.colors;
const R = theme.radius;

export default function SetupPinScreen() {
  const params   = useLocalSearchParams();
  const email    = params.email as string;
  const password = params.password as string;

  const [step, setStep]             = useState<1 | 2>(1);
  const [pin, setPin]               = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError]           = useState('');

  const currentPin = step === 1 ? pin : confirmPin;
  const setCurrentPin = step === 1 ? setPin : setConfirmPin;

  const handlePress = async (digit: string) => {
    if (currentPin.length >= 4) return;
    const newPin = currentPin + digit;
    setCurrentPin(newPin);
    setError('');

    if (newPin.length === 4) {
      if (step === 1) {
        setTimeout(() => setStep(2), 200);
      } else {
        await handleConfirm(newPin);
      }
    }
  };

  const handleDelete = () => {
    setCurrentPin(current => current.slice(0, -1));
    setError('');
  };

  const handleConfirm = async (confirmedPin: string) => {
    if (pin !== confirmedPin) {
      setError("PINs don't match. Try again.");
      setConfirmPin('');
      setStep(1);
      setPin('');
      return;
    }

    await enablePin(email, password, pin);

    const biometricAvailable = await isBiometricAvailable();
    if (biometricAvailable) {
      await enableBiometric(email, password);
    }

    Alert.alert(
      'Setup Complete',
      biometricAvailable
        ? 'Face ID and PIN are now enabled. You can log in with Face ID or your PIN next time.'
        : 'PIN is now enabled. You can log in with your PIN next time.',
      [{ text: 'Continue', onPress: () => router.replace('/(tabs)/projects') }]
    );
  };

  const handleSkip = () => {
    router.replace('/(tabs)/projects');
  };

  const dots = [0, 1, 2, 3];
  const keys = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['', '0', 'DEL'],
  ];

  return (
    <View style={styles.container}>

      <Text style={styles.title}>
        {step === 1 ? 'Set up PIN' : 'Confirm PIN'}
      </Text>
      <Text style={styles.subtitle}>
        {step === 1
          ? 'Choose a 4-digit PIN as a backup to Face ID'
          : 'Enter your PIN again to confirm'}
      </Text>

      {/* PIN dots */}
      <View style={styles.dotsRow}>
        {dots.map(i => (
          <View
            key={i}
            style={[
              styles.dot,
              currentPin.length > i && styles.dotFilled,
              error ? styles.dotError : null,
            ]}
          />
        ))}
      </View>

      {error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : (
        <Text style={styles.errorText}> </Text>
      )}

      {/* Number pad */}
      <View style={styles.keypad}>
        {keys.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.keyRow}>
            {row.map((key, keyIndex) => (
              <TouchableOpacity
                key={keyIndex}
                style={[styles.key, key === '' && styles.keyEmpty]}
                onPress={() => {
                  if (key === 'DEL') handleDelete();
                  else if (key !== '') handlePress(key);
                }}
                disabled={key === ''}
                activeOpacity={0.6}
              >
                <Text style={[styles.keyText, key === 'DEL' && styles.keyDelete]}>
                  {key}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </View>

      <TouchableOpacity style={styles.skipButton} onPress={handleSkip}>
        <Text style={styles.skipText}>Skip for now</Text>
      </TouchableOpacity>

    </View>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: T.paper, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title:      { fontSize: 26, fontWeight: '700', color: T.ink, marginBottom: 8, textAlign: 'center' },
  subtitle:   { fontSize: 14, color: T.mid, marginBottom: 40, textAlign: 'center', lineHeight: 20 },
  dotsRow:    { flexDirection: 'row', gap: 20, marginBottom: 12 },
  dot:        { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: T.indigo, backgroundColor: 'transparent' },
  dotFilled:  { backgroundColor: T.indigo, borderColor: T.indigo },
  dotError:   { borderColor: T.clay },
  errorText:  { fontSize: 13, color: T.clay, marginBottom: 32, height: 18 },
  keypad:     { width: '80%', gap: 12 },
  keyRow:     { flexDirection: 'row', justifyContent: 'space-between' },
  key:        { width: 72, height: 72, borderRadius: 36, backgroundColor: T.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: T.line, shadowColor: '#2C3950', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  keyEmpty:   { backgroundColor: 'transparent', borderColor: 'transparent', shadowOpacity: 0, elevation: 0 },
  keyText:    { fontSize: 24, fontWeight: '300', color: T.ink },
  keyDelete:  { fontSize: 20, color: T.mid },
  skipButton: { marginTop: 40 },
  skipText:   { fontSize: 14, color: T.mid },
});
