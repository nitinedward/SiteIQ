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
} from 'react-native';
import { useState, useCallback } from 'react';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { supabase } from '../../lib/supabase';
import * as WebBrowser from 'expo-web-browser';

type Zone = {
  id: string;
  label: string;
  x_percent: number;
  y_percent: number;
};

export default function DrawingViewerScreen() {
  const params    = useLocalSearchParams();
  const drawingId = params.id as string;
  const title     = params.title as string;
  const fileUrl   = params.file_url as string;
  const projectId = params.project_id as string;

  const [zones, setZones]               = useState<Zone[]>([]);
  const [isLoading, setIsLoading]       = useState(false);
  const [showAddZone, setShowAddZone]   = useState(false);
  const [newZoneLabel, setNewZoneLabel] = useState('');

  // ── FETCH ZONES ────────────────────────────────────────
  const fetchZones = async () => {
    const { data, error } = await supabase
      .from('zones')
      .select('*')
      .eq('drawing_id', drawingId)
      .order('created_at', { ascending: true });
    if (!error) setZones(data as Zone[]);
  };

  useFocusEffect(
    useCallback(() => {
      fetchZones();
    }, [drawingId])
  );

  // ── OPEN PDF ───────────────────────────────────────────
  // Fetches the PDF as a blob, converts to base64 data URL
  // then opens in the browser — no native modules needed
  const handleOpenPdf = async () => {
    setIsLoading(true);
    try {
      // Fetch the PDF file from Supabase Storage
      const response = await fetch(fileUrl);

      if (!response.ok) {
        throw new Error(`Failed to fetch PDF: ${response.status}`);
      }

      const blob = await response.blob();

      // Convert blob to base64 data URL using FileReader
      // This is pure JavaScript — no native modules needed
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      // Open the base64 data URL in Safari
      // Safari can render PDF data URLs natively
      await WebBrowser.openBrowserAsync(base64);

    } catch (err) {
      console.error('PDF open error:', err);
      // Fallback — try opening the raw URL directly
      try {
        await WebBrowser.openBrowserAsync(fileUrl);
      } catch (fallbackErr) {
        Alert.alert(
          'Could Not Open PDF',
          'Please try again or check your internet connection.'
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  // ── SAVE NEW ZONE ──────────────────────────────────────
  const handleSaveZone = async () => {
    if (!newZoneLabel.trim()) {
      Alert.alert('Missing Label', 'Please enter a name for this zone.');
      return;
    }

    const { error } = await supabase.from('zones').insert({
      drawing_id: drawingId,
      project_id: projectId,
      label: newZoneLabel.trim(),
      x_percent: 0,
      y_percent: 0,
    });

    if (error) { Alert.alert('Error', 'Could not save zone.'); return; }

    setNewZoneLabel('');
    setShowAddZone(false);
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
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Open PDF button */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.openPdfButton}
            onPress={handleOpenPdf}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.openPdfIcon}>📄</Text>
            )}
            <View style={styles.openPdfText}>
              <Text style={styles.openPdfTitle}>
                {isLoading ? 'Loading drawing...' : 'View Drawing'}
              </Text>
              <Text style={styles.openPdfSub}>
                {isLoading
                  ? 'Downloading — please wait'
                  : 'Opens in Safari — pinch to zoom'}
              </Text>
            </View>
            {!isLoading && <Text style={styles.openPdfArrow}>›</Text>}
          </TouchableOpacity>
        </View>

        {/* Zones section */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>
              Inspection Zones ({zones.length})
            </Text>
            <TouchableOpacity
              style={styles.addButton}
              onPress={() => setShowAddZone(true)}
            >
              <Text style={styles.addButtonText}>+ Add Zone</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.hint}>
            Add zones for each area you need to inspect on this drawing.
            Tap a zone to start an observation. Hold to delete.
          </Text>

          {zones.length === 0 && (
            <View style={styles.emptyZones}>
              <Text style={styles.emptyIcon}>📍</Text>
              <Text style={styles.emptyText}>No zones yet</Text>
              <Text style={styles.emptyHint}>
                Tap + Add Zone to mark areas on this drawing
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
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Add zone modal */}
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
            <Text style={styles.modalTitle}>Add Inspection Zone</Text>
            <Text style={styles.modalSub}>
              Name the area you want to inspect on this drawing
            </Text>
            <Text style={styles.modalExamples}>
              e.g. Column C3, Slab Level 2, Beam B1, Foundation Grid A
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
  scroll: { flex: 1 },
  section: { padding: 20, paddingBottom: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#8899AA', textTransform: 'uppercase', letterSpacing: 1 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  openPdfButton: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#2563EB', borderRadius: 14,
    padding: 18, gap: 14,
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
  emptyHint: { fontSize: 12, color: '#4A5568', textAlign: 'center' },
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
  modalExamples: { fontSize: 12, color: '#4A5568', fontStyle: 'italic' },
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
