import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../lib/theme';

const T = theme.colors;
const R = theme.radius;

type Inspection = {
  id: string; date: string; report_no: string; weather: string;
  site_contact: string; status: string; created_at: string;
};

export default function ReportsListScreen() {
  const { project_id, project_name } = useLocalSearchParams();
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [loading, setLoading]         = useState(true);

  const fetchInspections = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('inspections')
      .select('*')
      .eq('project_id', project_id)
      .eq('status', 'COMPLETED')
      .order('created_at', { ascending: false });
    setInspections((data as Inspection[]) ?? []);
    setLoading(false);
  };

  useFocusEffect(useCallback(() => { fetchInspections(); }, [project_id]));

  return (
    <View style={S.container}>
      <View style={S.header}>
        <TouchableOpacity style={S.backBtn} onPress={() => router.back()}>
          <Ionicons name="close" size={22} color={T.indigo} />
        </TouchableOpacity>
        <View style={S.headerMid}>
          <Text style={S.headerTitle} numberOfLines={1}>Site Reports</Text>
          {!!project_name && <Text style={S.headerSub} numberOfLines={1}>{project_name}</Text>}
        </View>
        <View style={{ width: 36 }} />
      </View>

      {loading ? (
        <View style={S.centred}><ActivityIndicator size="large" color={T.indigo} /></View>
      ) : (
        <ScrollView style={S.scroll} contentContainerStyle={S.list} showsVerticalScrollIndicator={false}>
          {inspections.length === 0 ? (
            <View style={S.emptyCard}>
              <Text style={S.emptyText}>No reports yet</Text>
            </View>
          ) : inspections.map(ins => (
            <TouchableOpacity key={ins.id} style={S.row} activeOpacity={0.7}
              onPress={() => router.push({ pathname: '/report/[id]', params: { id: ins.id, project_name: String(project_name ?? '') } })}>
              <View style={S.rowBadge}>
                <Text style={S.rowBadgeText}>#{ins.report_no}</Text>
              </View>
              <View style={S.rowInfo}>
                <Text style={S.rowTitle} numberOfLines={1}>{ins.date}</Text>
                <Text style={S.rowMeta}>{ins.site_contact || 'No contact'} · {ins.weather}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={T.mid} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const S = StyleSheet.create({
  container:  { flex: 1, backgroundColor: T.paper },
  centred:    { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 60, paddingBottom: 14, backgroundColor: T.surface, borderBottomWidth: 1, borderBottomColor: T.line, gap: 12 },
  backBtn:    { width: 36, height: 36, borderRadius: 18, backgroundColor: T.paper, alignItems: 'center', justifyContent: 'center' },
  headerMid:  { flex: 1 },
  headerTitle:{ fontSize: 17, fontWeight: '700', color: T.ink },
  headerSub:  { fontSize: 12, color: T.mid, marginTop: 1 },
  scroll:     { flex: 1 },
  list:       { padding: 16 },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: T.surface,
    borderRadius: R.md, padding: 14, marginBottom: 8, gap: 12,
    shadowColor: '#2C3950', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06, shadowRadius: 12, elevation: 2,
  },
  rowBadge:     { backgroundColor: T.indigoSoft, borderRadius: R.sm, paddingHorizontal: 10, paddingVertical: 6, minWidth: 48, alignItems: 'center' },
  rowBadgeText: { fontSize: 11, color: T.indigo, fontWeight: '700' },
  rowInfo:      { flex: 1 },
  rowTitle:     { fontSize: 14, fontWeight: '600', color: T.ink, marginBottom: 2 },
  rowMeta:      { fontSize: 12, color: T.mid },
  emptyCard: {
    backgroundColor: T.surface, borderRadius: R.md, padding: 20, alignItems: 'center',
    shadowColor: '#2C3950', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 12, elevation: 1,
  },
  emptyText: { fontSize: 13, color: T.mid, textAlign: 'center' },
});
