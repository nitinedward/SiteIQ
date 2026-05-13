import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Modal,
  TextInput,
  ScrollView,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useState, useCallback } from 'react';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { supabase } from '../../lib/supabase';
import Pdf from 'react-native-pdf';
import Svg, { Circle, Rect, Path, G } from 'react-native-svg';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

type MarkupType = 'pin' | 'rectangle' | 'freehand';
type Tool = 'pin' | 'rectangle' | 'freehand';

type Zone = {
  id: string;
  label: string;
  x_percent: number;
  y_percent: number;
  markup_type: MarkupType;
  shape_data: string | null;
};

type Point = { x: number; y: number };

function ToolBtn({ icon, label, active, onPress }: {
  icon: string; label: string; active: boolean; onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.toolBtn, active && styles.toolBtnActive]}
      onPress={onPress}
    >
      <Text style={styles.toolBtnIcon}>{icon}</Text>
      <Text style={[styles.toolBtnLabel, active && styles.toolBtnLabelActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function DrawingViewerScreen() {
  const params       = useLocalSearchParams();
  const drawingId    = params.id as string;
  const title        = params.title as string;
  const fileUrl      = params.file_url as string;
  const projectId    = params.project_id as string;
  const inspectionId = params.inspection_id as string;
  const viewOnly     = params.view_only === 'true';

  const [zones, setZones]         = useState<Zone[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pdfError, setPdfError]   = useState('');
  const [showPdf, setShowPdf]     = useState(false);
  const [activeTool, setActiveTool] = useState<Tool>('pin');

  const [showModal, setShowModal]     = useState(false);
  const [newLabel, setNewLabel]       = useState('');
  const [pendingZone, setPendingZone] = useState<Partial<Zone> | null>(null);

  const [pdfPageSize, setPdfPageSize] = useState({ width: 1, height: 1 });

  const encodedUrl = encodeURI(decodeURIComponent(fileUrl));

  const fetchZones = async () => {
    if (!inspectionId) { setZones([]); return; }
    const { data } = await supabase
      .from('zones')
      .select('*')
      .eq('drawing_id', drawingId)
      .eq('inspection_id', inspectionId)
      .order('created_at', { ascending: true });
    setZones((data as Zone[]) ?? []);
  };

  useFocusEffect(useCallback(() => { fetchZones(); }, [drawingId, inspectionId]));

  // Pin tap - react-native-pdf gives PDF page coordinates
  const handlePdfTap = (page: number, x: number, y: number) => {
    if (viewOnly || activeTool !== 'pin') return;
    const xPct = Math.max(0, Math.min(100, (x / pdfPageSize.width) * 100));
    const yPct = Math.max(0, Math.min(100, (y / pdfPageSize.height) * 100));
    setPendingZone({ markup_type: 'pin', x_percent: xPct, y_percent: yPct, shape_data: null });
    setNewLabel('');
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!newLabel.trim()) { Alert.alert('Missing Label', 'Please enter a zone name.'); return; }
    if (!pendingZone) return;
    const { error } = await supabase.from('zones').insert({
      drawing_id:    drawingId,
      project_id:    projectId,
      inspection_id: inspectionId || null,
      label:         newLabel.trim(),
      x_percent:     pendingZone.x_percent ?? 0,
      y_percent:     pendingZone.y_percent ?? 0,
      markup_type:   pendingZone.markup_type ?? 'pin',
      shape_data:    pendingZone.shape_data ?? null,
    });
    if (error) { Alert.alert('Error', 'Could not save zone.'); return; }
    setNewLabel('');
    setShowModal(false);
    setPendingZone(null);
    fetchZones();
  };

  const handleTapZone = (zone: Zone) => {
    Alert.alert(zone.label, 'What would you like to do?', [
      {
        text: 'Add Observation',
        onPress: () => router.push({
          pathname: '/observation',
          params: { zone_id: zone.id, zone_label: zone.label, project_id: projectId, inspection_id: inspectionId || '' },
        }),
      },
      ...(!viewOnly ? [{
        text: 'Delete Zone', style: 'destructive' as const,
        onPress: async () => {
          await supabase.from('zones').delete().eq('id', zone.id);
          setZones(c => c.filter(z => z.id !== zone.id));
        },
      }] : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
        <TouchableOpacity
          style={styles.toggleBtn}
          onPress={() => { setIsLoading(true); setPdfError(''); setShowPdf(v => !v); }}
        >
          <Text style={styles.toggleText}>{showPdf ? 'Zones' : 'Drawing'}</Text>
        </TouchableOpacity>
      </View>

      {showPdf ? (
        <View style={{ flex: 1 }}>
          {!viewOnly && (
            <View style={styles.toolbar}>
              <ToolBtn icon="📍" label="Pin" active={activeTool === 'pin'} onPress={() => setActiveTool('pin')} />
              <ToolBtn icon="⬜" label="Area" active={activeTool === 'rectangle'} onPress={() => setActiveTool('rectangle')} />
              <ToolBtn icon="✏️" label="Draw" active={activeTool === 'freehand'} onPress={() => setActiveTool('freehand')} />
            </View>
          )}

          <View style={styles.hintBar}>
            <Text style={styles.hintText}>
              {viewOnly ? '👁 View only — tap a marker to see observations'
                : activeTool === 'pin' ? '📍 Tap on PDF to place a pin'
                : activeTool === 'rectangle' ? '⬜ Drag to highlight an area'
                : '✏️ Draw freely on the drawing'}
            </Text>
          </View>

          {/* Pure PDF — let it handle its own scroll and zoom natively */}
          <View style={{ flex: 1 }}>
            <Pdf
              source={{ uri: encodedUrl, cache: true }}
              style={styles.pdf}
              onLoadComplete={(pages, path, size) => {
                setIsLoading(false);
                if (size) setPdfPageSize({ width: size.width, height: size.height });
              }}
              onError={() => {
                setIsLoading(false);
                setPdfError('Could not load drawing. Check your connection.');
              }}
              onPageSingleTap={!viewOnly && activeTool === 'pin' ? handlePdfTap : undefined}
              enablePaging={false}
              horizontal={false}
              fitPolicy={0}
              trustAllCerts={false}
            />

            {/* Pin markers rendered as absolute positioned views */}
            {/* These sit on top of the PDF but with pointerEvents none */}
            {!isLoading && zones.map(zone => {
              if (zone.markup_type !== 'pin' && zone.markup_type) return null;
              const cx = (zone.x_percent / 100) * SCREEN_WIDTH;
              const cy = (zone.y_percent / 100) * (SCREEN_HEIGHT - 200);
              return (
                <TouchableOpacity
                  key={zone.id}
                  style={[styles.pinMarker, { left: cx - 16, top: cy - 16 }]}
                  onPress={() => handleTapZone(zone)}
                  activeOpacity={0.8}
                >
                  <View style={styles.pinDot} />
                  <View style={styles.pinLabel}>
                    <Text style={styles.pinLabelText} numberOfLines={1}>{zone.label}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}

            {isLoading && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="large" color="#0EA5E9" />
                <Text style={styles.loadingText}>Loading drawing...</Text>
              </View>
            )}

            {!!pdfError && (
              <View style={styles.loadingOverlay}>
                <Text style={styles.errorText}>{pdfError}</Text>
                <TouchableOpacity onPress={() => { setPdfError(''); setIsLoading(true); }}>
                  <Text style={styles.retryText}>Tap to retry</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {zones.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              style={styles.strip} contentContainerStyle={styles.stripContent}>
              {zones.map(zone => (
                <TouchableOpacity key={zone.id}
                  style={[styles.chip, zone.markup_type === 'freehand' && styles.chipFree]}
                  onPress={() => handleTapZone(zone)}>
                  <Text style={styles.chipIcon}>
                    {!zone.markup_type || zone.markup_type === 'pin' ? '📍'
                      : zone.markup_type === 'rectangle' ? '⬜' : '✏️'}
                  </Text>
                  <Text style={styles.chipText}>{zone.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      ) : (
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.openBtn}
              onPress={() => { setIsLoading(true); setPdfError(''); setShowPdf(true); }}
              activeOpacity={0.8}
            >
              <Text style={styles.openBtnIcon}>📄</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.openBtnTitle}>
                  {viewOnly ? 'View Drawing' : 'Open & Mark Up Drawing'}
                </Text>
                <Text style={styles.openBtnSub}>
                  {viewOnly ? 'Tap markers to view observations'
                    : 'Pinch to zoom · Scroll · Tap to place pins'}
                </Text>
              </View>
              <Text style={styles.openBtnArrow}>›</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Marked Zones ({zones.length})</Text>
            {zones.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyIcon}>📍</Text>
                <Text style={styles.emptyTitle}>No zones yet</Text>
                <Text style={styles.emptyBody}>
                  {viewOnly ? 'No markup was added during this inspection'
                    : 'Open the drawing and tap to place pins'}
                </Text>
              </View>
            ) : zones.map(zone => (
              <TouchableOpacity key={zone.id} style={styles.zoneRow}
                onPress={() => handleTapZone(zone)} activeOpacity={0.7}>
                <View style={[styles.zoneBadge,
                  zone.markup_type === 'freehand' && { backgroundColor: '#2D1B00' }]}>
                  <Text style={styles.zoneBadgeIcon}>
                    {!zone.markup_type || zone.markup_type === 'pin' ? '📍'
                      : zone.markup_type === 'rectangle' ? '⬜' : '✏️'}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.zoneLabel}>{zone.label}</Text>
                  <Text style={styles.zoneMeta}>
                    {!zone.markup_type || zone.markup_type === 'pin' ? 'Pin marker'
                      : zone.markup_type === 'rectangle' ? 'Area highlight'
                      : 'Freehand drawing'} · Tap to inspect
                  </Text>
                </View>
                <Text style={styles.zoneArrow}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      <Modal visible={showModal} transparent animationType="slide"
        onRequestClose={() => setShowModal(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={StyleSheet.absoluteFill}
            activeOpacity={1} onPress={() => setShowModal(false)} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Name this zone</Text>
            <Text style={styles.modalSub}>e.g. Column C3, Beam B1, Slab Level 2</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Zone name..."
              placeholderTextColor="#334155"
              value={newLabel}
              onChangeText={setNewLabel}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleSave}
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalCancel}
                onPress={() => { setShowModal(false); setPendingZone(null); setNewLabel(''); }}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSave} onPress={handleSave}>
                <Text style={styles.modalSaveText}>Save Zone</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080C14' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 60, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1E293B',
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, width: 52 },
  backArrow: { fontSize: 20, color: '#0EA5E9' },
  backText: { fontSize: 14, color: '#0EA5E9' },
  headerTitle: { fontSize: 14, fontWeight: '600', color: '#F8FAFC', flex: 1, textAlign: 'center' },
  toggleBtn: {
    backgroundColor: '#0D1520', paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 8, borderWidth: 1, borderColor: '#1E293B',
  },
  toggleText: { fontSize: 13, color: '#0EA5E9', fontWeight: '600' },
  toolbar: {
    flexDirection: 'row', backgroundColor: '#0D1520',
    paddingVertical: 8, paddingHorizontal: 12, gap: 8,
    borderBottomWidth: 1, borderBottomColor: '#1E293B',
  },
  toolBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10,
    backgroundColor: '#080C14', borderWidth: 1, borderColor: '#1E293B', gap: 2,
  },
  toolBtnActive: { backgroundColor: '#0F2A3F', borderColor: '#0EA5E9' },
  toolBtnIcon: { fontSize: 18 },
  toolBtnLabel: { fontSize: 10, color: '#475569', fontWeight: '600' },
  toolBtnLabelActive: { color: '#0EA5E9' },
  hintBar: {
    backgroundColor: '#0A1628', paddingVertical: 7, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#1E293B',
  },
  hintText: { fontSize: 12, color: '#475569', textAlign: 'center' },
  pdf: { flex: 1, width: SCREEN_WIDTH, backgroundColor: '#080C14' },
  pinMarker: { position: 'absolute', zIndex: 10, alignItems: 'center' },
  pinDot: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#0EA5E9', borderWidth: 3, borderColor: '#FFFFFF',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5, shadowRadius: 4, elevation: 6,
  },
  pinLabel: {
    backgroundColor: '#0EA5E9', paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 6, marginTop: 2, maxWidth: 120,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.4, shadowRadius: 3, elevation: 4,
  },
  pinLabelText: { fontSize: 11, color: '#FFFFFF', fontWeight: '700' },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: '#080C14',
    alignItems: 'center', justifyContent: 'center', gap: 12,
  },
  loadingText: { color: '#475569', fontSize: 14 },
  errorText: { color: '#F87171', fontSize: 14, textAlign: 'center', paddingHorizontal: 40 },
  retryText: { color: '#0EA5E9', fontSize: 14, fontWeight: '500' },
  strip: {
    backgroundColor: '#0D1520', borderTopWidth: 1,
    borderTopColor: '#1E293B', maxHeight: 52,
  },
  stripContent: { paddingHorizontal: 16, gap: 8, alignItems: 'center', paddingVertical: 10 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#0F2A3F', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: '#0EA5E9',
  },
  chipFree: { backgroundColor: '#2D1B00', borderColor: '#D97706' },
  chipIcon: { fontSize: 12 },
  chipText: { fontSize: 12, color: '#0EA5E9', fontWeight: '500' },
  scroll: { flex: 1 },
  section: { padding: 20, paddingBottom: 8 },
  sectionTitle: {
    fontSize: 13, fontWeight: '600', color: '#475569',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12,
  },
  openBtn: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#0D1520',
    borderRadius: 14, padding: 18, gap: 14,
    borderWidth: 1.5, borderColor: '#0EA5E9',
  },
  openBtnIcon: { fontSize: 28 },
  openBtnTitle: { fontSize: 16, fontWeight: '700', color: '#F8FAFC', marginBottom: 3 },
  openBtnSub: { fontSize: 12, color: '#475569' },
  openBtnArrow: { fontSize: 24, color: '#0EA5E9' },
  empty: {
    backgroundColor: '#0D1520', borderRadius: 12, padding: 28,
    alignItems: 'center', borderWidth: 1, borderColor: '#1E293B',
    borderStyle: 'dashed', gap: 8,
  },
  emptyIcon: { fontSize: 32 },
  emptyTitle: { fontSize: 15, color: '#F8FAFC', fontWeight: '500' },
  emptyBody: { fontSize: 12, color: '#334155', textAlign: 'center', lineHeight: 18 },
  zoneRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#0D1520',
    borderRadius: 12, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: '#1E293B', gap: 12,
  },
  zoneBadge: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#0F2A3F', alignItems: 'center', justifyContent: 'center',
  },
  zoneBadgeIcon: { fontSize: 16 },
  zoneLabel: { fontSize: 15, fontWeight: '600', color: '#F8FAFC', marginBottom: 2 },
  zoneMeta: { fontSize: 11, color: '#334155' },
  zoneArrow: { fontSize: 20, color: '#1E293B' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: '#0D1520', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, gap: 10, borderTopWidth: 1, borderColor: '#1E293B',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#F8FAFC' },
  modalSub: { fontSize: 13, color: '#475569' },
  modalInput: {
    backgroundColor: '#080C14', borderWidth: 1, borderColor: '#1E293B',
    borderRadius: 10, padding: 14, fontSize: 15, color: '#F8FAFC', marginTop: 4,
  },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 6 },
  modalCancel: {
    flex: 1, backgroundColor: '#1E293B', borderRadius: 10, padding: 14, alignItems: 'center',
  },
  modalCancelText: { color: '#475569', fontSize: 15, fontWeight: '500' },
  modalSave: { flex: 1, backgroundColor: '#0EA5E9', borderRadius: 10, padding: 14, alignItems: 'center' },
  modalSaveText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});
