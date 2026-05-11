import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, Alert,
} from 'react-native';
import { useState, useCallback } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { getUserFirm } from '../../lib/firm';

type Project = {
  id: string;
  name: string;
  address: string;
  client_name: string;
  project_number: string;
  status: 'ACTIVE' | 'ON_HOLD' | 'COMPLETED';
  drawing_count: number;
  last_inspection: string;
};

type FirmInfo = { id: string; name: string; join_code: string } | null;

const STATUS = {
  ACTIVE:    { colour: '#10B981', bg: '#022C22', dot: '#10B981', label: 'Active' },
  ON_HOLD:   { colour: '#F59E0B', bg: '#2D1B00', dot: '#F59E0B', label: 'On Hold' },
  COMPLETED: { colour: '#0EA5E9', bg: '#082030', dot: '#0EA5E9', label: 'Done' },
};

function ProjectCard({ project, onDelete, isAdmin }: {
  project: Project; onDelete: (p: Project) => void; isAdmin: boolean;
}) {
  const s = STATUS[project.status];
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/project/${project.id}`)}
      onLongPress={() => isAdmin && onDelete(project)}
      activeOpacity={0.85}
    >
      {/* Status bar on left */}
      <View style={[styles.cardAccent, { backgroundColor: s.colour }]} />

      <View style={styles.cardContent}>
        <View style={styles.cardTop}>
          <Text style={styles.cardNumber}>{project.project_number}</Text>
          <View style={[styles.statusPill, { backgroundColor: s.bg }]}>
            <View style={[styles.statusDot, { backgroundColor: s.dot }]} />
            <Text style={[styles.statusText, { color: s.colour }]}>{s.label}</Text>
          </View>
        </View>

        <Text style={styles.cardName} numberOfLines={1}>{project.name}</Text>
        <Text style={styles.cardAddress} numberOfLines={1}>{project.address || 'No address'}</Text>

        <View style={styles.cardDivider} />

        <View style={styles.cardMeta}>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>CLIENT</Text>
            <Text style={styles.metaValue} numberOfLines={1}>{project.client_name || '—'}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>DRAWINGS</Text>
            <Text style={styles.metaValue}>{project.drawing_count ?? 0}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>LAST VISIT</Text>
            <Text style={styles.metaValue}>{project.last_inspection ?? '—'}</Text>
          </View>
        </View>
      </View>

      <Text style={styles.cardChevron}>›</Text>
    </TouchableOpacity>
  );
}

export default function ProjectsScreen() {
  const [searchText, setSearchText] = useState('');
  const [projects, setProjects]     = useState<Project[]>([]);
  const [isLoading, setIsLoading]   = useState(true);
  const [errorMsg, setErrorMsg]     = useState('');
  const [userIsAdmin, setUserIsAdmin] = useState(false);
  const [firm, setFirm]             = useState<FirmInfo>(null);

  const fetchProjects = async () => {
    setIsLoading(true);
    setErrorMsg('');

    const { firm: userFirm, role } = await getUserFirm();
    setFirm(userFirm);
    setUserIsAdmin(role === 'admin');

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setIsLoading(false); return; }

    const { data: memberData } = await supabase
      .from('project_members').select('project_id').eq('user_id', user.id);

    const projectIds = memberData?.map(m => m.project_id) ?? [];
    if (projectIds.length === 0) { setProjects([]); setIsLoading(false); return; }

    const { data, error } = await supabase
      .from('projects').select('*').in('id', projectIds).order('created_at', { ascending: false });

    if (error) setErrorMsg('Could not load projects.');
    else setProjects(data as Project[]);
    setIsLoading(false);
  };

  useFocusEffect(useCallback(() => { fetchProjects(); }, []));

  const handleDelete = (project: Project) => {
    if (!userIsAdmin) return;
    Alert.alert('Delete Project', `Delete "${project.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await supabase.from('projects').delete().eq('id', project.id);
          setProjects(current => current.filter(p => p.id !== project.id));
        },
      },
    ]);
  };

  const filtered = projects.filter(p =>
    p.name?.toLowerCase().includes(searchText.toLowerCase()) ||
    p.address?.toLowerCase().includes(searchText.toLowerCase()) ||
    p.client_name?.toLowerCase().includes(searchText.toLowerCase())
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.firmLabel}>{firm?.name ?? 'SiteIQ'}</Text>
          <Text style={styles.headerTitle}>Projects</Text>
        </View>
        <View style={styles.headerActions}>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{filtered.length}</Text>
          </View>
          {userIsAdmin && (
            <TouchableOpacity style={styles.newBtn} onPress={() => router.push('/project/create')}>
              <Text style={styles.newBtnText}>+ New</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Text style={styles.searchIcon}>⌕</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search projects, clients..."
          placeholderTextColor="#334155"
          value={searchText}
          onChangeText={setSearchText}
          autoCapitalize="none"
        />
        {searchText.length > 0 && (
          <TouchableOpacity onPress={() => setSearchText('')}>
            <Text style={styles.searchClear}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {isLoading && (
        <View style={styles.centred}>
          <ActivityIndicator size="large" color="#0EA5E9" />
          <Text style={styles.loadingText}>Loading projects...</Text>
        </View>
      )}

      {!isLoading && errorMsg !== '' && (
        <View style={styles.centred}>
          <Text style={styles.errorText}>{errorMsg}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={fetchProjects}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {!isLoading && errorMsg === '' && (
        <FlatList
          data={filtered}
          renderItem={({ item }) => (
            <ProjectCard project={item} onDelete={handleDelete} isAdmin={userIsAdmin} />
          )}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyIcon}>📋</Text>
              <Text style={styles.emptyTitle}>
                {userIsAdmin ? 'No projects yet' : 'No projects assigned'}
              </Text>
              <Text style={styles.emptyBody}>
                {userIsAdmin
                  ? 'Tap + New to create your first project'
                  : 'Your admin hasn\'t assigned you to any projects yet'}
              </Text>
              {userIsAdmin && (
                <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push('/project/create')}>
                  <Text style={styles.emptyBtnText}>Create Project</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080C14' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
    paddingHorizontal: 24, paddingTop: 64, paddingBottom: 20,
  },
  firmLabel: { fontSize: 11, color: '#0EA5E9', fontWeight: '700', letterSpacing: 2, marginBottom: 4 },
  headerTitle: { fontSize: 30, fontWeight: '800', color: '#F8FAFC', letterSpacing: -0.5 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  countBadge: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#0D1520', borderWidth: 1, borderColor: '#1E293B',
    alignItems: 'center', justifyContent: 'center',
  },
  countText: { color: '#64748B', fontSize: 14, fontWeight: '600' },
  newBtn: {
    backgroundColor: '#0EA5E9', paddingHorizontal: 16,
    paddingVertical: 9, borderRadius: 10,
    shadowColor: '#0EA5E9', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 6,
  },
  newBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0D1520', marginHorizontal: 24, marginBottom: 16,
    borderRadius: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: '#1E293B',
  },
  searchIcon: { fontSize: 18, color: '#334155', marginRight: 8 },
  searchInput: { flex: 1, paddingVertical: 13, fontSize: 14, color: '#F8FAFC' },
  searchClear: { fontSize: 14, color: '#334155', padding: 4 },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#475569', fontSize: 14 },
  errorText: { color: '#F87171', fontSize: 14, textAlign: 'center' },
  retryBtn: { backgroundColor: '#0D1520', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  retryText: { color: '#0EA5E9', fontSize: 14, fontWeight: '500' },
  list: { paddingHorizontal: 24, paddingBottom: 24, gap: 12 },
  card: {
    backgroundColor: '#0D1520', borderRadius: 16,
    borderWidth: 1, borderColor: '#1E293B',
    flexDirection: 'row', alignItems: 'stretch', overflow: 'hidden',
  },
  cardAccent: { width: 3 },
  cardContent: { flex: 1, padding: 16 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardNumber: { fontSize: 11, color: '#475569', fontWeight: '600', letterSpacing: 1 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: '600' },
  cardName: { fontSize: 17, fontWeight: '700', color: '#F8FAFC', marginBottom: 3 },
  cardAddress: { fontSize: 13, color: '#475569', marginBottom: 12 },
  cardDivider: { height: 1, backgroundColor: '#1E293B', marginBottom: 12 },
  cardMeta: { flexDirection: 'row' },
  metaItem: { flex: 1 },
  metaLabel: { fontSize: 9, color: '#334155', fontWeight: '700', letterSpacing: 1.5, marginBottom: 3 },
  metaValue: { fontSize: 12, color: '#64748B', fontWeight: '500' },
  cardChevron: { fontSize: 22, color: '#1E293B', paddingHorizontal: 12, alignSelf: 'center' },
  emptyWrap: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40, gap: 10 },
  emptyIcon: { fontSize: 44, marginBottom: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#F8FAFC', textAlign: 'center' },
  emptyBody: { fontSize: 14, color: '#475569', textAlign: 'center', lineHeight: 20 },
  emptyBtn: {
    backgroundColor: '#0EA5E9', borderRadius: 12, paddingHorizontal: 24,
    paddingVertical: 12, marginTop: 8,
  },
  emptyBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
