import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native'
import { useState, useCallback } from 'react'
import { router, useFocusEffect } from 'expo-router'
import { supabase } from '../../lib/supabase'

type Profile = { name: string; email: string; role: string; firmName: string }

export default function ProfileScreen() {
  const [profile, setProfile] = useState<Profile | null>(null)

  const load = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: m } = await supabase.from('firm_members').select('full_name, role, firms(name)').eq('user_id', user.id).single()
    const firm = m?.firms as any
    setProfile({ name: m?.full_name ?? '', email: user.email ?? '', role: m?.role ?? '', firmName: firm?.name ?? '' })
  }

  useFocusEffect(useCallback(() => { load() }, []))

  const handleSignOut = () => Alert.alert('Sign Out', 'Are you sure?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Sign Out', style: 'destructive', onPress: async () => { await supabase.auth.signOut(); router.replace('/') } },
  ])

  if (!profile) return <View style={S.container} />

  return (
    <View style={S.container}>
      <View style={S.header}>
        <Text style={S.headerTitle}>Profile</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={S.scroll}>
        <View style={S.avatarSection}>
          <View style={S.avatar}>
            <Text style={S.avatarText}>{profile.name?.[0]?.toUpperCase() ?? '?'}</Text>
          </View>
          <Text style={S.name}>{profile.name}</Text>
          <Text style={S.email}>{profile.email}</Text>
          <View style={S.rolePill}>
            <Text style={S.roleText}>{profile.role === 'admin' ? 'Admin' : 'Engineer'}</Text>
          </View>
        </View>

        <View style={S.card}>
          <View style={S.cardRow}>
            <Text style={S.cardLabel}>Firm</Text>
            <Text style={S.cardValue}>{profile.firmName}</Text>
          </View>
        </View>

        <View style={S.card}>
          <TouchableOpacity style={S.menuRow} onPress={() => router.push('/setup-pin')}>
            <Text style={S.menuIcon}>PIN</Text>
            <Text style={S.menuLabel}>Change PIN</Text>
            <Text style={S.menuArrow}>{'>'}</Text>
          </TouchableOpacity>
          <View style={S.divider} />
          <TouchableOpacity style={S.menuRow} onPress={() => router.push('/firm-settings')}>
            <Text style={S.menuIcon}>Firm</Text>
            <Text style={S.menuLabel}>Firm Settings</Text>
            <Text style={S.menuArrow}>{'>'}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={S.signOutBtn} onPress={handleSignOut} activeOpacity={0.8}>
          <Text style={S.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  )
}

const S = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#F8FAFC' },
  header:        { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  headerTitle:   { fontSize: 20, fontWeight: '700', color: '#0F172A' },
  scroll:        { padding: 16, gap: 12 },
  avatarSection: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 24, alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#E2E8F0' },
  avatar:        { width: 72, height: 72, borderRadius: 36, backgroundColor: '#2563EB', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  avatarText:    { fontSize: 30, fontWeight: '700', color: '#FFFFFF' },
  name:          { fontSize: 18, fontWeight: '700', color: '#0F172A' },
  email:         { fontSize: 14, color: '#64748B' },
  rolePill:      { backgroundColor: '#EFF6FF', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, marginTop: 4 },
  roleText:      { fontSize: 13, color: '#2563EB', fontWeight: '600' },
  card:          { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', overflow: 'hidden' },
  cardRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  cardLabel:     { fontSize: 14, color: '#64748B' },
  cardValue:     { fontSize: 14, fontWeight: '600', color: '#0F172A' },
  menuRow:       { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  menuIcon:      { fontSize: 18, width: 24 },
  menuLabel:     { flex: 1, fontSize: 15, color: '#0F172A' },
  menuArrow:     { fontSize: 20, color: '#94A3B8' },
  divider:       { height: 1, backgroundColor: '#E2E8F0', marginHorizontal: 16 },
  signOutBtn:    { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#FEE2E2' },
  signOutText:   { fontSize: 15, fontWeight: '600', color: '#EF4444' },
})