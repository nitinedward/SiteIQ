import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { getUserFirm } from '../../lib/firm';

type Status = 'ACTIVE' | 'ON_HOLD' | 'COMPLETED';

const STATUS_OPTIONS: { value: Status; label: string; colour: string }[] = [
  { value: 'ACTIVE',    label: 'Active',    colour: '#34D399' },
  { value: 'ON_HOLD',   label: 'On Hold',   colour: '#FBBF24' },
  { value: 'COMPLETED', label: 'Completed', colour: '#60A5FA' },
];

export default function CreateProjectScreen() {
  const [name, setName]                   = useState('');
  const [projectNumber, setProjectNumber] = useState('');
  const [clientName, setClientName]       = useState('');
  const [address, setAddress]             = useState('');
  const [status, setStatus]               = useState<Status>('ACTIVE');
  const [isSaving, setIsSaving]           = useState(false);

  const handleSave = async () => {
    if (!name.trim()) { Alert.alert('Missing Field', 'Please enter a project name.'); return; }
    if (!projectNumber.trim()) { Alert.alert('Missing Field', 'Please enter a project number.'); return; }

    setIsSaving(true);

    // Get the current user's firm
    const { firm } = await getUserFirm();
    const { data: { user } } = await supabase.auth.getUser();

    if (!firm || !user) {
      Alert.alert('Error', 'Could not find your firm. Please log out and back in.');
      setIsSaving(false);
      return;
    }

    // Create the project with the firm_id
    // This ensures it belongs to the firm and is protected
    const { data: project, error } = await supabase
      .from('projects')
      .insert({
        name:           name.trim(),
        project_number: projectNumber.trim(),
        client_name:    clientName.trim(),
        address:        address.trim(),
        status,
        drawing_count:  0,
        firm_id:        firm.id,
      })
      .select()
      .single();

    if (error) {
      Alert.alert('Save Failed', error.message);
      setIsSaving(false);
      return;
    }

    // Automatically add the admin who created the project as a member
    // so they can see it in their projects list
    await supabase.from('project_members').insert({
      project_id: project.id,
      user_id:    user.id,
      added_by:   user.id,
    });

    setIsSaving(false);
    Alert.alert(
      '✅ Project Created',
      `"${name}" has been added. You can now assign engineers to this project from the project screen.`,
      [{ text: 'OK', onPress: () => router.back() }]
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New Project</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        <View style={styles.field}>
          <Text style={styles.label}>Project Name <Text style={styles.required}>*</Text></Text>
          <TextInput style={styles.input} placeholder="e.g. 23 Harbour View Towers" placeholderTextColor="#4A5568" value={name} onChangeText={setName} />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Project Number <Text style={styles.required}>*</Text></Text>
          <TextInput style={styles.input} placeholder="e.g. 2026-047" placeholderTextColor="#4A5568" value={projectNumber} onChangeText={setProjectNumber} autoCapitalize="characters" />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Client Name</Text>
          <TextInput style={styles.input} placeholder="e.g. Harbour Developments Ltd" placeholderTextColor="#4A5568" value={clientName} onChangeText={setClientName} />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Address</Text>
          <TextInput style={styles.input} placeholder="e.g. Auckland CBD, Auckland" placeholderTextColor="#4A5568" value={address} onChangeText={setAddress} />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Status</Text>
          <View style={styles.statusRow}>
            {STATUS_OPTIONS.map(option => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.statusOption,
                  status === option.value && { borderColor: option.colour, backgroundColor: option.colour + '15' },
                ]}
                onPress={() => setStatus(option.value)}
              >
                <View style={[styles.statusDot, { backgroundColor: option.colour }, status !== option.value && { opacity: 0.4 }]} />
                <Text style={[styles.statusLabel, status === option.value && { color: option.colour }]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.saveSection}>
          <TouchableOpacity
            style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={isSaving}
          >
            {isSaving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.saveButtonText}>Create Project</Text>
            )}
          </TouchableOpacity>
          <Text style={styles.requiredNote}>* Required fields</Text>
        </View>

        <View style={{ height: 60 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A1628' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: '#1C2E44',
  },
  backButton: { flexDirection: 'row', alignItems: 'center', gap: 6, width: 60 },
  backArrow: { fontSize: 20, color: '#2563EB' },
  backText: { fontSize: 16, color: '#2563EB' },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#FFFFFF' },
  scroll: { flex: 1 },
  field: { paddingHorizontal: 20, paddingTop: 20 },
  label: { fontSize: 13, color: '#8899AA', marginBottom: 8, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5 },
  required: { color: '#F87171' },
  input: {
    backgroundColor: '#112240', borderWidth: 1, borderColor: '#1C2E44',
    borderRadius: 10, padding: 14, fontSize: 15, color: '#FFFFFF',
  },
  statusRow: { flexDirection: 'row', gap: 10 },
  statusOption: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#112240', borderWidth: 1.5, borderColor: '#1C2E44',
    borderRadius: 10, padding: 12,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { fontSize: 13, color: '#8899AA', fontWeight: '500' },
  saveSection: { padding: 20, paddingTop: 32, gap: 10 },
  saveButton: { backgroundColor: '#059669', borderRadius: 10, padding: 16, alignItems: 'center' },
  saveButtonDisabled: { opacity: 0.6 },
  saveButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  requiredNote: { fontSize: 12, color: '#4A5568', textAlign: 'center' },
});
