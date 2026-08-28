import {
  View, Text, StyleSheet, FlatList,
  TouchableOpacity, ActivityIndicator,
  RefreshControl, TextInput,
} from 'react-native'
import { useState, useCallback } from 'react'
import { router, useFocusEffect } from 'expo-router'
import { supabase } from '../../lib/supabase'
import { getUserFirm } from '../../lib/firm'
import { theme } from '../../lib/theme'
import { Ionicons } from '@expo/vector-icons'

const T = theme.colors
const R = theme.radius

type Project = {
  id: string; name: string; project_number: string
  address: string; status: string
  inspection_count?: number; last_inspection?: string
}
type ProjectStats = { reports: number; photos: number; drawings: number }

function statusPill(status: string): { bg: string; text: string; label: string } {
  switch ((status ?? '').toUpperCase()) {
    case 'ACTIVE':    return { bg: T.sageSoft, text: T.sage,         label: 'Active'    }
    case 'DRAFT':     return { bg: T.goldSoft, text: T.marigoldDeep, label: 'Draft'     }
    case 'ON_HOLD':   return { bg: '#EEF0F2',  text: T.mid,          label: 'On Hold'   }
    case 'COMPLETED': return { bg: '#EEF0F2',  text: T.mid,          label: 'Completed' }
    default:          return { bg: '#EEF0F2',  text: T.mid,          label: status ?? '' }
  }
}

export default function ProjectsScreen() {
  const [projects, setProjects]     = useState<Project[]>([])
  const [loading, setLoading]       = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch]         = useState('')
  const [firmName, setFirmName]     = useState('')
  const [userName, setUserName]     = useState('')
  const [projectStats, setProjectStats] = useState<Record<string, ProjectStats>>({})

  // ── Data fetching — identical logic, only added setUserName from existing user object ──
  const fetchProjects = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.replace('/'); return }

    // Pull name from firm_members.full_name — the authoritative source used by all other screens
    const { data: memberName } = await supabase
      .from('firm_members')
      .select('full_name')
      .eq('user_id', user.id)
      .single()
    setUserName(memberName?.full_name?.split(' ')[0] || user.email?.split('@')[0] || '')

    const { firm, role } = await getUserFirm()
    setFirmName(firm?.name ?? '')
    if (!firm) { setLoading(false); setRefreshing(false); return }

    let query = supabase.from('projects').select('*').order('created_at', { ascending: false })

    if (role === 'admin') {
      query = query.eq('firm_id', firm.id)
    } else {
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

    // Additive — card stat counts. Fired without awaiting so it never
    // delays the list; failure just leaves cards without a stats row.
    loadProjectStats((data ?? []).map((p: any) => p.id))
  }

  // Batched (not per-card) so N projects still costs 3 queries total.
  const loadProjectStats = async (projectIds: string[]) => {
    if (projectIds.length === 0) return
    try {
      const { data: inspections } = await supabase
        .from('inspections')
        .select('id, project_id, status')
        .in('project_id', projectIds)
      const inspList = inspections ?? []
      const inspectionToProject = new Map(inspList.map((i: any) => [i.id, i.project_id]))
      const inspectionIds = inspList.map((i: any) => i.id)

      const { data: drawings } = await supabase
        .from('drawings')
        .select('project_id')
        .in('project_id', projectIds)

      const { data: observations } = inspectionIds.length > 0
        ? await supabase.from('observations').select('inspection_id, photos').in('inspection_id', inspectionIds)
        : { data: [] as any[] }

      const stats: Record<string, ProjectStats> = {}
      projectIds.forEach(id => { stats[id] = { reports: 0, photos: 0, drawings: 0 } })

      inspList.forEach((i: any) => {
        if (i.status === 'COMPLETED' && stats[i.project_id]) stats[i.project_id].reports++
      })
      ;(drawings ?? []).forEach((d: any) => {
        if (stats[d.project_id]) stats[d.project_id].drawings++
      })
      ;(observations ?? []).forEach((o: any) => {
        const pid = inspectionToProject.get(o.inspection_id)
        if (!pid || !stats[pid]) return
        let photos: string[] = []
        if (Array.isArray(o.photos)) photos = o.photos
        else if (typeof o.photos === 'string') { try { photos = JSON.parse(o.photos) } catch { /* ignore */ } }
        stats[pid].photos += photos.length
      })

      setProjectStats(stats)
    } catch (err) {
      console.error('[loadProjectStats] error:', err)
    }
  }

  useFocusEffect(useCallback(() => { fetchProjects() }, []))

  const filtered = projects.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.project_number?.toLowerCase().includes(search.toLowerCase())
  )

  // ── Card ──────────────────────────────────────────────────────────────────
  const renderProject = ({ item }: { item: Project }) => {
    const pill = statusPill(item.status)
    const stats = projectStats[item.id] ?? { reports: 0, photos: 0, drawings: 0 }
    return (
      <TouchableOpacity
        style={S.card}
        onPress={() => router.push({ pathname: '/project/[id]', params: { id: item.id, name: item.name } })}
        activeOpacity={0.75}
      >
        {/* Row 1 — name + status pill */}
        <View style={S.cardTopRow}>
          <Text style={S.cardName} numberOfLines={2}>{item.name}</Text>
          <View style={[S.pill, { backgroundColor: pill.bg }]}>
            <Text style={[S.pillText, { color: pill.text }]}>{pill.label}</Text>
          </View>
        </View>

        {/* Row 2 — project number */}
        <Text style={S.cardNumber}>#{item.project_number}</Text>

        {/* Row 3 — address (optional) */}
        {!!item.address && (
          <Text style={S.cardAddress} numberOfLines={1}>{item.address}</Text>
        )}

        {/* Divider + stats */}
        <View style={S.cardDivider} />
        <View style={S.cardStatsRow}>
          <Text style={S.cardStat}><Text style={S.cardStatNum}>{stats.reports}</Text>{'  '}Reports</Text>
          <Text style={S.cardStat}><Text style={S.cardStatNum}>{stats.photos}</Text>{'  '}Photos</Text>
          <Text style={S.cardStat}><Text style={S.cardStatNum}>{stats.drawings}</Text>{'  '}Drawings</Text>
        </View>
      </TouchableOpacity>
    )
  }

  // ── Screen ────────────────────────────────────────────────────────────────
  return (
    <View style={S.root}>

      {/* Header */}
      <View style={S.header}>
        <Text style={S.greeting}>
          {userName ? `Kia ora, ${userName} 👋` : 'Kia ora 👋'}
        </Text>
        <Text style={S.title}>Your Projects</Text>
      </View>

      {/* Search */}
      <View style={S.searchWrap}>
        <View style={S.searchBox}>
          <Text style={S.searchGlyph}>⌕</Text>
          <TextInput
            style={S.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search projects…"
            placeholderTextColor={T.mid}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
      </View>

      {/* Content */}
      {loading ? (
        <View style={S.centred}>
          <ActivityIndicator color={T.indigo} size="large" />
        </View>
      ) : filtered.length === 0 ? (
        <View style={S.centred}>
          <Text style={S.emptyEmoji}>{search ? '🔍' : '📂'}</Text>
          <Text style={S.emptyTitle}>
            {search ? 'No results' : 'No projects yet'}
          </Text>
          <Text style={S.emptySub}>
            {search
              ? 'Try a different search term'
              : 'Ask your admin to assign you to a project'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={i => i.id}
          renderItem={renderProject}
          contentContainerStyle={S.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); fetchProjects() }}
              tintColor={T.indigo}
            />
          }
        />
      )}

      {/* FAB — single marigold accent on this screen */}
      <TouchableOpacity
        style={S.fab}
        onPress={() => router.push('/(tabs)/capture')}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={18} color={T.indigoDeep} />
        <Text style={S.fabText}>New inspection</Text>
      </TouchableOpacity>

    </View>
  )
}

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paper },

  // ── Header ──────────────────────────────────────────────────────────────
  header: {
    paddingHorizontal: 20,
    paddingTop: 64,
    paddingBottom: 16,
  },
  greeting: {
    fontSize: 17,
    fontWeight: '400',
    color: T.mid,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: T.indigo,
    marginTop: 3,
    lineHeight: 36,
  },

  // ── Search ──────────────────────────────────────────────────────────────
  searchWrap: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.surface,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: T.line,
    paddingHorizontal: 14,
    height: 44,
    gap: 8,
  },
  searchGlyph: {
    fontSize: 18,
    color: T.mid,
    marginTop: -1,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: T.ink,
  },

  // ── List ────────────────────────────────────────────────────────────────
  list: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 120,
  },

  // ── Card ────────────────────────────────────────────────────────────────
  card: {
    backgroundColor: T.surface,
    borderRadius: 26,
    padding: 24,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: T.line,
    // soft indigo shadow
    shadowColor: '#2C3950',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.07,
    shadowRadius: 20,
    elevation: 3,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 6,
  },
  cardName: {
    flex: 1,
    fontSize: 21,
    fontWeight: '800',
    color: T.indigo,
    lineHeight: 27,
  },
  pill: {
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
    flexShrink: 0,
  },
  pillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  cardNumber: {
    fontSize: 12,
    color: T.mid,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  cardAddress: {
    fontSize: 12,
    color: T.mid,
    marginTop: 2,
  },
  cardDivider: {
    height: 1,
    backgroundColor: T.line,
    marginTop: 12,
    marginBottom: 12,
  },
  cardStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardStat: {
    fontSize: 13,
    color: T.mid,
  },
  cardStatNum: {
    fontSize: 16,
    fontWeight: '800',
    color: T.ink,
  },

  // ── Empty / loading ──────────────────────────────────────────────────────
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 40,
  },
  emptyEmoji: {
    fontSize: 44,
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: T.ink,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 14,
    color: T.mid,
    textAlign: 'center',
    lineHeight: 20,
  },

  // ── FAB ─────────────────────────────────────────────────────────────────
  fab: {
    position: 'absolute',
    bottom: 78,
    right: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: T.marigold,
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingVertical: 14,
    // warm marigold glow
    shadowColor: '#E08D0B',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 8,
  },
  fabText: {
    fontSize: 14,
    fontWeight: '800',
    color: T.indigoDeep,
  },
})
