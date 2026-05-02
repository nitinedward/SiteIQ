import { 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  StyleSheet,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator
} from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';

export default function App() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async () => {

    // Step 1 — check fields are not empty
    if (email === '') {
      Alert.alert('Missing Email', 'Please enter your email address.');
      return;
    }

    if (password === '') {
      Alert.alert('Missing Password', 'Please enter your password.');
      return;
    }

    // Step 2 — start loading
    Keyboard.dismiss();
    setIsLoading(true);

    // Step 3 — fake a server delay (1.5 seconds)
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Step 4 — check against mock credentials
    if (email === 'engineer@siteiq.com' && password === 'password123') {
      router.replace('/(tabs)/projects');
    } else {
      Alert.alert('Login Failed', 'Incorrect email or password. Try engineer@siteiq.com / password123');
    }

    // Step 5 — stop loading
    setIsLoading(false);
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <ScrollView 
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >

          <Text style={styles.appName}>SiteIQ</Text>
          <Text style={styles.tagline}>Structural Site Inspections</Text>

          <View style={styles.form}>

            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              placeholder="engineer@yourfirm.com"
              placeholderTextColor="#4A5568"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your password"
              placeholderTextColor="#4A5568"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={true}
            />

            <TouchableOpacity 
  style={[styles.button, isLoading && styles.buttonDisabled]}
  onPress={handleLogin}
  disabled={isLoading}
>
  {isLoading ? (
    <ActivityIndicator color="#FFFFFF" />
  ) : (
    <Text style={styles.buttonText}>Log In</Text>
  )}
</TouchableOpacity>

          </View>

        </ScrollView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A1628',
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  appName: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#FFFFFF',
    letterSpacing: 4,
    marginBottom: 8,
  },
  tagline: {
    fontSize: 14,
    color: '#8899AA',
    marginBottom: 48,
    letterSpacing: 2,
  },
  form: {
    width: '100%',
  },
  label: {
    fontSize: 13,
    color: '#8899AA',
    marginBottom: 6,
    letterSpacing: 1,
  },
  input: {
    backgroundColor: '#1C2E44',
    borderWidth: 1,
    borderColor: '#2A3F55',
    borderRadius: 8,
    padding: 14,
    fontSize: 15,
    color: '#FFFFFF',
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#2563EB',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 1,
  },
  buttonDisabled: {
    backgroundColor: '#1A3A7A',
    opacity: 0.7,
  },
});