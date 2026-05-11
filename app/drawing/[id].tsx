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
} from 'react-native';
import { useState, useCallback } from 'react';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { supabase } from '../../lib/supabase';
import Pdf from 'react-native-pdf';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type Zone = {
  id: string;
  label: string;
  x_percent: number;
  y_percent: number;
};

export default function DrawingViewerScreen() {
  const params       = useLocalSearchParams();
  const drawingId    = params.id as string;
  const title        = params.title as string;
  const fileUrl      = params.file_url as string;
  const projectId    = params.project_id as string;
  const inspectionId = params.inspection_id as string;
  // view_only='true' means read-only from project page — no zones shown
  // view_only='false' means inside an active inspection — zones shown
  const viewOnly     = params.view_only === 'true';

  const [zones, setZones]               = useState<Zone[]>([]);
  const [isLoading, setIsLoading]       = useState(true);
  const [pdfError, setPdfError]         = useState('');
  const [showAddZone, setShowAddZone]   = useState(false);
  const [newZoneLabel, setNewZoneLabel] = useState('');
  const [pendingTap, setPendingTap]     = useState<{ x: number; y: number } | null>(null);
  const [pdfLayout, setPdfLayout]       = useState({ width: SCREEN_WIDTH, height: 500 });
  const [showPdf, setShowPdf]           = useState(false);

  const encodedUrl = encodeURI(decodeURIComponent(fileUrl));

  // ── FETCH ZONES — only when inside an active inspection ──
 const fetchZones = async () => {
  if (viewOnly) return;
  // Only load zones for THIS inspection — not all zones ever created
  // inspectionId being empty means don't load any zones
  if (!inspectionId) return;
  const { data, error } = await supabase
    .from('zones')
    .select('*')
    .eq('drawing_id', drawingId)
    .eq('inspection_id', inspectionId)
    .order('created_at', { ascending: true });
  if (!error) setZones(data as Zone[]);
};
  useFocusEffect(
    useCallback(() => {
      fetchZones();
    }, [drawingId, viewOnly])
  );

  // ── HANDLE TAP ON PDF ──────────────────────────────────
  const handlePdfTap = (page: number, x: number, y: number) => {
    const xPercent = (x / pdfLayout.width) * 100;
    const yPercent = (y / pdfLayout.height) * 100;
    setPendingTap({ x: xPercent, y: yPercent });
    setShowAddZone(true);
  };

  // ── SAVE NEW ZONE ──────────────────────────────────────
  const handleSaveZone = async () => {
    if (!newZoneLabel.trim()) {
      Alert.alert('Missing Label', 'Please enter a name for this zone.');
      return;
    }

  const { error } = await supabase.from('zones').insert({
      drawing_id:    drawingId,
      project_id:    projectId,
      inspection_id: inspectionId || null,
      label:         newZoneLabel.trim(),
      x_percent:     pendingTap?.x ?? 0,
      y_percent:     pendingTap?.y ?? 0,
    });

    if (error) { Alert.alert('Error', 'Could not save zone.'); return; }

    setNewZoneLabel('');
    setShowAddZone(false);
    setPendingTap(null);
    fetchZones();
  };

  // ── DELETE ZONE ────────────────────────────────────────
  const handleDeleteZone = (zone: Zone) => {
    Alert.alert('Delete Zone', `Delete "${zone.label}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await supabase.from('zones').delete().eq('id', zone.id);
          setZones(current => current.filter(z => z.id !== zone.id));
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
        <TouchableOpacity
          style={styles.viewToggle}
          onPress={() => {
            setIsLoading(true);
            setPdfError('');
            setShowPdf(!showPdf);
          }}
        >
          <Text style={styles.viewToggleText}>{showPdf ? 'Zones' : 'Drawing'}</Text>
        </TouchableOpacity>
      </View>

      {/* PDF VIEW */}
      {showPdf ? (
        <View style={styles.pdfContainer}>
          <View style={styles.hintBar}>
            <Text style={styles.hintText}>
              {viewOnly
                ? '👁 View only — start an inspection to mark zones'
                : '📍 Tap anywhere on the drawing to mark a zone · Tap a pin to inspect'}
            </Text>
          </View>

          <Pdf
            source={{
              uri: encodedUrl,
              cache: true,
            }}
            style={styles.pdf}
            onLoadComplete={(pages, path, size) => {
              setIsLoading(false);
              if (size) setPdfLayout({ width: size.width, height: size.height });
            }}
            onError={(error) => {
              setIsLoading(false);
              setPdfError('Could not load drawing. Please check your connection.');
              console.error('PDF error:', error);
            }}
            onPageSingleTap={viewOnly ? undefined : handlePdfTap}
            enablePaging={false}
            horizontal={false}
            fitPolicy={0}
            trustAllCerts={false}
          />

          {/* Zone pins on PDF */}
          {!isLoading && zones.map(zone => (
            <TouchableOpacity
              key={zone.id}
              style={[
                styles.zonePin,
                {
                  left: `${zone.x_percent}%` as any,
                  top: `${zone.y_percent}%` as any,
                },
              ]}
              onPress={() => router.push({
                pathname: '/observation',
                params: {
                  zone_id: zone.id,
                  zone_label: zone.label,
                  project_id: projectId,
                  inspection_id: '',
                },
              })}
              onLongPress={() => handleDeleteZone(zone)}
            >
              <View style={styles.pinDot} />
              <View style={styles.pinLabel}>
                <Text style={styles.pinLabelText}>{zone.label}</Text>
              </View>
            </TouchableOpacity>
          ))}

          {/* Loading overlay */}
          {isLoading && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#2563EB" />
              <Text style={styles.loadingText}>Loading drawing...</Text>
            </View>
          )}

          {/* Error overlay */}
          {pdfError ? (
            <View style={styles.loadingOverlay}>
              <Text style={styles.errorText}>{pdfError}</Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => {
                  setPdfError('');
                  setIsLoading(true);
                }}
              >
                <Text style={styles.retryText}>Tap to retry</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Zones strip at bottom */}
          {zones.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.zonesBar}
              contentContainerStyle={styles.zonesScroll}
            >
              {zones.map(zone => (
                <TouchableOpacity
                  key={zone.id}
                  style={styles.zoneChip}
                  onPress={() => router.push({
                    pathname: '/observation',
                    params: {
                      zone_id: zone.id,
                      zone_label: zone.label,
                      project_id: projectId,
                      inspection_id: '',
                    },
                  })}
                >
                  <Text style={styles.zoneChipText}>{zone.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      ) : (
        // ── ZONES LIST VIEW ──────────────────────────────
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>

          <View style={styles.section}>
            <TouchableOpacity
              style={styles.openPdfButton}
              onPress={() => {
                setIsLoading(true);
                setPdfError('');
                setShowPdf(true);
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.openPdfIcon}>📄</Text>
              <View style={styles.openPdfText}>
                <Text style={styles.openPdfTitle}>View Drawing</Text>
                <Text style={styles.openPdfSub}>
                  Tap to open PDF · Tap on drawing to mark zones
                </Text>
              </View>
              <Text style={styles.openPdfArrow}>›</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>
                {viewOnly ? 'Reference Drawing' : `Inspection Zones (${zones.length})`}
              </Text>
              {!viewOnly && (
                <TouchableOpacity
                  style={styles.addButton}
                  onPress={() => setShowAddZone(true)}
                >
                  <Text style={styles.addButtonText}>+ Add Zone</Text>
                </TouchableOpacity>
              )}
            </View>

            {viewOnly ? (
              <View style={styles.emptyZones}>
                <Text style={styles.emptyIcon}>👁</Text>
                <Text style={styles.emptyText}>View only</Text>
                <Text style={styles.emptyHint}>
                  Start an inspection from the project page to mark zones on this drawing
                </Text>
              </View>
            ) : (
              <>
                <Text style={styles.hint}>
                  Tap a zone to start an observation. Hold to delete.
                  Or open the drawing and tap directly on it to mark zones.
                </Text>

                {zones.length === 0 && (
                  <View style={styles.emptyZones}>
                    <Text style={styles.emptyIcon}>📍</Text>
                    <Text style={styles.emptyText}>No zones yet</Text>
                    <Text style={styles.emptyHint}>
                      Open the drawing and tap on it to mark zones,
                      or tap + Add Zone to add one manually
                    </Text>
                  </View>
                )}

                {zones.map((zone, index) => (
              <TouchableOpacity
                key={zone.id}
                style={styles.zoneCard}
                onPress={() => router.push({
                  pathname: '/observation',
                  params: {
                    zone_id: zone.id,
                    zone_label: zone.label,
                    project_id: projectId,
                    inspection_id: '',
                  },
                })}
                onLongPress={() => handleDeleteZone(zone)}
                activeOpacity={0.7}
              >
                <View style={styles.zoneNumber}>
                  <Text style={styles.zoneNumberText}>{index + 1}</Text>
                </View>
                <View style={styles.zoneInfo}>
                  <Text style={styles.zoneLabel}>{zone.label}</Text>
                  <Text style={styles.zoneMeta}>Tap to inspect · Hold to delete</Text>
                </View>
                <Text style={styles.zoneArrow}>›</Text>
              </TouchableOpacity>
            ))}
              </>
            )}
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* Add zone modal — only shown during active inspection */}
      {!viewOnly && (
      <Modal
        visible={showAddZone}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddZone(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setShowAddZone(false)}
          />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Name this zone</Text>
            <Text style={styles.modalSub}>
              e.g. Column C3, Slab Level 2, Beam B1
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Zone name..."
              placeholderTextColor="#4A5568"
              value={newZoneLabel}
              onChangeText={setNewZoneLabel}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleSaveZone}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => {
                  setShowAddZone(false);
                  setPendingTap(null);
                  setNewZoneLabel('');
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSave} onPress={handleSaveZone}>
                <Text style={styles.modalSaveText}>Save Zone</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A1628' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1C2E44',
  },
  backButton: { flexDirection: 'row', alignItems: 'center', gap: 6, width: 60 },
  backArrow: { fontSize: 20, color: '#2563EB' },
  backText: { fontSize: 16, color: '#2563EB' },
  headerTitle: { fontSize: 16, fontWeight: '600', color: '#FFFFFF', flex: 1, textAlign: 'center' },
  viewToggle: {
    backgroundColor: '#1C2E44', paddingHorizontal: 14,
    paddingVertical: 7, borderRadius: 8, width: 70, alignItems: 'center',
  },
  viewToggleText: { fontSize: 13, color: '#2563EB', fontWeight: '600' },
  pdfContainer: { flex: 1, position: 'relative' },
  hintBar: {
    backgroundColor: '#112240', paddingVertical: 8, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#1C2E44',
  },
  hintText: { fontSize: 12, color: '#8899AA', textAlign: 'center' },
  pdf: { flex: 1, width: SCREEN_WIDTH, backgroundColor: '#0A1628' },
  zonePin: {
    position: 'absolute', alignItems: 'center',
    transform: [{ translateX: -12 }, { translateY: -12 }],
  },
  pinDot: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#2563EB', borderWidth: 3, borderColor: '#FFFFFF',
  },
  pinLabel: {
    backgroundColor: '#2563EB', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 6, marginTop: 2, maxWidth: 120,
  },
  pinLabelText: { fontSize: 11, color: '#FFFFFF', fontWeight: '600' },
  loadingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#0A1628', alignItems: 'center', justifyContent: 'center', gap: 12,
  },
  loadingText: { color: '#8899AA', fontSize: 14 },
  errorText: { color: '#F87171', fontSize: 14, textAlign: 'center', paddingHorizontal: 40 },
  retryButton: {
    backgroundColor: '#1C2E44', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8,
  },
  retryText: { color: '#2563EB', fontSize: 14, fontWeight: '500' },
  zonesBar: {
    backgroundColor: '#112240', borderTopWidth: 1,
    borderTopColor: '#1C2E44', maxHeight: 50,
  },
  zonesScroll: { paddingHorizontal: 16, gap: 8, alignItems: 'center', paddingVertical: 8 },
  zoneChip: {
    backgroundColor: '#1C2E44', borderRadius: 20, paddingHorizontal: 14,
    paddingVertical: 6, borderWidth: 1, borderColor: '#2563EB',
  },
  zoneChipText: { fontSize: 12, color: '#2563EB', fontWeight: '500' },
  scroll: { flex: 1 },
  section: { padding: 20, paddingBottom: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#8899AA', textTransform: 'uppercase', letterSpacing: 1 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  openPdfButton: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#2563EB', borderRadius: 14, padding: 18, gap: 14,
  },
  openPdfIcon: { fontSize: 28 },
  openPdfText: { flex: 1 },
  openPdfTitle: { fontSize: 16, fontWeight: '700', color: '#FFFFFF', marginBottom: 3 },
  openPdfSub: { fontSize: 12, color: 'rgba(255,255,255,0.7)', lineHeight: 16 },
  openPdfArrow: { fontSize: 24, color: 'rgba(255,255,255,0.7)' },
  hint: { fontSize: 12, color: '#4A5568', fontStyle: 'italic', marginBottom: 14, lineHeight: 18 },
  addButton: {
    backgroundColor: '#1C2E44', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8,
  },
  addButtonText: { fontSize: 13, color: '#2563EB', fontWeight: '600' },
  emptyZones: {
    backgroundColor: '#112240', borderRadius: 12, padding: 28,
    alignItems: 'center', borderWidth: 1, borderColor: '#1C2E44',
    borderStyle: 'dashed', gap: 8,
  },
  emptyIcon: { fontSize: 32 },
  emptyText: { fontSize: 15, color: '#FFFFFF', fontWeight: '500' },
  emptyHint: { fontSize: 12, color: '#4A5568', textAlign: 'center', lineHeight: 18 },
  zoneCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#112240', borderRadius: 12,
    padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: '#1C2E44', gap: 12,
  },
  zoneNumber: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#2563EB', alignItems: 'center', justifyContent: 'center',
  },
  zoneNumberText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  zoneInfo: { flex: 1 },
  zoneLabel: { fontSize: 15, fontWeight: '600', color: '#FFFFFF', marginBottom: 2 },
  zoneMeta: { fontSize: 11, color: '#4A5568' },
  zoneArrow: { fontSize: 20, color: '#4A5568' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  modalCard: {
    backgroundColor: '#112240', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, gap: 10,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  modalSub: { fontSize: 13, color: '#8899AA' },
  modalInput: {
    backgroundColor: '#0A1628', borderWidth: 1, borderColor: '#2A3F55',
    borderRadius: 10, padding: 14, fontSize: 15, color: '#FFFFFF', marginTop: 4,
  },
  modalButtons: { flexDirection: 'row', gap: 10, marginTop: 6 },
  modalCancel: {
    flex: 1, backgroundColor: '#1C2E44', borderRadius: 10, padding: 14, alignItems: 'center',
  },
  modalCancelText: { color: '#8899AA', fontSize: 15, fontWeight: '500' },
  modalSave: { flex: 1, backgroundColor: '#2563EB', borderRadius: 10, padding: 14, alignItems: 'center' },
  modalSaveText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});
