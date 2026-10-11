import {
  View, Text, StyleSheet, FlatList,
  TouchableOpacity, ActivityIndicator,
  RefreshControl, TextInput,
} from 'react-native'
import { useState, useCallback, useEffect } from 'react'
import { router, useFocusEffect } from 'expo-router'
import { supabase } from '../../lib/supabase'
import { theme } from '../../lib/theme'
import { Ionicons } from '@expo/vector-icons'
import { listProjects, myProfile, projectStats as loadStats } from '../../lib/offline/store'
import { offlineProjects, onOfflineProjectsChange } from '../../lib/offline/download'
import { SyncStatus } from '../../components/SyncStatus'

const T = theme.colors
const R = theme.radius

type Project = {
  id: string; name: string; project_number: string
  address: string; status: string
  inspection_count?: number; last_inspection?: string
}

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
  const [projectStats, setProjectStats] = useState<Record<string, { reports: number; photos: number; drawings: number }>>({})
  const [offline, setOffline] = useState<Set<string>>(new Set())

  // From the phone's copy at once, refreshed from the server behind it
  // when there's signal (lib/offline/store).
  const fetchProjects = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.replace('/'); return }

    const showMe = (me: Awaited<ReturnType<typeof myProfile>>) => {
      setUserName(me?.name?.split(' ')[0] || session.user.email?.split('@')[0] || '')
      setFirmName(me?.firmName ?? '')
    }
    showMe(await myProfile(showMe))

    const show = (rows: any[]) => {
      setProjects(rows as Project[])
      // Card counts, batched for all cards; never holds up the list.
      const ids = rows.map(p => p.id)
      loadStats(ids, setProjectStats).then(setProjectStats).catch(() => {})
    }
    show(await listProjects(show))
    setLoading(false)
    setRefreshing(false)
  }

  const loadOffline = () => offlineProjects().then(rows => setOffline(new Set(rows.map(r => r.project_id)))).catch(() => {})
  useEffect(() => onOfflineProjectsChange(loadOffline), [])

  useFocusEffect(useCallback(() => { fetchProjects(); loadOffline() }, []))

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

        {/* Row 2 — project number, and whether it's kept on the phone */}
        <View style={S.cardNumberRow}>
          <Text style={S.cardNumber}>#{item.project_number}</Text>
          {offline.has(item.id) && (
            <View style={S.offlineTag}>
              <Ionicons name="cloud-done-outline" size={12} color={T.sage} />
              <Text style={S.offlineTagText}>Available offline</Text>
            </View>
          )}
        </View>

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
        <View style={{ marginTop: 10 }}><SyncStatus /></View>
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
        onPress={() => router.push('/project/create')}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={28} color={T.indigoDeep} />
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
  cardNumberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  offlineTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: T.sageSoft,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginTop: 2,
  },
  offlineTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: T.sage,
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
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.marigold,
    // warm marigold glow
    shadowColor: '#E08D0B',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 8,
  },
})
