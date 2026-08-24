import { theme } from '../lib/theme'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Modal,
  Share,
} from 'react-native';
import { useState, useCallback } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { getUserFirm } from '../lib/firm';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

const T = theme.colors;
const R = theme.radius;

const SUPABASE_URL = 'https://vbaewualqaxhbmqgnhdt.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

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

type Firm = {
  id: string;
  name: string;
  join_code: string;
  report_template_url: string | null;
};

export default function FirmSettingsScreen() {
  const [firm, setFirm]           = useState<Firm | null>(null);
  const [members, setMembers]     = useState<Member[]>([]);
  const [projects, setProjects]   = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState('');
  const [isUploadingTemplate, setIsUploadingTemplate] = useState(false);

  const [showAssign, setShowAssign]           = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectMembers, setProjectMembers]   = useState<string[]>([]);

  const fetchData = async () => {
    setIsLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) setCurrentUserId(user.id);

    const { firm: userFirm } = await getUserFirm();
    if (!userFirm) { setIsLoading(false); return; }

    const { data: fullFirm } = await supabase
      .from('firms')
      .select('id, name, join_code, report_template_url')
      .eq('id', userFirm.id)
      .single();
    setFirm(fullFirm as Firm);

    const { data: membersData } = await supabase
      .from('firm_members')
      .select('*')
      .eq('firm_id', userFirm.id)
      .order('joined_at', { ascending: true });
    setMembers(membersData as Member[] ?? []);

    const { data: projectsData } = await supabase
      .from('projects')
      .select('id, name, project_number')
      .eq('firm_id', userFirm.id)
      .order('created_at', { ascending: false });
    setProjects(projectsData as Project[] ?? []);
    setIsLoading(false);
  };

  useFocusEffect(useCallback(() => { fetchData(); }, []));

  const handleShareCode = async () => {
    if (!firm) return;
    await Share.share({
      message: `Join my firm on SiteIQ!\n\nFirm: ${firm.name}\nJoin Code: ${firm.join_code}\n\nDownload SiteIQ and enter this code when signing up.`,
      title: 'Join my firm on SiteIQ',
    });
  };

  const handleUploadTemplate = async () => {
    if (!firm) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;

      const file = result.assets[0];
      setIsUploadingTemplate(true);

      const base64 = await FileSystem.readAsStringAsync(file.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const fileName = `template-${firm.id}.docx`;

      const response = await fetch(
        `${SUPABASE_URL}/storage/v1/object/report-templates/${fileName}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'x-upsert': 'true',
          },
          body: Uint8Array.from(atob(base64), c => c.charCodeAt(0)),
        }
      );

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const templateUrl = `${SUPABASE_URL}/storage/v1/object/report-templates/${fileName}`;
      await supabase.from('firms').update({ report_template_url: templateUrl }).eq('id', firm.id);
      setFirm(prev => prev ? { ...prev, report_template_url: templateUrl } : prev);

      Alert.alert('Template Uploaded', 'Your report template has been saved. Engineers can now generate AI reports using this template.');
    } catch (err) {
      Alert.alert('Upload Failed', 'Could not upload template. Make sure it is a .docx file.');
    } finally {
      setIsUploadingTemplate(false);
    }
  };

  const handleRemoveTemplate = () => {
    Alert.alert('Remove Template', 'Are you sure? Engineers will not be able to generate AI reports until a new template is uploaded.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          await supabase.from('firms').update({ report_template_url: null }).eq('id', firm!.id);
          setFirm(prev => prev ? { ...prev, report_template_url: null } : prev);
        },
      },
    ]);
  };

  const handleRemoveMember = (member: Member) => {
    if (member.role === 'admin') {
      Alert.alert('Cannot Remove', 'You cannot remove the admin from the firm.');
      return;
    }
    Alert.alert('Remove Member', `Remove ${member.full_name} from your firm?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          await supabase.from('firm_members').delete().eq('id', member.id);
          setMembers(current => current.filter(m => m.id !== member.id));
        },
      },
    ]);
  };

  const handleAssignProject = async (project: Project) => {
    setSelectedProject(project);
    const { data } = await supabase.from('project_members').select('user_id').eq('project_id', project.id);
    setProjectMembers(data?.map(m => m.user_id) ?? []);
    setShowAssign(true);
  };

  const handleToggleMember = async (member: Member) => {
    if (!selectedProject) return;
    const isAssigned = projectMembers.includes(member.user_id);
    if (isAssigned) {
      await supabase.from('project_members').delete().eq('project_id', selectedProject.id).eq('user_id', member.user_id);
      setProjectMembers(current => current.filter(id => id !== member.user_id));
    } else {
      await supabase.from('project_members').insert({ project_id: selectedProject.id, user_id: member.user_id, added_by: currentUserId });
      setProjectMembers(current => [...current, member.user_id]);
    }
  };

  if (isLoading) {
    return (
      <View style={[S.container, S.centred]}>
        <ActivityIndicator size="large" color={T.indigo} />
      </View>
    );
  }

  return (
    <View style={S.container}>
      <View style={S.header}>
        <TouchableOpacity style={S.backBtn} onPress={() => router.back()}>
          <Text style={S.backArrow}>{'⬅️'}</Text>
          <Text style={S.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={S.headerTitle}>Firm Settings</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={S.scroll} showsVerticalScrollIndicator={false}>

        {/* Firm Info */}
        <View style={S.section}>
          <Text style={S.sectionTitle}>Your Firm</Text>
          <View style={S.card}>
            <Text style={S.firmName}>{firm?.name}</Text>
            <Text style={S.label}>Join Code</Text>
            <Text style={S.joinCode}>{firm?.join_code}</Text>
            <TouchableOpacity style={S.shareBtn} onPress={handleShareCode}>
              <Text style={S.shareBtnText}>Share Join Code</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Report Template */}
        <View style={S.section}>
          <Text style={S.sectionTitle}>Report Template</Text>
          <Text style={S.sectionDesc}>
            Upload your firm's Word document template (.docx). Use these placeholders where AI content should appear:{'\n\n'}
            {'{{project_name}}  {{date}}  {{report_no}}\n{{engineer_name}}  {{site_contact}}\n{{weather}}  {{purpose}}\n{{executive_summary}}\n{{findings}}\n{{recommendations}}'}
          </Text>

          {firm?.report_template_url ? (
            <View style={S.templateCard}>
              <View style={S.templateIconRow}>
                <Text style={S.templateIcon}>Doc</Text>
                <View style={{ flex: 1 }}>
                  <Text style={S.templateName}>Report Template</Text>
                  <Text style={S.templateSub}>Template uploaded — AI reports enabled</Text>
                </View>
              </View>
              <View style={S.templateBtns}>
                <TouchableOpacity style={S.replaceBtn} onPress={handleUploadTemplate} disabled={isUploadingTemplate}>
                  {isUploadingTemplate
                    ? <ActivityIndicator size="small" color={T.indigo} />
                    : <Text style={S.replaceBtnText}>Replace</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={S.removeBtn} onPress={handleRemoveTemplate}>
                  <Text style={S.removeBtnText}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity style={S.uploadTemplateBtn} onPress={handleUploadTemplate} disabled={isUploadingTemplate} activeOpacity={0.8}>
              {isUploadingTemplate ? (
                <ActivityIndicator size="small" color={T.indigo} />
              ) : (
                <>
                  <Text style={S.uploadTemplateIcon}>Upload</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={S.uploadTemplateTitle}>Upload Word Template</Text>
                    <Text style={S.uploadTemplateSub}>Upload a .docx file with placeholders</Text>
                  </View>
                  <Text style={S.uploadTemplateArrow}>{'>'}</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Members */}
        <View style={S.section}>
          <Text style={S.sectionTitle}>Engineers ({members.length})</Text>
          {members.map(member => (
            <View key={member.id} style={S.memberRow}>
              <View style={S.avatar}>
                <Text style={S.avatarText}>{member.full_name?.[0]?.toUpperCase() ?? '?'}</Text>
              </View>
              <View style={S.memberInfo}>
                <View style={S.memberNameRow}>
                  <Text style={S.memberName}>{member.full_name}</Text>
                  {member.role === 'admin' && (
                    <View style={S.adminBadge}>
                      <Text style={S.adminBadgeText}>Admin</Text>
                    </View>
                  )}
                </View>
                <Text style={S.memberEmail}>{member.email}</Text>
              </View>
              {member.user_id !== currentUserId && member.role !== 'admin' && (
                <TouchableOpacity style={S.removeBtn} onPress={() => handleRemoveMember(member)}>
                  <Text style={S.removeBtnText}>Remove</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>

        {/* Projects */}
        <View style={S.section}>
          <Text style={S.sectionTitle}>Projects ({projects.length})</Text>
          {projects.map(project => (
            <TouchableOpacity key={project.id} style={S.projectRow} onPress={() => handleAssignProject(project)}>
              <View style={{ flex: 1 }}>
                <Text style={S.projectName}>{project.name}</Text>
                <Text style={S.projectNumber}>#{project.project_number}</Text>
              </View>
              <Text style={S.projectArrow}>{'Assign Engineers >'}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ height: 50 }} />
      </ScrollView>

      {/* Assign modal */}
      <Modal visible={showAssign} transparent animationType="slide">
        <View style={S.modalOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setShowAssign(false)} />
          <View style={S.modalCard}>
            <Text style={S.modalTitle}>Assign to {selectedProject?.name}</Text>
            <Text style={S.modalSub}>Tap to toggle access</Text>
            <ScrollView style={{ maxHeight: 300 }}>
              {members.map(member => {
                const assigned = projectMembers.includes(member.user_id);
                return (
                  <TouchableOpacity key={member.id} style={S.assignRow} onPress={() => handleToggleMember(member)}>
                    <View style={[S.assignCheck, assigned && S.assignCheckOn]}>
                      {assigned && <Text style={S.assignCheckText}>v</Text>}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={S.memberName}>{member.full_name}</Text>
                      <Text style={S.memberEmail}>{member.email}</Text>
                    </View>
                    {member.role === 'admin' && (
                      <View style={S.adminBadge}>
                        <Text style={S.adminBadgeText}>Admin</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={S.doneBtn} onPress={() => setShowAssign(false)}>
              <Text style={S.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const S = StyleSheet.create({
  container:           { flex: 1, backgroundColor: T.paper },
  centred:             { alignItems: 'center', justifyContent: 'center' },
  header:              { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 60, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: T.line, backgroundColor: T.surface },
  backBtn:             { flexDirection: 'row', alignItems: 'center', gap: 4, width: 60 },
  backArrow:           { fontSize: 28, color: T.indigo, lineHeight: 32 },
  backText:            { fontSize: 14, color: T.indigo },
  headerTitle:         { fontSize: 17, fontWeight: '700', color: T.ink },
  scroll:              { flex: 1 },
  section:             { padding: 20, paddingBottom: 8 },
  sectionTitle:        { fontSize: 11, fontWeight: '700', color: T.mid, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  sectionDesc:         { fontSize: 12, color: T.mid, lineHeight: 20, marginBottom: 14, backgroundColor: T.indigoSoft, padding: 14, borderRadius: R.sm, borderWidth: 1, borderColor: T.line, fontFamily: 'monospace' },
  card:                { backgroundColor: T.surface, borderRadius: R.md, padding: 18, borderWidth: 1, borderColor: T.line, gap: 8, shadowColor: '#2C3950', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.08, shadowRadius: 24, elevation: 3 },
  firmName:            { fontSize: 20, fontWeight: '700', color: T.ink },
  label:               { fontSize: 12, color: T.mid, marginTop: 4 },
  joinCode:            { fontSize: 28, fontWeight: '800', color: T.indigo, letterSpacing: 4 },
  shareBtn:            { backgroundColor: T.indigoSoft, borderRadius: R.sm, padding: 12, alignItems: 'center', marginTop: 4, borderWidth: 1, borderColor: T.indigo },
  shareBtnText:        { color: T.indigo, fontSize: 14, fontWeight: '600' },
  templateCard:        { backgroundColor: T.sageSoft, borderRadius: R.md, padding: 16, borderWidth: 1, borderColor: T.sage, gap: 12 },
  templateIconRow:     { flexDirection: 'row', alignItems: 'center', gap: 12 },
  templateIcon:        { fontSize: 11, fontWeight: '800', color: T.sage },
  templateName:        { fontSize: 15, fontWeight: '700', color: T.ink },
  templateSub:         { fontSize: 12, color: T.sage, marginTop: 2 },
  templateBtns:        { flexDirection: 'row', gap: 10 },
  replaceBtn:          { flex: 1, backgroundColor: T.indigoSoft, borderRadius: R.sm, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: T.indigo },
  replaceBtnText:      { color: T.indigo, fontSize: 13, fontWeight: '600' },
  uploadTemplateBtn:   { flexDirection: 'row', alignItems: 'center', backgroundColor: T.surface, borderRadius: R.md, padding: 18, borderWidth: 1.5, borderColor: T.indigo, borderStyle: 'dashed', gap: 14 },
  uploadTemplateIcon:  { fontSize: 11, fontWeight: '800', color: T.indigo },
  uploadTemplateTitle: { fontSize: 15, fontWeight: '700', color: T.ink },
  uploadTemplateSub:   { fontSize: 12, color: T.mid, marginTop: 2 },
  uploadTemplateArrow: { fontSize: 22, color: T.indigo },
  memberRow:           { flexDirection: 'row', alignItems: 'center', backgroundColor: T.surface, borderRadius: R.md, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: T.line, gap: 12, shadowColor: '#2C3950', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 2 },
  avatar:              { width: 40, height: 40, borderRadius: 20, backgroundColor: T.indigoSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText:          { fontSize: 16, fontWeight: '700', color: T.indigo },
  memberInfo:          { flex: 1 },
  memberNameRow:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
  memberName:          { fontSize: 15, fontWeight: '600', color: T.ink },
  memberEmail:         { fontSize: 12, color: T.mid, marginTop: 2 },
  adminBadge:          { backgroundColor: T.indigoSoft, paddingHorizontal: 8, paddingVertical: 3, borderRadius: R.pill, borderWidth: 1, borderColor: T.indigo },
  adminBadgeText:      { fontSize: 10, color: T.indigo, fontWeight: '700' },
  removeBtn:           { backgroundColor: '#FEF2F0', borderRadius: R.sm, padding: 8 },
  removeBtnText:       { color: T.clay, fontSize: 12, fontWeight: '600' },
  projectRow:          { flexDirection: 'row', alignItems: 'center', backgroundColor: T.surface, borderRadius: R.md, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: T.line, shadowColor: '#2C3950', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 2 },
  projectName:         { fontSize: 14, fontWeight: '600', color: T.ink },
  projectNumber:       { fontSize: 12, color: T.mid, marginTop: 2 },
  projectArrow:        { fontSize: 12, color: T.indigo, fontWeight: '500' },
  modalOverlay:        { flex: 1, justifyContent: 'flex-end' },
  modalCard:           { backgroundColor: T.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, borderTopWidth: 1, borderColor: T.line, gap: 12 },
  modalTitle:          { fontSize: 18, fontWeight: '700', color: T.ink },
  modalSub:            { fontSize: 13, color: T.mid },
  assignRow:           { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: T.line, gap: 12 },
  assignCheck:         { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: T.line, alignItems: 'center', justifyContent: 'center' },
  assignCheckOn:       { backgroundColor: T.indigo, borderColor: T.indigo },
  assignCheckText:     { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  doneBtn:             { backgroundColor: T.indigo, borderRadius: R.pill, height: 54, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  doneBtnText:         { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
