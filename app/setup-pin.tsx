import { C } from '../lib/theme'
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

// This screen is shown after first login to let the engineer
// set up Face ID and a backup PIN

export default function SetupPinScreen() {
  const params   = useLocalSearchParams();
  const email    = params.email as string;
  const password = params.password as string;

  // step 1 = create PIN, step 2 = confirm PIN
  const [step, setStep]           = useState<1 | 2>(1);
  const [pin, setPin]             = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError]         = useState('');

  const currentPin = step === 1 ? pin : confirmPin;
  const setCurrentPin = step === 1 ? setPin : setConfirmPin;

  const handlePress = async (digit: string) => {
    if (currentPin.length >= 4) return;
    const newPin = currentPin + digit;
    setCurrentPin(newPin);
    setError('');

    if (newPin.length === 4) {
      if (step === 1) {
        // Move to confirmation step
        setTimeout(() => setStep(2), 200);
      } else {
        // Confirm PIN matches
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

    // Save PIN securely
    await enablePin(email, password, pin);

    // Also enable Face ID if available
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
              error && styles.dotError,
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
  container:  { flex: 1, backgroundColor: C.bgPage, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title:      { fontSize: 26, fontWeight: '700', color: C.textPrimary, marginBottom: 8, textAlign: 'center' },
  subtitle:   { fontSize: 14, color: C.textSecondary, marginBottom: 40, textAlign: 'center', lineHeight: 20 },
  dotsRow:    { flexDirection: 'row', gap: 20, marginBottom: 12 },
  dot:        { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: C.blue, backgroundColor: 'transparent' },
  dotFilled:  { backgroundColor: C.blue, borderColor: C.blue },
  dotError:   { borderColor: C.danger },
  errorText:  { fontSize: 13, color: C.danger, marginBottom: 32, height: 18 },
  keypad:     { width: '80%', gap: 12 },
  keyRow:     { flexDirection: 'row', justifyContent: 'space-between' },
  key:        { width: 72, height: 72, borderRadius: 36, backgroundColor: C.bgCard, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border },
  keyEmpty:   { backgroundColor: 'transparent', borderColor: 'transparent' },
  keyText:    { fontSize: 24, fontWeight: '300', color: C.textPrimary },
  keyDelete:  { fontSize: 20 },
  skipButton: { marginTop: 40 },
  skipText:   { fontSize: 14, color: C.textSecondary },
});