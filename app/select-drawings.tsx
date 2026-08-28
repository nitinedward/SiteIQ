import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { setPendingDrawingSelection } from '../lib/pendingSelection';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../lib/theme';

const T = theme.colors;
const R = theme.radius;

type Drawing = { id: string; title: string; number: string; revision: string };

export default function SelectDrawingsScreen() {
  const { project_id, selected } = useLocalSearchParams();
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [loading, setLoading]   = useState(true);
  const [picked, setPicked]     = useState<string[]>(
    String(selected ?? '').split(',').filter(Boolean)
  );

  const fetchDrawings = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('drawings')
      .select('id,title,number,revision')
      .eq('project_id', String(project_id))
      .order('number', { ascending: true });
    setDrawings((data as Drawing[]) ?? []);
    setLoading(false);
  };

  useFocusEffect(useCallback(() => { fetchDrawings(); }, [project_id]));

  const toggle = (id: string) =>
    setPicked(curr => curr.includes(id) ? curr.filter(x => x !== id) : [...curr, id]);

  const done = () => {
    setPendingDrawingSelection(picked);
    router.back();
  };

  return (
    <View style={S.container}>
      <View style={S.header}>
        <TouchableOpacity style={S.backBtn} onPress={() => router.back()}>
          <Ionicons name="close" size={22} color={T.indigo} />
        </TouchableOpacity>
        <View style={S.headerMid}>
          <Text style={S.headerTitle} numberOfLines={1}>Select Drawings</Text>
          <Text style={S.headerSub}>{picked.length} selected</Text>
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
          ) : drawings.map(d => {
            const sel = picked.includes(d.id);
            return (
              <TouchableOpacity key={d.id} style={[S.row, sel && S.rowActive]}
                onPress={() => toggle(d.id)} activeOpacity={0.7}>
                <View style={[S.checkbox, sel && S.checkboxActive]}>
                  {sel && <Ionicons name="checkmark" size={16} color="#FFFFFF" />}
                </View>
                <View style={S.rowInfo}>
                  <Text style={S.rowTitle} numberOfLines={1}>{d.title}</Text>
                  <Text style={S.rowMeta}>{d.number ? `${d.number} · ` : ''}Rev {d.revision}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
          <View style={{ height: 90 }} />
        </ScrollView>
      )}

      <View style={S.footer}>
        <TouchableOpacity style={S.doneBtn} onPress={done} activeOpacity={0.85}>
          <Text style={S.doneBtnText}>Done{picked.length > 0 ? ` (${picked.length} selected)` : ''}</Text>
        </TouchableOpacity>
      </View>
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
    borderWidth: 1.5, borderColor: T.line,
  },
  rowActive:    { borderColor: T.indigo, backgroundColor: T.indigoSoft },
  checkbox:     { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: T.line, alignItems: 'center', justifyContent: 'center', backgroundColor: T.surface },
  checkboxActive:{ backgroundColor: T.indigo, borderColor: T.indigo },
  rowInfo:      { flex: 1 },
  rowTitle:     { fontSize: 14, fontWeight: '600', color: T.ink, marginBottom: 2 },
  rowMeta:      { fontSize: 12, color: T.mid },
  emptyCard: {
    backgroundColor: T.surface, borderRadius: R.md, padding: 20, alignItems: 'center',
    shadowColor: '#2C3950', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 12, elevation: 1,
  },
  emptyText: { fontSize: 13, color: T.mid, textAlign: 'center' },
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 16, paddingBottom: 32,
    backgroundColor: T.paper, borderTopWidth: 1, borderTopColor: T.line,
  },
  doneBtn: {
    backgroundColor: T.marigold, borderRadius: R.pill, paddingVertical: 15, alignItems: 'center',
    shadowColor: '#E08D0B', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: 6,
  },
  doneBtnText: { fontSize: 15, fontWeight: '700', color: T.indigoDeep },
});
