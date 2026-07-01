import {
  View, Text, StyleSheet, FlatList,
  TouchableOpacity, ActivityIndicator,
  RefreshControl, TextInput,
} from 'react-native'
import { useState, useCallback } from 'react'
import { router, useFocusEffect } from 'expo-router'
import { supabase } from '../../lib/supabase'
import { getUserFirm } from '../../lib/firm'
import { C, FONT, RADIUS, SHADOW } from '../../lib/theme'

type Project = {
  id: string; name: string; project_number: string
  address: string; status: string
  inspection_count?: number; last_inspection?: string
}

export default function ProjectsScreen() {
  const [projects, setProjects]   = useState<Project[]>([])
  const [loading, setLoading]     = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch]       = useState('')
  const [firmName, setFirmName]   = useState('')

  const fetchProjects = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.replace('/'); return }

    const { firm, role } = await getUserFirm()
    setFirmName(firm?.name ?? '')
    if (!firm) { setLoading(false); setRefreshing(false); return }

    let query = supabase.from('projects').select('*').order('created_at', { ascending: false })

    if (role === 'admin') {
      // Admins see all firm projects
      query = query.eq('firm_id', firm.id)
    } else {
      // Engineers only see projects they're assigned to
      const { data: assignments } = await supabase
        .from('project_members')
        .select('project_id')
        .eq('user_id', user.id)

      const projectIds = (assignments ?? []).map((a: any) => a.project_id)
      if (projectIds.length === 0) {
        setProjects([])
        setLoading(false)
        setRefreshing(false)
        return
      }
      query = query.in('id', projectIds)
    }

    const { data } = await query
    setProjects((data as Project[]) ?? [])
    setLoading(false)
    setRefreshing(false)
  }

  useFocusEffect(useCallback(() => { fetchProjects() }, []))

  const filtered = projects.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.project_number?.toLowerCase().includes(search.toLowerCase())
  )

  const renderProject = ({ item }: { item: Project }) => (
    <TouchableOpacity
      style={S.card}
      onPress={() => router.push({ pathname: '/project/[id]', params: { id: item.id, name: item.name } })}
      activeOpacity={0.7}
    >
      <View style={S.cardLeft}>
        <View style={S.cardIcon}>
          <Text style={S.cardIconText}>🏗</Text>
        </View>
        <View style={S.cardInfo}>
          <Text style={S.cardName} numberOfLines={1}>{item.name}</Text>
          <Text style={S.cardSub}>#{item.project_number}</Text>
          {item.address ? <Text style={S.cardAddress} numberOfLines={1}>{item.address}</Text> : null}
        </View>
      </View>
      <Text style={S.cardArrow}>›</Text>
    </TouchableOpacity>
  )

  return (
    <View style={S.container}>
      {/* Header */}
      <View style={S.header}>
        <View>
          <Text style={S.headerTitle}>Projects</Text>
          <Text style={S.headerSub}>{firmName}</Text>
        </View>
      </View>

      {/* Search */}
      <View style={S.searchWrap}>
        <Text style={S.searchIcon}>🔍</Text>
        <TextInput
          style={S.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search projects..."
          placeholderTextColor={C.textMuted}
        />
      </View>

      {loading ? (
        <View style={S.centred}><ActivityIndicator color={C.blue} size="large" /></View>
      ) : filtered.length === 0 ? (
        <View style={S.centred}>
          <Text style={S.emptyIcon}>🏗</Text>
          <Text style={S.emptyTitle}>{search ? 'No projects found' : 'No projects assigned'}</Text>
          <Text style={S.emptySub}>{search ? 'Try a different search' : 'Ask your admin to assign you to a project'}</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={i => i.id}
          renderItem={renderProject}
          contentContainerStyle={S.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchProjects() }} tintColor={C.blue} />}
        />
      )}
    </View>
  )
}

const S = StyleSheet.create({
  container:    { flex: 1, backgroundColor: C.bgPage },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16, backgroundColor: C.bgCard, borderBottomWidth: 1, borderBottomColor: C.border },
  headerTitle:  { fontSize: FONT.xl, fontWeight: '700', color: C.textPrimary },
  headerSub:    { fontSize: FONT.sm, color: C.textSecondary, marginTop: 2 },
  addBtn:       { backgroundColor: C.blue, borderRadius: RADIUS.md, paddingHorizontal: 16, paddingVertical: 8 },
  addBtnText:   { fontSize: FONT.sm, fontWeight: '700', color: '#fff' },
  searchWrap:   { flexDirection: 'row', alignItems: 'center', margin: 16, backgroundColor: C.bgCard, borderRadius: RADIUS.md, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, gap: 8 },
  searchIcon:   { fontSize: 16 },
  searchInput:  { flex: 1, height: 44, fontSize: FONT.md, color: C.textPrimary },
  list:         { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  card:         { backgroundColor: C.bgCard, borderRadius: RADIUS.lg, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: C.border, ...SHADOW.sm },
  cardLeft:     { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  cardIcon:     { width: 44, height: 44, borderRadius: RADIUS.md, backgroundColor: C.blueLight, alignItems: 'center', justifyContent: 'center' },
  cardIconText: { fontSize: 20 },
  cardInfo:     { flex: 1 },
  cardName:     { fontSize: FONT.md, fontWeight: '600', color: C.textPrimary },
  cardSub:      { fontSize: FONT.xs, color: C.textSecondary, marginTop: 2 },
  cardAddress:  { fontSize: FONT.xs, color: C.textMuted, marginTop: 2 },
  cardArrow:    { fontSize: 22, color: C.textMuted },
  centred:      { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40 },
  emptyIcon:    { fontSize: 48 },
  emptyTitle:   { fontSize: FONT.lg, fontWeight: '700', color: C.textPrimary },
  emptySub:     { fontSize: FONT.sm, color: C.textSecondary, textAlign: 'center' },
  emptyBtn:     { backgroundColor: C.blue, borderRadius: RADIUS.md, paddingHorizontal: 24, paddingVertical: 12, marginTop: 8 },
  emptyBtnText: { fontSize: FONT.md, fontWeight: '700', color: '#fff' },
})