import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Modal, TextInput,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useLocalSearchParams, router, useFocusEffect } from 'expo-router';
import { useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';

type Project = {
  id: string; name: string; address: string; client_name: string;
  project_number: string; status: 'ACTIVE' | 'ON_HOLD' | 'COMPLETED';
  description: string; drawing_count: number; created_at: string;
};
type Drawing = {
  id: string; title: string; number: string; revision: string;
  file_url: string; created_at: string;
};
type Inspection = {
  id: string; date: string; report_no: string; weather: string;
  site_contact: string; status: string; created_at: string;
};

const statusConfig = {
  ACTIVE:    { colour: '#16A34A', bg: '#F0FDF4', label: 'Active' },
  ON_HOLD:   { colour: '#F59E0B', bg: '#FFFBEB', label: 'On Hold' },
  COMPLETED: { colour: '#2563EB', bg: '#EFF6FF', label: 'Completed' },
};

const fmt = (d: string) => new Date(d).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams();
  const [project, setProject]         = useState<Project | null>(null);
  const [drawings, setDrawings]       = useState<Drawing[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');

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
  };

  useFocusEffect(useCallback(() => { fetchData(); }, [id]));

  if (loading) return <View style={S.centred}><ActivityIndicator size="large" color="#2563EB" /></View>;
  if (error || !project) return <View style={S.centred}><Text style={S.errText}>Project not found</Text><TouchableOpacity onPress={() => router.back()}><Text style={S.link}>Go back</Text></TouchableOpacity></View>;

  const status = statusConfig[project.status];

  return (
    <View style={S.container}>
      {/* Header */}
      <View style={S.header}>
        <TouchableOpacity style={S.backBtn} onPress={() => router.back()}>
          <Text style={S.backArrow}>{'<'}</Text>
        </TouchableOpacity>
        <View style={S.headerMid}>
          <Text style={S.headerTitle} numberOfLines={1}>{project.name}</Text>
          <Text style={S.headerSub}>#{project.project_number}</Text>
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
                  {inspections.length > 0 ? `Last: ${inspections[0].date}` : 'No inspections yet'}
                </Text>
              </View>
              <Text style={S.startArrow}>{'>'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* DRAWINGS */}
        <View style={S.section}>
          <Text style={S.sectionTitle}>Drawings</Text>
          {drawings.length === 0 ? (
            <View style={S.emptyCard}>
              <Text style={S.emptyText}>No drawings - admin uploads via web portal</Text>
            </View>
          ) : drawings.map(d => (
            <TouchableOpacity key={d.id} style={S.row}
              onPress={() => router.push({ pathname: '/drawing/[id]', params: { id: d.id, title: d.title, file_url: d.file_url, project_id: project.id, view_only: 'true' } })}
              activeOpacity={0.7}>
              <View style={S.rowBadge}>
                <Text style={S.rowBadgeText}>{d.number || '-'}</Text>
              </View>
              <View style={S.rowInfo}>
                <Text style={S.rowTitle}>{d.title}</Text>
                <Text style={S.rowMeta}>Rev {d.revision}</Text>
              </View>
              <Text style={S.rowArrow}>{'>'}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* PAST REPORTS */}
        <View style={S.section}>
          <Text style={S.sectionTitle}>Site Reports</Text>
          {inspections.length === 0 ? (
            <View style={S.emptyCard}>
              <Text style={S.emptyText}>No reports yet - start an inspection above</Text>
            </View>
          ) : inspections.map(ins => (
            <TouchableOpacity key={ins.id} style={S.row} activeOpacity={0.7}
              onPress={() => router.push({ pathname: '/report/[id]', params: { id: ins.id, project_name: project.name } })}>
              <View style={S.rowBadge}>
                <Text style={S.rowBadgeText}>#{ins.report_no}</Text>
              </View>
              <View style={S.rowInfo}>
                <Text style={S.rowTitle}>{ins.date}</Text>
                <Text style={S.rowMeta}>{ins.site_contact || 'No contact'} - {ins.weather}</Text>
              </View>
              <Text style={S.rowArrow}>{'>'}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const S = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#F8FAFC' },
  centred:     { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#F8FAFC' },
  errText:     { fontSize: 16, color: '#0F172A' },
  link:        { fontSize: 15, color: '#2563EB', marginTop: 8 },
  scroll:      { flex: 1 },

  // Header
  header:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 60, paddingBottom: 14, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0', gap: 12 },
  backBtn:     { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backArrow:   { fontSize: 24, color: '#2563EB' },
  headerMid:   { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#0F172A' },
  headerSub:   { fontSize: 12, color: '#94A3B8', marginTop: 1 },
  statusPill:  { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusText:  { fontSize: 12, fontWeight: '600' },

  // Hero start button
  heroSection: { padding: 16 },
  startBtn:    { backgroundColor: '#2563EB', borderRadius: 16, padding: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  startLeft:   { gap: 4 },
  startTitle:  { fontSize: 20, fontWeight: '700', color: '#FFFFFF' },
  startSub:    { fontSize: 13, color: 'rgba(255,255,255,0.7)' },
  startArrow:  { fontSize: 28, color: '#FFFFFF' },

  // Sections
  section:     { paddingHorizontal: 16, paddingBottom: 8 },
  sectionTitle:{ fontSize: 12, fontWeight: '700', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10, marginTop: 8 },

  // Rows
  row:         { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#E2E8F0', gap: 12 },
  rowBadge:    { backgroundColor: '#EFF6FF', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minWidth: 48, alignItems: 'center' },
  rowBadgeText:{ fontSize: 11, color: '#2563EB', fontWeight: '700' },
  rowInfo:     { flex: 1 },
  rowTitle:    { fontSize: 14, fontWeight: '600', color: '#0F172A', marginBottom: 2 },
  rowMeta:     { fontSize: 12, color: '#64748B' },
  rowArrow:    { fontSize: 20, color: '#94A3B8' },

  // Empty
  emptyCard:   { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 20, borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center' },
  emptyText:   { fontSize: 13, color: '#94A3B8', textAlign: 'center' },
});