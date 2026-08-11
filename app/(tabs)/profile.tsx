import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native'
import { useState, useCallback } from 'react'
import { router, useFocusEffect } from 'expo-router'
import { supabase } from '../../lib/supabase'
import { theme } from '../../lib/theme'

const T = theme.colors
const R = theme.radius

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

  const isAdmin = profile.role === 'admin'

  return (
    <View style={S.container}>
      <View style={S.header}>
        <Text style={S.headerTitle}>Profile</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={S.scroll}>

        {/* Avatar + identity */}
        <View style={S.heroCard}>
          <View style={S.avatar}>
            <Text style={S.avatarText}>{profile.name?.[0]?.toUpperCase() ?? '?'}</Text>
          </View>
          <Text style={S.name}>{profile.name}</Text>
          <Text style={S.email}>{profile.email}</Text>
          <View style={[S.rolePill, { backgroundColor: isAdmin ? T.indigoSoft : T.sageSoft }]}>
            <Text style={[S.roleText, { color: isAdmin ? T.indigo : T.sage }]}>
              {isAdmin ? 'Admin' : 'Engineer'}
            </Text>
          </View>
        </View>

        {/* Firm */}
        <View style={S.card}>
          <View style={S.cardRow}>
            <Text style={S.cardLabel}>Firm</Text>
            <Text style={S.cardValue}>{profile.firmName}</Text>
          </View>
        </View>

        {/* Menu */}
        <View style={S.card}>
          <TouchableOpacity style={S.menuRow} onPress={() => router.push('/setup-pin')} activeOpacity={0.7}>
            <View style={[S.menuBadge, { backgroundColor: T.indigoSoft }]}>
              <Text style={[S.menuBadgeText, { color: T.indigo }]}>PIN</Text>
            </View>
            <Text style={S.menuLabel}>Change PIN</Text>
            <Text style={S.menuChevron}>›</Text>
          </TouchableOpacity>
          <View style={S.divider} />
          <TouchableOpacity style={S.menuRow} onPress={() => router.push('/firm-settings')} activeOpacity={0.7}>
            <View style={[S.menuBadge, { backgroundColor: T.sageSoft }]}>
              <Text style={[S.menuBadgeText, { color: T.sage }]}>Firm</Text>
            </View>
            <Text style={S.menuLabel}>Firm Settings</Text>
            <Text style={S.menuChevron}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Sign Out */}
        <TouchableOpacity style={S.signOutBtn} onPress={handleSignOut} activeOpacity={0.8}>
          <Text style={S.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        <View style={{ height: 48 }} />
      </ScrollView>
    </View>
  )
}

const S = StyleSheet.create({
  container:    { flex: 1, backgroundColor: T.paper },
  header:       { paddingHorizontal: 24, paddingTop: 64, paddingBottom: 20 },
  headerTitle:  { fontSize: 30, fontWeight: '800', color: T.indigo, letterSpacing: -0.4 },
  scroll:       { padding: 20, gap: 14 },

  heroCard: {
    backgroundColor: T.surface,
    borderRadius: R.md,
    padding: 28,
    alignItems: 'center',
    gap: 6,
    shadowColor: '#2C3950',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 3,
  },
  avatar:     { width: 80, height: 80, borderRadius: 40, backgroundColor: T.indigo, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  avatarText: { fontSize: 34, fontWeight: '800', color: '#FFFFFF' },
  name:       { fontSize: 20, fontWeight: '800', color: T.ink },
  email:      { fontSize: 14, color: T.mid },
  rolePill:   { borderRadius: R.pill, paddingHorizontal: 14, paddingVertical: 5, marginTop: 4 },
  roleText:   { fontSize: 13, fontWeight: '600' },

  card: {
    backgroundColor: T.surface,
    borderRadius: R.md,
    overflow: 'hidden',
    shadowColor: '#2C3950',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 3,
  },
  cardRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 18 },
  cardLabel:  { fontSize: 14, color: T.mid },
  cardValue:  { fontSize: 14, fontWeight: '600', color: T.ink },

  menuRow:      { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14 },
  menuBadge:    { borderRadius: R.sm, paddingHorizontal: 8, paddingVertical: 4 },
  menuBadgeText:{ fontSize: 11, fontWeight: '700' },
  menuLabel:    { flex: 1, fontSize: 15, color: T.ink, fontWeight: '500' },
  menuChevron:  { fontSize: 22, color: T.mid },
  divider:      { height: 1, backgroundColor: T.line, marginHorizontal: 16 },

  signOutBtn: {
    backgroundColor: T.surface,
    borderRadius: R.md,
    padding: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FEE2E2',
    shadowColor: '#2C3950',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 1,
  },
  signOutText: { fontSize: 15, fontWeight: '600', color: T.clay },
})
