import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  TextInput,
  Modal,
  Share,
} from 'react-native';
import { useState, useCallback } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { getUserFirm } from '../lib/firm';

type Member = {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  role: 'admin' | 'member';
  joined_at: string;
};

type Project = {
  id: string;
  name: string;
  project_number: string;
};

export default function FirmSettingsScreen() {
  const [firm, setFirm]           = useState<{ id: string; name: string; join_code: string } | null>(null);
  const [members, setMembers]     = useState<Member[]>([]);
  const [projects, setProjects]   = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState('');

  // Assign engineer modal
  const [showAssign, setShowAssign]       = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectMembers, setProjectMembers]   = useState<string[]>([]);

  const fetchData = async () => {
    setIsLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (user) setCurrentUserId(user.id);

    const { firm: userFirm } = await getUserFirm();
    setFirm(userFirm);

    if (!userFirm) { setIsLoading(false); return; }

    // Fetch all members of this firm
    const { data: membersData } = await supabase
      .from('firm_members')
      .select('*')
      .eq('firm_id', userFirm.id)
      .order('joined_at', { ascending: true });

    setMembers(membersData as Member[] ?? []);

    // Fetch all projects for this firm
    const { data: projectsData } = await supabase
      .from('projects')
      .select('id, name, project_number')
      .eq('firm_id', userFirm.id)
      .order('created_at', { ascending: false });

    setProjects(projectsData as Project[] ?? []);
    setIsLoading(false);
  };

  useFocusEffect(useCallback(() => { fetchData(); }, []));

  // ── SHARE JOIN CODE ────────────────────────────────────
  const handleShareCode = async () => {
    if (!firm) return;
    await Share.share({
      message: `Join my firm on SiteIQ!\n\nFirm: ${firm.name}\nJoin Code: ${firm.join_code}\n\nDownload SiteIQ and enter this code when signing up.`,
      title: 'Join my firm on SiteIQ',
    });
  };

  // ── REMOVE MEMBER ──────────────────────────────────────
  const handleRemoveMember = (member: Member) => {
    if (member.role === 'admin') {
      Alert.alert('Cannot Remove', 'You cannot remove the admin from the firm.');
      return;
    }
    Alert.alert(
      'Remove Member',
      `Remove ${member.full_name} from your firm? They will lose access to all projects.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive',
          onPress: async () => {
            await supabase.from('firm_members').delete().eq('id', member.id);
            setMembers(current => current.filter(m => m.id !== member.id));
          },
        },
      ]
    );
  };

  // ── OPEN ASSIGN MODAL ──────────────────────────────────
  const handleAssignProject = async (project: Project) => {
    setSelectedProject(project);

    // Fetch current members of this project
    const { data } = await supabase
      .from('project_members')
      .select('user_id')
      .eq('project_id', project.id);

    setProjectMembers(data?.map(m => m.user_id) ?? []);
    setShowAssign(true);
  };

  // ── TOGGLE PROJECT MEMBER ──────────────────────────────
  const handleToggleMember = async (member: Member) => {
    if (!selectedProject) return;
    const isAssigned = projectMembers.includes(member.user_id);

    if (isAssigned) {
      // Remove from project
      await supabase
        .from('project_members')
        .delete()
        .eq('project_id', selectedProject.id)
        .eq('user_id', member.user_id);
      setProjectMembers(current => current.filter(id => id !== member.user_id));
    } else {
      // Add to project
      await supabase.from('project_members').insert({
        project_id: selectedProject.id,
        user_id:    member.user_id,
        added_by:   currentUserId,
      });
      setProjectMembers(current => [...current, member.user_id]);
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centred]}>
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Firm Settings</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Firm info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Firm</Text>
          <View style={styles.firmCard}>
            <Text style={styles.firmName}>{firm?.name}</Text>
            <Text style={styles.firmLabel}>Join Code</Text>
            <Text style={styles.joinCode}>{firm?.join_code}</Text>
            <TouchableOpacity style={styles.shareButton} onPress={handleShareCode}>
              <Text style={styles.shareButtonText}>Share Join Code</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Members */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Engineers ({members.length})</Text>
          {members.map(member => (
            <View key={member.id} style={styles.memberRow}>
              <View style={styles.memberAvatar}>
                <Text style={styles.memberAvatarText}>
                  {member.full_name ? member.full_name[0].toUpperCase() : '?'}
                </Text>
              </View>
              <View style={styles.memberInfo}>
                <View style={styles.memberNameRow}>
                  <Text style={styles.memberName}>{member.full_name}</Text>
                  {member.role === 'admin' && (
                    <View style={styles.adminBadge}>
                      <Text style={styles.adminBadgeText}>Admin</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.memberEmail}>{member.email}</Text>
              </View>
              {member.role !== 'admin' && member.user_id !== currentUserId && (
                <TouchableOpacity
                  style={styles.removeButton}
                  onPress={() => handleRemoveMember(member)}
                >
                  <Text style={styles.removeButtonText}>Remove</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>

        {/* Project access */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Project Access</Text>
          <Text style={styles.hint}>
            Tap a project to assign or remove engineers
          </Text>
          {projects.map(project => (
            <TouchableOpacity
              key={project.id}
              style={styles.projectRow}
              onPress={() => handleAssignProject(project)}
            >
              <View style={styles.projectInfo}>
                <Text style={styles.projectName}>{project.name}</Text>
                <Text style={styles.projectNumber}>{project.project_number}</Text>
              </View>
              <Text style={styles.manageText}>Manage →</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Assign engineers modal */}
      <Modal
        visible={showAssign}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAssign(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setShowAssign(false)}
          />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{selectedProject?.name}</Text>
            <Text style={styles.modalSub}>
              Toggle engineers to grant or remove access to this project
            </Text>
            {members.map(member => {
              const assigned = projectMembers.includes(member.user_id);
              return (
                <TouchableOpacity
                  key={member.id}
                  style={[styles.assignRow, assigned && styles.assignRowActive]}
                  onPress={() => handleToggleMember(member)}
                >
                  <View style={styles.memberAvatar}>
                    <Text style={styles.memberAvatarText}>
                      {member.full_name ? member.full_name[0].toUpperCase() : '?'}
                    </Text>
                  </View>
                  <View style={styles.memberInfo}>
                    <Text style={styles.memberName}>{member.full_name}</Text>
                    <Text style={styles.memberEmail}>{member.email}</Text>
                  </View>
                  <View style={[styles.checkbox, assigned && styles.checkboxActive]}>
                    {assigned && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={styles.doneButton} onPress={() => setShowAssign(false)}>
              <Text style={styles.doneButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A1628' },
  centred: { alignItems: 'center', justifyContent: 'center' },
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
  section: { padding: 20, paddingBottom: 8 },
  sectionTitle: {
    fontSize: 13, fontWeight: '600', color: '#8899AA',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12,
  },
  hint: { fontSize: 12, color: '#4A5568', marginBottom: 10, fontStyle: 'italic' },
  firmCard: {
    backgroundColor: '#112240', borderRadius: 14, padding: 20,
    borderWidth: 1, borderColor: '#1C2E44', alignItems: 'center', gap: 8,
  },
  firmName: { fontSize: 20, fontWeight: '700', color: '#FFFFFF' },
  firmLabel: { fontSize: 11, color: '#4A5568', textTransform: 'uppercase', letterSpacing: 1 },
  joinCode: {
    fontSize: 32, fontWeight: '700', color: '#2563EB',
    letterSpacing: 8, backgroundColor: '#0A1628',
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10,
  },
  shareButton: {
    backgroundColor: '#2563EB', borderRadius: 8,
    paddingHorizontal: 20, paddingVertical: 10, marginTop: 4,
  },
  shareButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  memberRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#112240',
    borderRadius: 10, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: '#1C2E44', gap: 12,
  },
  memberAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#2563EB', alignItems: 'center', justifyContent: 'center',
  },
  memberAvatarText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  memberInfo: { flex: 1 },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  memberName: { fontSize: 14, fontWeight: '500', color: '#FFFFFF' },
  adminBadge: { backgroundColor: '#1E3A5F', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  adminBadgeText: { fontSize: 10, color: '#60A5FA', fontWeight: '600' },
  memberEmail: { fontSize: 12, color: '#4A5568' },
  removeButton: { backgroundColor: '#3B1A1A', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  removeButtonText: { fontSize: 12, color: '#F87171', fontWeight: '500' },
  projectRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#112240',
    borderRadius: 10, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: '#1C2E44',
  },
  projectInfo: { flex: 1 },
  projectName: { fontSize: 14, fontWeight: '500', color: '#FFFFFF', marginBottom: 2 },
  projectNumber: { fontSize: 12, color: '#4A5568' },
  manageText: { fontSize: 13, color: '#2563EB', fontWeight: '500' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)' },
  modalCard: {
    backgroundColor: '#112240', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, gap: 10,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  modalSub: { fontSize: 13, color: '#8899AA', marginBottom: 4 },
  assignRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#0A1628',
    borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#1C2E44', gap: 12,
  },
  assignRowActive: { borderColor: '#2563EB', backgroundColor: '#1E3A5F' },
  checkbox: {
    width: 24, height: 24, borderRadius: 6, borderWidth: 2,
    borderColor: '#2A3F55', alignItems: 'center', justifyContent: 'center',
  },
  checkboxActive: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  checkmark: { fontSize: 14, color: '#FFFFFF', fontWeight: '700' },
  doneButton: {
    backgroundColor: '#2563EB', borderRadius: 10, padding: 14,
    alignItems: 'center', marginTop: 8,
  },
  doneButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});
