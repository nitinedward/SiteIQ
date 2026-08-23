import { theme } from '../../lib/theme'

const T = theme.colors;
const R = theme.radius;
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Image,
  Modal,
  FlatList,
  Alert,
} from 'react-native';
import { useState, useCallback, useEffect, useRef } from 'react';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { supabase } from '../../lib/supabase';
import Svg, { Circle, Rect, Path, G } from 'react-native-svg';
import {
  PanResponder,
  Animated,
} from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';

const { width: SW, height: SH } = Dimensions.get('window');

// ── TYPES ──────────────────────────────────────────────
type Zone = {
  id: string;
  label: string;
  x_percent: number;
  y_percent: number;
  markup_type: 'pin' | 'rectangle' | 'freehand';
  shape_data: string | null;
  drawing_id: string;
};

type Observation = {
  id: string;
  zone_id: string;
  notes: string;
  transcript: string;
  severity: string;
  photos: string[] | string | null;
  measurements: string;
  created_at: string;
};

// Safely parse photos regardless of how they're stored
const getPhotos = (obs: Observation): string[] => {
  if (!obs.photos) return [];
  if (Array.isArray(obs.photos)) return obs.photos;
  try { return JSON.parse(obs.photos as string); } catch { return []; }
};

type Drawing = {
  id: string;
  title: string;
  number: string;
  file_url: string;
  preview_url: string | null;
};

type Inspection = {
  id: string;
  date: string;
  report_no: string;
  weather: string;
  site_contact: string;
  contact_phone: string;
  purpose: string;
  drawing_ref: string;
  status: string;
};

type Pt = { x: number; y: number };
type PdfRect = { x: number; y: number; width: number; height: number };

const SEVERITY_COLOURS: Record<string, string> = {
  NONE:     '#94A3B8',
  LOW:      '#22C55E',
  MEDIUM:   '#F59E0B',
  HIGH:     '#EF4444',
  CRITICAL: '#7C3AED',
};

// ── ZONE OBSERVATION PANEL ─────────────────────────────
function ZonePanel({
  zone,
  observations,
  onClose,
}: {
  zone: Zone;
  observations: Observation[];
  onClose: () => void;
}) {
  const [fullscreenPhoto, setFullscreenPhoto] = useState<string | null>(null);
  const zoneObs = observations.filter(o => String(o.zone_id) === String(zone.id));

  return (
    <View style={P.overlay}>
      <TouchableOpacity style={P.backdrop} onPress={onClose} activeOpacity={1} />
      <View style={P.panel}>
        {/* Handle */}
        <View style={P.handle} />

        {/* Header */}
        <View style={P.panelHeader}>
          <View style={P.panelIcon}>
            <Text style={P.panelIconText}>
              {!zone.markup_type || zone.markup_type === 'pin' ? 'Pin'
                : zone.markup_type === 'rectangle' ? 'Area' : 'Draw'}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={P.panelTitle}>{zone.label}</Text>
            <Text style={P.panelSub}>
              {!zone.markup_type || zone.markup_type === 'pin' ? 'Pin marker'
                : zone.markup_type === 'rectangle' ? 'Area highlight' : 'Freehand'}
              {' - '}{zoneObs.length} observation{zoneObs.length !== 1 ? 's' : ''}
            </Text>
          </View>
          <TouchableOpacity style={P.closeBtn} onPress={onClose}>
            <Text style={P.closeBtnText}>x</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={P.panelScroll} showsVerticalScrollIndicator={false}>
          {zoneObs.length === 0 ? (
            <View style={P.emptyObs}>
              <Text style={P.emptyObsText}>No observations recorded for this zone</Text>
            </View>
          ) : (
            zoneObs.map((obs, idx) => {
              let measurements: any[] = [];
              try {
                measurements = typeof obs.measurements === 'string'
                  ? JSON.parse(obs.measurements || '[]')
                  : obs.measurements || [];
              } catch {}
              const severity = obs.severity || 'NONE';

              return (
                <View key={obs.id} style={P.obsCard}>
                  <View style={P.obsCardHeader}>
                    <Text style={P.obsCardNum}>Observation {idx + 1}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={[P.severityBadge, { backgroundColor: SEVERITY_COLOURS[severity] + '22' }]}>
                        <View style={[P.severityDot, { backgroundColor: SEVERITY_COLOURS[severity] }]} />
                        <Text style={[P.severityText, { color: SEVERITY_COLOURS[severity] }]}>
                          {severity}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={P.editBtn}
                        onPress={() => router.push({
                          pathname: '/observation',
                          params: {
                            observation_id: obs.id,
                            zone_label:     zone.label,
                            zone_id:        zone.id,
                          },
                        })}
                      >
                        <Text style={P.editBtnText}>Edit</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Photos */}
                  {getPhotos(obs).length > 0 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}
                      style={P.photoScroll} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
                      {getPhotos(obs).map((uri, i) => (
                        <TouchableOpacity key={i} onPress={() => setFullscreenPhoto(uri)}>
                          <Image source={{ uri }} style={P.photo} />
                          <View style={P.photoOverlay}>
                            <Text style={P.photoExpand}>+</Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}

                  {/* Transcript */}
                  {!!obs.transcript && (
                    <View style={P.transcriptBox}>
                      <Text style={P.transcriptLabel}>Voice Note</Text>
                      <Text style={P.transcriptText}>{obs.transcript}</Text>
                    </View>
                  )}

                  {/* Notes */}
                  {!!obs.notes && (
                    <View style={P.notesBox}>
                      <Text style={P.notesLabel}>Notes</Text>
                      <Text style={P.notesText}>{obs.notes}</Text>
                    </View>
                  )}

                  {/* Measurements */}
                  {measurements.length > 0 && (
                    <View style={P.measureBox}>
                      <Text style={P.measureLabel}>Measurements</Text>
                      {measurements.map((m: any, i: number) => (
                        <View key={i} style={P.measureRow}>
                          <Text style={P.measureName}>{m.label || m.type}</Text>
                          <Text style={P.measureValue}>{m.value} {m.unit}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              );
            })
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      </View>

      {/* Fullscreen photo */}
      <Modal visible={!!fullscreenPhoto} transparent animationType="fade">
        <TouchableOpacity
          style={P.fullscreen}
          activeOpacity={1}
          onPress={() => setFullscreenPhoto(null)}
        >
          {fullscreenPhoto && (
            <Image source={{ uri: fullscreenPhoto }}
              style={P.fullscreenImg} resizeMode="contain" />
          )}
          <TouchableOpacity style={P.fullscreenClose} onPress={() => setFullscreenPhoto(null)}>
            <Text style={P.fullscreenCloseText}>x</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// ── DRAWING TAB ────────────────────────────────────────
function DrawingTab({
  drawing,
  zones,
  observations,
  inspectionId,
}: {
  drawing: Drawing;
  zones: Zone[];
  observations: Observation[];
  inspectionId: string;
}) {
  const [isLoading, setIsLoading]   = useState(true);
  const [pdfError, setPdfError]     = useState('');
  const [pdfH, setPdfH]             = useState(SH);
  const [selectedZone, setSelectedZone] = useState<Zone | null>(null);
  const [wrapSize, setWrapSize]     = useState({ w: SW, h: SH });

  const pdfDims    = useRef({ pdfWidth: 1, pdfHeight: 1 });
  const naturalH   = useRef(SH);
  const pageLeft   = useRef(0);
  const pageTop    = useRef(0);
  const scale      = useRef(1);

  const animTx     = useRef(new Animated.Value(0)).current;
  const animTy     = useRef(new Animated.Value(0)).current;
  const animScale  = useRef(new Animated.Value(1)).current;

  const pdfWrapRef  = useRef<View>(null);
  const wrapTop     = useRef(0);
  const wrapLeft    = useRef(0);
  const pdfWrapH    = useRef(SH - 220);

  const lastDist   = useRef(0);
  const lastMid    = useRef<Pt>({ x: 0, y: 0 });
  const isPinching = useRef(false);
  const lastTouch  = useRef<Pt>({ x: 0, y: 0 });

  const drawingZones = zones.filter(z => z.drawing_id === drawing.id);

  // Load the pre-rendered preview image's real dimensions so the container
  // gets the correct aspect ratio. Using a plain <Image> instead of the
  // native PDF viewer avoids react-native-pdf's unreliable internal scaling,
  // which was clipping large landscape sheets (A3/A1).
  const loadPreviewDimensions = useCallback(() => {
    if (!drawing.preview_url) { setIsLoading(false); setPdfError('No preview available for this drawing. Please re-upload it from the web app.'); return; }
    setIsLoading(true); setPdfError('');
    Image.getSize(
      drawing.preview_url,
      (w, h) => {
        const computedH = SW * (h / w);
        naturalH.current = computedH;
        pdfDims.current  = { pdfWidth: w, pdfHeight: h };
        setPdfH(computedH);
        const containerH = pdfWrapH.current > 50 ? pdfWrapH.current : SH - 220;
        if (computedH > containerH) {
          const s = containerH / computedH;
          applyTransform((SW * (1 - s)) / 2, 0, s);
        } else {
          applyTransform(0, (containerH - computedH) / 2, 1);
        }
        setIsLoading(false);
      },
      () => { setIsLoading(false); setPdfError('Could not load drawing.'); }
    );
  }, [drawing.preview_url]);

  useEffect(() => { loadPreviewDimensions(); }, [loadPreviewDimensions]);

  const measureWrap = () => {
    pdfWrapRef.current?.measure((_x, _y, _w, _h, px, py) => {
      wrapLeft.current = px;
      wrapTop.current  = py;
    });
  };

  const applyTransform = (left: number, top: number, s: number) => {
    pageLeft.current = left;
    pageTop.current  = top;
    scale.current    = s;
    const h = naturalH.current;
    animTx.setValue(left + (SW * (s - 1)) / 2);
    animTy.setValue(top  + (h  * (s - 1)) / 2);
    animScale.setValue(s);
  };

  // Pan/zoom only — no drawing tools
  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder:  () => true,

    onPanResponderGrant: (evt) => {
      const { pageX, pageY, touches } = evt.nativeEvent;
      const lx = pageX - wrapLeft.current;
      const ly = pageY - wrapTop.current;
      lastTouch.current = { x: lx, y: ly };

      if (touches.length >= 2) {
        isPinching.current = true;
        const dx = touches[1].pageX - touches[0].pageX;
        const dy = touches[1].pageY - touches[0].pageY;
        lastDist.current = Math.sqrt(dx * dx + dy * dy);
        lastMid.current = {
          x: (touches[0].pageX + touches[1].pageX) / 2 - wrapLeft.current,
          y: (touches[0].pageY + touches[1].pageY) / 2 - wrapTop.current,
        };
      }
    },

    onPanResponderMove: (evt) => {
      const { pageX, pageY, touches } = evt.nativeEvent;

      if (touches.length >= 2 || isPinching.current) {
        if (touches.length < 2) return;
        isPinching.current = true;
        const dx   = touches[1].pageX - touches[0].pageX;
        const dy   = touches[1].pageY - touches[0].pageY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const mid  = {
          x: (touches[0].pageX + touches[1].pageX) / 2 - wrapLeft.current,
          y: (touches[0].pageY + touches[1].pageY) / 2 - wrapTop.current,
        };
        if (lastDist.current > 0) {
          const oldS    = scale.current;
          const newS    = Math.max(0.5, Math.min(8, oldS * (dist / lastDist.current)));
          const oldLeft = pageLeft.current;
          const oldTop  = pageTop.current;
          const newLeft = mid.x - (mid.x - oldLeft) * (newS / oldS);
          const newTop  = mid.y - (mid.y - oldTop)  * (newS / oldS);
          const panDx   = mid.x - lastMid.current.x;
          const panDy   = mid.y - lastMid.current.y;
          applyTransform(newLeft + panDx, newTop + panDy, newS);
        }
        lastDist.current = dist;
        lastMid.current  = mid;
        return;
      }

      // Single finger pan
      const lx = pageX - wrapLeft.current;
      const ly = pageY - wrapTop.current;
      applyTransform(
        pageLeft.current + (lx - lastTouch.current.x),
        pageTop.current  + (ly - lastTouch.current.y),
        scale.current
      );
      lastTouch.current = { x: lx, y: ly };
    },

    onPanResponderRelease: (evt) => {
      isPinching.current = false;
      lastDist.current   = 0;
    },
    onPanResponderTerminate: () => {
      isPinching.current = false;
      lastDist.current   = 0;
    },
  })).current;

  const pctToPage = (xPct: number, yPct: number): Pt => ({
    x: (xPct / 100) * SW,
    y: (yPct / 100) * naturalH.current,
  });

  const pdfRectToPage = (r: PdfRect): PdfRect => {
    const { pdfWidth, pdfHeight } = pdfDims.current;
    const h = naturalH.current;
    return {
      x:      (r.x      / pdfWidth)  * SW,
      y:      (r.y      / pdfHeight) * h,
      width:  (r.width  / pdfWidth)  * SW,
      height: (r.height / pdfHeight) * h,
    };
  };

  const renderSvg = () => (
    <Svg width={SW} height={pdfH} style={StyleSheet.absoluteFill} pointerEvents="none">
      {drawingZones.map(zone => {
        const sc = pctToPage(zone.x_percent, zone.y_percent);
        if (!zone.markup_type || zone.markup_type === 'pin') {
          return (
            <G key={zone.id}>
              <Circle cx={sc.x + 1} cy={sc.y + 2} r={10} fill="rgba(0,0,0,0.3)" />
              <Circle cx={sc.x} cy={sc.y} r={10} fill={T.indigo} />
              <Circle cx={sc.x} cy={sc.y} r={10} stroke="#FFF" strokeWidth={2} fill="none" />
              <Circle cx={sc.x} cy={sc.y} r={4}  fill="#FFF" />
            </G>
          );
        }
        if (zone.markup_type === 'rectangle' && zone.shape_data) {
          try {
            const pr = pdfRectToPage(JSON.parse(zone.shape_data));
            return <Rect key={zone.id} x={pr.x} y={pr.y} width={pr.width} height={pr.height}
              fill={T.indigo} fillOpacity={0.18} stroke={T.indigo} strokeWidth={2} />;
          } catch { return null; }
        }
        if (zone.markup_type === 'freehand' && zone.shape_data) {
          try {
            const pts: Pt[] = JSON.parse(zone.shape_data);
            const d = pts.map((p, i) => {
              const px = (p.x / pdfDims.current.pdfWidth)  * SW;
              const py = (p.y / pdfDims.current.pdfHeight) * naturalH.current;
              return `${i === 0 ? 'M' : 'L'} ${px} ${py}`;
            }).join(' ');
            return <Path key={zone.id} d={d} stroke="#F59E0B" strokeWidth={3}
              fill="none" strokeLinecap="round" strokeLinejoin="round" />;
          } catch { return null; }
        }
        return null;
      })}
    </Svg>
  );

  const renderLabels = () => drawingZones.map(zone => {
    const sc     = pctToPage(zone.x_percent, zone.y_percent);
    const isFree = zone.markup_type === 'freehand';
    const obsCount = observations.filter(o => String(o.zone_id) === String(zone.id)).length;
    return (
      <TouchableOpacity
        key={zone.id}
        style={{ position: 'absolute', left: sc.x - 80, top: sc.y - 46, zIndex: 10, width: 160, alignItems: 'center' }}
        onPress={() => setSelectedZone(zone)}
      >
        <View style={[D.labelBubble, isFree && D.labelFree]}>
          <Text style={D.labelText} numberOfLines={1}>{zone.label}</Text>
          {obsCount > 0 && (
            <View style={D.obsBadge}>
              <Text style={D.obsBadgeText}>{obsCount}</Text>
            </View>
          )}
        </View>
        {(!zone.markup_type || zone.markup_type === 'pin') && <View style={D.labelStem} />}
      </TouchableOpacity>
    );
  });

  return (
    <View style={{ flex: 1 }}>
      <View style={D.hintBar}>
        <Text style={D.hintText}>View only - Tap a marker to see observations - Pinch to zoom</Text>
      </View>

      <View
        ref={pdfWrapRef}
        style={D.pdfWrap}
        onLayout={(e) => { const h = e.nativeEvent.layout.height; if (h > 0) pdfWrapH.current = h; measureWrap(); setTimeout(measureWrap, 50); }}
        {...panResponder.panHandlers}
      >
        <Animated.View style={{
          position: 'absolute', top: 0, left: 0,
          width: SW, height: pdfH,
          transform: [{ translateX: animTx }, { translateY: animTy }, { scale: animScale }],
        }}>
          {!isLoading && !pdfError && drawing.preview_url && (
            <Image
              source={{ uri: drawing.preview_url }}
              style={{ width: SW, height: pdfH, backgroundColor: T.line }}
              resizeMode="contain"
            />
          )}
          {!isLoading && renderSvg()}
          {!isLoading && renderLabels()}
        </Animated.View>

        {isLoading && (
          <View style={D.overlay}>
            <ActivityIndicator size="large" color={T.indigo} />
            <Text style={D.overlayText}>Loading drawing...</Text>
          </View>
        )}
        {!!pdfError && (
          <View style={D.overlay}>
            <Text style={{ color: '#F87171', fontSize: 14 }}>{pdfError}</Text>
          </View>
        )}
      </View>

      {/* Zone observation panel */}
      {selectedZone && (
        <ZonePanel
          zone={selectedZone}
          observations={observations}
          onClose={() => setSelectedZone(null)}
        />
      )}
    </View>
  );
}

// ── BUILD REPORT HTML ──────────────────────────────────
function buildReportHtml(
  inspection: Inspection,
  projectName: string,
  zones: Zone[],
  observations: Observation[],
  drawings: Drawing[]
): string {
  const severityColour: Record<string, string> = {
    NONE: '#94A3B8', LOW: '#22C55E', MEDIUM: '#F59E0B', HIGH: '#EF4444', CRITICAL: '#7C3AED',
  };
  const drawingNames = drawings.map(d => d.number || d.title).join(', ') || '-';

  const zonesHtml = zones.map(zone => {
    const zoneObs = observations.filter(o => String(o.zone_id) === String(zone.id));
    const icon = !zone.markup_type || zone.markup_type === 'pin' ? '[Pin]'
      : zone.markup_type === 'rectangle' ? '[Area]' : '[Draw]';

    const obsHtml = zoneObs.length === 0
      ? '<p style="color:#64748B;font-style:italic">No observations recorded</p>'
      : zoneObs.map((obs, idx) => {
          const photos = getPhotos(obs);
          let measurements: any[] = [];
          try { measurements = typeof obs.measurements === 'string' ? JSON.parse(obs.measurements || '[]') : obs.measurements || []; } catch {}
          const severity = obs.severity || 'NONE';
          const colour   = severityColour[severity] || '#94A3B8';

          const photosHtml = photos.length > 0
            ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin:10px 0">
                ${photos.map(url =>
                  `<img src="${url}" style="width:160px;height:120px;object-fit:cover;border-radius:6px;border:1px solid #e2e8f0" />`
                ).join('')}
               </div>` : '';

          const transcriptHtml = obs.transcript
            ? `<div style="background:#EEF1F6;border-left:3px solid #3A4A63;padding:10px;border-radius:4px;margin:8px 0">
                <div style="font-size:11px;color:#64748b;margin-bottom:4px">VOICE NOTE</div>
                <div style="font-size:13px;color:#1e293b">${obs.transcript}</div>
               </div>` : '';

          const notesHtml = obs.notes
            ? `<div style="background:#f0fdf4;border-left:3px solid #16A34A;padding:10px;border-radius:4px;margin:8px 0">
                <div style="font-size:11px;color:#64748b;margin-bottom:4px">NOTES</div>
                <div style="font-size:13px;color:#1e293b">${obs.notes}</div>
               </div>` : '';

          const measureHtml = measurements.length > 0
            ? `<div style="margin:8px 0">
                <div style="font-size:11px;color:#64748b;margin-bottom:6px">MEASUREMENTS</div>
                ${measurements.map((m: any) =>
                  `<div style="display:flex;justify-content:space-between;padding:6px 10px;background:#f8fafc;border-radius:4px;margin:3px 0">
                    <span style="color:#64748b">${m.label || m.type}</span>
                    <strong>${m.value} ${m.unit}</strong>
                   </div>`
                ).join('')}
               </div>` : '';

          return `
            <div style="border:1px solid #e2e8f0;border-radius:6px;padding:14px;margin:8px 0;background:#fff">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                <span style="font-size:12px;color:#64748b;font-weight:600">OBSERVATION ${idx + 1}</span>
                <span style="background:${colour}22;color:${colour};padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">${severity}</span>
              </div>
              ${photosHtml}${transcriptHtml}${notesHtml}${measureHtml}
            </div>`;
        }).join('');

    return `
      <div style="border:1px solid #e2e8f0;border-radius:8px;margin:16px 0;overflow:hidden">
        <div style="background:#f8fafc;padding:14px 16px;border-bottom:1px solid #e2e8f0">
          <span style="font-size:18px">${icon}</span>
          <span style="font-size:15px;font-weight:700;color:#1e293b;margin-left:8px">${zone.label}</span>
          <span style="font-size:12px;color:#64748b;margin-left:8px">${zoneObs.length} observation${zoneObs.length !== 1 ? 's' : ''}</span>
        </div>
        <div style="padding:14px;background:#fafafa">${obsHtml}</div>
      </div>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
* { box-sizing:border-box; margin:0; padding:0; }
body { font-family:-apple-system,Helvetica,Arial,sans-serif; color:#1e293b; background:#fff; }
.page { max-width:800px; margin:0 auto; padding:40px 32px; }
</style></head><body><div class="page">
  <div style="border-bottom:3px solid #3A4A63;padding-bottom:24px;margin-bottom:28px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Site Inspection Report</div>
        <div style="font-size:24px;font-weight:800;color:#3A4A63">${projectName}</div>
      </div>
      <div style="background:#3A4A63;color:#fff;padding:6px 16px;border-radius:20px;font-size:13px;font-weight:700">Report #${inspection.report_no}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:20px 0;background:#f8fafc;border-radius:8px;padding:16px">
      <div><div style="font-size:11px;color:#64748b;text-transform:uppercase;margin-bottom:3px">Date</div><div style="font-size:13px;font-weight:600">${inspection.date}</div></div>
      <div><div style="font-size:11px;color:#64748b;text-transform:uppercase;margin-bottom:3px">Weather</div><div style="font-size:13px;font-weight:600">${inspection.weather || '—'}</div></div>
      <div><div style="font-size:11px;color:#64748b;text-transform:uppercase;margin-bottom:3px">Site Contact</div><div style="font-size:13px;font-weight:600">${inspection.site_contact || '—'}</div></div>
      <div><div style="font-size:11px;color:#64748b;text-transform:uppercase;margin-bottom:3px">Phone</div><div style="font-size:13px;font-weight:600">${inspection.contact_phone || '—'}</div></div>
      <div><div style="font-size:11px;color:#64748b;text-transform:uppercase;margin-bottom:3px">Drawings</div><div style="font-size:13px;font-weight:600">${drawingNames}</div></div>
      <div><div style="font-size:11px;color:#64748b;text-transform:uppercase;margin-bottom:3px">Total Zones</div><div style="font-size:13px;font-weight:600">${zones.length}</div></div>
    </div>
    ${inspection.purpose ? `<div style="background:#EEF1F6;border-left:3px solid #3A4A63;padding:12px;border-radius:4px"><div style="font-size:11px;color:#64748b;margin-bottom:4px;font-weight:600">PURPOSE / SCOPE</div><div style="font-size:13px">${inspection.purpose}</div></div>` : ''}
  </div>

  <div style="font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin:28px 0 12px;border-top:1px solid #e2e8f0;padding-top:20px">
    Findings — ${zones.length} Marked Zone${zones.length !== 1 ? 's' : ''}
  </div>
  ${zones.length === 0 ? '<p style="color:#94a3b8;font-style:italic">No zones were marked up.</p>' : zonesHtml}

  <div style="margin-top:40px;padding-top:16px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:11px;color:#94a3b8">
    <span>SiteIQ · Generated ${new Date().toLocaleDateString()}</span>
    <span>Report #${inspection.report_no} · ${projectName}</span>
  </div>
</div></body></html>`;
}

// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
export default function ReportScreen() {
  const params       = useLocalSearchParams();
  const inspectionId = params.id as string;
  const projectName  = params.project_name as string;

  const [isLoading, setIsLoading]       = useState(true);
  const [isExporting, setIsExporting]   = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [inspection, setInspection]     = useState<Inspection | null>(null);
  const [zones, setZones]               = useState<Zone[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [drawings, setDrawings]         = useState<Drawing[]>([]);
  const [activeTab, setActiveTab]       = useState<'drawing' | 'report'>('drawing');
  const [activeDrawingIdx, setActiveDrawingIdx] = useState(0);

  const fetchAll = async () => {
    setIsLoading(true);

    // Fetch inspection details
    const { data: inspData } = await supabase
      .from('inspections')
      .select('*')
      .eq('id', inspectionId)
      .single();
    setInspection(inspData as Inspection);

    // Fetch all zones for this inspection
    const { data: zonesData } = await supabase
      .from('zones')
      .select('*')
      .eq('inspection_id', inspectionId);
    const zoneList = (zonesData as Zone[]) ?? [];
    setZones(zoneList);

    // Fetch all observations for this inspection
    const { data: obsData } = await supabase
      .from('observations')
      .select('*')
      .eq('inspection_id', inspectionId);
    setObservations((obsData as Observation[]) ?? []);

    // Get unique drawing IDs from zones
    const drawingIds = [...new Set(zoneList.map(z => z.drawing_id))];

    if (drawingIds.length > 0) {
      const { data: drawingsData } = await supabase
        .from('drawings')
        .select('*')
        .in('id', drawingIds);
      setDrawings((drawingsData as Drawing[]) ?? []);
    }

    setIsLoading(false);
  };

  useFocusEffect(useCallback(() => { fetchAll(); }, [inspectionId]));

  // ── GENERATE PDF ───────────────────────────────────────
  const generatePdf = async () => {
    if (!inspection) return;
    setIsExporting(true);
    try {
      const html = buildReportHtml(inspection, projectName, zones, observations, drawings);
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: `Site Report - ${projectName} #${inspection.report_no}`,
        UTI: 'com.adobe.pdf',
      });
    } catch (e) {
      Alert.alert('Export Failed', 'Could not generate PDF. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  // ── GENERATE AI WORD REPORT ────────────────────────────
  const generateWordReport = async () => {
    if (!inspection) return;

    // Check firm has a template
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: memberData } = await supabase
      .from('firm_members')
      .select('firm_id, full_name, firms(name, report_template_url)')
      .eq('user_id', user.id)
      .single();

    const templateUrl = (memberData?.firms as any)?.report_template_url;

    if (!templateUrl) {
      Alert.alert(
        'No Template',
        'Your firm admin needs to upload a Word template in Firm Settings before you can generate AI reports.',
        [{ text: 'OK' }]
      );
      return;
    }

    setIsGenerating(true);

    try {
      // 1. Generate the AI report via the web backend (handles Anthropic + template processing)
      const genRes = await fetch('https://www.site-iq.co.nz/api/docs/ai-generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ inspectionId }),
      });

      if (!genRes.ok) {
        const errData = await genRes.json().catch(() => ({}));
        throw new Error((errData as any).error || 'AI generation failed');
      }

      // 2. Download the generated .docx
      const fileName = `SiteIQ-Report-${(projectName || 'Report').replace(/[^a-zA-Z0-9]/g, '-')}-${inspection.report_no}.docx`;
      const fileUri  = FileSystem.documentDirectory + fileName;

      const dl = await FileSystem.downloadAsync(
        `https://www.site-iq.co.nz/api/docs/${inspectionId}?download=true`,
        fileUri
      );

      if (dl.status !== 200) throw new Error('Could not download the generated report');

      // 3. Share
      await Sharing.shareAsync(dl.uri, {
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        dialogTitle: `${projectName} - Report #${inspection.report_no}`,
        UTI: 'org.openxmlformats.wordprocessingml.document',
      });

    } catch (err: any) {
      console.error('Report generation error:', err);
      Alert.alert('Generation Failed', `Could not generate report: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const activeDrawing = drawings[activeDrawingIdx] ?? null;

  if (isLoading) {
    return (
      <View style={S.container}>
        <View style={S.header}>
          <TouchableOpacity style={S.backBtn} onPress={() => router.back()}>
            <Text style={S.backArrow}>{'<'}</Text>
            <Text style={S.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={S.headerTitle}>Site Report</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={S.centred}>
          <ActivityIndicator size="large" color={T.indigo} />
          <Text style={S.loadingText}>Loading report...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={S.container}>
      {/* Header */}
      <View style={S.header}>
        <TouchableOpacity style={S.backBtn} onPress={() => router.back()}>
          <Text style={S.backArrow}>{'<'}</Text>
          <Text style={S.backText}>Back</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={S.headerTitle} numberOfLines={1}>{projectName}</Text>
          <Text style={S.headerSub}>Report #{inspection?.report_no} - {inspection?.date}</Text>
        </View>
        <TouchableOpacity style={S.exportBtn} onPress={generateWordReport} disabled={isGenerating || isExporting}>
          {isGenerating
            ? <ActivityIndicator size="small" color={T.indigo} />
            : <Text style={S.exportBtnText}>AI Report</Text>}
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={S.tabs}>
        <TouchableOpacity
          style={[S.tab, activeTab === 'drawing' && S.tabOn]}
          onPress={() => setActiveTab('drawing')}
        >
          <Text style={[S.tabText, activeTab === 'drawing' && S.tabTextOn]}>Drawing</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[S.tab, activeTab === 'report' && S.tabOn]}
          onPress={() => setActiveTab('report')}
        >
          <Text style={[S.tabText, activeTab === 'report' && S.tabTextOn]}>Report</Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'drawing' ? (
        <View style={{ flex: 1 }}>
          {/* Drawing selector if multiple drawings */}
          {drawings.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              style={S.drawingStrip} contentContainerStyle={S.drawingStripContent}>
              {drawings.map((d, i) => (
                <TouchableOpacity key={d.id}
                  style={[S.drawingChip, i === activeDrawingIdx && S.drawingChipOn]}
                  onPress={() => setActiveDrawingIdx(i)}>
                  <Text style={[S.drawingChipText, i === activeDrawingIdx && S.drawingChipTextOn]}>
                    {d.number || d.title}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {drawings.length === 0 ? (
            <View style={S.centred}>
              <Text style={S.emptyIcon}>PDF</Text>
              <Text style={S.emptyText}>No drawings were marked up in this inspection</Text>
            </View>
          ) : activeDrawing ? (
            <DrawingTab
              key={activeDrawing.id}
              drawing={activeDrawing}
              zones={zones}
              observations={observations}
              inspectionId={inspectionId}
            />
          ) : null}
        </View>
      ) : (
        // ── REPORT TAB ──────────────────────────────────
        <ScrollView style={S.scroll} showsVerticalScrollIndicator={false}>
          {/* Inspection details */}
          <View style={S.reportSection}>
            <Text style={S.reportSectionTitle}>Inspection Details</Text>
            <View style={S.detailsCard}>
              <DetailRow label="Date"         value={inspection?.date ?? '—'} />
              <DetailRow label="Report No"    value={`#${inspection?.report_no ?? '—'}`} />
              <DetailRow label="Weather"      value={inspection?.weather ?? '—'} />
              <DetailRow label="Site Contact" value={inspection?.site_contact || '—'} />
              <DetailRow label="Phone"        value={inspection?.contact_phone || '—'} />
              <DetailRow label="Drawings"     value={inspection?.drawing_ref || '—'} />
              {!!inspection?.purpose && (
                <View style={S.purposeBox}>
                  <Text style={S.purposeLabel}>Purpose / Scope</Text>
                  <Text style={S.purposeText}>{inspection.purpose}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Zones and observations */}
          <View style={S.reportSection}>
            <Text style={S.reportSectionTitle}>
              Findings ({zones.length} zone{zones.length !== 1 ? 's' : ''})
            </Text>

            {zones.length === 0 ? (
              <View style={S.emptyCard}>
                <Text style={S.emptyText}>No zones were marked up in this inspection</Text>
              </View>
            ) : zones.map(zone => {
              const zoneObs = observations.filter(o => String(o.zone_id) === String(zone.id));
              return (
                <View key={zone.id} style={S.zoneCard}>
                  <View style={S.zoneCardHeader}>
                    <Text style={S.zoneCardIcon}>
                      {!zone.markup_type || zone.markup_type === 'pin' ? 'Pin'
                        : zone.markup_type === 'rectangle' ? 'Area' : 'Draw'}
                    </Text>
                    <Text style={S.zoneCardLabel}>{zone.label}</Text>
                    <Text style={S.zoneCardCount}>{zoneObs.length} obs</Text>
                  </View>

                  {zoneObs.map((obs, idx) => {
                    let measurements: { label: string; value: string; unit: string }[] = [];
                    try { measurements = typeof obs.measurements === 'string' ? JSON.parse(obs.measurements || '[]') : obs.measurements || []; } catch {}
                    const severity = obs.severity || 'NONE';

                    return (
                      <View key={obs.id} style={S.obsRow}>
                        <View style={S.obsRowHeader}>
                          <Text style={S.obsRowNum}>Obs {idx + 1}</Text>
                          <View style={[S.severityPill, { backgroundColor: SEVERITY_COLOURS[severity] + '22' }]}>
                            <Text style={[S.severityPillText, { color: SEVERITY_COLOURS[severity] }]}>
                              {severity}
                            </Text>
                          </View>
                        </View>

                        {getPhotos(obs).length > 0 && (
                          <Text style={S.obsDetail}>Photos: {getPhotos(obs).length} photo{getPhotos(obs).length !== 1 ? 's' : ''}</Text>
                        )}
                        {!!obs.transcript && (
                          <Text style={S.obsDetail} numberOfLines={3}>Voice: {obs.transcript}</Text>
                        )}
                        {!!obs.notes && (
                          <Text style={S.obsDetail} numberOfLines={2}>Notes: {obs.notes}</Text>
                        )}
                        {measurements.length > 0 && (
                          <Text style={S.obsDetail}>
                            Measurements: {measurements.map((m: any) => `${m.label || m.type}: ${m.value}${m.unit}`).join(', ')}
                          </Text>
                        )}
                      </View>
                    );
                  })}
                </View>
              );
            })}
          </View>
          <View style={{ height: 50 }} />
        </ScrollView>
      )}
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={S.detailRow}>
      <Text style={S.detailLabel}>{label}</Text>
      <Text style={S.detailValue}>{value}</Text>
    </View>
  );
}

// ── STYLES ─────────────────────────────────────────────
const S = StyleSheet.create({
  container:          { flex: 1, backgroundColor: T.paper },
  header:             { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 60, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: T.line, backgroundColor: T.surface },
  backBtn:            { flexDirection: 'row', alignItems: 'center', gap: 4, width: 60 },
  backArrow:          { fontSize: 20, color: T.indigo },
  backText:           { fontSize: 14, color: T.indigo },
  headerTitle:        { fontSize: 14, fontWeight: '700', color: T.ink },
  headerSub:          { fontSize: 11, color: T.mid, marginTop: 2 },
  tabs:               { flexDirection: 'row', backgroundColor: T.surface, borderBottomWidth: 1, borderBottomColor: T.line },
  tab:                { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabOn:              { borderBottomWidth: 2, borderBottomColor: T.indigo },
  tabText:            { fontSize: 13, color: T.mid, fontWeight: '600' },
  tabTextOn:          { color: T.indigo },
  drawingStrip:       { backgroundColor: T.surface, borderBottomWidth: 1, borderBottomColor: T.line, maxHeight: 48 },
  drawingStripContent:{ paddingHorizontal: 16, gap: 8, alignItems: 'center', paddingVertical: 10 },
  drawingChip:        { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: T.line, borderWidth: 1, borderColor: T.line },
  drawingChipOn:      { backgroundColor: T.indigoSoft, borderColor: T.indigo },
  drawingChipText:    { fontSize: 12, color: T.mid, fontWeight: '500' },
  drawingChipTextOn:  { color: T.indigo },
  exportBtn:          { backgroundColor: T.indigoSoft, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: T.indigo, minWidth: 60, alignItems: 'center' },
  exportBtnText:      { fontSize: 12, color: T.indigo, fontWeight: '700' },
  centred:            { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText:        { color: T.mid, fontSize: 14 },
  emptyIcon:          { fontSize: 32 },
  emptyText:          { fontSize: 14, color: T.mid, textAlign: 'center', paddingHorizontal: 40 },
  scroll:             { flex: 1 },
  reportSection:      { padding: 20, paddingBottom: 8 },
  reportSectionTitle: { fontSize: 13, fontWeight: '600', color: T.mid, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
  detailsCard:        { backgroundColor: T.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: T.line, gap: 10 },
  detailRow:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  detailLabel:        { fontSize: 13, color: T.mid, fontWeight: '500' },
  detailValue:        { fontSize: 13, color: T.ink, fontWeight: '600', flex: 1, textAlign: 'right' },
  purposeBox:         { borderTopWidth: 1, borderTopColor: T.line, paddingTop: 10, gap: 6 },
  purposeLabel:       { fontSize: 12, color: T.mid, fontWeight: '500' },
  purposeText:        { fontSize: 13, color: T.ink, lineHeight: 20 },
  zoneCard:           { backgroundColor: T.surface, borderRadius: 14, marginBottom: 12, borderWidth: 1, borderColor: T.line, overflow: 'hidden' },
  zoneCardHeader:     { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: T.line, gap: 10 },
  zoneCardIcon:       { fontSize: 18 },
  zoneCardLabel:      { fontSize: 15, fontWeight: '700', color: T.ink, flex: 1 },
  zoneCardCount:      { fontSize: 12, color: T.mid },
  obsRow:             { padding: 14, borderBottomWidth: 1, borderBottomColor: T.line, gap: 6 },
  obsRowHeader:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  obsRowNum:          { fontSize: 12, color: T.mid, fontWeight: '600' },
  severityPill:       { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  severityPillText:   { fontSize: 11, fontWeight: '700' },
  obsDetail:          { fontSize: 13, color: T.mid, lineHeight: 18 },
  emptyCard:          { backgroundColor: T.surface, borderRadius: 14, padding: 20, alignItems: 'center', borderWidth: 1, borderColor: T.line },
});

// Drawing tab styles
const D = StyleSheet.create({
  hintBar:     { backgroundColor: T.indigoSoft, paddingVertical: 7, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: T.line },
  hintText:    { fontSize: 12, color: T.mid, textAlign: 'center' },
  pdfWrap:     { flex: 1, overflow: 'hidden', backgroundColor: T.line },
  overlay:     { ...StyleSheet.absoluteFillObject, backgroundColor: T.paper, alignItems: 'center', justifyContent: 'center', gap: 12 },
  overlayText: { color: T.mid, fontSize: 14 },
  labelBubble: { backgroundColor: T.indigo, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.5, shadowRadius: 4, elevation: 6 },
  labelFree:   { backgroundColor: '#D97706' },
  labelText:   { fontSize: 12, color: '#FFFFFF', fontWeight: '700' },
  labelStem:   { width: 2, height: 8, backgroundColor: T.indigo },
  obsBadge:    { backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 },
  obsBadgeText:{ fontSize: 10, color: '#FFFFFF', fontWeight: '700' },
});

// Zone panel styles
const P = StyleSheet.create({
  overlay:          { ...StyleSheet.absoluteFillObject, zIndex: 100 },
  backdrop:         { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  panel:            { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: T.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: SH * 0.75, borderTopWidth: 1, borderColor: T.line },
  handle:           { width: 40, height: 4, backgroundColor: T.line, borderRadius: 2, alignSelf: 'center', marginTop: 12 },
  panelHeader:      { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: T.line, gap: 12 },
  panelIcon:        { width: 40, height: 40, borderRadius: 10, backgroundColor: T.indigoSoft, alignItems: 'center', justifyContent: 'center' },
  panelIconText:    { fontSize: 20 },
  panelTitle:       { fontSize: 17, fontWeight: '700', color: T.ink },
  panelSub:         { fontSize: 12, color: T.mid, marginTop: 2 },
  closeBtn:         { width: 32, height: 32, borderRadius: 16, backgroundColor: T.indigoSoft, alignItems: 'center', justifyContent: 'center' },
  closeBtnText:     { fontSize: 14, color: T.mid },
  panelScroll:      { flex: 1 },
  emptyObs:         { padding: 30, alignItems: 'center' },
  emptyObsText:     { fontSize: 14, color: T.mid, textAlign: 'center' },
  obsCard:          { margin: 16, marginBottom: 12, backgroundColor: T.surface, borderRadius: 12, borderWidth: 1, borderColor: T.line, overflow: 'hidden' },
  obsCardHeader:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderBottomWidth: 1, borderBottomColor: T.line },
  editBtn:          { backgroundColor: T.indigoSoft, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: T.indigo },
  editBtnText:      { fontSize: 11, color: T.indigo, fontWeight: '700' },
  obsCardNum:       { fontSize: 13, color: T.mid, fontWeight: '600' },
  severityBadge:    { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  severityDot:      { width: 6, height: 6, borderRadius: 3 },
  severityText:     { fontSize: 11, fontWeight: '700' },
  photoScroll:      { marginVertical: 12 },
  photo:            { width: 120, height: 120, borderRadius: 8 },
  photoOverlay:     { position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  photoExpand:      { fontSize: 12, color: '#FFFFFF' },
  transcriptBox:    { margin: 12, marginTop: 0, backgroundColor: T.indigoSoft, borderRadius: 8, padding: 12, borderLeftWidth: 3, borderLeftColor: T.indigo },
  transcriptLabel:  { fontSize: 11, color: T.mid, marginBottom: 6, fontWeight: '600' },
  transcriptText:   { fontSize: 13, color: T.ink, lineHeight: 20 },
  notesBox:         { margin: 12, marginTop: 0, backgroundColor: T.sageSoft, borderRadius: 8, padding: 12, borderLeftWidth: 3, borderLeftColor: T.sage },
  notesLabel:       { fontSize: 11, color: T.mid, marginBottom: 6, fontWeight: '600' },
  notesText:        { fontSize: 13, color: T.ink, lineHeight: 20 },
  measureBox:       { margin: 12, marginTop: 0, gap: 6 },
  measureLabel:     { fontSize: 11, color: T.mid, fontWeight: '600' },
  measureRow:       { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: T.paper, borderRadius: 8, padding: 10 },
  measureName:      { fontSize: 13, color: T.mid },
  measureValue:     { fontSize: 13, color: T.ink, fontWeight: '600' },
  fullscreen:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', alignItems: 'center', justifyContent: 'center' },
  fullscreenImg:    { width: SW, height: SH * 0.85 },
  fullscreenClose:  { position: 'absolute', top: 60, right: 20, backgroundColor: T.indigoSoft, borderRadius: 20, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  fullscreenCloseText: { fontSize: 16, color: T.ink },
});