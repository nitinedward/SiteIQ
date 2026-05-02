import { View, Text, StyleSheet } from 'react-native';

export default function CaptureScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Capture</Text>
      <Text style={styles.subtitle}>
        Camera and voice recording will live here
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A1628',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    color: '#8899AA',
    textAlign: 'center',
  },
});