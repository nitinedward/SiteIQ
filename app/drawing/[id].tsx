import {
  View, Text, StyleSheet, TouchableOpacity, Alert,
  ActivityIndicator, Modal, TextInput, ScrollView,
  Dimensions, KeyboardAvoidingView, Platform,
  PanResponder, Animated, Image,
} from 'react-native';
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { supabase } from '../../lib/supabase';
import Svg, { Circle, Ellipse, Rect, Path, G } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../lib/theme';

const T = theme.colors;
const R = theme.radius;
const { width: SW, height: SH } = Dimensions.get('window');

type MarkupType = 'pin' | 'rectangle' | 'freehand';
type Tool = 'pin' | 'rectangle' | 'freehand';
type Zone = { id: string; label: string; x_percent: number; y_percent: number; markup_type: MarkupType; shape_data: string | null };
type Pt = { x: number; y: number };
type PdfRect = { x: number; y: number; width: number; height: number };

function zoneIcon(markupType?: MarkupType): keyof typeof Ionicons.glyphMap {
  if (markupType === 'rectangle') return 'scan';
  if (markupType === 'freehand') return 'pencil';
  return 'location';
}

function ToolBtn({ icon, label, active, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[S.toolBtn, active && S.toolBtnOn]} onPress={onPress} activeOpacity={0.75}>
      <Ionicons name={icon} size={20} color={active ? T.indigo : T.mid} />
      <Text style={[S.toolLabel, active && S.toolLabelOn]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function DrawingViewerScreen() {
  const params       = useLocalSearchParams();
  const drawingId    = params.id as string;
  const title        = params.title as string;
  const fileUrl      = params.file_url as string;
  const previewUrl   = params.preview_url as string | undefined;
  const projectId    = params.project_id as string;
  const inspectionId = params.inspection_id as string;
  const viewOnly     = params.view_only === 'true';

  const [zones, setZones]         = useState<Zone[]>([]);
  const zonesRef                  = useRef<Zone[]>([]);
  const setZonesAndRef = (z: Zone[]) => { zonesRef.current = z; setZones(z); };
  const [showPdf, setShowPdf]     = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [pdfError, setPdfError]   = useState('');
  const [tool, setTool]           = useState<Tool>('pin');
  const toolRef                   = useRef<Tool>('pin');
  const [showModal, setShowModal] = useState(false);
  const [newLabel, setNewLabel]   = useState('');
  const [pendingZone, setPendingZone] = useState<Partial<Zone> | null>(null);
  const [liveRect, setLiveRect]   = useState<PdfRect | null>(null);
  const [livePath, setLivePath]   = useState<Pt[]>([]);

  const pdfDims  = useRef({ pdfWidth: 1, pdfHeight: 1 });
  const naturalH = useRef(SH);
  const [pdfH, setPdfH] = useState(SH);
  const pageLeft = useRef(0);
  const pageTop  = useRef(0);
  const scale    = useRef(1);
  const animTx    = useRef(new Animated.Value(0)).current;
  const animTy    = useRef(new Animated.Value(0)).current;
  const animScale = useRef(new Animated.Value(1)).current;

  const applyTransform = (left: number, top: number, s: number) => {
    pageLeft.current = left; pageTop.current = top; scale.current = s;
    const h = naturalH.current;
    animTx.setValue(left + (SW * (s - 1)) / 2);
    animTy.setValue(top  + (h  * (s - 1)) / 2);
    animScale.setValue(s);
  };

  const pdfWrapRef = useRef<View>(null);
  const wrapTop    = useRef(0);
  const wrapLeft   = useRef(0);
  const pdfWrapH   = useRef(SH - 220); // available height for the drawing (updated by onLayout)
  const measureWrap = () => { pdfWrapRef.current?.measure((_x, _y, _w, _h, px, py) => { wrapLeft.current = px; wrapTop.current = py; }); };

  const touchToPage = (absX: number, absY: number): Pt => ({
    x: (absX - wrapLeft.current - pageLeft.current) / scale.current,
    y: (absY - wrapTop.current  - pageTop.current)  / scale.current,
  });
  const touchToPdf = (absX: number, absY: number): Pt => {
    const p = touchToPage(absX, absY);
    return { x: (p.x / SW) * pdfDims.current.pdfWidth, y: (p.y / naturalH.current) * pdfDims.current.pdfHeight };
  };
  const pctToPage = (xPct: number, yPct: number): Pt => ({ x: (xPct / 100) * SW, y: (yPct / 100) * naturalH.current });
  const pdfRectToPage = (r: PdfRect): PdfRect => {
    const { pdfWidth, pdfHeight } = pdfDims.current; const h = naturalH.current;
    return { x: (r.x / pdfWidth) * SW, y: (r.y / pdfHeight) * h, width: (r.width / pdfWidth) * SW, height: (r.height / pdfHeight) * h };
  };

  const lastDist   = useRef(0);
  const lastMid    = useRef<Pt>({ x: 0, y: 0 });
  const isPinching = useRef(false);
  const isDrawing  = useRef(false);
  const drawStart  = useRef<Pt>({ x: 0, y: 0 });
  const freePoints = useRef<Pt[]>([]);
  const tapStart   = useRef<{ x: number; y: number; t: number } | null>(null);
  const hasMoved   = useRef(false);

  // Load the pre-rendered preview image's real dimensions so the container
  // gets the correct aspect ratio. Using a plain <Image> instead of the
  // native PDF viewer avoids react-native-pdf's unreliable internal scaling,
  // which was clipping large landscape sheets (A3/A1).
  const loadPreviewDimensions = useCallback(() => {
    if (!previewUrl) { setIsLoading(false); setPdfError('No preview available for this drawing. Please re-upload it from the web app.'); return; }
    setIsLoading(true); setPdfError('');
    Image.getSize(
      previewUrl,
      (imgW, imgH) => {
        // Full-width display height (maintains aspect ratio)
        const fullH = SW * (imgH / imgW);
        naturalH.current = fullH;
        pdfDims.current  = { pdfWidth: imgW, pdfHeight: imgH };
        setPdfH(fullH);

        const containerH = pdfWrapH.current > 50 ? pdfWrapH.current : SH - 220;
        if (fullH > containerH) {
          // Portrait drawing taller than container (e.g. A3 portrait on a small
          // phone): scale down uniformly and centre horizontally.
          const s = containerH / fullH;
          const offsetX = (SW * (1 - s)) / 2;
          applyTransform(offsetX, 0, s);
        } else {
          // Drawing fits (landscape or short portrait). Centre it vertically so
          // grey space is split equally above and below — A1 landscape drawings
          // previously appeared as a top strip with a large grey gap below,
          // making the bottom look cut off.
          const offsetY = (containerH - fullH) / 2;
          applyTransform(0, offsetY, 1);
        }
        setIsLoading(false);
      },
      () => { setIsLoading(false); setPdfError('Could not load drawing.'); }
    );
  }, [previewUrl]);

  useEffect(() => { if (showPdf) loadPreviewDimensions(); }, [showPdf, loadPreviewDimensions]);

  const updateTool = (t: Tool) => {
    toolRef.current = t; setTool(t);
    setLiveRect(null); setLivePath([]);
    isDrawing.current = false; tapStart.current = null; hasMoved.current = false;
  };

  const fetchZones = async () => {
    if (!inspectionId) { setZonesAndRef([]); return; }
    const { data } = await supabase.from('zones').select('*').eq('drawing_id', drawingId).eq('inspection_id', inspectionId).order('created_at', { ascending: true });
    setZonesAndRef((data as Zone[]) ?? []);
  };
  useFocusEffect(useCallback(() => { fetchZones(); }, [drawingId, inspectionId]));

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder:  () => true,

    onPanResponderGrant: (evt) => {
      const { pageX, pageY, touches } = evt.nativeEvent;
      const lx = pageX - wrapLeft.current;
      const ly = pageY - wrapTop.current;
      tapStart.current = { x: lx, y: ly, t: Date.now() };
      hasMoved.current = false;
      if (touches.length >= 2) {
        isPinching.current = true; tapStart.current = null;
        const dx = touches[1].pageX - touches[0].pageX;
        const dy = touches[1].pageY - touches[0].pageY;
        lastDist.current = Math.sqrt(dx * dx + dy * dy);
        lastMid.current  = { x: (touches[0].pageX + touches[1].pageX) / 2 - wrapLeft.current, y: (touches[0].pageY + touches[1].pageY) / 2 - wrapTop.current };
        return;
      }
      isPinching.current = false;
      const t = toolRef.current;
      if (t === 'rectangle' || t === 'freehand') {
        const p = touchToPdf(pageX, pageY);
        drawStart.current = p; freePoints.current = [p];
        isDrawing.current = false; setLiveRect(null); setLivePath([]);
      }
    },

    onPanResponderMove: (evt) => {
      const { pageX, pageY, touches } = evt.nativeEvent;
      if (touches.length >= 2 || isPinching.current) {
        if (touches.length < 2) return;
        tapStart.current = null; hasMoved.current = true;
        isDrawing.current = false; isPinching.current = true;
        freePoints.current = []; setLiveRect(null); setLivePath([]);
        const dx = touches[1].pageX - touches[0].pageX;
        const dy = touches[1].pageY - touches[0].pageY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const mid  = { x: (touches[0].pageX + touches[1].pageX) / 2 - wrapLeft.current, y: (touches[0].pageY + touches[1].pageY) / 2 - wrapTop.current };
        if (lastDist.current === 0) { lastDist.current = dist; lastMid.current = mid; return; }
        const oldS = scale.current;
        const newS = Math.max(0.5, Math.min(8, oldS * (dist / lastDist.current)));
        const newLeft = mid.x - (mid.x - pageLeft.current) * (newS / oldS) + (mid.x - lastMid.current.x);
        const newTop  = mid.y - (mid.y - pageTop.current)  * (newS / oldS) + (mid.y - lastMid.current.y);
        applyTransform(newLeft, newTop, newS);
        lastDist.current = dist; lastMid.current = mid;
        return;
      }
      const t  = toolRef.current;
      const lx = pageX - wrapLeft.current;
      const ly = pageY - wrapTop.current;
      if (tapStart.current && (Math.abs(lx - tapStart.current.x) > 6 || Math.abs(ly - tapStart.current.y) > 6)) hasMoved.current = true;
      if (t === 'rectangle' || t === 'freehand') {
        const pdfPt  = touchToPdf(pageX, pageY);
        const pagePt = touchToPage(pageX, pageY);
        const startPage = { x: (drawStart.current.x / pdfDims.current.pdfWidth) * SW, y: (drawStart.current.y / pdfDims.current.pdfHeight) * naturalH.current };
        const moveDist = Math.sqrt(Math.pow(pagePt.x - startPage.x, 2) + Math.pow(pagePt.y - startPage.y, 2));
        if (!isDrawing.current && moveDist < 20) return;
        isDrawing.current = true;
        if (t === 'rectangle') {
          setLiveRect({ x: Math.min(startPage.x, pagePt.x), y: Math.min(startPage.y, pagePt.y), width: Math.abs(pagePt.x - startPage.x), height: Math.abs(pagePt.y - startPage.y) });
        } else {
          freePoints.current = [...freePoints.current, pdfPt];
          setLivePath(prev => [...prev, pagePt]);
        }
      }
    },

    onPanResponderRelease: (evt) => {
      isPinching.current = false; lastDist.current = 0;
      const t = toolRef.current;
      const { pageX, pageY } = evt.nativeEvent;
      const lx = pageX - wrapLeft.current;
      const ly = pageY - wrapTop.current;

      if (!isDrawing.current && tapStart.current) {
        const dt   = Date.now() - tapStart.current.t;
        const tapLx = (lx - pageLeft.current) / scale.current;
        const tapLy = (ly - pageTop.current)  / scale.current;
        if (dt < 500) {
          const hitZone = zonesRef.current?.find(zone => {
            const sc = { x: (zone.x_percent / 100) * SW, y: (zone.y_percent / 100) * naturalH.current };
            if (!zone.markup_type || zone.markup_type === 'pin') {
              return Math.sqrt(Math.pow(tapLx - sc.x, 2) + Math.pow(tapLy - sc.y, 2)) < 28;
            }
            if (zone.markup_type === 'rectangle' && zone.shape_data) {
              try {
                const r  = JSON.parse(zone.shape_data);
                const pr = pdfRectToPage(r);
                return tapLx >= pr.x && tapLx <= pr.x + pr.width && tapLy >= pr.y && tapLy <= pr.y + pr.height;
              } catch { return false; }
            }
            if (zone.markup_type === 'freehand') return Math.sqrt(Math.pow(tapLx - sc.x, 2) + Math.pow(tapLy - sc.y, 2)) < 36;
            return false;
          });
          if (hitZone) { tapStart.current = null; hasMoved.current = false; handleTapZone(hitZone); return; }
        }
      }

      if (t === 'pin' && tapStart.current && !hasMoved.current) {
        const dt = Date.now() - tapStart.current.t;
        tapStart.current = null; hasMoved.current = false;
        if (dt < 500) {
          const pdfPt = touchToPdf(pageX, pageY);
          const { pdfWidth, pdfHeight } = pdfDims.current;
          setPendingZone({ markup_type: 'pin', x_percent: (pdfPt.x / pdfWidth) * 100, y_percent: (pdfPt.y / pdfHeight) * 100, shape_data: null });
          setNewLabel(''); setShowModal(true); return;
        }
      }
      tapStart.current = null; hasMoved.current = false;

      if (!isDrawing.current) return;
      isDrawing.current = false;
      const pdfPt = touchToPdf(pageX, pageY);
      const { pdfWidth, pdfHeight } = pdfDims.current;

      if (t === 'rectangle') {
        const x = Math.min(drawStart.current.x, pdfPt.x);
        const y = Math.min(drawStart.current.y, pdfPt.y);
        const w = Math.abs(pdfPt.x - drawStart.current.x);
        const h = Math.abs(pdfPt.y - drawStart.current.y);
        setLiveRect(null);
        if (w < 3 || h < 3) return;
        setPendingZone({ markup_type: 'rectangle', x_percent: ((x + w / 2) / pdfWidth) * 100, y_percent: ((y + h / 2) / pdfHeight) * 100, shape_data: JSON.stringify({ x, y, width: w, height: h }) });
        setNewLabel(''); setShowModal(true);
      } else if (t === 'freehand') {
        const pts = [...freePoints.current, pdfPt];
        setLivePath([]);
        if (pts.length < 5) return;
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        setPendingZone({ markup_type: 'freehand', x_percent: (cx / pdfWidth) * 100, y_percent: (cy / pdfHeight) * 100, shape_data: JSON.stringify(pts) });
        setNewLabel(''); setShowModal(true);
      }
    },

    onPanResponderTerminate: () => {
      isPinching.current = false; lastDist.current = 0;
      isDrawing.current = false; tapStart.current = null; hasMoved.current = false;
    },
  }), []);

  const handleSave = async () => {
    if (!newLabel.trim()) { Alert.alert('Missing Label', 'Enter a zone name.'); return; }
    if (!pendingZone) return;
    const { error } = await supabase.from('zones').insert({
      drawing_id: drawingId, project_id: projectId,
      inspection_id: inspectionId || null,
      label: newLabel.trim(),
      x_percent: pendingZone.x_percent ?? 0,
      y_percent: pendingZone.y_percent ?? 0,
      markup_type: pendingZone.markup_type ?? 'pin',
      shape_data: pendingZone.shape_data ?? null,
    });
    if (error) { Alert.alert('Error', 'Could not save zone.'); return; }
    setNewLabel(''); setShowModal(false); setPendingZone(null); setLiveRect(null); setLivePath([]);
    fetchZones();
  };

  const handleTapZone = async (zone: Zone) => {
    let hasObs = false; let obsId: string | null = null;
    if (inspectionId) {
      const { data: existingObs } = await supabase.from('observations').select('id').eq('zone_id', zone.id).eq('inspection_id', inspectionId).limit(1);
      hasObs = !!(existingObs && existingObs.length > 0);
      obsId  = hasObs ? existingObs![0].id : null;
    }
    const buttons: any[] = [];
    if (!viewOnly && inspectionId) {
      buttons.push({ text: hasObs ? 'Edit Observation' : 'Add Observation', onPress: () => router.push({ pathname: '/observation', params: { zone_id: zone.id, zone_label: zone.label, project_id: projectId, inspection_id: inspectionId, ...(obsId ? { observation_id: obsId } : {}) } }) });
      if (hasObs) buttons.push({ text: 'Add Another Observation', onPress: () => router.push({ pathname: '/observation', params: { zone_id: zone.id, zone_label: zone.label, project_id: projectId, inspection_id: inspectionId } }) });
      buttons.push({ text: 'Delete Zone', style: 'destructive' as const, onPress: async () => { await supabase.from('zones').delete().eq('id', zone.id); setZonesAndRef(zonesRef.current.filter(z => z.id !== zone.id)); } });
    }
    buttons.push({ text: 'Cancel', style: 'cancel' as const });
    Alert.alert(zone.label, 'What would you like to do?', buttons);
  };

  const renderSvg = (h: number) => (
    <Svg width={SW} height={h} style={StyleSheet.absoluteFill} pointerEvents="none">
      {zones.map(zone => {
        const sc = pctToPage(zone.x_percent, zone.y_percent);
        if (!zone.markup_type || zone.markup_type === 'pin') {
          return (
            <G key={zone.id}>
              <Ellipse cx={sc.x} cy={sc.y + 2} rx={7} ry={2} fill="rgba(0,0,0,0.14)" />
              <Circle cx={sc.x} cy={sc.y} r={12} fill="#FFFFFF" stroke={T.indigo} strokeWidth={3} />
              <Circle cx={sc.x} cy={sc.y} r={4}  fill={T.marigold} />
            </G>
          );
        }
        if (zone.markup_type === 'rectangle' && zone.shape_data) {
          try {
            const pr = pdfRectToPage(JSON.parse(zone.shape_data));
            return <Rect key={zone.id} x={pr.x} y={pr.y} width={pr.width} height={pr.height} fill={T.indigo} fillOpacity={0.16} stroke={T.indigo} strokeWidth={1.5} />;
          } catch { return null; }
        }
        if (zone.markup_type === 'freehand' && zone.shape_data) {
          try {
            const pts: Pt[] = JSON.parse(zone.shape_data);
            const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(p.x / pdfDims.current.pdfWidth) * SW} ${(p.y / pdfDims.current.pdfHeight) * h}`).join(' ');
            return <Path key={zone.id} d={d} stroke="#F59E0B" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
          } catch { return null; }
        }
        return null;
      })}
      {liveRect && <Rect x={liveRect.x} y={liveRect.y} width={liveRect.width} height={liveRect.height} fill={T.indigo} fillOpacity={0.1} stroke={T.indigo} strokeWidth={1.5} strokeDasharray="6,4" />}
      {livePath.length > 1 && <Path d={livePath.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')} stroke="#F59E0B" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
    </Svg>
  );

  const renderLabels = () => zones.map(zone => {
    const sc = pctToPage(zone.x_percent, zone.y_percent);
    const isFree = zone.markup_type === 'freehand';
    const isPin  = !zone.markup_type || zone.markup_type === 'pin';
    return (
      <TouchableOpacity key={zone.id} style={{ position: 'absolute', left: sc.x - 80, top: sc.y - (isPin ? 37 : 46), zIndex: 10, width: 160, alignItems: 'center' }} onPress={() => handleTapZone(zone)} disabled={tool === 'rectangle' || tool === 'freehand'}>
        <View style={[S.labelBubble, isFree && S.labelFree]}>
          <Text style={S.labelText} numberOfLines={1}>{zone.label}</Text>
        </View>
      </TouchableOpacity>
    );
  });

  return (
    <View style={S.container}>
      <View style={S.header}>
        <TouchableOpacity style={S.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={18} color={T.indigo} />
        </TouchableOpacity>
        <View style={S.headerMid}>
          <Text style={S.headerTitle} numberOfLines={1}>{viewOnly ? 'View Drawing' : 'PDF Mark-up'}</Text>
          <Text style={S.headerSub} numberOfLines={1}>{title}</Text>
        </View>
        <TouchableOpacity style={S.toggleBtn} onPress={() => { setIsLoading(true); setPdfError(''); setShowPdf(v => !v); }}>
          <Text style={S.toggleText}>{showPdf ? 'Zones' : 'Drawing'}</Text>
        </TouchableOpacity>
      </View>

      {showPdf ? (
        <View style={S.pdfScreen}>
          {!viewOnly && (
            <View style={S.toolbar}>
              <ToolBtn icon="location-outline" label="Pin"  active={tool==='pin'}       onPress={() => updateTool('pin')} />
              <ToolBtn icon="scan-outline"     label="Area" active={tool==='rectangle'} onPress={() => updateTool('rectangle')} />
              <ToolBtn icon="pencil-outline"   label="Draw" active={tool==='freehand'}  onPress={() => updateTool('freehand')} />
            </View>
          )}
          <View ref={pdfWrapRef} style={S.pdfWrap} onLayout={(e) => { const h = e.nativeEvent.layout.height; if (h > 0) pdfWrapH.current = h; measureWrap(); setTimeout(measureWrap, 50); }} {...panResponder.panHandlers}>
            <Animated.View style={{ position: 'absolute', top: 0, left: 0, width: SW, height: pdfH, transform: [{ translateX: animTx }, { translateY: animTy }, { scale: animScale }] }}>
              {!isLoading && !pdfError && previewUrl && (
                <Image
                  source={{ uri: previewUrl }}
                  style={{ width: SW, height: pdfH, backgroundColor: '#F1F5F9' }}
                  resizeMode="contain"
                />
              )}
              {!isLoading && renderSvg(pdfH)}
              {!isLoading && renderLabels()}
            </Animated.View>
            {isLoading && <View style={S.overlay}><ActivityIndicator size="large" color={T.indigo} /><Text style={S.loadingTxt}>Loading drawing...</Text></View>}
            {!!pdfError && <View style={S.overlay}><Text style={S.errTxt}>{pdfError}</Text><TouchableOpacity onPress={loadPreviewDimensions}><Text style={S.retryTxt}>Tap to retry</Text></TouchableOpacity></View>}
          </View>
          {zones.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={S.strip} contentContainerStyle={S.stripContent}>
              {zones.map(zone => (
                <TouchableOpacity key={zone.id} style={[S.chip, zone.markup_type === 'freehand' && S.chipFree]} onPress={() => handleTapZone(zone)} activeOpacity={0.75}>
                  <Ionicons name={zoneIcon(zone.markup_type)} size={16} color={zone.markup_type === 'freehand' ? '#F59E0B' : T.indigo} />
                  <Text style={S.chipText}>{zone.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      ) : (
        <ScrollView style={S.scroll} showsVerticalScrollIndicator={false}>
          <View style={S.section}>
            <TouchableOpacity style={S.openBtn} onPress={() => { setIsLoading(true); setPdfError(''); setShowPdf(true); }}>
              <Text style={S.openIcon}>📐</Text>
              <View style={{ flex: 1 }}>
                <Text style={S.openTitle}>{viewOnly ? 'View Drawing' : 'Open & Mark Up Drawing'}</Text>
                <Text style={S.openSub}>{viewOnly ? 'Tap markers to view observations' : 'Pinch to zoom · Pin · Area · Freehand'}</Text>
              </View>
              <Ionicons name="chevron-forward" size={22} color={T.indigo} />
            </TouchableOpacity>
          </View>
          <View style={S.section}>
            <Text style={S.sectionTitle}>Marked Zones ({zones.length})</Text>
            {zones.length === 0 ? (
              <View style={S.empty}>
                <Text style={S.emptyIcon}>📍</Text>
                <Text style={S.emptyTitle}>No zones yet</Text>
                <Text style={S.emptyBody}>{viewOnly ? 'No markup was added during this inspection' : 'Open the drawing and use the tools to mark zones'}</Text>
              </View>
            ) : zones.map(zone => (
              <TouchableOpacity key={zone.id} style={S.zoneRow} onPress={() => handleTapZone(zone)} activeOpacity={0.7}>
                <View style={[S.zoneBadge, zone.markup_type === 'freehand' && { backgroundColor: '#FEF3C7' }]}>
                  <Ionicons name={zoneIcon(zone.markup_type)} size={18} color={zone.markup_type === 'freehand' ? '#F59E0B' : T.indigo} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={S.zoneLabel}>{zone.label}</Text>
                  <Text style={S.zoneMeta}>{!zone.markup_type || zone.markup_type === 'pin' ? 'Pin marker' : zone.markup_type === 'rectangle' ? 'Area highlight' : 'Freehand drawing'}{' · Tap to inspect'}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={T.mid} />
              </TouchableOpacity>
            ))}
          </View>
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      <Modal visible={showModal} transparent animationType="slide" onRequestClose={() => setShowModal(false)}>
        <KeyboardAvoidingView style={S.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => { setShowModal(false); setPendingZone(null); setNewLabel(''); setLiveRect(null); setLivePath([]); }} />
          <View style={S.modalCard}>
            <Text style={S.modalTitle}>Name this zone</Text>
            <Text style={S.modalSub}>{pendingZone?.markup_type === 'pin' ? 'e.g. Column C3, Beam B1' : pendingZone?.markup_type === 'rectangle' ? 'e.g. Spalling area, Crack zone' : 'e.g. Crack pattern, Settlement area'}</Text>
            <TextInput style={S.modalInput} placeholder="Zone name..." placeholderTextColor="#94A3B8" value={newLabel} onChangeText={setNewLabel} autoFocus returnKeyType="done" onSubmitEditing={handleSave} />
            <View style={S.modalBtns}>
              <TouchableOpacity style={S.modalCancel} onPress={() => { setShowModal(false); setPendingZone(null); setNewLabel(''); }}>
                <Text style={S.modalCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.modalSave} onPress={handleSave}>
                <Text style={S.modalSaveTxt}>Save Zone</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const S = StyleSheet.create({
  container:     { flex: 1, backgroundColor: T.paper },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 60, paddingBottom: 12, gap: 12, backgroundColor: T.line, zIndex: 10 },
  backBtn:       {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.line,
    alignItems: 'center', justifyContent: 'center',
  },
  headerMid:     { flex: 1 },
  headerTitle:   { fontSize: 21, fontWeight: '800', color: T.indigo },
  headerSub:     { fontSize: 11, color: T.mid, marginTop: 1 },
  toggleBtn:     { backgroundColor: T.indigoSoft, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  toggleText:    { fontSize: 10, color: T.indigo, fontWeight: '700' },
  pdfScreen:     { flex: 1 },
  toolbar:       { flexDirection: 'row', backgroundColor: T.line, paddingVertical: 12, paddingHorizontal: 16, gap: 8, zIndex: 10 },
  toolBtn:       { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 22, paddingHorizontal: 10, borderRadius: 18, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, gap: 6 },
  toolBtnOn:     { backgroundColor: T.indigoSoft, borderColor: T.indigo },
  toolLabel:     { fontSize: 11, color: T.mid, fontWeight: '700' },
  toolLabelOn:   { color: T.indigo },
  hintBar:       { backgroundColor: T.paper, paddingVertical: 7, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: T.line, zIndex: 10 },
  hintText:      { fontSize: 12, color: T.mid, textAlign: 'center' },
  pdfWrap:       { flex: 1, overflow: 'hidden', backgroundColor: T.indigoSoft },
  overlay:       { ...StyleSheet.absoluteFillObject, backgroundColor: T.paper, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingTxt:    { color: T.mid, fontSize: 14 },
  errTxt:        { color: T.clay, fontSize: 14, textAlign: 'center', paddingHorizontal: 40 },
  retryTxt:      { color: T.indigo, fontSize: 14, fontWeight: '500' },
  labelBubble:   { backgroundColor: T.indigo, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20, alignSelf: 'center', marginBottom: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 6 },
  labelText:     { fontSize: 10, color: '#FFFFFF', fontWeight: '700' },
  labelFree:     { backgroundColor: '#F59E0B' },
  strip:         { backgroundColor: T.line, maxHeight: 76 },
  stripContent:  { paddingHorizontal: 16, gap: 10, alignItems: 'center', paddingVertical: 16 },
  chip:          { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: T.indigoSoft, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderColor: T.indigo },
  chipFree:      { backgroundColor: '#FEF3C7', borderColor: '#F59E0B' },
  chipText:      { fontSize: 14, color: T.indigo, fontWeight: '600' },
  scroll:        { flex: 1, backgroundColor: T.paper },
  section:       { padding: 20, paddingBottom: 8 },
  sectionTitle:  { fontSize: 12, fontWeight: '700', color: T.mid, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
  openBtn:       { flexDirection: 'row', alignItems: 'center', backgroundColor: T.surface, borderRadius: R.md, padding: 18, gap: 14, borderWidth: 1.5, borderColor: T.indigo, shadowColor: '#2C3950', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 2 },
  openIcon:      { fontSize: 24 },
  openTitle:     { fontSize: 16, fontWeight: '700', color: T.ink, marginBottom: 3 },
  openSub:       { fontSize: 12, color: T.mid },
  openArrow:     { fontSize: 24, color: T.indigo },
  empty:         { backgroundColor: T.surface, borderRadius: R.md, padding: 28, alignItems: 'center', borderWidth: 1, borderColor: T.line, borderStyle: 'dashed', gap: 8 },
  emptyIcon:     { fontSize: 36 },
  emptyTitle:    { fontSize: 15, color: T.ink, fontWeight: '500' },
  emptyBody:     { fontSize: 12, color: T.mid, textAlign: 'center', lineHeight: 18 },
  zoneRow:       { flexDirection: 'row', alignItems: 'center', backgroundColor: T.surface, borderRadius: R.md, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: T.line, gap: 12, shadowColor: '#2C3950', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 2 },
  zoneBadge:     { width: 36, height: 36, borderRadius: 10, backgroundColor: T.indigoSoft, alignItems: 'center', justifyContent: 'center' },
  zoneLabel:     { fontSize: 15, fontWeight: '600', color: T.ink, marginBottom: 2 },
  zoneMeta:      { fontSize: 11, color: T.mid },
  zoneArrow:     { fontSize: 20, color: T.mid },
  modalOverlay:  { flex: 1, justifyContent: 'flex-end' },
  modalCard:     { backgroundColor: T.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 10, borderTopWidth: 1, borderColor: T.line },
  modalTitle:    { fontSize: 18, fontWeight: '700', color: T.ink },
  modalSub:      { fontSize: 13, color: T.mid },
  modalInput:    { backgroundColor: T.paper, borderWidth: 1, borderColor: T.line, borderRadius: 10, padding: 14, fontSize: 15, color: T.ink, marginTop: 4 },
  modalBtns:     { flexDirection: 'row', gap: 10, marginTop: 6 },
  modalCancel:   { flex: 1, backgroundColor: T.indigoSoft, borderRadius: 10, padding: 14, alignItems: 'center' },
  modalCancelTxt:{ color: T.mid, fontSize: 15, fontWeight: '500' },
  modalSave:     { flex: 1, backgroundColor: T.indigo, borderRadius: 10, padding: 14, alignItems: 'center' },
  modalSaveTxt:  { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});