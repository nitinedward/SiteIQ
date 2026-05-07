import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { supabase } from '../../lib/supabase';

export default function ProfileScreen() {
  const [email, setEmail] = useState('');

  useEffect(() => {
    const loadUser = async () => {
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        setEmail(data.user.email ?? '');
      }
    };
    loadUser();
  }, []);

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.auth.signOut();
          if (error) {
            Alert.alert('Error', 'Could not log out. Please try again.');
            return;
          }
          router.replace('/');
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {email ? email[0].toUpperCase() : '?'}
          </Text>
        </View>
        <Text style={styles.roleLabel}>Structural Engineer</Text>
        <Text style={styles.emailText}>{email || 'Loading...'}</Text>
      </View>

      <View style={styles.section}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>App</Text>
          <Text style={styles.infoValue}>SiteIQ</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Version</Text>
          <Text style={styles.infoValue}>1.0.0</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>Log Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A1628' },
  header: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 20 },
  headerTitle: { fontSize: 28, fontWeight: 'bold', color: '#FFFFFF' },
  profileCard: {
    alignItems: 'center', backgroundColor: '#112240',
    marginHorizontal: 20, borderRadius: 16, padding: 28,
    borderWidth: 1, borderColor: '#1C2E44', marginBottom: 20,
  },
  avatar: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: '#2563EB',
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  avatarText: { fontSize: 30, fontWeight: 'bold', color: '#FFFFFF' },
  roleLabel: { fontSize: 12, color: '#8899AA', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
  emailText: { fontSize: 16, color: '#FFFFFF', fontWeight: '500' },
  section: {
    backgroundColor: '#112240', marginHorizontal: 20,
    borderRadius: 12, borderWidth: 1, borderColor: '#1C2E44',
    marginBottom: 20, overflow: 'hidden',
  },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  infoLabel: { fontSize: 14, color: '#8899AA' },
  infoValue: { fontSize: 14, color: '#FFFFFF', fontWeight: '500' },
  divider: { height: 1, backgroundColor: '#1C2E44' },
  logoutButton: {
    marginHorizontal: 20, backgroundColor: '#3B1A1A',
    borderRadius: 12, padding: 16, alignItems: 'center',
    borderWidth: 1, borderColor: '#7F1D1D',
  },
  logoutText: { fontSize: 16, fontWeight: '600', color: '#F87171' },
});