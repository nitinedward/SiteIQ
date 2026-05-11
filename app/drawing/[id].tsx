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
  PanResponder,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useState, useCallback, useRef, useMemo } from 'react';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { supabase } from '../../lib/supabase';
import Pdf from 'react-native-pdf';
import Svg, { Circle, Rect, Path, G } from 'react-native-svg';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

type MarkupType = 'pin' | 'rectangle' | 'freehand';
type Tool = 'pin' | 'rectangle' | 'freehand';
type ViewMode = 'pdf' | 'markup' | 'list';

type Zone = {
  id: string;
  label: string;
  x_percent: number;
  y_percent: number;
  markup_type: MarkupType;
  shape_data: string | null;
};

type Point = { x: number; y: number };

type DrawState = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  points: Point[];
};

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

  // Three view modes:
  // pdf    = pure PDF viewer (no overlays, full scroll/zoom/tap)
  // markup = canvas with SVG markup for drawing rectangle/freehand
  // list   = zones list
  const [viewMode, setViewMode]     = useState<ViewMode>('list');
  const [activeTool, setActiveTool] = useState<Tool>('pin');

  // Label modal
  const [showModal, setShowModal]     = useState(false);
  const [newLabel, setNewLabel]       = useState('');
  const [pendingZone, setPendingZone] = useState<Partial<Zone> | null>(null);

  // PDF size from onLoadComplete
  const [pdfSize, setPdfSize] = useState({ width: 1, height: 1 });

  // Markup canvas container measured position
  const canvasRef = useRef<View>(null);
  const canvasPos = useRef({ x: 0, y: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT });

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawState, setDrawState] = useState<DrawState | null>(null);
  const freehandPts = useRef<Point[]>([]);

  const encodedUrl = encodeURI(decodeURIComponent(fileUrl));

  // ── FETCH ZONES ────────────────────────────────────────
  const fetchZones = async () => {
    if (!inspectionId && viewOnly) { setZones([]); return; }
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

  // ── MEASURE MARKUP CANVAS ──────────────────────────────
  const measureCanvas = () => {
    canvasRef.current?.measure((x, y, w, h, px, py) => {
      canvasPos.current = { x: px, y: py, width: w, height: h };
    });
  };

  // ── CONVERT SCREEN COORDS TO PERCENT ──────────────────
  const toPercent = (pageX: number, pageY: number): Point => {
    const { x, y, width, height } = canvasPos.current;
    return {
      x: Math.max(0, Math.min(100, ((pageX - x) / width) * 100)),
      y: Math.max(0, Math.min(100, ((pageY - y) / height) * 100)),
    };
  };

  // ── PIN TAP — fires from PDF onPageSingleTap ──────────
  // Only works in pdf view mode with pin tool selected
  // react-native-pdf gives coords in PDF page space
  const handlePdfTap = (page: number, x: number, y: number) => {
    if (viewOnly || activeTool !== 'pin') return;
    const xPct = Math.max(0, Math.min(100, (x / pdfSize.width) * 100));
    const yPct = Math.max(0, Math.min(100, (y / pdfSize.height) * 100));
    setPendingZone({ markup_type: 'pin', x_percent: xPct, y_percent: yPct, shape_data: null });
    setNewLabel('');
    setShowModal(true);
  };

  // ── PAN RESPONDER — markup canvas only ────────────────
  // This runs on the markup canvas view, NOT on the PDF
  // So the PDF never sees these gestures
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,

    onPanResponderGrant: (evt) => {
      const { pageX, pageY } = evt.nativeEvent;
      const p = toPercent(pageX, pageY);
      if (activeTool === 'freehand') {
        freehandPts.current = [p];
        setDrawState({ startX: p.x, startY: p.y, currentX: p.x, currentY: p.y, points: [p] });
      } else {
        setDrawState({ startX: p.x, startY: p.y, currentX: p.x, currentY: p.y, points: [] });
      }
      setIsDrawing(true);
    },

    onPanResponderMove: (evt) => {
      const { pageX, pageY } = evt.nativeEvent;
      const p = toPercent(pageX, pageY);
      if (activeTool === 'freehand') {
        freehandPts.current.push(p);
        setDrawState(prev => prev ? { ...prev, currentX: p.x, currentY: p.y, points: [...freehandPts.current] } : null);
      } else {
        setDrawState(prev => prev ? { ...prev, currentX: p.x, currentY: p.y } : null);
      }
    },

    onPanResponderRelease: () => {
      setIsDrawing(false);
      if (!drawState) return;

      if (activeTool === 'rectangle') {
        const x = Math.min(drawState.startX, drawState.currentX);
        const y = Math.min(drawState.startY, drawState.currentY);
        const w = Math.abs(drawState.currentX - drawState.startX);
        const h = Math.abs(drawState.currentY - drawState.startY);
        if (w < 2 || h < 2) { setDrawState(null); return; }
        setPendingZone({
          markup_type: 'rectangle',
          x_percent: x + w / 2,
          y_percent: y + h / 2,
          shape_data: JSON.stringify({ x, y, width: w, height: h }),
        });
      } else if (activeTool === 'freehand') {
        const pts = freehandPts.current;
        if (pts.length < 3) { setDrawState(null); return; }
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        setPendingZone({
          markup_type: 'freehand',
          x_percent: cx,
          y_percent: cy,
          shape_data: JSON.stringify(pts),
        });
      }
      setNewLabel('');
      setShowModal(true);
    },
  }), [activeTool, drawState]);

  // ── SAVE ZONE ──────────────────────────────────────────
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
    setDrawState(null);
    fetchZones();
    // After saving a pin, stay in pdf view
    // After saving rectangle/freehand, switch to markup view to see it
    if (pendingZone.markup_type !== 'pin') setViewMode('markup');
  };

  // ── TAP ZONE ───────────────────────────────────────────
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
        text: 'Delete Zone',
        style: 'destructive' as const,
        onPress: async () => {
          await supabase.from('zones').delete().eq('id', zone.id);
          setZones(c => c.filter(z => z.id !== zone.id));
        },
      }] : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  // ── RENDER SVG MARKUP ──────────────────────────────────
  const renderMarkupSvg = (W: number, H: number) => (
    <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
      {zones.map(zone => {
        const cx = (zone.x_percent / 100) * W;
        const cy = (zone.y_percent / 100) * H;

        if (!zone.markup_type || zone.markup_type === 'pin') {
          return (
            <G key={zone.id}>
              <Circle cx={cx} cy={cy} r={14} fill="#0EA5E9" opacity={0.9} />
              <Circle cx={cx} cy={cy} r={14} stroke="#FFFFFF" strokeWidth={2.5} fill="none" />
              <Circle cx={cx} cy={cy} r={5} fill="#FFFFFF" />
            </G>
          );
        }
        if (zone.markup_type === 'rectangle' && zone.shape_data) {
          try {
            const s = JSON.parse(zone.shape_data);
            return (
              <Rect key={zone.id}
                x={(s.x / 100) * W} y={(s.y / 100) * H}
                width={(s.width / 100) * W} height={(s.height / 100) * H}
                fill="#0EA5E9" fillOpacity={0.2}
                stroke="#0EA5E9" strokeWidth={2.5}
              />
            );
          } catch { return null; }
        }
        if (zone.markup_type === 'freehand' && zone.shape_data) {
          try {
            const pts: Point[] = JSON.parse(zone.shape_data);
            const d = pts.map((p, i) =>
              `${i === 0 ? 'M' : 'L'} ${(p.x / 100) * W} ${(p.y / 100) * H}`
            ).join(' ');
            return (
              <Path key={zone.id} d={d} stroke="#F59E0B" strokeWidth={3.5}
                fill="none" strokeLinecap="round" strokeLinejoin="round" />
            );
          } catch { return null; }
        }
        return null;
      })}

      {/* Live drawing preview */}
      {isDrawing && drawState && activeTool === 'rectangle' && (
        <Rect
          x={(Math.min(drawState.startX, drawState.currentX) / 100) * W}
          y={(Math.min(drawState.startY, drawState.currentY) / 100) * H}
          width={(Math.abs(drawState.currentX - drawState.startX) / 100) * W}
          height={(Math.abs(drawState.currentY - drawState.startY) / 100) * H}
          fill="#0EA5E9" fillOpacity={0.1}
          stroke="#0EA5E9" strokeWidth={2} strokeDasharray="6,4"
        />
      )}
      {isDrawing && drawState && activeTool === 'freehand' && drawState.points.length > 1 && (
        <Path
          d={drawState.points.map((p, i) =>
            `${i === 0 ? 'M' : 'L'} ${(p.x / 100) * W} ${(p.y / 100) * H}`
          ).join(' ')}
          stroke="#F59E0B" strokeWidth={3.5} fill="none"
          strokeLinecap="round" strokeLinejoin="round"
        />
      )}
    </Svg>
  );

  return (
    <View style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
        <View style={styles.headerTabs}>
          <TouchableOpacity
            style={[styles.headerTab, viewMode === 'pdf' && styles.headerTabActive]}
            onPress={() => { setIsLoading(true); setPdfError(''); setViewMode('pdf'); }}
          >
            <Text style={[styles.headerTabText, viewMode === 'pdf' && styles.headerTabTextActive]}>PDF</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.headerTab, viewMode === 'markup' && styles.headerTabActive]}
            onPress={() => setViewMode('markup')}
          >
            <Text style={[styles.headerTabText, viewMode === 'markup' && styles.headerTabTextActive]}>Markup</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.headerTab, viewMode === 'list' && styles.headerTabActive]}
            onPress={() => setViewMode('list')}
          >
            <Text style={[styles.headerTabText, viewMode === 'list' && styles.headerTabTextActive]}>Zones</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── PDF VIEW — no overlays, full native scroll/zoom/tap ── */}
      {viewMode === 'pdf' && (
        <View style={{ flex: 1 }}>
          <View style={styles.hintBar}>
            <Text style={styles.hintText}>
              {viewOnly
                ? '👁 View only — switch to Markup to see zones'
                : activeTool === 'pin'
                  ? '📍 Tap anywhere on the drawing to place a pin'
                  : '⬜✏️ Switch to Markup tab to draw areas and freehand'}
            </Text>
          </View>

          {!viewOnly && (
            <View style={styles.pinToolbar}>
              <TouchableOpacity
                style={[styles.pinModeBtn, activeTool === 'pin' && styles.pinModeBtnActive]}
                onPress={() => setActiveTool('pin')}
              >
                <Text style={styles.pinModeBtnText}>📍 Tap to Pin</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.switchToMarkup}
                onPress={() => setViewMode('markup')}
              >
                <Text style={styles.switchToMarkupText}>⬜ Area / ✏️ Draw →</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Pure PDF — NO overlays, NO children that intercept touches */}
          <Pdf
            source={{ uri: encodedUrl, cache: true }}
            style={styles.pdf}
            onLoadComplete={(pages, path, size) => {
              setIsLoading(false);
              if (size) setPdfSize({ width: size.width, height: size.height });
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

          {isLoading && (
            <View style={styles.overlay}>
              <ActivityIndicator size="large" color="#0EA5E9" />
              <Text style={styles.overlayText}>Loading drawing...</Text>
            </View>
          )}
          {!!pdfError && (
            <View style={styles.overlay}>
              <Text style={styles.errorTxt}>{pdfError}</Text>
              <TouchableOpacity onPress={() => { setPdfError(''); setIsLoading(true); }}>
                <Text style={styles.retryTxt}>Tap to retry</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* ── MARKUP VIEW — PDF frozen + SVG overlay for drawing ── */}
      {viewMode === 'markup' && (
        <View style={{ flex: 1 }}>
          {!viewOnly && (
            <View style={styles.toolbar}>
              <ToolBtn icon="⬜" label="Area" active={activeTool === 'rectangle'} onPress={() => setActiveTool('rectangle')} />
              <ToolBtn icon="✏️" label="Draw" active={activeTool === 'freehand'} onPress={() => setActiveTool('freehand')} />
              <TouchableOpacity style={styles.switchToPdf} onPress={() => setViewMode('pdf')}>
                <Text style={styles.switchToPdfText}>📍 Pin → PDF tab</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.hintBar}>
            <Text style={styles.hintText}>
              {viewOnly
                ? '👁 Tap a marker to add observations'
                : activeTool === 'rectangle'
                  ? '⬜ Drag to highlight an area on the drawing'
                  : '✏️ Draw freely on the drawing'}
            </Text>
          </View>

          {/* PDF rendered in fixed/frozen mode as background */}
          {/* SVG and pan responder sit on top */}
          <View
            ref={canvasRef}
            style={styles.markupCanvas}
            onLayout={() => setTimeout(measureCanvas, 200)}
          >
            {/* PDF as static background — scroll disabled */}
            <Pdf
              source={{ uri: encodedUrl, cache: true }}
              style={StyleSheet.absoluteFill}
              onLoadComplete={(pages, path, size) => {
                if (size) setPdfSize({ width: size.width, height: size.height });
                setTimeout(measureCanvas, 300);
              }}
              onError={() => {}}
              enablePaging={false}
              horizontal={false}
              fitPolicy={0}
              trustAllCerts={false}
              scrollEnabled={false}
              onPageSingleTap={undefined}
            />

            {/* SVG markup drawn on top of PDF */}
            {renderMarkupSvg(
              canvasPos.current.width || SCREEN_WIDTH,
              canvasPos.current.height || SCREEN_HEIGHT - 200
            )}

            {/* Zone labels */}
            {zones.map(zone => {
              const W = canvasPos.current.width || SCREEN_WIDTH;
              const H = canvasPos.current.height || SCREEN_HEIGHT - 200;
              const cx = (zone.x_percent / 100) * W;
              const cy = (zone.y_percent / 100) * H;
              return (
                <TouchableOpacity
                  key={zone.id}
                  style={[styles.labelBtn, { left: cx - 60, top: cy - 30 }]}
                  onPress={() => handleTapZone(zone)}
                >
                  <View style={[styles.labelBubble, zone.markup_type === 'freehand' && styles.labelBubbleFreehand]}>
                    <Text style={styles.labelText} numberOfLines={1}>{zone.label}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}

            {/* Pan responder overlay for drawing gestures */}
            {!viewOnly && (
              <View
                style={[StyleSheet.absoluteFill, { backgroundColor: 'transparent' }]}
                {...panResponder.panHandlers}
              />
            )}
          </View>
        </View>
      )}

      {/* ── ZONES LIST ── */}
      {viewMode === 'list' && (
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.section}>
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => { setIsLoading(true); setPdfError(''); setViewMode('pdf'); setActiveTool('pin'); }}
              >
                <Text style={styles.actionBtnIcon}>📍</Text>
                <Text style={styles.actionBtnText}>Place Pin</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnSecondary]}
                onPress={() => { setViewMode('markup'); setActiveTool('rectangle'); }}
              >
                <Text style={styles.actionBtnIcon}>⬜</Text>
                <Text style={[styles.actionBtnText, { color: '#475569' }]}>Mark Area</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnSecondary]}
                onPress={() => { setViewMode('markup'); setActiveTool('freehand'); }}
              >
                <Text style={styles.actionBtnIcon}>✏️</Text>
                <Text style={[styles.actionBtnText, { color: '#475569' }]}>Draw</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Marked Zones ({zones.length})</Text>
            {zones.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyIcon}>📍</Text>
                <Text style={styles.emptyTitle}>No zones yet</Text>
                <Text style={styles.emptyBody}>
                  {viewOnly
                    ? 'No markup was added during this inspection'
                    : 'Use the buttons above to mark zones on this drawing'}
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
                      : zone.markup_type === 'rectangle' ? 'Area highlight' : 'Freehand drawing'}
                    {' · Tap to add observation'}
                  </Text>
                </View>
                <Text style={styles.zoneArrow}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* Label modal */}
      <Modal visible={showModal} transparent animationType="slide"
        onRequestClose={() => { setShowModal(false); setDrawState(null); }}>
        <KeyboardAvoidingView style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={StyleSheet.absoluteFill}
            activeOpacity={1} onPress={() => { setShowModal(false); setDrawState(null); }} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Name this zone</Text>
            <Text style={styles.modalSub}>
              {pendingZone?.markup_type === 'pin' ? 'e.g. Column C3, Beam B1'
                : pendingZone?.markup_type === 'rectangle' ? 'e.g. Spalling area, Crack zone'
                : 'e.g. Crack pattern, Settlement area'}
            </Text>
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
                onPress={() => { setShowModal(false); setPendingZone(null); setDrawState(null); setNewLabel(''); }}>
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
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, width: 50 },
  backArrow: { fontSize: 20, color: '#0EA5E9' },
  backText: { fontSize: 14, color: '#0EA5E9' },
  headerTitle: { fontSize: 13, fontWeight: '600', color: '#F8FAFC', flex: 1, textAlign: 'center', paddingHorizontal: 8 },
  headerTabs: { flexDirection: 'row', gap: 4 },
  headerTab: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    backgroundColor: '#0D1520', borderWidth: 1, borderColor: '#1E293B',
  },
  headerTabActive: { backgroundColor: '#0F2A3F', borderColor: '#0EA5E9' },
  headerTabText: { fontSize: 12, color: '#475569', fontWeight: '600' },
  headerTabTextActive: { color: '#0EA5E9' },
  hintBar: {
    backgroundColor: '#0A1628', paddingVertical: 8, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#1E293B',
  },
  hintText: { fontSize: 12, color: '#475569', textAlign: 'center' },
  pinToolbar: {
    flexDirection: 'row', gap: 8, padding: 10,
    backgroundColor: '#0D1520', borderBottomWidth: 1, borderBottomColor: '#1E293B',
  },
  pinModeBtn: {
    flex: 1, backgroundColor: '#080C14', borderRadius: 10, padding: 10,
    alignItems: 'center', borderWidth: 1, borderColor: '#1E293B',
  },
  pinModeBtnActive: { backgroundColor: '#0F2A3F', borderColor: '#0EA5E9' },
  pinModeBtnText: { fontSize: 13, color: '#0EA5E9', fontWeight: '600' },
  switchToMarkup: {
    flex: 1, backgroundColor: '#080C14', borderRadius: 10, padding: 10,
    alignItems: 'center', borderWidth: 1, borderColor: '#1E293B',
  },
  switchToMarkupText: { fontSize: 12, color: '#475569', fontWeight: '500' },
  pdf: { flex: 1, width: SCREEN_WIDTH, backgroundColor: '#080C14' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#080C14',
    alignItems: 'center', justifyContent: 'center', gap: 12,
  },
  overlayText: { color: '#475569', fontSize: 14 },
  errorTxt: { color: '#F87171', fontSize: 14, textAlign: 'center', paddingHorizontal: 40 },
  retryTxt: { color: '#0EA5E9', fontSize: 14, fontWeight: '500' },
  toolbar: {
    flexDirection: 'row', backgroundColor: '#0D1520',
    paddingVertical: 8, paddingHorizontal: 12, gap: 8,
    borderBottomWidth: 1, borderBottomColor: '#1E293B', alignItems: 'center',
  },
  toolBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10,
    backgroundColor: '#080C14', borderWidth: 1, borderColor: '#1E293B', gap: 2,
  },
  toolBtnActive: { backgroundColor: '#0F2A3F', borderColor: '#0EA5E9' },
  toolBtnIcon: { fontSize: 18 },
  toolBtnLabel: { fontSize: 10, color: '#475569', fontWeight: '600' },
  toolBtnLabelActive: { color: '#0EA5E9' },
  switchToPdf: {
    flex: 1, backgroundColor: '#080C14', borderRadius: 10, padding: 8,
    alignItems: 'center', borderWidth: 1, borderColor: '#1E293B',
  },
  switchToPdfText: { fontSize: 11, color: '#475569', fontWeight: '500', textAlign: 'center' },
  markupCanvas: {
    flex: 1, position: 'relative', overflow: 'hidden',
  },
  labelBtn: { position: 'absolute', zIndex: 10 },
  labelBubble: {
    backgroundColor: '#0EA5E9', paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 8, maxWidth: 140,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5, shadowRadius: 4, elevation: 6,
  },
  labelBubbleFreehand: { backgroundColor: '#D97706' },
  labelText: { fontSize: 12, color: '#FFFFFF', fontWeight: '700' },
  scroll: { flex: 1 },
  section: { padding: 20, paddingBottom: 8 },
  sectionTitle: {
    fontSize: 13, fontWeight: '600', color: '#475569',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12,
  },
  actionRow: { flexDirection: 'row', gap: 10 },
  actionBtn: {
    flex: 1, backgroundColor: '#0EA5E9', borderRadius: 12,
    padding: 14, alignItems: 'center', gap: 6,
  },
  actionBtnSecondary: { backgroundColor: '#0D1520', borderWidth: 1, borderColor: '#1E293B' },
  actionBtnIcon: { fontSize: 22 },
  actionBtnText: { fontSize: 13, color: '#FFFFFF', fontWeight: '600' },
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
