import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Modal, TextInput,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useLocalSearchParams, router, useFocusEffect } from 'expo-router';
import { useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { Ionicons } from '@expo/vector-icons';
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

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams();
  const [project, setProject]         = useState<Project | null>(null);
  const [drawings, setDrawings]       = useState<Drawing[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [photoCount, setPhotoCount]   = useState(0);

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
          <Ionicons name="arrow-back" size={18} color={T.indigo} />
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
          <Text style={S.sectionTitle}>Drawings</Text>
          {drawings.length === 0 ? (
            <View style={S.emptyCard}>
              <Text style={S.emptyText}>No drawings — admin uploads via web portal</Text>
            </View>
          ) : (
            <TouchableOpacity style={S.row}
              onPress={() => router.push({ pathname: '/drawings', params: { project_id: project.id, project_name: project.name } })}
              activeOpacity={0.7}>
              <View style={S.rowBadge}>
                <Text style={S.rowBadgeText}>{drawings.length}</Text>
              </View>
              <View style={S.rowInfo}>
                <Text style={S.rowTitle}>{drawings.length === 1 ? '1 Drawing' : `${drawings.length} Drawings`}</Text>
                <Text style={S.rowMeta}>Tap to view all</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={T.mid} />
            </TouchableOpacity>
          )}
        </View>

        {/* PAST REPORTS */}
        <View style={S.section}>
          <Text style={S.sectionTitle}>Site Reports</Text>
          {inspections.length === 0 ? (
            <View style={S.emptyCard}>
              <Text style={S.emptyText}>No reports yet — start an inspection above</Text>
            </View>
          ) : (
            <TouchableOpacity style={S.row}
              onPress={() => router.push({ pathname: '/reports', params: { project_id: project.id, project_name: project.name } })}
              activeOpacity={0.7}>
              <View style={S.rowBadge}>
                <Text style={S.rowBadgeText}>{inspections.length}</Text>
              </View>
              <View style={S.rowInfo}>
                <Text style={S.rowTitle}>{inspections.length === 1 ? '1 Report' : `${inspections.length} Reports`}</Text>
                <Text style={S.rowMeta}>Tap to view all</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={T.mid} />
            </TouchableOpacity>
          )}
        </View>

        <View style={{ height: 48 }} />
      </ScrollView>
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
  header:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 60, paddingBottom: 12, backgroundColor: T.surface, borderBottomWidth: 1, borderBottomColor: T.line, gap: 12 },
  backBtn:     {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.line,
    alignItems: 'center', justifyContent: 'center',
  },
  headerMid:   { flex: 1 },
  headerTitle: { fontSize: 15, fontWeight: '800', color: T.indigo },
  headerSub:   { fontSize: 11, color: T.mid, marginTop: 1 },
  statusPill:  { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusText:  { fontSize: 10, fontWeight: '700' },

  // Hero start button
  heroSection: { padding: 16 },
  startBtn:    {
    backgroundColor: T.marigold,
    borderRadius: 22,
    paddingHorizontal: 20,
    paddingVertical: 16,
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
  startTitle:  { fontSize: 16, fontWeight: '800', color: T.indigoDeep },
  startSub:    { fontSize: 12, color: 'rgba(44,57,80,0.72)' },
  startArrow:  { fontSize: 32, color: T.indigoDeep, lineHeight: 36 },

  // Stats
  statsRow:  { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 16, marginBottom: 20 },
  statTile:  {
    flex: 1, backgroundColor: T.surface, borderRadius: 18,
    paddingVertical: 12, paddingHorizontal: 12, alignItems: 'center',
    borderWidth: 1, borderColor: T.line,
  },
  statNum:   { fontSize: 18, fontWeight: '800', color: T.indigo },
  statLabel: { fontSize: 11, color: T.mid, marginTop: 4 },

  // Sections
  section:      { paddingHorizontal: 16, paddingBottom: 8 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: T.mid, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10, marginTop: 24 },

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
  rowTitle:    { fontSize: 13, fontWeight: '700', color: T.ink, marginBottom: 2 },
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
});
