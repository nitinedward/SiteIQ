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

type Drawing = {
  id: string; title: string; number: string; revision: string;
  file_url: string; preview_url: string | null; created_at: string;
};

export default function DrawingsListScreen() {
  const { project_id, project_name } = useLocalSearchParams();
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [loading, setLoading]   = useState(true);

  const fetchDrawings = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('drawings')
      .select('*')
      .eq('project_id', project_id)
      .order('created_at', { ascending: false });
    setDrawings((data as Drawing[]) ?? []);
    setLoading(false);
  };

  useFocusEffect(useCallback(() => { fetchDrawings(); }, [project_id]));

  return (
    <View style={S.container}>
      <View style={S.header}>
        <TouchableOpacity style={S.backBtn} onPress={() => router.back()}>
          <Ionicons name="close" size={22} color={T.indigo} />
        </TouchableOpacity>
        <View style={S.headerMid}>
          <Text style={S.headerTitle} numberOfLines={1}>Drawings</Text>
          {!!project_name && <Text style={S.headerSub} numberOfLines={1}>{project_name}</Text>}
        </View>
        <View style={{ width: 36 }} />
      </View>

      {loading ? (
        <View style={S.centred}><ActivityIndicator size="large" color={T.indigo} /></View>
      ) : (
        <ScrollView style={S.scroll} contentContainerStyle={S.list} showsVerticalScrollIndicator={false}>
          {drawings.length === 0 ? (
            <View style={S.emptyCard}>
              <Text style={S.emptyText}>No drawings — admin uploads via web portal</Text>
            </View>
          ) : drawings.map(d => (
            <TouchableOpacity key={d.id} style={S.row}
              onPress={() => router.push({ pathname: '/drawing/[id]', params: { id: d.id, title: d.title, number: d.number, file_url: d.file_url, preview_url: d.preview_url ?? '', project_id: String(project_id), view_only: 'true' } })}
              activeOpacity={0.7}>
              <View style={S.rowBadge}>
                <Text style={S.rowBadgeText}>{d.number || '-'}</Text>
              </View>
              <View style={S.rowInfo}>
                <Text style={S.rowTitle} numberOfLines={1}>{d.title}</Text>
                <Text style={S.rowMeta}>Rev {d.revision}</Text>
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
