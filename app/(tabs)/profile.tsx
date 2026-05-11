import {
  View, Text, StyleSheet, TouchableOpacity, Alert, Switch, ScrollView,
} from 'react-native';
import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { getUserFirm } from '../../lib/firm';
import { isBiometricAvailable, isBiometricEnabled, disableBiometric } from '../../lib/auth';

export default function ProfileScreen() {
  const [email, setEmail]                           = useState('');
  const [fullName, setFullName]                     = useState('');
  const [firmName, setFirmName]                     = useState('');
  const [role, setRole]                             = useState<'admin' | 'member' | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled]     = useState(false);

  useEffect(() => { loadUser(); checkBiometric(); }, []);

  const loadUser = async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      setEmail(data.user.email ?? '');
      setFullName(data.user.user_metadata?.full_name ?? '');
    }
    const result = await getUserFirm();
    setFirmName(result.firm?.name ?? '');
    setRole(result.role);
  };

  const checkBiometric = async () => {
    setBiometricAvailable(await isBiometricAvailable());
    setBiometricEnabled(await isBiometricEnabled());
  };

  const handleToggleBiometric = async (value: boolean) => {
    if (!value) {
      Alert.alert('Disable Face ID', 'You will need to use email and password to log in.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disable', style: 'destructive', onPress: async () => {
          await disableBiometric(); setBiometricEnabled(false);
        }},
      ]);
    } else {
      Alert.alert('Enable Face ID', 'Log out and log back in to enable Face ID.', [{ text: 'OK' }]);
    }
  };

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: async () => {
        await supabase.auth.signOut(); router.replace('/');
      }},
    ]);
  };

  const initials = fullName
    ? fullName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : email?.[0]?.toUpperCase() ?? '?';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Profile card */}
        <View style={styles.profileCard}>
          <View style={styles.avatarRing}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{fullName || 'Engineer'}</Text>
            <Text style={styles.profileEmail}>{email}</Text>
            <View style={styles.firmBadgeRow}>
              <Text style={styles.firmBadgeName}>{firmName}</Text>
              {role && (
                <View style={[styles.rolePill, role === 'admin' && styles.rolePillAdmin]}>
                  <Text style={[styles.roleText, role === 'admin' && styles.roleTextAdmin]}>
                    {role === 'admin' ? '👑 Admin' : 'Member'}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Settings */}
        <View style={styles.settingsCard}>
          {role === 'admin' && (
            <>
              <TouchableOpacity style={styles.settingRow} onPress={() => router.push('/firm-settings')}>
                <View style={styles.settingLeft}>
                  <View style={[styles.settingIcon, { backgroundColor: '#0F2A3F' }]}>
                    <Text style={styles.settingIconText}>🏢</Text>
                  </View>
                  <View>
                    <Text style={styles.settingLabel}>Firm Settings</Text>
                    <Text style={styles.settingDesc}>Manage engineers and project access</Text>
                  </View>
                </View>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
              <View style={styles.separator} />
            </>
          )}

          {biometricAvailable && (
            <>
              <View style={styles.settingRow}>
                <View style={styles.settingLeft}>
                  <View style={[styles.settingIcon, { backgroundColor: '#0F2A1F' }]}>
                    <Text style={styles.settingIconText}>🔒</Text>
                  </View>
                  <View>
                    <Text style={styles.settingLabel}>Face ID Login</Text>
                    <Text style={styles.settingDesc}>Skip password on next login</Text>
                  </View>
                </View>
                <Switch
                  value={biometricEnabled}
                  onValueChange={handleToggleBiometric}
                  trackColor={{ false: '#1E293B', true: '#0EA5E9' }}
                  thumbColor="#FFFFFF"
                />
              </View>
              <View style={styles.separator} />
            </>
          )}

          <View style={styles.settingRow}>
            <View style={styles.settingLeft}>
              <View style={[styles.settingIcon, { backgroundColor: '#1A1A2E' }]}>
                <Text style={styles.settingIconText}>📱</Text>
              </View>
              <View>
                <Text style={styles.settingLabel}>Version</Text>
                <Text style={styles.settingDesc}>SiteIQ 1.0.0</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080C14' },
  header: { paddingHorizontal: 24, paddingTop: 64, paddingBottom: 24 },
  headerTitle: { fontSize: 30, fontWeight: '800', color: '#F8FAFC', letterSpacing: -0.5 },
  profileCard: {
    marginHorizontal: 24, marginBottom: 20,
    backgroundColor: '#0D1520', borderRadius: 20,
    borderWidth: 1, borderColor: '#1E293B',
    padding: 24, flexDirection: 'row', alignItems: 'center', gap: 16,
  },
  avatarRing: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 2, borderColor: '#0EA5E9',
    alignItems: 'center', justifyContent: 'center',
    padding: 3,
  },
  avatar: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: '#0EA5E9',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 24, fontWeight: '800', color: '#FFFFFF' },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 18, fontWeight: '700', color: '#F8FAFC', marginBottom: 3 },
  profileEmail: { fontSize: 13, color: '#475569', marginBottom: 8 },
  firmBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  firmBadgeName: { fontSize: 13, color: '#64748B', fontWeight: '500' },
  rolePill: { backgroundColor: '#1E293B', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  rolePillAdmin: { backgroundColor: '#0F2A3F' },
  roleText: { fontSize: 11, color: '#64748B', fontWeight: '600' },
  roleTextAdmin: { color: '#38BDF8' },
  settingsCard: {
    marginHorizontal: 24, marginBottom: 16,
    backgroundColor: '#0D1520', borderRadius: 20,
    borderWidth: 1, borderColor: '#1E293B', overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', padding: 16,
  },
  settingLeft: { flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 },
  settingIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  settingIconText: { fontSize: 18 },
  settingLabel: { fontSize: 15, color: '#F8FAFC', fontWeight: '600', marginBottom: 2 },
  settingDesc: { fontSize: 12, color: '#475569' },
  chevron: { fontSize: 22, color: '#334155' },
  separator: { height: 1, backgroundColor: '#1E293B', marginHorizontal: 16 },
  logoutBtn: {
    marginHorizontal: 24, backgroundColor: '#1A0A0A',
    borderRadius: 16, padding: 16, alignItems: 'center',
    borderWidth: 1, borderColor: '#450A0A',
  },
  logoutText: { fontSize: 15, fontWeight: '700', color: '#F87171' },
});
