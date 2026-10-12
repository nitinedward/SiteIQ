import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Image, Modal, Dimensions,
} from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useState, useCallback } from 'react';
import { setPendingDrawingSelection } from '../lib/pendingSelection';
import { latestRevisions, revisionsOf, revisionCount } from '../lib/drawingRevisions';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../lib/theme';
import { loadProjectDocs, sketchSource, type CanItem, type SketchItem, type DrawingRow } from '../lib/projectDocs';
import { listDrawings } from '../lib/offline/store';
import { thumbFor, fullImageFor } from '../lib/thumbs';

const T = theme.colors;
const R = theme.radius;

const GAP = 12;
const PAD = 14;
const CARD_W = (Dimensions.get('window').width - PAD * 2 - GAP) / 2;

type Drawing = DrawingRow;

/** What the magnifier shows full screen. */
type Zoomed = { id: string; title: string; heading: string; image: string | null };

/** One drawing or sketch in the grid: its thumbnail, a tick, and a
 *  magnifier to look at the whole sheet before choosing. */
function Card({ image, heading, title, meta, selected, older, onToggle, onZoom }: {
  image: string | null; heading: string; title: string; meta: string;
  selected: boolean; older?: boolean; onToggle: () => void; onZoom: () => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <View style={{ width: CARD_W }}>
      <TouchableOpacity
        style={[S.card, selected && S.cardOn, older && S.cardOlder]}
        onPress={onToggle}
        activeOpacity={0.8}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={`${heading} ${title}`}
      >
        {image && !failed ? (
          <Image source={{ uri: image }} style={S.thumb} resizeMode="cover" onError={() => setFailed(true)} />
        ) : (
          <View style={[S.thumb, S.thumbEmpty]}>
            <Ionicons name="document-outline" size={28} color={T.line} />
          </View>
        )}
        <View style={S.cardBody}>
          <Text style={S.cardHeading} numberOfLines={1}>{heading}</Text>
          <Text style={S.cardTitle} numberOfLines={2}>{title}</Text>
          <Text style={S.cardMeta} numberOfLines={1}>{meta}</Text>
        </View>
      </TouchableOpacity>
      <View style={[S.tick, selected && S.tickOn]} pointerEvents="none">
        {selected && <Ionicons name="checkmark" size={16} color="#FFFFFF" />}
      </View>
      <TouchableOpacity style={S.zoom} onPress={onZoom} accessibilityLabel={`Look at ${heading}`} hitSlop={6}>
        <Ionicons name="search" size={16} color="#FFFFFF" />
      </TouchableOpacity>
    </View>
  );
}

export default function SelectDrawingsScreen() {
  const { project_id, selected } = useLocalSearchParams();
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  // Sketches (from CANs, or added in the office) are picked here too, to
  // mark up like a drawing — listed apart from the drawings.
  const [sketches, setSketches] = useState<SketchItem[]>([]);
  const [cans, setCans]         = useState<CanItem[]>([]);
  const [loading, setLoading]   = useState(true);
  // Which sheet's older revisions are open, by drawing number.
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [zoomed, setZoomed]     = useState<Zoomed | null>(null);
  const [picked, setPicked]     = useState<string[]>(
    String(selected ?? '').split(',').filter(Boolean)
  );

  // From the phone's copy at once (and offline), refreshed behind it.
  const fetchDrawings = async () => {
    const show = async (rows: DrawingRow[]) => {
      const byNumber = [...rows].sort((a, b) => String(a.number ?? '').localeCompare(String(b.number ?? ''), undefined, { numeric: true }));
      setDrawings(byNumber.filter(r => (r.kind ?? 'drawing') !== 'sketch'));
      try {
        const docs = await loadProjectDocs(String(project_id), rows);
        // A superseded CAN's sketches stay out of the list for new markups.
        const superseded = new Set(docs.cans.filter(c => c.status === 'superseded').map(c => c.id));
        setSketches(docs.sketches.filter(sk => !sk.canId || !superseded.has(sk.canId)));
        setCans(docs.cans);
      } catch (err) {
        console.warn('[select-drawings] sketches:', err);
        setSketches([]);
      }
    };
    await show(await listDrawings(String(project_id), rows => { show(rows); }) as DrawingRow[]);
    setLoading(false);
  };

  useFocusEffect(useCallback(() => { fetchDrawings(); }, [project_id]));

  const toggle = (id: string) =>
    setPicked(curr => curr.includes(id) ? curr.filter(x => x !== id) : [...curr, id]);

  const done = () => {
    setPendingDrawingSelection(picked);
    router.back();
  };

  const zoomIn = (d: Drawing, heading: string, title: string) =>
    setZoomed({ id: d.id, heading, title, image: fullImageFor(d.preview_url) ?? thumbFor(d.preview_url) });

  const zoomedPicked = !!zoomed && picked.includes(zoomed.id);

  return (
    <View style={S.container}>
      <View style={S.header}>
        <TouchableOpacity style={S.backBtn} onPress={() => router.back()} accessibilityLabel="Close">
          <Ionicons name="close" size={22} color={T.indigo} />
        </TouchableOpacity>
        <View style={S.headerMid}>
          <Text style={S.headerTitle} numberOfLines={1}>Select drawings & sketches</Text>
          <Text style={S.headerSub}>{picked.length === 0 ? 'None selected' : `${picked.length} selected`}</Text>
        </View>
      </View>

      {loading ? (
        <View style={S.centred}><ActivityIndicator size="large" color={T.indigo} /></View>
      ) : (
        <ScrollView style={S.scroll} contentContainerStyle={S.list} showsVerticalScrollIndicator={false}>
          <Text style={[S.sectionLabel, { marginTop: 0 }]}>Drawings</Text>
          {drawings.length === 0 ? (
            <View style={S.emptyCard}>
              <Text style={S.emptyText}>No drawings — admin uploads via web portal</Text>
            </View>
          ) : (
            <View style={S.grid}>
              {latestRevisions(drawings).map(d => {
                const count  = revisionCount(drawings, d);
                const older  = revisionsOf(drawings, d).slice(1);
                const isOpen = historyFor === (d.number ?? '').trim();
                const cards  = isOpen ? [d, ...older] : [d];
                return cards.map((rev, i) => (
                  <View key={rev.id} style={{ width: CARD_W }}>
                    <Card
                      image={thumbFor(rev.preview_url)}
                      heading={rev.number || 'Drawing'}
                      title={rev.title}
                      meta={`Rev ${rev.revision}${i > 0 ? ' · superseded' : ''}`}
                      selected={picked.includes(rev.id)}
                      older={i > 0}
                      onToggle={() => toggle(rev.id)}
                      onZoom={() => zoomIn(rev, rev.number || 'Drawing', rev.title)}
                    />
                    {i === 0 && count > 1 && (
                      <TouchableOpacity
                        style={S.revToggle}
                        onPress={() => setHistoryFor(isOpen ? null : (d.number ?? '').trim())}
                        activeOpacity={0.7}
                      >
                        <Text style={S.revToggleText}>
                          {isOpen ? 'Hide older revisions' : `${count - 1} older revision${count - 1 === 1 ? '' : 's'}`}
                        </Text>
                        <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={13} color={T.indigo} />
                      </TouchableOpacity>
                    )}
                  </View>
                ));
              })}
            </View>
          )}

          {/* Always shown, so "none on this project" reads as that rather than as missing. */}
          <Text style={S.sectionLabel}>Sketches</Text>
          {sketches.length === 0 ? (
            <View style={S.emptyCard}>
              <Text style={S.emptyText}>No sketches on this project — they come from CANs and sketches added on the web portal</Text>
            </View>
          ) : (
            <View style={S.grid}>
              {sketches.map(sk => (
                <Card
                  key={sk.drawing.id}
                  image={thumbFor(sk.drawing.preview_url)}
                  heading="Sketch"
                  title={sk.title}
                  meta={sketchSource(sk, cans)}
                  selected={picked.includes(sk.drawing.id)}
                  onToggle={() => toggle(sk.drawing.id)}
                  onZoom={() => zoomIn(sk.drawing, 'Sketch', sk.title)}
                />
              ))}
            </View>
          )}
          <View style={{ height: 110 }} />
        </ScrollView>
      )}

      <View style={S.footer}>
        <TouchableOpacity style={S.doneBtn} onPress={done} activeOpacity={0.85}>
          <Text style={S.doneBtnText}>Done{picked.length > 0 ? ` · ${picked.length} selected` : ''}</Text>
        </TouchableOpacity>
      </View>

      {/* The magnifier: the whole sheet, to check before choosing. */}
      <Modal visible={!!zoomed} animationType="fade" onRequestClose={() => setZoomed(null)}>
        <View style={S.zoomScreen}>
          <View style={S.zoomHeader}>
            <TouchableOpacity style={S.zoomClose} onPress={() => setZoomed(null)} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color="#FFFFFF" />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={S.zoomHeading} numberOfLines={1}>{zoomed?.heading}</Text>
              <Text style={S.zoomTitle} numberOfLines={1}>{zoomed?.title}</Text>
            </View>
          </View>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={S.zoomBody}
            maximumZoomScale={5}
            minimumZoomScale={1}
            centerContent
          >
            {zoomed?.image ? (
              <Image source={{ uri: zoomed.image }} style={S.zoomImage} resizeMode="contain" />
            ) : (
              <Text style={S.zoomNone}>No image for this one — open it with signal.</Text>
            )}
          </ScrollView>
          <View style={S.zoomFooter}>
            <TouchableOpacity
              style={S.zoomAction}
              onPress={() => { if (zoomed && !zoomedPicked) toggle(zoomed.id); setZoomed(null); }}
              activeOpacity={0.85}
            >
              <Text style={S.zoomActionText}>{zoomedPicked ? 'Selected · close' : 'Select this one'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const S = StyleSheet.create({
  container:  { flex: 1, backgroundColor: T.paper },
  centred:    { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 60, paddingBottom: 14, backgroundColor: T.surface, borderBottomWidth: 1, borderBottomColor: T.line, gap: 12 },
  backBtn:    { width: 44, height: 44, borderRadius: 22, backgroundColor: T.paper, alignItems: 'center', justifyContent: 'center' },
  headerMid:  { flex: 1 },
  headerTitle:{ fontSize: 17, fontWeight: '700', color: T.ink },
  headerSub:  { fontSize: 12, color: T.mid, marginTop: 1 },
  scroll:     { flex: 1 },
  list:       { padding: PAD },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: T.mid, textTransform: 'uppercase', letterSpacing: 1, marginTop: 20, marginBottom: 10 },
  grid:       { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },

  card:       { backgroundColor: T.surface, borderRadius: R.md, borderWidth: 2, borderColor: T.line, overflow: 'hidden' },
  cardOn:     { borderColor: T.indigo, backgroundColor: T.indigoSoft },
  cardOlder:  { borderStyle: 'dashed' },
  thumb:      { width: '100%', height: 118, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: T.line },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  cardBody:   { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10 },
  cardHeading:{ fontSize: 13, fontWeight: '800', color: T.indigoDeep },
  cardTitle:  { fontSize: 12, color: T.ink, lineHeight: 16, minHeight: 32 },
  cardMeta:   { fontSize: 11, color: T.mid, marginTop: 3 },
  tick:       { position: 'absolute', top: 8, right: 8, width: 26, height: 26, borderRadius: 13, backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: '#C9CDD4', alignItems: 'center', justifyContent: 'center' },
  tickOn:     { backgroundColor: T.indigo, borderColor: T.indigo },
  zoom:       { position: 'absolute', left: 8, top: 80, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(42,46,55,0.78)', alignItems: 'center', justifyContent: 'center' },

  revToggle:    { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingLeft: 4 },
  revToggleText:{ fontSize: 12, fontWeight: '600', color: T.indigo },

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

  zoomScreen:  { flex: 1, backgroundColor: '#1E222A' },
  zoomHeader:  { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 56, paddingHorizontal: 16, paddingBottom: 12 },
  zoomClose:   { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  zoomHeading: { fontSize: 17, fontWeight: '800', color: '#FFFFFF' },
  zoomTitle:   { fontSize: 12, color: '#C9CDD4' },
  zoomBody:    { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 8 },
  zoomImage:   { width: Dimensions.get('window').width - 16, height: Dimensions.get('window').height * 0.6, backgroundColor: '#FFFFFF', borderRadius: 6 },
  zoomNone:    { color: '#C9CDD4', fontSize: 14 },
  zoomFooter:  { padding: 16, paddingBottom: 36 },
  zoomAction:  { backgroundColor: T.marigold, borderRadius: R.pill, paddingVertical: 16, alignItems: 'center' },
  zoomActionText: { fontSize: 16, fontWeight: '800', color: T.indigoDeep },
});
