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

const T = theme.colors
const R = theme.radius

type Project = {
  id: string; name: string; project_number: string
  address: string; status: string
  inspection_count?: number; last_inspection?: string
}

function statusPill(status: string): { bg: string; text: string; label: string } {
  switch ((status ?? '').toUpperCase()) {
    case 'ACTIVE':    return { bg: T.sageSoft,   text: T.sage,         label: 'Active'    }
    case 'ON_HOLD':   return { bg: '#FEF3C7',    text: '#92400E',      label: 'On Hold'   }
    case 'COMPLETED': return { bg: T.indigoSoft, text: T.indigo,       label: 'Completed' }
    default:          return { bg: T.indigoSoft, text: T.indigo,       label: status ?? '' }
  }
}

export default function ProjectsScreen() {
  const [projects, setProjects]     = useState<Project[]>([])
  const [loading, setLoading]       = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch]         = useState('')
  const [firmName, setFirmName]     = useState('')
  const [userName, setUserName]     = useState('')

  // ── Data fetching — identical logic, only added setUserName from existing user object ──
  const fetchProjects = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.replace('/'); return }

    // Derive first name from already-fetched auth object — no new network call
    const meta = (user.user_metadata ?? {}) as Record<string, string>
    const fullName = meta.full_name ?? meta.name ?? ''
    setUserName(fullName.split(' ')[0] || user.email?.split('@')[0] || '')

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
  }

  useFocusEffect(useCallback(() => { fetchProjects() }, []))

  const filtered = projects.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.project_number?.toLowerCase().includes(search.toLowerCase())
  )

  // ── Card ──────────────────────────────────────────────────────────────────
  const renderProject = ({ item }: { item: Project }) => {
    const pill = statusPill(item.status)
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

        {/* Divider + footer */}
        <View style={S.cardDivider} />
        <View style={S.cardFooter}>
          <Text style={S.cardFooterLabel}>View project</Text>
          <Text style={S.cardChevron}>›</Text>
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
        {!!firmName && <Text style={S.firmLabel}>{firmName}</Text>}
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
        <Text style={S.fabText}>＋  New inspection</Text>
      </TouchableOpacity>

    </View>
  )
}

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paper },

  // ── Header ──────────────────────────────────────────────────────────────
  header: {
    paddingHorizontal: 24,
    paddingTop: 64,
    paddingBottom: 20,
  },
  greeting: {
    fontSize: 14,
    fontWeight: '500',
    color: T.mid,
    marginBottom: 6,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: T.indigo,
    letterSpacing: -0.4,
    lineHeight: 36,
  },
  firmLabel: {
    marginTop: 6,
    fontSize: 13,
    color: T.mid,
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
    paddingBottom: 100,
    gap: 12,
  },

  // ── Card ────────────────────────────────────────────────────────────────
  card: {
    backgroundColor: T.surface,
    borderRadius: R.md,       // 18
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 14,
    // soft indigo shadow
    shadowColor: '#2C3950',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
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
    fontSize: 16,
    fontWeight: '700',
    color: T.ink,
    lineHeight: 22,
  },
  pill: {
    borderRadius: R.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
    flexShrink: 0,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  cardNumber: {
    fontSize: 13,
    color: T.mid,
    marginBottom: 4,
  },
  cardAddress: {
    fontSize: 12,
    color: T.mid,
    marginBottom: 4,
  },
  cardDivider: {
    height: 1,
    backgroundColor: T.line,
    marginTop: 12,
    marginBottom: 10,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  cardFooterLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: T.indigo,
  },
  cardChevron: {
    fontSize: 20,
    color: T.indigo,
    marginLeft: 2,
    lineHeight: 20,
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
    bottom: 24,
    right: 20,
    backgroundColor: T.marigold,
    borderRadius: R.pill,
    paddingHorizontal: 22,
    paddingVertical: 14,
    // warm marigold glow
    shadowColor: '#E08D0B',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.42,
    shadowRadius: 26,
    elevation: 8,
  },
  fabText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
})
