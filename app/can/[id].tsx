import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useState, useCallback } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { theme } from '../../lib/theme';
import { loadProjectDocs, canLabel, sketchViewerParams, type CanItem, type DrawingRow } from '../../lib/projectDocs';

const T = theme.colors;
const R = theme.radius;

const fmt = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * One Consultant Advice Notice on site: its details, the whole notice to
 * read (every page, in the in-app browser's PDF viewer — the drawing viewer
 * shows one page), and the sketches found in it, each opened and checked
 * like a drawing. Marking a sketch up happens from an inspection, where it
 * is picked like any drawing.
 */
export default function CanScreen() {
  const { id, project_id } = useLocalSearchParams<{ id: string; project_id: string }>();
  const [can, setCan] = useState<CanItem | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data: rows } = await supabase.from('drawings').select('*').eq('project_id', String(project_id));
      const docs = await loadProjectDocs(String(project_id), (rows as DrawingRow[]) ?? []);
      setCan(docs.cans.find(c => c.id === id) ?? null);
    } catch (err) {
      console.warn('[can] load failed:', err);
      setCan(null);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, [id, project_id]));

  const openFull = async () => {
    if (!can) return;
    try {
      await WebBrowser.openBrowserAsync(can.fileUrl);
    } catch {
      Alert.alert('Could not open the CAN', 'Check your connection and try again.');
    }
  };

  return (
    <View style={S.container}>
      <View style={S.header}>
        <TouchableOpacity style={S.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={T.indigo} />
        </TouchableOpacity>
        <View style={S.headerMid}>
          <Text style={S.headerTitle} numberOfLines={1}>{can ? canLabel(can) : 'CAN'}</Text>
          {!!can?.title && <Text style={S.headerSub} numberOfLines={1}>{can.title}</Text>}
        </View>
        {can && (
          <View style={[S.statusPill, { backgroundColor: can.status === 'current' ? T.sageSoft : T.indigoSoft }]}>
            <Text style={[S.statusText, { color: can.status === 'current' ? T.sage : T.mid }]}>
              {can.status === 'current' ? 'Current' : 'Superseded'}
            </Text>
          </View>
        )}
      </View>

      {loading ? (
        <View style={S.centred}><ActivityIndicator size="large" color={T.indigo} /></View>
      ) : !can ? (
        <View style={S.centred}>
          <Text style={S.emptyText}>This CAN could not be found.</Text>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={S.body} showsVerticalScrollIndicator={false}>
          <View style={S.card}>
            {!!can.issuedOn && <Text style={S.meta}>Issued {fmt(can.issuedOn)}</Text>}
            <Text style={S.meta}>{can.pageCount} page{can.pageCount === 1 ? '' : 's'}</Text>
            {!!can.summary && <Text style={S.summary}>{can.summary}</Text>}
            {can.status === 'superseded' && (
              <Text style={[S.meta, { color: T.clay, marginTop: 8 }]}>A newer revision of this CAN has been issued.</Text>
            )}
          </View>

          <TouchableOpacity style={S.openBtn} onPress={openFull} activeOpacity={0.85}>
            <Ionicons name="document-text-outline" size={20} color={T.indigoDeep} />
            <Text style={S.openBtnText}>Open full CAN</Text>
          </TouchableOpacity>

          <Text style={S.sectionTitle}>Sketches in this CAN</Text>
          {can.sketches.length === 0 ? (
            <View style={S.emptyCard}>
              <Text style={S.emptyText}>No sketches were taken from this CAN.</Text>
            </View>
          ) : can.sketches.map(sk => (
            <TouchableOpacity key={sk.drawing.id} style={S.row}
              onPress={() => router.push({ pathname: '/drawing/[id]', params: sketchViewerParams(sk, String(project_id)) })}
              activeOpacity={0.7}>
              <View style={S.rowBadge}>
                <Text style={S.rowBadgeText}>p{sk.canPage}</Text>
              </View>
              <View style={S.rowInfo}>
                <Text style={S.rowTitle} numberOfLines={1}>{sk.title}</Text>
                <Text style={S.rowMeta}>Page {sk.canPage} of the CAN</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={T.mid} />
            </TouchableOpacity>
          ))}
          <Text style={S.hint}>To mark up a sketch, start an inspection and select it with the drawings.</Text>
        </ScrollView>
      )}
    </View>
  );
}

const S = StyleSheet.create({
  container:  { flex: 1, backgroundColor: T.paper },
  centred:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 60, paddingBottom: 16, backgroundColor: T.paper, borderBottomWidth: 1, borderBottomColor: T.line, gap: 12 },
  backBtn:    { width: 44, height: 44, borderRadius: 22, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, alignItems: 'center', justifyContent: 'center' },
  headerMid:  { flex: 1 },
  headerTitle:{ fontSize: 19, fontWeight: '800', color: T.indigo },
  headerSub:  { fontSize: 12, color: T.mid, marginTop: 1 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusText: { fontSize: 12, fontWeight: '700' },
  body:       { padding: 16, paddingBottom: 60 },
  card:       { backgroundColor: T.surface, borderRadius: R.md, padding: 14, borderWidth: 1, borderColor: T.line },
  meta:       { fontSize: 12, color: T.mid, marginBottom: 2 },
  summary:    { fontSize: 14, color: T.ink, lineHeight: 20, marginTop: 8 },
  openBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: T.marigold, borderRadius: R.pill, paddingVertical: 15, marginTop: 14 },
  openBtnText:{ fontSize: 15, fontWeight: '800', color: T.indigoDeep },
  sectionTitle:{ fontSize: 11, fontWeight: '700', color: T.mid, textTransform: 'uppercase', letterSpacing: 1, marginTop: 24, marginBottom: 10 },
  row:        { flexDirection: 'row', alignItems: 'center', backgroundColor: T.surface, borderRadius: R.md, padding: 12, marginBottom: 8, gap: 12, borderWidth: 1, borderColor: T.line },
  rowBadge:   { backgroundColor: T.goldSoft, borderRadius: R.sm, paddingHorizontal: 10, paddingVertical: 6, minWidth: 44, alignItems: 'center' },
  rowBadgeText:{ fontSize: 11, color: T.indigo, fontWeight: '700' },
  rowInfo:    { flex: 1 },
  rowTitle:   { fontSize: 15, fontWeight: '700', color: T.ink, marginBottom: 2 },
  rowMeta:    { fontSize: 11, color: T.mid },
  emptyCard:  { backgroundColor: T.surface, borderRadius: R.md, padding: 18, alignItems: 'center', borderWidth: 1, borderColor: T.line },
  emptyText:  { fontSize: 13, color: T.mid, textAlign: 'center' },
  hint:       { fontSize: 12, color: T.mid, marginTop: 10, textAlign: 'center' },
});
