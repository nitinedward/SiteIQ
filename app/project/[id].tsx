import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Modal, TextInput,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useLocalSearchParams, router, useFocusEffect } from 'expo-router';
import { useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../../lib/theme';

const T = theme.colors;
const R = theme.radius;

type Project = {
  id: string; name: string; address: string; client_name: string;
  project_number: string; status: 'ACTIVE' | 'ON_HOLD' | 'COMPLETED';
  description: string; drawing_count: number; created_at: string;
};
type Drawing = {
  id: string; title: string; number: string; revision: string;
  file_url: string; preview_url: string | null; created_at: string;
};
type Inspection = {
  id: string; date: string; report_no: string; weather: string;
  site_contact: string; status: string; created_at: string;
};

const statusConfig = {
  ACTIVE:    { colour: '#5B9279', bg: '#E7F0EB', label: 'Active' },
  ON_HOLD:   { colour: '#92400E', bg: '#FEF3C7', label: 'On Hold' },
  COMPLETED: { colour: '#3A4A63', bg: '#EEF1F6', label: 'Completed' },
};

const fmt = (d: string) => new Date(d).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
const DRAWING_PREVIEW_COUNT = 3;
const REPORT_PREVIEW_COUNT = 3;

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const [project, setProject]         = useState<Project | null>(null);
  const [drawings, setDrawings]       = useState<Drawing[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [photoCount, setPhotoCount]   = useState(0);
  const [showAllDrawings, setShowAllDrawings] = useState(false);
  const [showAllReports, setShowAllReports] = useState(false);

  const fetchData = async () => {
    setLoading(true);

    // Clean up orphaned IN_PROGRESS inspections
    const { data: orphans } = await supabase.from('inspections').select('id').eq('project_id', id).eq('status', 'IN_PROGRESS');
    if (orphans?.length) {
      const ids = orphans.map((o: any) => o.id);
      await supabase.from('zones').delete().in('inspection_id', ids);
      await supabase.from('observations').delete().in('inspection_id', ids);
      await supabase.from('inspections').delete().in('id', ids);
    }

    const [{ data: p, error: pe }, { data: d }, { data: ins }] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase.from('drawings').select('*').eq('project_id', id).order('created_at', { ascending: false }),
      supabase.from('inspections').select('*').eq('project_id', id).eq('status', 'COMPLETED').order('created_at', { ascending: false }),
    ]);

    if (pe) { setError('Project not found.'); setLoading(false); return; }
    setProject(p as Project);
    setDrawings(d as Drawing[] ?? []);
    setInspections(ins as Inspection[] ?? []);
    setLoading(false);

    // Additive — total photo count across this project's reports. Best-effort:
    // failure just leaves the stat tile at 0, never blocks the rest of the screen.
    try {
      const inspectionIds = (ins ?? []).map((i: any) => i.id);
      if (inspectionIds.length > 0) {
        const { data: obs } = await supabase.from('observations').select('photos').in('inspection_id', inspectionIds);
        let total = 0;
        (obs ?? []).forEach((o: any) => {
          let arr: string[] = [];
          if (Array.isArray(o.photos)) arr = o.photos;
          else if (typeof o.photos === 'string') { try { arr = JSON.parse(o.photos); } catch { /* ignore */ } }
          total += arr.length;
        });
        setPhotoCount(total);
      } else {
        setPhotoCount(0);
      }
    } catch (err) {
      console.error('[photoCount] error:', err);
    }
  };

  useFocusEffect(useCallback(() => { fetchData(); }, [id]));

  if (loading) return (
    <View style={S.centred}>
      <ActivityIndicator size="large" color={T.indigo} />
    </View>
  );
  if (error || !project) return (
    <View style={S.centred}>
      <Text style={S.errText}>Project not found</Text>
      <TouchableOpacity onPress={() => router.back()}>
        <Text style={S.link}>Go back</Text>
      </TouchableOpacity>
    </View>
  );

  const status = statusConfig[project.status];

  return (
    <View style={S.container}>
      {/* Header */}
      <View style={S.header}>
        <TouchableOpacity style={S.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={T.indigo} />
        </TouchableOpacity>
        <View style={S.headerMid}>
          <Text style={S.headerTitle} numberOfLines={1}>{project.name}</Text>
          <Text style={S.headerSub} numberOfLines={1}>#{project.project_number}{project.address ? ` · ${project.address}` : ''}</Text>
        </View>
        <View style={[S.statusPill, { backgroundColor: status.bg }]}>
          <Text style={[S.statusText, { color: status.colour }]}>{status.label}</Text>
        </View>
      </View>

      <ScrollView style={S.scroll} showsVerticalScrollIndicator={false}>

        {/* START INSPECTION — hero button */}
        {project.status !== 'COMPLETED' && (
          <View style={S.heroSection}>
            <TouchableOpacity style={S.startBtn}
              onPress={() => router.push({ pathname: '/session', params: { project_id: project.id, project_name: project.name } })}
              activeOpacity={0.85}>
              <View style={S.startLeft}>
                <Text style={S.startTitle}>Start Inspection</Text>
                <Text style={S.startSub}>
                  {inspections.length > 0 ? `Last visit ${inspections[0].date}` : 'No inspections yet'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={T.indigoDeep} />
            </TouchableOpacity>
          </View>
        )}

        {/* STATS */}
        <View style={S.statsRow}>
          <View style={S.statTile}>
            <Text style={S.statNum}>{inspections.length}</Text>
            <Text style={S.statLabel}>Reports</Text>
          </View>
          <View style={S.statTile}>
            <Text style={S.statNum}>{photoCount}</Text>
            <Text style={S.statLabel}>Photos</Text>
          </View>
          <View style={S.statTile}>
            <Text style={S.statNum}>{drawings.length}</Text>
            <Text style={S.statLabel}>Drawings</Text>
          </View>
        </View>

        {/* DRAWINGS */}
        <View style={S.section}>
          <View style={S.sectionHeaderRow}>
            <Text style={S.sectionTitleRow}>Drawings</Text>
            {drawings.length > DRAWING_PREVIEW_COUNT && (
              <TouchableOpacity onPress={() => setShowAllDrawings(v => !v)}>
                <Text style={S.viewAllText}>{showAllDrawings ? 'Show less' : 'View all'}</Text>
              </TouchableOpacity>
            )}
          </View>
          {drawings.length === 0 ? (
            <View style={S.emptyCard}>
              <Text style={S.emptyText}>No drawings — admin uploads via web portal</Text>
            </View>
          ) : (showAllDrawings ? drawings : drawings.slice(0, DRAWING_PREVIEW_COUNT)).map(d => (
            <TouchableOpacity key={d.id} style={S.row}
              onPress={() => router.push({ pathname: '/drawing/[id]', params: { id: d.id, title: d.title, file_url: d.file_url, preview_url: d.preview_url ?? '', project_id: project.id, view_only: 'true' } })}
              activeOpacity={0.7}>
              <View style={S.rowBadge}>
                <Text style={S.rowBadgeText}>{d.number || '-'}</Text>
              </View>
              <View style={S.rowInfo}>
                <Text style={S.rowTitle} numberOfLines={1}>{d.title}</Text>
                <Text style={S.rowMeta}>Rev {d.revision}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={T.mid} />
            </TouchableOpacity>
          ))}
        </View>

        {/* PAST REPORTS */}
        <View style={S.section}>
          <View style={S.sectionHeaderRow}>
            <Text style={S.sectionTitleRow}>Site Reports</Text>
            {inspections.length > REPORT_PREVIEW_COUNT && (
              <TouchableOpacity onPress={() => setShowAllReports(v => !v)}>
                <Text style={S.viewAllText}>{showAllReports ? 'Show less' : 'View all'}</Text>
              </TouchableOpacity>
            )}
          </View>
          {inspections.length === 0 ? (
            <View style={S.emptyCard}>
              <Text style={S.emptyText}>No reports yet — start an inspection above</Text>
            </View>
          ) : (showAllReports ? inspections : inspections.slice(0, REPORT_PREVIEW_COUNT)).map(ins => (
            <TouchableOpacity key={ins.id} style={S.row} activeOpacity={0.7}
              onPress={() => router.push({ pathname: '/report/[id]', params: { id: ins.id, project_name: project.name } })}>
              <View style={S.rowBadge}>
                <Text style={S.rowBadgeText}>#{ins.report_no}</Text>
              </View>
              <View style={S.rowInfo}>
                <Text style={S.rowTitle} numberOfLines={1}>{ins.date}</Text>
                <Text style={S.rowMeta}>{ins.site_contact || 'No contact'} · {ins.weather}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={T.mid} />
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Footer nav — matches (tabs) bottom bar */}
      <View style={[S.footer, { paddingBottom: 0.25 + insets.bottom }]}>
        <TouchableOpacity style={S.footerTab} onPress={() => router.push('/(tabs)/projects')} activeOpacity={0.7}>
          <Ionicons name="folder-outline" size={31} color={T.mid} />
          <Text style={S.footerTabLabel}>Projects</Text>
        </TouchableOpacity>
        <TouchableOpacity style={S.footerTab} onPress={() => router.push('/(tabs)/profile')} activeOpacity={0.7}>
          <Ionicons name="person-outline" size={31} color={T.mid} />
          <Text style={S.footerTabLabel}>Profile</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  container:   { flex: 1, backgroundColor: T.paper },
  centred:     { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: T.paper },
  errText:     { fontSize: 16, color: T.ink },
  link:        { fontSize: 15, color: T.indigo, marginTop: 8 },
  scroll:      { flex: 1 },

  // Header
  header:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 60, paddingBottom: 20, backgroundColor: T.paper, borderBottomWidth: 1, borderBottomColor: T.line, gap: 12 },
  backBtn:     {
    width: 50, height: 50, borderRadius: 25,
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.line,
    alignItems: 'center', justifyContent: 'center',
  },
  headerMid:   { flex: 1 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: T.indigo },
  headerSub:   { fontSize: 11, color: T.mid, marginTop: 1 },
  statusPill:  { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusText:  { fontSize: 13, fontWeight: '700' },

  // Hero start button
  heroSection: { padding: 16 },
  startBtn:    {
    backgroundColor: T.marigold,
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: T.marigoldDeep,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.32,
    shadowRadius: 20,
    elevation: 6,
  },
  startLeft:   { gap: 4 },
  startTitle:  { fontSize: 20, fontWeight: '800', color: T.indigoDeep },
  startSub:    { fontSize: 13, color: 'rgba(44,57,80,0.72)' },
  startArrow:  { fontSize: 32, color: T.indigoDeep, lineHeight: 36 },

  // Stats
  statsRow:  { flexDirection: 'row', gap: 12, paddingHorizontal: 24, marginTop: 16, marginBottom: 20 },
  statTile:  {
    flex: 1, backgroundColor: T.surface, borderRadius: 18,
    paddingVertical: 22, paddingHorizontal: 8, alignItems: 'center',
    borderWidth: 1, borderColor: T.line,
  },
  statNum:   { fontSize: 22, fontWeight: '800', color: T.indigo },
  statLabel: { fontSize: 13, color: T.mid, marginTop: 4 },

  // Sections
  section:         { paddingHorizontal: 16, paddingBottom: 8 },
  sectionTitle:    { fontSize: 11, fontWeight: '700', color: T.mid, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10, marginTop: 24 },
  sectionHeaderRow:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, marginTop: 24 },
  sectionTitleRow: { fontSize: 11, fontWeight: '700', color: T.mid, textTransform: 'uppercase', letterSpacing: 1 },
  viewAllText:     { fontSize: 11, fontWeight: '700', color: T.indigo },

  // Rows
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.surface,
    borderRadius: R.md,
    padding: 12,
    marginBottom: 8,
    gap: 12,
    borderWidth: 1,
    borderColor: T.line,
  },
  rowBadge:    { backgroundColor: T.indigoSoft, borderRadius: R.sm, paddingHorizontal: 10, paddingVertical: 6, minWidth: 48, alignItems: 'center' },
  rowBadgeText:{ fontSize: 10, color: T.indigo, fontWeight: '700' },
  rowInfo:     { flex: 1 },
  rowTitle:    { fontSize: 15, fontWeight: '700', color: T.ink, marginBottom: 2 },
  rowMeta:     { fontSize: 11, color: T.mid },
  rowArrow:    { fontSize: 22, color: T.mid },

  // Empty
  emptyCard: {
    backgroundColor: T.surface,
    borderRadius: R.md,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#2C3950',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 1,
  },
  emptyText: { fontSize: 13, color: T.mid, textAlign: 'center' },

  // Footer nav
  footer: {
    flexDirection: 'row',
    backgroundColor: T.surface,
    borderTopWidth: 1,
    borderTopColor: T.line,
    paddingTop: 10,
  },
  footerTab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  footerTabLabel: { fontSize: 10, fontWeight: '700', color: T.mid },
});
