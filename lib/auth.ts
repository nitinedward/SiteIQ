import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { supabase } from './supabase';

const BIOMETRIC_ENABLED_KEY = 'biometric_enabled';
const PIN_ENABLED_KEY       = 'pin_enabled';
const STORED_EMAIL_KEY      = 'stored_email';
const STORED_PASSWORD_KEY   = 'stored_password';
const STORED_PIN_KEY        = 'stored_pin';

// ── CHECK IF FACE ID IS AVAILABLE ON THIS DEVICE ───────
export const isBiometricAvailable = async (): Promise<boolean> => {
  const compatible = await LocalAuthentication.hasHardwareAsync();
  if (!compatible) return false;
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  return enrolled;
};

// ── CHECK IF ENGINEER HAS ENABLED FACE ID ──────────────
export const isBiometricEnabled = async (): Promise<boolean> => {
  const value = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
  return value === 'true';
};

// ── CHECK IF ENGINEER HAS SET A PIN ────────────────────
export const isPinEnabled = async (): Promise<boolean> => {
  const value = await SecureStore.getItemAsync(PIN_ENABLED_KEY);
  return value === 'true';
};

// ── ENABLE FACE ID AND/OR PIN ──────────────────────────
// Saves credentials and PIN securely on the device
export const enableBiometric = async (email: string, password: string): Promise<void> => {
  await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, 'true');
  await SecureStore.setItemAsync(STORED_EMAIL_KEY, email);
  await SecureStore.setItemAsync(STORED_PASSWORD_KEY, password);
};

export const enablePin = async (email: string, password: string, pin: string): Promise<void> => {
  await SecureStore.setItemAsync(PIN_ENABLED_KEY, 'true');
  await SecureStore.setItemAsync(STORED_EMAIL_KEY, email);
  await SecureStore.setItemAsync(STORED_PASSWORD_KEY, password);
  // Store the PIN as a hash — never store PINs as plain text
  // For simplicity we store it directly here but in production
  // you would hash it first
  await SecureStore.setItemAsync(STORED_PIN_KEY, pin);
};

// ── VERIFY PIN ─────────────────────────────────────────
// Returns true if the entered PIN matches the stored one
export const verifyPin = async (enteredPin: string): Promise<boolean> => {
  const storedPin = await SecureStore.getItemAsync(STORED_PIN_KEY);
  return storedPin === enteredPin;
};

// ── DISABLE ALL BIOMETRIC/PIN ──────────────────────────
export const disableBiometric = async (): Promise<void> => {
  await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY);
  await SecureStore.deleteItemAsync(PIN_ENABLED_KEY);
  await SecureStore.deleteItemAsync(STORED_EMAIL_KEY);
  await SecureStore.deleteItemAsync(STORED_PASSWORD_KEY);
  await SecureStore.deleteItemAsync(STORED_PIN_KEY);
};

// ── LOGIN WITH STORED CREDENTIALS ─────────────────────
// Used after Face ID or PIN succeeds to create a Supabase session
export const loginWithStoredCredentials = async (): Promise<{
  success: boolean;
  error?: string;
}> => {
  const email    = await SecureStore.getItemAsync(STORED_EMAIL_KEY);
  const password = await SecureStore.getItemAsync(STORED_PASSWORD_KEY);

  if (!email || !password) {
    return { success: false, error: 'No stored credentials found' };
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { success: false, error: error.message };
  return { success: true };
};

// ── AUTHENTICATE WITH FACE ID ──────────────────────────
export const authenticateWithBiometric = async (): Promise<{
  success: boolean;
  cancelled?: boolean;
  error?: string;
}> => {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Log in to SiteIQ',
      fallbackLabel: 'Use PIN instead',
      // We handle PIN ourselves so disable system fallback
      disableDeviceFallback: true,
    });

    if (!result.success) {
      return { success: false, cancelled: true };
    }

    return await loginWithStoredCredentials();
  } catch (err) {
    return { success: false, error: 'Biometric authentication failed' };
  }
};