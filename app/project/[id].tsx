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

type Inspection = {
  id: string;
  date: string;
  report_no: string;
  weather: string;
  site_contact: string;
  purpose: string;
  status: string;
  created_at: string;
};

const statusConfig = {
  ACTIVE:    { colour: '#34D399', bg: '#0D3B2E', label: 'Active' },
  ON_HOLD:   { colour: '#FBBF24', bg: '#3B2E0D', label: 'On Hold' },
  COMPLETED: { colour: '#60A5FA', bg: '#1E3A5F', label: 'Completed' },
};

const STATUS_OPTIONS = ['ACTIVE', 'ON_HOLD', 'COMPLETED'] as const;

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-NZ', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
};

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams();

  const [project, setProject]         = useState<Project | null>(null);
  const [drawings, setDrawings]       = useState<Drawing[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [isLoading, setIsLoading]     = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMsg, setErrorMsg]       = useState('');
  const [isAdmin, setIsAdmin]         = useState(false);

  // Upload modal
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [drawingTitle, setDrawingTitle]       = useState('');
  const [drawingNumber, setDrawingNumber]     = useState('');
  const [drawingRevision, setDrawingRevision] = useState('A');
  const [selectedFile, setSelectedFile]       = useState<{ uri: string; name: string } | null>(null);

  // Edit project modal
  const [showEditModal, setShowEditModal]   = useState(false);
  const [editName, setEditName]             = useState('');
  const [editNumber, setEditNumber]         = useState('');
  const [editClient, setEditClient]         = useState('');
  const [editAddress, setEditAddress]       = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStatus, setEditStatus]         = useState<typeof STATUS_OPTIONS[number]>('ACTIVE');
  const [isSavingEdit, setIsSavingEdit]     = useState(false);

  // ── FETCH DATA ─────────────────────────────────────────
  const fetchData = async () => {
    setIsLoading(true);
    setErrorMsg('');

    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      const { data: memberData } = await supabase
        .from('firm_members')
        .select('role')
        .eq('user_id', user.id)
        .single();
      setIsAdmin(memberData?.role === 'admin');
    }

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

    // Fetch drawings ordered by number
    const { data: drawingsData } = await supabase
      .from('drawings')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: false });

    setDrawings(drawingsData as Drawing[] ?? []);

    // Fetch past inspections for this project
    const { data: inspectionsData } = await supabase
      .from('inspections')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: false });

    setInspections(inspectionsData as Inspection[] ?? []);

    setIsLoading(false);
  };

  useFocusEffect(
    useCallback(() => { fetchData(); }, [id])
  );

  // ── OPEN EDIT MODAL ────────────────────────────────────
  const handleEditProject = () => {
    if (!project) return;
    setEditName(project.name);
    setEditNumber(project.project_number);
    setEditClient(project.client_name || '');
    setEditAddress(project.address || '');
    setEditDescription(project.description || '');
    setEditStatus(project.status);
    setShowEditModal(true);
  };

  // ── SAVE EDITED PROJECT ────────────────────────────────
  const handleSaveEdit = async () => {
    if (!editName.trim()) {
      Alert.alert('Missing Field', 'Please enter a project name.');
      return;
    }
    setIsSavingEdit(true);

    const { error } = await supabase
      .from('projects')
      .update({
        name:           editName.trim(),
        project_number: editNumber.trim(),
        client_name:    editClient.trim(),
        address:        editAddress.trim(),
        description:    editDescription.trim(),
        status:         editStatus,
      })
      .eq('id', id);

    setIsSavingEdit(false);

    if (error) {
      Alert.alert('Save Failed', error.message);
      return;
    }

    setShowEditModal(false);
    fetchData();
  };

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
      const fileExtension = selectedFile.name.split('.').pop() || 'pdf';
      const uploadFileName = `drawing-${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExtension}`;

      const formData = new FormData();
      formData.append('file', {
        uri: selectedFile.uri,
        name: uploadFileName,
        type: 'application/pdf',
      } as any);

      const supabaseUrl = 'https://vbaewualqaxhbmqgnhdt.supabase.co';
      const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZiYWV3dWFscWF4aGJtcWduaGR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4NzAzNjMsImV4cCI6MjA5MzQ0NjM2M30.8s39SZtGq4r_0NXYhsAU0WdPSGqLfefm2YYK_JXjZbg';

      const uploadResponse = await fetch(
        `${supabaseUrl}/storage/v1/object/drawings/${uploadFileName}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'apikey': supabaseKey,
          },
          body: formData,
        }
      );

      if (!uploadResponse.ok) {
        Alert.alert('Upload Failed', 'Could not upload drawing. Please try again.');
        setIsUploading(false);
        return;
      }

      const publicUrl = `${supabaseUrl}/storage/v1/object/public/drawings/${uploadFileName}`;

      const { error: dbError } = await supabase
        .from('drawings')
        .insert({
          project_id: id,
          title:      drawingTitle.trim(),
          number:     drawingNumber.trim(),
          revision:   drawingRevision.trim() || 'A',
          file_url:   publicUrl,
          file_name:  uploadFileName,
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
      setDrawingRevision('A');
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
    if (!isAdmin) return;
    Alert.alert(
      'Delete Drawing',
      `Delete "${drawing.title}"?`,
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
        <View style={styles.headerRight}>
          <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
            <Text style={[styles.statusText, { color: status.colour }]}>{status.label}</Text>
          </View>
          {/* Edit button — admin only */}
          {isAdmin && (
            <TouchableOpacity style={styles.editButton} onPress={handleEditProject}>
              <Text style={styles.editButtonText}>Edit</Text>
            </TouchableOpacity>
          )}
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
            <Text style={styles.statValue}>{project.drawing_count ?? drawings.length}</Text>
            <Text style={styles.statLabel}>Drawings</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{inspections.length}</Text>
            <Text style={styles.statLabel}>Inspections</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>
              {inspections.filter(i => i.status === 'COMPLETED').length}
            </Text>
            <Text style={styles.statLabel}>Reports</Text>
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
            <Text style={styles.infoValue}>
              {inspections.length > 0 ? inspections[0].date : 'None yet'}
            </Text>
          </View>
        </View>

        {/* Description */}
        {project.description ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Project Scope</Text>
            <Text style={styles.scopeText}>{project.description}</Text>
          </View>
        ) : null}

        {/* START INSPECTION */}
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
                  Select drawings, capture observations and measurements
                </Text>
              </View>
              <Text style={styles.startButtonArrow}>›</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ALL DRAWINGS — full list */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Drawings ({drawings.length})</Text>
          {drawings.length === 0 ? (
            <View style={styles.emptyDrawings}>
              <Text style={styles.emptyDrawingsIcon}>📐</Text>
              <Text style={styles.emptyDrawingsText}>No drawings uploaded yet</Text>
            </View>
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
                    view_only: 'true',
                  },
                })}
                onLongPress={() => handleDeleteDrawing(drawing)}
                activeOpacity={0.7}
              >
                <View style={styles.drawingBadge}>
                  <Text style={styles.drawingBadgeText}>{drawing.number || '—'}</Text>
                </View>
                <View style={styles.drawingInfo}>
                  <Text style={styles.drawingTitle}>{drawing.title}</Text>
                  <Text style={styles.drawingMeta}>
                    Rev {drawing.revision} · {formatDate(drawing.created_at)}
                  </Text>
                </View>
                <Text style={styles.drawingArrow}>›</Text>
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* UPLOAD BUTTON — admin only */}
        {isAdmin && (
          <View style={styles.section}>
            {isUploading ? (
              <View style={styles.uploadingRow}>
                <ActivityIndicator size="small" color="#2563EB" />
                <Text style={styles.uploadingText}>Uploading drawing...</Text>
              </View>
            ) : (
              <TouchableOpacity style={styles.uploadDrawingsButton} onPress={handlePickFile}>
                <Text style={styles.uploadDrawingsIcon}>📐</Text>
                <Text style={styles.uploadDrawingsText}>Upload Drawing</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* PAST INSPECTIONS / SITE REPORTS */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Site Reports ({inspections.length})
          </Text>

          {inspections.length === 0 ? (
            <View style={styles.emptyInspections}>
              <Text style={styles.emptyInspectionsText}>
                No inspections yet — tap Start Inspection above
              </Text>
            </View>
          ) : (
            inspections.map(inspection => (
              <TouchableOpacity
                key={inspection.id}
                style={styles.inspectionRow}
                activeOpacity={0.7}
                onPress={() => Alert.alert(
                  `Report #${inspection.report_no}`,
                  `Date: ${inspection.date}\nWeather: ${inspection.weather}\nSite Contact: ${inspection.site_contact || '—'}\nPurpose: ${inspection.purpose || '—'}\nStatus: ${inspection.status}`,
                  [{ text: 'OK' }]
                )}
              >
                <View style={styles.inspectionLeft}>
                  <View style={styles.reportBadge}>
                    <Text style={styles.reportBadgeText}>#{inspection.report_no}</Text>
                  </View>
                  <View>
                    <Text style={styles.inspectionDate}>{inspection.date}</Text>
                    <Text style={styles.inspectionMeta}>
                      {inspection.site_contact || 'No contact'} · {inspection.weather}
                    </Text>
                  </View>
                </View>
                <View style={[
                  styles.inspectionStatus,
                  { backgroundColor: inspection.status === 'COMPLETED' ? '#0D3B2E' : '#3B2E0D' }
                ]}>
                  <Text style={[
                    styles.inspectionStatusText,
                    { color: inspection.status === 'COMPLETED' ? '#34D399' : '#FBBF24' }
                  ]}>
                    {inspection.status === 'COMPLETED' ? 'Complete' : 'In Progress'}
                  </Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Edit project modal */}
      <Modal
        visible={showEditModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEditModal(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setShowEditModal(false)}
          />
          <ScrollView style={styles.modalCard} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalTitle}>Edit Project</Text>

            <Text style={styles.modalLabel}>Project Name *</Text>
            <TextInput style={styles.modalInput} value={editName} onChangeText={setEditName} placeholderTextColor="#4A5568" />

            <Text style={styles.modalLabel}>Project Number</Text>
            <TextInput style={styles.modalInput} value={editNumber} onChangeText={setEditNumber} placeholderTextColor="#4A5568" autoCapitalize="characters" />

            <Text style={styles.modalLabel}>Client Name</Text>
            <TextInput style={styles.modalInput} value={editClient} onChangeText={setEditClient} placeholderTextColor="#4A5568" />

            <Text style={styles.modalLabel}>Address</Text>
            <TextInput style={styles.modalInput} value={editAddress} onChangeText={setEditAddress} placeholderTextColor="#4A5568" />

            <Text style={styles.modalLabel}>Project Scope / Description</Text>
            <TextInput
              style={[styles.modalInput, { height: 80, textAlignVertical: 'top' }]}
              value={editDescription}
              onChangeText={setEditDescription}
              placeholderTextColor="#4A5568"
              multiline
            />

            <Text style={styles.modalLabel}>Status</Text>
            <View style={styles.statusRow}>
              {STATUS_OPTIONS.map(s => (
                <TouchableOpacity
                  key={s}
                  style={[
                    styles.statusOption,
                    editStatus === s && {
                      borderColor: statusConfig[s].colour,
                      backgroundColor: statusConfig[s].colour + '15',
                    },
                  ]}
                  onPress={() => setEditStatus(s)}
                >
                  <View style={[
                    styles.statusDot,
                    { backgroundColor: statusConfig[s].colour },
                    editStatus !== s && { opacity: 0.4 },
                  ]} />
                  <Text style={[
                    styles.statusLabel,
                    editStatus === s && { color: statusConfig[s].colour },
                  ]}>
                    {statusConfig[s].label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => setShowEditModal(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSave, isSavingEdit && { opacity: 0.6 }]}
                onPress={handleSaveEdit}
                disabled={isSavingEdit}
              >
                {isSavingEdit ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.modalSaveText}>Save Changes</Text>
                )}
              </TouchableOpacity>
            </View>

            <View style={{ height: 40 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Upload drawing modal */}
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
            />

            <View style={styles.modalRow}>
              <View style={styles.modalHalf}>
                <Text style={styles.modalLabel}>Drawing Number</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. SK-001"
                  placeholderTextColor="#4A5568"
                  value={drawingNumber}
                  onChangeText={setDrawingNumber}
                  autoCapitalize="characters"
                />
              </View>
              <View style={styles.modalHalf}>
                <Text style={styles.modalLabel}>Revision</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. A"
                  placeholderTextColor="#4A5568"
                  value={drawingRevision}
                  onChangeText={setDrawingRevision}
                  autoCapitalize="characters"
                  maxLength={3}
                />
              </View>
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => {
                  setShowUploadModal(false);
                  setSelectedFile(null);
                  setDrawingTitle('');
                  setDrawingNumber('');
                  setDrawingRevision('A');
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
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20 },
  statusText: { fontSize: 12, fontWeight: '500' },
  editButton: {
    backgroundColor: '#1C2E44', paddingHorizontal: 14,
    paddingVertical: 7, borderRadius: 8,
  },
  editButtonText: { fontSize: 13, color: '#2563EB', fontWeight: '600' },
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
  latestDrawingCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#112240',
    borderRadius: 10, padding: 14, borderWidth: 1.5, borderColor: '#2563EB', gap: 12,
  },
  uploadDrawingsButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#112240', borderRadius: 12, padding: 16,
    borderWidth: 1.5, borderColor: '#2563EB', borderStyle: 'dashed', gap: 10,
  },
  uploadDrawingsIcon: { fontSize: 22 },
  uploadDrawingsText: { fontSize: 15, color: '#2563EB', fontWeight: '600' },
  uploadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center', padding: 16 },
  uploadingText: { fontSize: 14, color: '#8899AA' },
  emptyDrawings: {
    backgroundColor: '#112240', borderRadius: 12, padding: 28,
    alignItems: 'center', borderWidth: 1, borderColor: '#1C2E44',
    borderStyle: 'dashed', gap: 8,
  },
  emptyDrawingsIcon: { fontSize: 36 },
  emptyDrawingsText: { fontSize: 15, color: '#FFFFFF', fontWeight: '500' },
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
  drawingBadge: {
    backgroundColor: '#1C2E44', borderRadius: 8, paddingHorizontal: 10,
    paddingVertical: 6, minWidth: 52, alignItems: 'center',
    borderWidth: 1, borderColor: '#2A3F55',
  },
  drawingBadgeText: { fontSize: 11, color: '#2563EB', fontWeight: '700', letterSpacing: 0.5 },
  drawingInfo: { flex: 1 },
  drawingTitle: { fontSize: 14, fontWeight: '500', color: '#FFFFFF', marginBottom: 3 },
  drawingMeta: { fontSize: 12, color: '#4A5568' },
  drawingArrow: { fontSize: 20, color: '#4A5568' },
  emptyInspections: {
    backgroundColor: '#112240', borderRadius: 10, padding: 16,
    borderWidth: 1, borderColor: '#1C2E44', alignItems: 'center',
  },
  emptyInspectionsText: { fontSize: 13, color: '#4A5568', textAlign: 'center' },
  inspectionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#112240', borderRadius: 10, padding: 14,
    marginBottom: 8, borderWidth: 1, borderColor: '#1C2E44',
  },
  inspectionLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  reportBadge: {
    backgroundColor: '#1C2E44', borderRadius: 6, paddingHorizontal: 8,
    paddingVertical: 4, borderWidth: 1, borderColor: '#2A3F55',
  },
  reportBadgeText: { fontSize: 12, color: '#8899AA', fontWeight: '700' },
  inspectionDate: { fontSize: 14, color: '#FFFFFF', fontWeight: '500', marginBottom: 2 },
  inspectionMeta: { fontSize: 12, color: '#4A5568' },
  inspectionStatus: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  inspectionStatusText: { fontSize: 11, fontWeight: '600' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)' },
  modalCard: {
    backgroundColor: '#112240', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, maxHeight: '90%',
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#FFFFFF', marginBottom: 16 },
  selectedFile: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#0A1628', borderRadius: 8, padding: 12,
    borderWidth: 1, borderColor: '#2563EB', marginBottom: 12,
  },
  selectedFileIcon: { fontSize: 20 },
  selectedFileName: { flex: 1, fontSize: 13, color: '#2563EB', fontWeight: '500' },
  modalLabel: { fontSize: 12, color: '#8899AA', marginBottom: 6, marginTop: 12 },
  modalInput: {
    backgroundColor: '#0A1628', borderWidth: 1, borderColor: '#2A3F55',
    borderRadius: 10, padding: 14, fontSize: 15, color: '#FFFFFF',
  },
  modalRow: { flexDirection: 'row', gap: 10 },
  modalHalf: { flex: 1 },
  statusRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  statusOption: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#0A1628', borderWidth: 1.5, borderColor: '#1C2E44',
    borderRadius: 10, padding: 10,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { fontSize: 12, color: '#8899AA', fontWeight: '500' },
  modalButtons: { flexDirection: 'row', gap: 10, marginTop: 20 },
  modalCancel: {
    flex: 1, backgroundColor: '#1C2E44', borderRadius: 10, padding: 14, alignItems: 'center',
  },
  modalCancelText: { color: '#8899AA', fontSize: 15, fontWeight: '500' },
  modalSave: { flex: 1, backgroundColor: '#2563EB', borderRadius: 10, padding: 14, alignItems: 'center' },
  modalSaveText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});
