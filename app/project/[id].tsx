import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, router, useFocusEffect } from 'expo-router';
import { useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import * as DocumentPicker from 'expo-document-picker';

type Project = {
  id: string;
  name: string;
  address: string;
  client_name: string;
  project_number: string;
  status: 'ACTIVE' | 'ON_HOLD' | 'COMPLETED';
  description: string;
  last_inspection: string;
  drawing_count: number;
  created_at: string;
};

type Drawing = {
  id: string;
  title: string;
  number: string;
  revision: string;
  file_url: string;
  file_name: string;
  created_at: string;
};

const statusConfig = {
  ACTIVE:    { colour: '#34D399', bg: '#0D3B2E', label: 'Active' },
  ON_HOLD:   { colour: '#FBBF24', bg: '#3B2E0D', label: 'On Hold' },
  COMPLETED: { colour: '#60A5FA', bg: '#1E3A5F', label: 'Completed' },
};

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams();

  const [project, setProject]         = useState<Project | null>(null);
  const [drawings, setDrawings]       = useState<Drawing[]>([]);
  const [isLoading, setIsLoading]     = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMsg, setErrorMsg]       = useState('');

  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [drawingTitle, setDrawingTitle]       = useState('');
  const [drawingNumber, setDrawingNumber]     = useState('');
  const [selectedFile, setSelectedFile]       = useState<{ uri: string; name: string } | null>(null);

  // ── FETCH DATA ─────────────────────────────────────────
  const fetchData = async () => {
    setIsLoading(true);
    setErrorMsg('');

    const { data: projectData, error: projectError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', id)
      .single();

    if (projectError) {
      setErrorMsg('Project not found.');
      setIsLoading(false);
      return;
    }

    setProject(projectData as Project);

    const { data: drawingsData, error: drawingsError } = await supabase
      .from('drawings')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: false });

    if (!drawingsError) setDrawings(drawingsData as Drawing[]);

    setIsLoading(false);
  };

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [id])
  );

  // ── PICK PDF FILE ──────────────────────────────────────
  const handlePickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf'],
      copyToCacheDirectory: true,
    });

    if (result.canceled) return;

    const file = result.assets[0];
    setSelectedFile({ uri: file.uri, name: file.name });
    setDrawingTitle(file.name.replace('.pdf', '').replace(/-/g, ' '));
    setShowUploadModal(true);
  };

  // ── UPLOAD DRAWING ─────────────────────────────────────
  const handleUpload = async () => {
    if (!drawingTitle.trim()) {
      Alert.alert('Missing Title', 'Please enter a title for this drawing.');
      return;
    }
    if (!selectedFile) {
      Alert.alert('No File', 'Please select a PDF file first.');
      return;
    }

    setIsUploading(true);
    setShowUploadModal(false);

    try {
      const response = await fetch(selectedFile.uri);
      const blob = await response.blob();
      const uploadFileName = `${Date.now()}-${selectedFile.name}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('drawings')
        .upload(uploadFileName, blob, {
          contentType: 'application/pdf',
          upsert: false,
        });

      if (uploadError) {
        Alert.alert('Upload Failed', uploadError.message);
        setIsUploading(false);
        return;
      }

      const { data: urlData } = supabase.storage
        .from('drawings')
        .getPublicUrl(uploadData.path);

      const { error: dbError } = await supabase
        .from('drawings')
        .insert({
          project_id: id,
          title: drawingTitle.trim(),
          number: drawingNumber.trim(),
          revision: 'A',
          file_url: urlData.publicUrl,
          file_name: selectedFile.name,
        });

      if (dbError) {
        Alert.alert('Save Failed', dbError.message);
        setIsUploading(false);
        return;
      }

      await supabase
        .from('projects')
        .update({ drawing_count: drawings.length + 1 })
        .eq('id', id);

      setDrawingTitle('');
      setDrawingNumber('');
      setSelectedFile(null);

      Alert.alert('✅ Drawing Uploaded', `"${drawingTitle}" has been added.`);
      fetchData();
    } catch (err) {
      Alert.alert('Upload Failed', 'Something went wrong. Please try again.');
      console.error('Drawing upload error:', err);
    } finally {
      setIsUploading(false);
    }
  };

  // ── DELETE DRAWING ─────────────────────────────────────
  const handleDeleteDrawing = (drawing: Drawing) => {
    Alert.alert(
      'Delete Drawing',
      `Are you sure you want to delete "${drawing.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            await supabase.from('drawings').delete().eq('id', drawing.id);
            setDrawings(current => current.filter(d => d.id !== drawing.id));
          },
        },
      ]
    );
  };

  // ── LOADING STATE ──────────────────────────────────────
  if (isLoading) {
    return (
      <View style={[styles.container, styles.centred]}>
        <ActivityIndicator size="large" color="#2563EB" />
        <Text style={styles.loadingText}>Loading project...</Text>
      </View>
    );
  }

  if (errorMsg || !project) {
    return (
      <View style={[styles.container, styles.centred]}>
        <Text style={styles.errorText}>Project not found</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backLink}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const status = statusConfig[project.status];

  return (
    <View style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backText}>Projects</Text>
        </TouchableOpacity>
        <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
          <Text style={[styles.statusText, { color: status.colour }]}>
            {status.label}
          </Text>
        </View>
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Title */}
        <View style={styles.titleBlock}>
          <Text style={styles.projectNumber}>{project.project_number}</Text>
          <Text style={styles.projectName}>{project.name}</Text>
          <Text style={styles.projectAddress}>{project.address}</Text>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{drawings.length}</Text>
            <Text style={styles.statLabel}>Drawings</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>—</Text>
            <Text style={styles.statLabel}>Zones</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>—</Text>
            <Text style={styles.statLabel}>Inspections</Text>
          </View>
        </View>

        {/* Info */}
        <View style={styles.infoGrid}>
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Client</Text>
            <Text style={styles.infoValue}>{project.client_name || '—'}</Text>
          </View>
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Last Inspection</Text>
            <Text style={styles.infoValue}>{project.last_inspection || 'None yet'}</Text>
          </View>
        </View>

        {/* Description */}
        {project.description ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Project Scope</Text>
            <Text style={styles.scopeText}>{project.description}</Text>
          </View>
        ) : null}

        {/* Start Inspection */}
        {project.status !== 'COMPLETED' && (
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.startButton}
              onPress={() => router.push({
                pathname: '/session',
                params: { project_id: project.id, project_name: project.name },
              })}
              activeOpacity={0.8}
            >
              <Text style={styles.startButtonIcon}>🔍</Text>
              <View style={styles.startButtonTextBlock}>
                <Text style={styles.startButtonTitle}>Start Today's Inspection</Text>
                <Text style={styles.startButtonSub}>
                  Capture observations, photos and measurements
                </Text>
              </View>
              <Text style={styles.startButtonArrow}>›</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Drawings */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Drawings ({drawings.length})</Text>
            {isUploading ? (
              <ActivityIndicator size="small" color="#2563EB" />
            ) : (
              <TouchableOpacity style={styles.uploadButton} onPress={handlePickFile}>
                <Text style={styles.uploadButtonText}>+ Upload PDF</Text>
              </TouchableOpacity>
            )}
          </View>

          <Text style={styles.drawingsHint}>Tap to view · Hold to delete</Text>

          {drawings.length === 0 ? (
            <TouchableOpacity style={styles.emptyDrawings} onPress={handlePickFile}>
              <Text style={styles.emptyDrawingsIcon}>📐</Text>
              <Text style={styles.emptyDrawingsText}>No drawings yet</Text>
              <Text style={styles.emptyDrawingsHint}>Tap here to upload a PDF drawing</Text>
              <View style={styles.emptyUploadButton}>
                <Text style={styles.emptyUploadButtonText}>Select PDF from Files</Text>
              </View>
            </TouchableOpacity>
          ) : (
            drawings.map(drawing => (
              <TouchableOpacity
                key={drawing.id}
                style={styles.drawingRow}
                onPress={() => router.push({
                  pathname: '/drawing/[id]',
                  params: {
                    id: drawing.id,
                    title: drawing.title,
                    file_url: drawing.file_url,
                    project_id: project.id,
                  },
                })}
                onLongPress={() => handleDeleteDrawing(drawing)}
                activeOpacity={0.7}
              >
                <Text style={styles.drawingIcon}>📄</Text>
                <View style={styles.drawingInfo}>
                  <Text style={styles.drawingTitle}>{drawing.title}</Text>
                  <Text style={styles.drawingMeta}>
                    {drawing.number ? `${drawing.number} · ` : ''}Rev {drawing.revision}
                  </Text>
                </View>
                <Text style={styles.drawingArrow}>›</Text>
              </TouchableOpacity>
            ))
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Upload modal — KeyboardAvoidingView stops keyboard covering inputs */}
      <Modal
        visible={showUploadModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowUploadModal(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setShowUploadModal(false)}
          />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Upload Drawing</Text>

            {selectedFile && (
              <View style={styles.selectedFile}>
                <Text style={styles.selectedFileIcon}>📄</Text>
                <Text style={styles.selectedFileName} numberOfLines={1}>
                  {selectedFile.name}
                </Text>
              </View>
            )}

            <Text style={styles.modalLabel}>Drawing Title *</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Ground Floor Plan"
              placeholderTextColor="#4A5568"
              value={drawingTitle}
              onChangeText={setDrawingTitle}
              autoFocus
              returnKeyType="next"
            />

            <Text style={styles.modalLabel}>Drawing Number</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. SK-001"
              placeholderTextColor="#4A5568"
              value={drawingNumber}
              onChangeText={setDrawingNumber}
              autoCapitalize="characters"
              returnKeyType="done"
              onSubmitEditing={handleUpload}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => {
                  setShowUploadModal(false);
                  setSelectedFile(null);
                  setDrawingTitle('');
                  setDrawingNumber('');
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSave} onPress={handleUpload}>
                <Text style={styles.modalSaveText}>Upload</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A1628' },
  centred: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#8899AA', fontSize: 14 },
  errorText: { fontSize: 18, color: '#FFFFFF', textAlign: 'center', marginBottom: 12 },
  backLink: { fontSize: 16, color: '#2563EB', textAlign: 'center' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: '#1C2E44',
  },
  backButton: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backArrow: { fontSize: 20, color: '#2563EB' },
  backText: { fontSize: 16, color: '#2563EB', fontWeight: '500' },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20 },
  statusText: { fontSize: 12, fontWeight: '500' },
  scroll: { flex: 1 },
  titleBlock: { padding: 20, paddingBottom: 12 },
  projectNumber: { fontSize: 12, color: '#8899AA', letterSpacing: 1, marginBottom: 6 },
  projectName: { fontSize: 24, fontWeight: 'bold', color: '#FFFFFF', marginBottom: 4, lineHeight: 30 },
  projectAddress: { fontSize: 14, color: '#8899AA' },
  statsRow: { flexDirection: 'row', paddingHorizontal: 20, gap: 10, marginBottom: 12 },
  statCard: {
    flex: 1, backgroundColor: '#112240', borderRadius: 10, padding: 14,
    alignItems: 'center', borderWidth: 1, borderColor: '#1C2E44',
  },
  statValue: { fontSize: 24, fontWeight: 'bold', color: '#FFFFFF', marginBottom: 2 },
  statLabel: { fontSize: 11, color: '#8899AA', textTransform: 'uppercase', letterSpacing: 0.5 },
  infoGrid: { paddingHorizontal: 20, gap: 8, marginBottom: 4 },
  infoCard: { backgroundColor: '#112240', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#1C2E44' },
  infoLabel: { fontSize: 10, color: '#4A5568', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  infoValue: { fontSize: 14, color: '#FFFFFF', fontWeight: '500' },
  section: { padding: 20, paddingBottom: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#8899AA', textTransform: 'uppercase', letterSpacing: 1 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  scopeText: { fontSize: 14, color: '#CBD5E1', lineHeight: 22 },
  startButton: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#2563EB',
    borderRadius: 14, padding: 18, gap: 14,
  },
  startButtonIcon: { fontSize: 28 },
  startButtonTextBlock: { flex: 1 },
  startButtonTitle: { fontSize: 16, fontWeight: '700', color: '#FFFFFF', marginBottom: 3 },
  startButtonSub: { fontSize: 12, color: 'rgba(255,255,255,0.7)', lineHeight: 16 },
  startButtonArrow: { fontSize: 24, color: 'rgba(255,255,255,0.7)' },
  uploadButton: {
    backgroundColor: '#1C2E44', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8,
  },
  uploadButtonText: { fontSize: 13, color: '#2563EB', fontWeight: '600' },
  drawingsHint: { fontSize: 12, color: '#4A5568', marginBottom: 10, fontStyle: 'italic', marginTop: 4 },
  emptyDrawings: {
    backgroundColor: '#112240', borderRadius: 12, padding: 28,
    alignItems: 'center', borderWidth: 1, borderColor: '#1C2E44',
    borderStyle: 'dashed', gap: 8,
  },
  emptyDrawingsIcon: { fontSize: 36 },
  emptyDrawingsText: { fontSize: 15, color: '#FFFFFF', fontWeight: '500' },
  emptyDrawingsHint: { fontSize: 12, color: '#4A5568', textAlign: 'center' },
  emptyUploadButton: {
    backgroundColor: '#2563EB', borderRadius: 8,
    paddingHorizontal: 20, paddingVertical: 10, marginTop: 8,
  },
  emptyUploadButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  drawingRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#112240',
    borderRadius: 10, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: '#1C2E44', gap: 12,
  },
  drawingIcon: { fontSize: 22 },
  drawingInfo: { flex: 1 },
  drawingTitle: { fontSize: 14, fontWeight: '500', color: '#FFFFFF', marginBottom: 2 },
  drawingMeta: { fontSize: 12, color: '#8899AA' },
  drawingArrow: { fontSize: 20, color: '#4A5568' },
  modalOverlay: {
    flex: 1, justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  modalCard: {
    backgroundColor: '#112240', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, gap: 12,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#FFFFFF', marginBottom: 4 },
  selectedFile: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#0A1628', borderRadius: 8, padding: 12,
    borderWidth: 1, borderColor: '#2563EB',
  },
  selectedFileIcon: { fontSize: 20 },
  selectedFileName: { flex: 1, fontSize: 13, color: '#2563EB', fontWeight: '500' },
  modalLabel: { fontSize: 12, color: '#8899AA', marginBottom: 4, marginTop: 4 },
  modalInput: {
    backgroundColor: '#0A1628', borderWidth: 1, borderColor: '#2A3F55',
    borderRadius: 10, padding: 14, fontSize: 15, color: '#FFFFFF',
  },
  modalButtons: { flexDirection: 'row', gap: 10, marginTop: 6 },
  modalCancel: {
    flex: 1, backgroundColor: '#1C2E44', borderRadius: 10, padding: 14, alignItems: 'center',
  },
  modalCancelText: { color: '#8899AA', fontSize: 15, fontWeight: '500' },
  modalSave: { flex: 1, backgroundColor: '#2563EB', borderRadius: 10, padding: 14, alignItems: 'center' },
  modalSaveText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});
