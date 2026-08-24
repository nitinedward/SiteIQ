import {
  View, Text, StyleSheet, TextInput,
  TouchableOpacity, ScrollView,
  ActivityIndicator, Alert,
} from 'react-native'
import { useState } from 'react'
import { router } from 'expo-router'
import { supabase } from '../../lib/supabase'
import { getUserFirm } from '../../lib/firm'
import { theme } from '../../lib/theme'

const T = theme.colors
const R = theme.radius

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
          <Text style={S.backArrow}>{'⬅️'}</Text>
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
                placeholderTextColor={T.mid}
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
  container:    { flex: 1, backgroundColor: T.paper },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 60, paddingBottom: 12, backgroundColor: T.surface, borderBottomWidth: 1, borderBottomColor: T.line },
  backBtn:      { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backArrow:    { fontSize: 28, color: T.indigo, lineHeight: 32 },
  headerTitle:  { fontSize: 17, fontWeight: '700', color: T.ink },
  scroll:       { flex: 1 },
  section:      { padding: 20 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: T.mid, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 },
  field:        { marginBottom: 16 },
  label:        { fontSize: 14, fontWeight: '600', color: T.ink, marginBottom: 6 },
  input:        { backgroundColor: T.surface, borderRadius: R.md, padding: 14, fontSize: 15, color: T.ink, borderWidth: 1, borderColor: T.line },
  btnWrap:      { paddingHorizontal: 20 },
  btn:          {
    backgroundColor: T.marigold,
    borderRadius: R.pill,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#E08D0B',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.42,
    shadowRadius: 26,
    elevation: 8,
  },
  btnText:      { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
})