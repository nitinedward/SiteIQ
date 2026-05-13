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
  Image,
} from 'react-native';
import { useState, useCallback, useRef } from 'react';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { supabase } from '../../lib/supabase';
import * as FileSystem from 'expo-file-system/legacy';
import PdfThumbnail from 'react-native-pdf-thumbnail';
import Svg, { Circle, Rect, Path, G } from 'react-native-svg';
import {
  GestureHandlerRootView,
  GestureDetector,
  Gesture,
  GestureStateChangeEvent,
  PanGestureHandlerEventPayload,
} from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';

const { width: SW, height: SH } = Dimensions.get('window');

type MarkupType = 'pin' | 'rectangle' | 'freehand';
type Tool = 'pin' | 'rectangle' | 'freehand' | 'select';
type Mode = 'view' | 'markup' | 'list';

type Zone = {
  id: string;
  label: string;
  x_percent: number;
  y_percent: number;
  markup_type: MarkupType;
  shape_data: string | null;
};

type Pt = { x: number; y: number };

// ── TOOL BUTTON ────────────────────────────────────────
function ToolBtn({ icon, label, active, onPress }: {
  icon: string; label: string; active: boolean; onPress: () => void;
}) {
  return (
    <TouchableOpacity style={[S.toolBtn, active && S.toolBtnOn]} onPress={onPress}>
      <Text style={S.toolIcon}>{icon}</Text>
      <Text style={[S.toolLabel, active && S.toolLabelOn]}>{label}</Text>
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

  const [zones, setZones]   = useState<Zone[]>([]);
  const [mode, setMode]     = useState<Mode>('list');
  const [tool, setTool]     = useState<Tool>('pin');

  // PDF → image state
  const [pageImg, setPageImg]     = useState<string | null>(null);
  const [imgSize, setImgSize]     = useState({ w: SW, h: SH });
  const [isLoading, setIsLoading] = useState(false);
  const [loadErr, setLoadErr]     = useState('');

  // Modal state
  const [showModal, setShowModal]     = useState(false);
  const [newLabel, setNewLabel]       = useState('');
  const [pendingZone, setPendingZone] = useState<Partial<Zone> | null>(null);

  // Drawing state for rectangle/freehand
  const [liveRect, setLiveRect]   = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [livePath, setLivePath]   = useState<Pt[]>([]);
  const drawingRef                = useRef(false);
  const startPt                   = useRef<Pt>({ x: 0, y: 0 });
  const freeRef                   = useRef<Pt[]>([]);

  // Gesture transform values
  const scale      = useSharedValue(1);
  const tx         = useSharedValue(0);
  const ty         = useSharedValue(0);
  const savedScale = useSharedValue(1);
  const savedTx    = useSharedValue(0);
  const savedTy    = useSharedValue(0);
  // Used to track if pan was actually a drawing gesture
  const isPanning  = useSharedValue(false);

  // ── LOAD PDF AS IMAGE ──────────────────────────────────
  const loadPageImage = async () => {
    setIsLoading(true);
    setLoadErr('');
    setPageImg(null);

    try {
      // Download PDF to local cache if it's a remote URL
      let localPath = fileUrl;
      if (fileUrl.startsWith('http')) {
        const cacheFile = FileSystem.cacheDirectory + drawingId + '.pdf';
        const info = await FileSystem.getInfoAsync(cacheFile);
        if (!info.exists) {
          await FileSystem.downloadAsync(fileUrl, cacheFile);
        }
        localPath = cacheFile;
      }

      // Convert first page to image at high resolution
      const result = await PdfThumbnail.generate(localPath, 0, 100);
      setPageImg(result.uri);
      setImgSize({ w: result.width, h: result.height });
      setIsLoading(false);
    } catch (err) {
      console.error('PDF thumbnail error:', err);
      setLoadErr('Could not load drawing. Please try again.');
      setIsLoading(false);
    }
  };

  // ── FETCH ZONES ────────────────────────────────────────
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

  // ── OPEN MARKUP VIEW ───────────────────────────────────
  const openMarkup = async () => {
    setMode('markup');
    if (!pageImg) await loadPageImage();
  };

  // ── GESTURE: PINCH ────────────────────────────────────
  const pinch = Gesture.Pinch()
    .onStart(() => { savedScale.value = scale.value; })
    .onUpdate(e => {
      scale.value = Math.max(0.5, Math.min(6, savedScale.value * e.scale));
    });

  // ── GESTURE: PAN (scroll when select tool) ───────────
  const pan = Gesture.Pan()
    .onStart(() => { savedTx.value = tx.value; savedTy.value = ty.value; })
    .onUpdate(e => {
      if (tool === 'select' || tool === 'pin') {
        tx.value = savedTx.value + e.translationX;
        ty.value = savedTy.value + e.translationY;
      }
    });

  // Pinch + pan run simultaneously for zoom+scroll
  const navGesture = Gesture.Simultaneous(pinch, pan);

  // ── ANIMATED STYLE ─────────────────────────────────────
  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  // ── CONVERT TOUCH → IMAGE PERCENT ─────────────────────
  // When user touches the screen we need to account for
  // current pan offset and zoom level to get the correct
  // position on the underlying image
  const touchToPercent = (screenX: number, screenY: number): Pt => {
    const imgX = (screenX - tx.value) / scale.value;
    const imgY = (screenY - ty.value) / scale.value;
    return {
      x: Math.max(0, Math.min(100, (imgX / SW) * 100)),
      y: Math.max(0, Math.min(100, (imgY / (SH - 180)) * 100)),
    };
  };

  // ── HANDLE TAP (PIN) ───────────────────────────────────
  const handleTap = Gesture.Tap()
    .onEnd((e) => {
      if (viewOnly) return;
      if (tool !== 'pin') return;
      runOnJS(onTapPin)(e.x, e.y);
    });

  const onTapPin = (x: number, y: number) => {
    const p = touchToPercent(x, y);
    setPendingZone({ markup_type: 'pin', x_percent: p.x, y_percent: p.y, shape_data: null });
    setNewLabel('');
    setShowModal(true);
  };

  // ── HANDLE DRAW (RECTANGLE / FREEHAND) ────────────────
  const drawPan = Gesture.Pan()
    .onStart((e) => {
      if (tool === 'select' || tool === 'pin') return;
      const p = touchToPercent(e.x, e.y);
      startPt.current = p;
      freeRef.current = [p];
      drawingRef.current = true;
      runOnJS(setLivePath)([p]);
      runOnJS(setLiveRect)(null);
    })
    .onUpdate((e) => {
      if (!drawingRef.current) return;
      const p = touchToPercent(e.x, e.y);
      if (tool === 'rectangle') {
        const x = Math.min(startPt.current.x, p.x);
        const y = Math.min(startPt.current.y, p.y);
        const w = Math.abs(p.x - startPt.current.x);
        const h = Math.abs(p.y - startPt.current.y);
        runOnJS(setLiveRect)({ x, y, w, h });
      } else if (tool === 'freehand') {
        freeRef.current = [...freeRef.current, p];
        runOnJS(setLivePath)([...freeRef.current]);
      }
    })
    .onEnd((e) => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      const p = touchToPercent(e.x, e.y);

      if (tool === 'rectangle') {
        const x = Math.min(startPt.current.x, p.x);
        const y = Math.min(startPt.current.y, p.y);
        const w = Math.abs(p.x - startPt.current.x);
        const h = Math.abs(p.y - startPt.current.y);
        if (w < 2 || h < 2) { runOnJS(setLiveRect)(null); return; }
        runOnJS(onFinishRect)(x, y, w, h);
      } else if (tool === 'freehand') {
        const pts = freeRef.current;
        if (pts.length < 3) { runOnJS(setLivePath)([]); return; }
        runOnJS(onFinishFreehand)(pts);
      }
    });

  const onFinishRect = (x: number, y: number, w: number, h: number) => {
    setLiveRect(null);
    setPendingZone({
      markup_type: 'rectangle',
      x_percent: x + w / 2,
      y_percent: y + h / 2,
      shape_data: JSON.stringify({ x, y, width: w, height: h }),
    });
    setNewLabel('');
    setShowModal(true);
  };

  const onFinishFreehand = (pts: Pt[]) => {
    setLivePath([]);
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    setPendingZone({
      markup_type: 'freehand',
      x_percent: cx,
      y_percent: cy,
      shape_data: JSON.stringify(pts),
    });
    setNewLabel('');
    setShowModal(true);
  };

  // Combine tap + draw into one gesture detector
  const drawGesture = tool === 'pin'
    ? Gesture.Race(handleTap, pan)
    : Gesture.Race(drawPan, pinch);

  const allGestures = tool === 'select'
    ? navGesture
    : tool === 'pin'
      ? Gesture.Simultaneous(pinch, handleTap)
      : Gesture.Race(drawPan, pinch);

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
    fetchZones();
  };

  // ── TAP EXISTING ZONE ──────────────────────────────────
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

  // ── RENDER SVG MARKUP ──────────────────────────────────
  // The SVG is sized to match the image display size (SW x imgDisplayH)
  // Percentages map directly to pixel positions on the image
  const renderMarkup = (W: number, H: number) => (
    <Svg width={W} height={H} style={StyleSheet.absoluteFill} pointerEvents="none">
      {zones.map(zone => {
        const cx = (zone.x_percent / 100) * W;
        const cy = (zone.y_percent / 100) * H;

        if (!zone.markup_type || zone.markup_type === 'pin') {
          return (
            <G key={zone.id}>
              <Circle cx={cx + 1} cy={cy + 2} r={16} fill="rgba(0,0,0,0.25)" />
              <Circle cx={cx} cy={cy} r={16} fill="#0EA5E9" />
              <Circle cx={cx} cy={cy} r={16} stroke="#FFF" strokeWidth={2.5} fill="none" />
              <Circle cx={cx} cy={cy} r={6} fill="#FFF" />
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
                fill="#0EA5E9" fillOpacity={0.18}
                stroke="#0EA5E9" strokeWidth={3}
              />
            );
          } catch { return null; }
        }

        if (zone.markup_type === 'freehand' && zone.shape_data) {
          try {
            const pts: Pt[] = JSON.parse(zone.shape_data);
            const d = pts.map((p, i) =>
              `${i === 0 ? 'M' : 'L'} ${(p.x / 100) * W} ${(p.y / 100) * H}`
            ).join(' ');
            return (
              <Path key={zone.id} d={d}
                stroke="#F59E0B" strokeWidth={4}
                fill="none" strokeLinecap="round" strokeLinejoin="round" />
            );
          } catch { return null; }
        }
        return null;
      })}

      {/* Live rectangle preview */}
      {liveRect && (
        <Rect
          x={(liveRect.x / 100) * W} y={(liveRect.y / 100) * H}
          width={(liveRect.w / 100) * W} height={(liveRect.h / 100) * H}
          fill="#0EA5E9" fillOpacity={0.1}
          stroke="#0EA5E9" strokeWidth={2} strokeDasharray="8,5"
        />
      )}

      {/* Live freehand preview */}
      {livePath.length > 1 && (
        <Path
          d={livePath.map((p, i) =>
            `${i === 0 ? 'M' : 'L'} ${(p.x / 100) * W} ${(p.y / 100) * H}`
          ).join(' ')}
          stroke="#F59E0B" strokeWidth={4}
          fill="none" strokeLinecap="round" strokeLinejoin="round"
        />
      )}
    </Svg>
  );

  // ── IMAGE DISPLAY HEIGHT ───────────────────────────────
  // Scale image to fit screen width maintaining aspect ratio
  const imgAspect   = imgSize.h / imgSize.w;
  const imgDisplayW = SW;
  const imgDisplayH = SW * imgAspect;

  // ══════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════
  return (
    <GestureHandlerRootView style={S.container}>

      {/* Header */}
      <View style={S.header}>
        <TouchableOpacity style={S.backBtn} onPress={() => router.back()}>
          <Text style={S.backArrow}>←</Text>
          <Text style={S.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={S.headerTitle} numberOfLines={1}>{title}</Text>
        <View style={S.headerTabs}>
          <TouchableOpacity
            style={[S.tab, mode === 'markup' && S.tabOn]}
            onPress={openMarkup}
          >
            <Text style={[S.tabText, mode === 'markup' && S.tabTextOn]}>Drawing</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[S.tab, mode === 'list' && S.tabOn]}
            onPress={() => setMode('list')}
          >
            <Text style={[S.tabText, mode === 'list' && S.tabTextOn]}>
              Zones {zones.length > 0 ? `(${zones.length})` : ''}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── DRAWING / MARKUP VIEW ── */}
      {mode === 'markup' && (
        <View style={S.markupView}>
          {/* Toolbar */}
          {!viewOnly && (
            <View style={S.toolbar}>
              <ToolBtn icon="🔍" label="Pan" active={tool === 'select'} onPress={() => setTool('select')} />
              <ToolBtn icon="📍" label="Pin" active={tool === 'pin'} onPress={() => setTool('pin')} />
              <ToolBtn icon="⬜" label="Area" active={tool === 'rectangle'} onPress={() => setTool('rectangle')} />
              <ToolBtn icon="✏️" label="Draw" active={tool === 'freehand'} onPress={() => setTool('freehand')} />
            </View>
          )}

          {/* Hint */}
          <View style={S.hintBar}>
            <Text style={S.hintText}>
              {viewOnly ? '👁 Tap a marker to view observations'
                : tool === 'select' ? '🔍 Pinch to zoom · Drag to scroll'
                : tool === 'pin' ? '📍 Tap on drawing to place a pin'
                : tool === 'rectangle' ? '⬜ Drag to highlight an area'
                : '✏️ Draw freely on the drawing'}
            </Text>
          </View>

          {/* Loading */}
          {isLoading && (
            <View style={S.centred}>
              <ActivityIndicator size="large" color="#0EA5E9" />
              <Text style={S.loadingText}>Loading drawing...</Text>
            </View>
          )}

          {/* Error */}
          {!!loadErr && !isLoading && (
            <View style={S.centred}>
              <Text style={S.errText}>{loadErr}</Text>
              <TouchableOpacity style={S.retryBtn} onPress={loadPageImage}>
                <Text style={S.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Drawing canvas */}
          {pageImg && !isLoading && (
            <GestureDetector gesture={allGestures}>
              <Animated.View style={[S.canvas, animStyle]}>
                {/* PDF page rendered as high-res image */}
                <Image
                  source={{ uri: pageImg }}
                  style={{ width: imgDisplayW, height: imgDisplayH }}
                  resizeMode="contain"
                />

                {/* SVG markup — same size as image, perfectly aligned */}
                {renderMarkup(imgDisplayW, imgDisplayH)}

                {/* Zone label buttons — tappable, sit on top */}
                {zones.map(zone => {
                  const cx = (zone.x_percent / 100) * imgDisplayW;
                  const cy = (zone.y_percent / 100) * imgDisplayH;
                  const isFree = zone.markup_type === 'freehand';
                  return (
                    <TouchableOpacity
                      key={zone.id}
                      style={[S.labelBtn, { left: cx - 55, top: cy - 48 }]}
                      onPress={() => handleTapZone(zone)}
                    >
                      <View style={[S.labelBubble, isFree && S.labelBubbleFree]}>
                        <Text style={S.labelText} numberOfLines={1}>{zone.label}</Text>
                      </View>
                      {(!zone.markup_type || zone.markup_type === 'pin') && (
                        <View style={[S.labelStem, isFree && { backgroundColor: '#D97706' }]} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </Animated.View>
            </GestureDetector>
          )}

          {/* Bottom zones strip */}
          {zones.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              style={S.strip} contentContainerStyle={S.stripContent}>
              {zones.map(zone => (
                <TouchableOpacity key={zone.id}
                  style={[S.chip, zone.markup_type === 'freehand' && S.chipFree]}
                  onPress={() => handleTapZone(zone)}>
                  <Text style={S.chipIcon}>
                    {!zone.markup_type || zone.markup_type === 'pin' ? '📍'
                      : zone.markup_type === 'rectangle' ? '⬜' : '✏️'}
                  </Text>
                  <Text style={S.chipText}>{zone.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      )}

      {/* ── ZONES LIST ── */}
      {mode === 'list' && (
        <ScrollView style={S.scroll} showsVerticalScrollIndicator={false}>
          <View style={S.section}>
            <TouchableOpacity style={S.openBtn} onPress={openMarkup} activeOpacity={0.8}>
              <Text style={S.openBtnIcon}>📄</Text>
              <View style={{ flex: 1 }}>
                <Text style={S.openBtnTitle}>
                  {viewOnly ? 'View Drawing' : 'Open & Mark Up Drawing'}
                </Text>
                <Text style={S.openBtnSub}>
                  {viewOnly ? 'Tap any marker to view observations'
                    : 'Pin · Area · Freehand · Pinch to zoom · Drag to scroll'}
                </Text>
              </View>
              <Text style={S.openBtnArrow}>›</Text>
            </TouchableOpacity>
          </View>

          <View style={S.section}>
            <Text style={S.sectionTitle}>Marked Zones ({zones.length})</Text>
            {zones.length === 0 ? (
              <View style={S.empty}>
                <Text style={S.emptyIcon}>📍</Text>
                <Text style={S.emptyTitle}>No zones yet</Text>
                <Text style={S.emptyBody}>
                  {viewOnly ? 'No markup was added during this inspection'
                    : 'Open the drawing and use the tools to mark zones'}
                </Text>
              </View>
            ) : zones.map(zone => (
              <TouchableOpacity key={zone.id} style={S.zoneRow}
                onPress={() => handleTapZone(zone)} activeOpacity={0.7}>
                <View style={[S.zoneBadge,
                  zone.markup_type === 'freehand' && { backgroundColor: '#2D1B00' }]}>
                  <Text style={S.zoneBadgeIcon}>
                    {!zone.markup_type || zone.markup_type === 'pin' ? '📍'
                      : zone.markup_type === 'rectangle' ? '⬜' : '✏️'}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={S.zoneLabel}>{zone.label}</Text>
                  <Text style={S.zoneMeta}>
                    {!zone.markup_type || zone.markup_type === 'pin' ? 'Pin marker'
                      : zone.markup_type === 'rectangle' ? 'Area highlight'
                      : 'Freehand drawing'} · Tap to inspect
                  </Text>
                </View>
                <Text style={S.zoneArrow}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* Label modal */}
      <Modal visible={showModal} transparent animationType="slide"
        onRequestClose={() => setShowModal(false)}>
        <KeyboardAvoidingView style={S.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={StyleSheet.absoluteFill}
            activeOpacity={1} onPress={() => setShowModal(false)} />
          <View style={S.modalCard}>
            <Text style={S.modalTitle}>Name this zone</Text>
            <Text style={S.modalSub}>
              {pendingZone?.markup_type === 'pin' ? 'e.g. Column C3, Beam B1'
                : pendingZone?.markup_type === 'rectangle' ? 'e.g. Spalling area, Crack zone'
                : 'e.g. Crack pattern, Settlement area'}
            </Text>
            <TextInput
              style={S.modalInput}
              placeholder="Zone name..."
              placeholderTextColor="#334155"
              value={newLabel}
              onChangeText={setNewLabel}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleSave}
            />
            <View style={S.modalBtns}>
              <TouchableOpacity style={S.modalCancel}
                onPress={() => { setShowModal(false); setPendingZone(null); setNewLabel(''); setLiveRect(null); setLivePath([]); }}>
                <Text style={S.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.modalSave} onPress={handleSave}>
                <Text style={S.modalSaveText}>Save Zone</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </GestureHandlerRootView>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080C14' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 60, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1E293B',
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, width: 52 },
  backArrow: { fontSize: 20, color: '#0EA5E9' },
  backText: { fontSize: 14, color: '#0EA5E9' },
  headerTitle: { fontSize: 13, fontWeight: '600', color: '#F8FAFC', flex: 1, textAlign: 'center', paddingHorizontal: 4 },
  headerTabs: { flexDirection: 'row', gap: 6 },
  tab: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
    backgroundColor: '#0D1520', borderWidth: 1, borderColor: '#1E293B',
  },
  tabOn: { backgroundColor: '#0F2A3F', borderColor: '#0EA5E9' },
  tabText: { fontSize: 12, color: '#475569', fontWeight: '600' },
  tabTextOn: { color: '#0EA5E9' },
  markupView: { flex: 1 },
  toolbar: {
    flexDirection: 'row', backgroundColor: '#0D1520',
    paddingVertical: 8, paddingHorizontal: 10, gap: 6,
    borderBottomWidth: 1, borderBottomColor: '#1E293B',
  },
  toolBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 10,
    backgroundColor: '#080C14', borderWidth: 1, borderColor: '#1E293B', gap: 2,
  },
  toolBtnOn: { backgroundColor: '#0F2A3F', borderColor: '#0EA5E9' },
  toolIcon: { fontSize: 16 },
  toolLabel: { fontSize: 9, color: '#475569', fontWeight: '600' },
  toolLabelOn: { color: '#0EA5E9' },
  hintBar: {
    backgroundColor: '#0A1628', paddingVertical: 7, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#1E293B',
  },
  hintText: { fontSize: 12, color: '#475569', textAlign: 'center' },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#475569', fontSize: 14 },
  errText: { color: '#F87171', fontSize: 14, textAlign: 'center', paddingHorizontal: 40 },
  retryBtn: { backgroundColor: '#0D1520', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#1E293B' },
  retryText: { color: '#0EA5E9', fontSize: 14, fontWeight: '500' },
  canvas: { flex: 1 },
  labelBtn: { position: 'absolute', zIndex: 20, alignItems: 'center' },
  labelBubble: {
    backgroundColor: '#0EA5E9', paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 8, maxWidth: 130,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5, shadowRadius: 4, elevation: 6,
  },
  labelBubbleFree: { backgroundColor: '#D97706' },
  labelText: { fontSize: 12, color: '#FFFFFF', fontWeight: '700' },
  labelStem: { width: 2, height: 8, backgroundColor: '#0EA5E9' },
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
  openBtnSub: { fontSize: 12, color: '#475569', lineHeight: 16 },
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
