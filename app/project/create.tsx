import {
  View, Text, StyleSheet, TextInput,
  TouchableOpacity, ScrollView,
  ActivityIndicator, Alert,
} from 'react-native'
import { useState } from 'react'
import { router } from 'expo-router'
import { supabase } from '../../lib/supabase'
import { getUserFirm } from '../../lib/firm'
import { C, FONT, RADIUS } from '../../lib/theme'

export default function CreateProjectScreen() {
  const [name, setName]               = useState('')
  const [number, setNumber]           = useState('')
  const [address, setAddress]         = useState('')
  const [client, setClient]           = useState('')
  const [loading, setLoading]         = useState(false)

  const handleCreate = async () => {
    if (!name.trim()) { Alert.alert('Required', 'Please enter a project name'); return }
    setLoading(true)
    const { firm } = await getUserFirm()
    const { error } = await supabase.from('projects').insert({
      name: name.trim(),
      project_number: number.trim() || `PRJ-${Date.now().toString().slice(-6)}`,
      address: address.trim(),
      client: client.trim(),
      firm_id: firm?.id,
      status: 'active',
    })
    setLoading(false)
    if (error) { Alert.alert('Error', error.message); return }
    router.back()
  }

  return (
    <View style={S.container}>
      <View style={S.header}>
        <TouchableOpacity style={S.backBtn} onPress={() => router.back()}>
          <Text style={S.backArrow}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={S.headerTitle}>New Project</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={S.scroll} showsVerticalScrollIndicator={false}>
        <View style={S.section}>
          <Text style={S.sectionTitle}>Project Details</Text>

          {[
            { label: 'Project Name *', value: name, setter: setName, placeholder: 'e.g. Auckland Mall Refurbishment', multiline: false },
            { label: 'Project Number', value: number, setter: setNumber, placeholder: 'e.g. PRJ-2024-001', multiline: false },
            { label: 'Address', value: address, setter: setAddress, placeholder: 'e.g. 123 Queen Street, Auckland', multiline: false },
            { label: 'Client', value: client, setter: setClient, placeholder: 'e.g. Auckland Council', multiline: false },
          ].map(field => (
            <View key={field.label} style={S.field}>
              <Text style={S.label}>{field.label}</Text>
              <TextInput
                style={S.input}
                value={field.value}
                onChangeText={field.setter}
                placeholder={field.placeholder}
                placeholderTextColor={C.textMuted}
                multiline={field.multiline}
              />
            </View>
          ))}
        </View>

        <View style={S.btnWrap}>
          <TouchableOpacity style={S.btn} onPress={handleCreate} disabled={loading} activeOpacity={0.85}>
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={S.btnText}>Create Project</Text>}
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  )
}

const S = StyleSheet.create({
  container:    { flex: 1, backgroundColor: C.bgPage },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 60, paddingBottom: 12, backgroundColor: C.bgCard, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn:      { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backArrow:    { fontSize: 24, color: C.blue },
  headerTitle:  { fontSize: FONT.lg, fontWeight: '700', color: C.textPrimary },
  scroll:       { flex: 1 },
  section:      { padding: 20 },
  sectionTitle: { fontSize: FONT.xs, fontWeight: '700', color: C.textSecondary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 },
  field:        { marginBottom: 16 },
  label:        { fontSize: FONT.sm, fontWeight: '600', color: C.textPrimary, marginBottom: 6 },
  input:        { backgroundColor: C.bgCard, borderRadius: RADIUS.md, padding: 14, fontSize: FONT.md, color: C.textPrimary, borderWidth: 1, borderColor: C.border },
  btnWrap:      { paddingHorizontal: 20 },
  btn:          { backgroundColor: C.blue, borderRadius: RADIUS.md, padding: 16, alignItems: 'center' },
  btnText:      { fontSize: FONT.md, fontWeight: '700', color: '#fff' },
})