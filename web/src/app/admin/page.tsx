'use client'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { Shell, Badge, Btn, Spinner, Card } from '@/components/Shell'

const supabase = createClient(
  'https://vbaewualqaxhbmqgnhdt.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
)

type Project = { id: string; name: string; project_number: string; address: string; client_name: string; status: string; description: string }
type Drawing = { id: string; title: string; number: string; revision: string; file_url: string; created_at: string }
type Member  = { id: string; user_id: string; full_name: string; email: string; role: string }

const STATUS_OPTIONS = ['ACTIVE', 'ON_HOLD', 'COMPLETED'] as const
const STATUS_LABELS: Record<string, string> = { ACTIVE: 'Active', ON_HOLD: 'On Hold', COMPLETED: 'Completed' }

// ── FORM PRIMITIVES ───────────────────────────────────────────────────────────
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label style={{
      display: 'block', fontSize: 14, fontWeight: 500,
      color: 'var(--dark)', marginBottom: 6,
    }}>
      {children}
    </label>
  )
}

function FInp({ value, onChange, placeholder, type = 'text' }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  const [focused, setFocused] = useState(false)
  return (
    <input
      type={type} value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%', padding: '12px 16px',
        background: focused ? 'var(--white)' : 'var(--stone)',
        border: `1px solid ${focused ? 'var(--accent)' : 'var(--line)'}`,
        borderRadius: 8, fontSize: 15, color: 'var(--ink)',
        outline: 'none', transition: 'all .15s',
      }}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    />
  )
}

function FTA({ value, onChange, placeholder, rows = 3 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number
}) {
  const [focused, setFocused] = useState(false)
  return (
    <textarea
      value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} rows={rows}
      style={{
        width: '100%', padding: '12px 16px',
        background: focused ? 'var(--white)' : 'var(--stone)',
        border: `1px solid ${focused ? 'var(--accent)' : 'var(--line)'}`,
        borderRadius: 8, fontSize: 15, color: 'var(--ink)',
        outline: 'none', resize: 'none', transition: 'all .15s',
      }}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    />
  )
}

function FSel({ value, onChange, options }: {
  value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value} onChange={e => onChange(e.target.value)}
      style={{
        width: '100%', padding: '12px 16px',
        background: 'var(--stone)', border: '1px solid var(--line)',
        borderRadius: 8, fontSize: 15, color: 'var(--ink)', outline: 'none',
      }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: 'var(--accent2)', color: 'var(--accent)',
      fontSize: size * 0.35, fontWeight: 600,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {initials}
    </div>
  )
}

// ── PAGE ──────────────────────────────────────────────────────────────────────
export default function AdminPage() {
  const router = useRouter()

  // ── existing state ────────────────────────────────────────────────────────
  const [firmId, setFirmId]           = useState('')
  const [firmName, setFirmName]       = useState('')
  const [joinCode, setJoinCode]       = useState('')
  const [fullName, setFullName]       = useState('')
  const [adminUserId, setAdminUserId] = useState('')
  const [projects, setProjects]       = useState<Project[]>([])
  const [members, setMembers]         = useState<Member[]>([])
  const [loading, setLoading]         = useState(true)
  const [tab, setTab]                 = useState<'projects' | 'team'>('projects')

  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [projTab, setProjTab]                 = useState<'reports' | 'drawings' | 'engineers'>('reports')
  const [drawings, setDrawings]               = useState<Drawing[]>([])
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>([])
  const [showNewProject, setShowNewProject]   = useState(false)
  const [uploading, setUploading]             = useState(false)
  const [savingAssignment, setSavingAssignment] = useState(false)

  const [editingProject, setEditingProject] = useState(false)
  const [editForm, setEditForm]             = useState<Partial<Project>>({})

  const [newName, setNewName]       = useState('')
  const [newNumber, setNewNumber]   = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [newClient, setNewClient]   = useState('')
  const [newDesc, setNewDesc]       = useState('')
  const [newStatus, setNewStatus]   = useState('ACTIVE')
  const [saving, setSaving]         = useState(false)

  const [projectSearch, setProjectSearch]     = useState('')
  const [showJoinCodePanel, setShowJoinCodePanel] = useState(false)

  // ── new state ─────────────────────────────────────────────────────────────
  const [editingJoinCode, setEditingJoinCode]     = useState('')
  const [savingJoinCode, setSavingJoinCode]       = useState(false)
  const [pendingInspections, setPendingInspections]     = useState<any[]>([])
  const [finalisedInspections, setFinalisedInspections] = useState<any[]>([])
  const [loadingInspections, setLoadingInspections] = useState(false)
  const [deletingReportId, setDeletingReportId]   = useState<string | null>(null)
  const [currentUserId, setCurrentUserId]         = useState('')
  const [copiedCode, setCopiedCode]               = useState(false)
  const [uploadProgress, setUploadProgress]       = useState<string | null>(null)

  const drawingInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { loadData() }, [])

  // ── existing functions (unchanged) ────────────────────────────────────────
  const loadData = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/'); return }
    setAdminUserId(user.id)
    setCurrentUserId(user.id)

    const { data: member } = await supabase
      .from('firm_members')
      .select('firm_id, role, full_name, firms(id, name, join_code)')
      .eq('user_id', user.id)
      .single()

    if (member?.role !== 'admin') { router.push('/dashboard'); return }

    const firm = member.firms as any
    setFirmId(firm.id)
    setFirmName(firm.name)
    setJoinCode(firm.join_code ?? '')
    setEditingJoinCode(firm.join_code ?? '')
    setFullName(member.full_name)

    const [{ data: projs }, { data: mems }] = await Promise.all([
      supabase.from('projects').select('*').eq('firm_id', firm.id).order('created_at', { ascending: false }),
      supabase.from('firm_members').select('id, user_id, full_name, email, role').eq('firm_id', firm.id),
    ])

    setProjects(projs ?? [])
    setMembers(mems ?? [])
    setLoading(false)
  }

  const selectProject = async (project: Project) => {
    setSelectedProject(project)
    setEditingProject(false)
    setProjTab('reports')
    const [{ data: d }, { data: pm }] = await Promise.all([
      supabase.from('drawings').select('*').eq('project_id', project.id).order('created_at', { ascending: false }),
      supabase.from('project_members').select('user_id').eq('project_id', project.id),
    ])
    setDrawings(d ?? [])
    setAssignedUserIds((pm ?? []).map((p: any) => p.user_id))
    loadProjectInspections(project.id)
  }

  const toggleAssignment = async (userId: string) => {
    if (!selectedProject) return
    setSavingAssignment(true)
    const isAssigned = assignedUserIds.includes(userId)
    if (isAssigned) {
      await supabase.from('project_members').delete().eq('project_id', selectedProject.id).eq('user_id', userId)
      setAssignedUserIds(curr => curr.filter(id => id !== userId))
    } else {
      await supabase.from('project_members').insert({ project_id: selectedProject.id, user_id: userId, added_by: adminUserId })
      setAssignedUserIds(curr => [...curr, userId])
    }
    setSavingAssignment(false)
  }

  const createProject = async () => {
    if (!newName.trim()) { alert('Project name is required'); return }
    setSaving(true)
    const { data: newProj } = await supabase.from('projects').insert({
      name: newName.trim(), project_number: newNumber.trim() || `PRJ-${Date.now().toString().slice(-6)}`,
      address: newAddress.trim(), client_name: newClient.trim(), description: newDesc.trim(),
      firm_id: firmId, status: newStatus,
    }).select().single()
    if (newProj) {
      await supabase.from('project_members').insert({ project_id: newProj.id, user_id: adminUserId, added_by: adminUserId })
    }
    setNewName(''); setNewNumber(''); setNewAddress(''); setNewClient(''); setNewDesc(''); setNewStatus('ACTIVE')
    setShowNewProject(false)
    setSaving(false)
    loadData()
  }

  const startEdit = () => { if (!selectedProject) return; setEditForm({ ...selectedProject }); setEditingProject(true) }

  const saveEdit = async () => {
    if (!selectedProject || !editForm.name?.trim()) return
    setSaving(true)
    const { data: updated } = await supabase.from('projects').update({
      name: editForm.name?.trim(), project_number: editForm.project_number?.trim(),
      address: editForm.address?.trim(), client_name: editForm.client_name?.trim(),
      description: editForm.description?.trim(), status: editForm.status,
    }).eq('id', selectedProject.id).select().single()
    if (updated) { setSelectedProject(updated as Project); setProjects(curr => curr.map(p => p.id === updated.id ? updated as Project : p)) }
    setEditingProject(false)
    setSaving(false)
  }

  const uploadDrawing = async (projectId: string) => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = 'application/pdf'
    input.onchange = async (e: any) => {
      const file = e.target.files[0]; if (!file) return
      setUploading(true)
      const fileName = `drawing-${Date.now()}.pdf`
      const { error } = await supabase.storage.from('drawings').upload(fileName, file)
      if (error) { alert('Upload failed: ' + error.message); setUploading(false); return }
      const { data: { publicUrl } } = supabase.storage.from('drawings').getPublicUrl(fileName)
      await supabase.from('drawings').insert({ project_id: projectId, title: file.name.replace('.pdf', ''), number: '', revision: 'A', file_url: publicUrl, file_name: fileName })
      setUploading(false)
      if (selectedProject) selectProject(selectedProject)
    }
    input.click()
  }

  const deleteDrawing = async (id: string) => {
    if (!confirm('Delete this drawing?')) return
    await supabase.from('drawings').delete().eq('id', id)
    if (selectedProject) selectProject(selectedProject)
  }

  const deleteProject = async (id: string) => {
    if (!confirm('Delete this project and all its data?')) return
    await supabase.from('projects').delete().eq('id', id)
    setSelectedProject(null); loadData()
  }

  const updateMemberRole = async (memberId: string, role: string) => {
    await supabase.from('firm_members').update({ role }).eq('id', memberId)
    loadData()
  }

  const handleSignOut = async () => { await supabase.auth.signOut(); router.push('/') }

  // ── new functions ─────────────────────────────────────────────────────────
  const saveJoinCode = async () => {
    if (!editingJoinCode.trim() || editingJoinCode.length < 4) {
      alert('Join code must be at least 4 characters')
      return
    }
    if (editingJoinCode.includes(' ')) {
      alert('Join code cannot contain spaces')
      return
    }
    setSavingJoinCode(true)
    await supabase.from('firms')
      .update({ join_code: editingJoinCode.trim().toUpperCase() })
      .eq('id', firmId)
    setJoinCode(editingJoinCode.trim().toUpperCase())
    setSavingJoinCode(false)
    alert('Join code updated successfully')
  }

  const removeMember = async (memberId: string, userId: string, memberName: string) => {
    if (!confirm(`Remove ${memberName} from firm? They will lose access to all projects immediately.`)) return
    await supabase.from('project_members').delete().eq('user_id', userId)
    await supabase.from('firm_members').delete().eq('id', memberId)
    loadData()
  }

  const loadProjectInspections = async (projectId: string) => {
    setLoadingInspections(true)
    const { data: pending } = await supabase
      .from('inspections')
      .select('*')
      .eq('project_id', projectId)
      .eq('status', 'COMPLETED')
      .or('report_status.eq.pending,report_status.is.null')
      .order('created_at', { ascending: false })
    const { data: finalised } = await supabase
      .from('inspections')
      .select('*')
      .eq('project_id', projectId)
      .eq('status', 'COMPLETED')
      .eq('report_status', 'finalised')
      .order('created_at', { ascending: false })
    setPendingInspections(pending ?? [])
    setFinalisedInspections(finalised ?? [])
    setLoadingInspections(false)
  }

  const deleteReport = async (inspectionId: string) => {
    if (!confirm('Delete this site report? All observations and photos linked to this report will also be deleted.')) return
    setDeletingReportId(inspectionId)
    await supabase.from('observations').delete().eq('inspection_id', inspectionId)
    await supabase.from('zones').delete().eq('inspection_id', inspectionId)
    await supabase.from('inspections').delete().eq('id', inspectionId)
    setPendingInspections(prev => prev.filter(i => i.id !== inspectionId))
    setFinalisedInspections(prev => prev.filter(i => i.id !== inspectionId))
    setDeletingReportId(null)
  }

  const handlePdfUpload = async (file: File) => {
    if (!selectedProject) return
    setUploadProgress('Processing PDF… Splitting into individual pages')
    try {
      const arrayBuffer = await file.arrayBuffer()
      const pdfjsLib = await import('pdfjs-dist')
      pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
      const pdf = await loadingTask.promise
      const pageCount = pdf.numPages

      // Upload the PDF to storage
      const fileName = `drawing-${Date.now()}-${file.name.replace(/\s/g, '-')}`
      const { error } = await supabase.storage.from('drawings').upload(fileName, file)
      if (error) { alert('Upload failed: ' + error.message); setUploadProgress(null); return }
      const { data: { publicUrl } } = supabase.storage.from('drawings').getPublicUrl(fileName)

      // Insert one drawing record per page
      for (let n = 1; n <= pageCount; n++) {
        await supabase.from('drawings').insert({
          project_id: selectedProject.id,
          title: `${file.name.replace('.pdf', '')} — Page ${n} of ${pageCount}`,
          number: `DWG-${String(n).padStart(3, '0')}`,
          revision: 'A',
          file_url: publicUrl,
          file_name: fileName,
        })
      }

      setUploadProgress(null)
      alert(`Drawing uploaded and split into ${pageCount} page${pageCount > 1 ? 's' : ''}`)
      selectProject(selectedProject)
    } catch (err) {
      console.error(err)
      alert('Upload failed. Please try again.')
      setUploadProgress(null)
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  const projectFormFields = (
    vals: { name: string; number: string; address: string; client: string; desc: string; status: string },
    set: { name: (v: string) => void; number: (v: string) => void; address: (v: string) => void; client: (v: string) => void; desc: (v: string) => void; status: (v: string) => void }
  ) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div><FieldLabel>Project Name *</FieldLabel><FInp value={vals.name} onChange={set.name} placeholder="e.g. Auckland Mall Carpark" /></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div><FieldLabel>Project Number</FieldLabel><FInp value={vals.number} onChange={set.number} placeholder="PRJ-2024-001" /></div>
        <div><FieldLabel>Status</FieldLabel><FSel value={vals.status} onChange={set.status} options={STATUS_OPTIONS.map(s => ({ value: s, label: STATUS_LABELS[s] }))} /></div>
      </div>
      <div><FieldLabel>Address</FieldLabel><FInp value={vals.address} onChange={set.address} placeholder="123 Queen St, Auckland" /></div>
      <div><FieldLabel>Client</FieldLabel><FInp value={vals.client} onChange={set.client} placeholder="e.g. Auckland Council" /></div>
      <div><FieldLabel>Description</FieldLabel><FTA value={vals.desc} onChange={set.desc} placeholder="Project scope…" rows={3} /></div>
    </div>
  )

  const filteredProjects = projects.filter(p =>
    p.name.toLowerCase().includes(projectSearch.toLowerCase()) ||
    p.project_number.toLowerCase().includes(projectSearch.toLowerCase()) ||
    (p.client_name ?? '').toLowerCase().includes(projectSearch.toLowerCase())
  )

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <Spinner size={32} />
    </div>
  )

  const tabBtn = (active: boolean): React.CSSProperties => ({
    padding: '14px 20px', fontSize: 15,
    fontWeight: active ? 600 : 400,
    color: active ? 'var(--accent)' : 'var(--mid)',
    background: 'none', border: 'none',
    borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
    cursor: 'pointer', transition: 'all .15s',
  })

  const subTabBtn = (active: boolean): React.CSSProperties => ({
    padding: '14px 24px', fontSize: 15,
    fontWeight: active ? 600 : 400,
    color: active ? 'var(--accent)' : 'var(--mid)',
    background: 'none', border: 'none',
    borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
    cursor: 'pointer', transition: 'all .15s',
  })

  // ── TABLE HEADER STYLE ────────────────────────────────────────────────────
  const th: React.CSSProperties = {
    textAlign: 'left', padding: '12px 20px',
    fontFamily: 'var(--f-mono)', fontSize: 11,
    textTransform: 'uppercase', letterSpacing: '1.5px',
    color: 'var(--mid)', fontWeight: 600,
    borderBottom: '1px solid var(--line)',
    background: 'var(--stone)',
  }
  const td: React.CSSProperties = {
    padding: '14px 20px', fontSize: 15,
    borderBottom: '1px solid var(--line)',
    verticalAlign: 'middle',
  }

  return (
    <Shell
      activePage={tab === 'projects' ? 'projects' : 'team'}
      role="admin"
      fullName={fullName}
      firmName={firmName}
      onSignOut={handleSignOut}
    >

      {/* ── Main tab bar ─────────────────────────────────── */}
      <div style={{ borderBottom: '1px solid var(--line)', background: 'var(--white)', padding: '0 28px', display: 'flex', gap: 4 }}>
        <button style={tabBtn(tab === 'projects')} onClick={() => setTab('projects')}>Projects</button>
        <button style={tabBtn(tab === 'team')}     onClick={() => setTab('team')}>Team</button>
      </div>

      {/* ══════════════════════════════════════════════════════
          PROJECTS TAB
      ══════════════════════════════════════════════════════ */}
      {tab === 'projects' && (
        <div style={{ display: 'flex', height: 'calc(100vh - 64px - 49px)', overflow: 'hidden' }}>

          {/* Left — project list (300px fixed) */}
          <div style={{
            width: 300, flexShrink: 0,
            borderRight: '1px solid var(--line)',
            background: 'var(--white)',
            display: 'flex', flexDirection: 'column',
            overflowY: 'auto',
          }}>
            {/* Search */}
            <div style={{ padding: 16, borderBottom: '1px solid var(--line)' }}>
              <div style={{ position: 'relative' }}>
                <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--mid)', pointerEvents: 'none' }} width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                </svg>
                <input
                  value={projectSearch}
                  onChange={e => setProjectSearch(e.target.value)}
                  placeholder="Search projects…"
                  style={{
                    width: '100%', padding: '9px 12px 9px 32px',
                    background: 'var(--stone)', border: '1px solid var(--line)',
                    borderRadius: 8, fontSize: 14, color: 'var(--ink)', outline: 'none',
                  }}
                  onFocus={e => { e.target.style.background = 'var(--white)'; e.target.style.borderColor = 'var(--accent)' }}
                  onBlur={e =>  { e.target.style.background = 'var(--stone)'; e.target.style.borderColor = 'var(--line)' }}
                />
              </div>
            </div>

            {/* New project button */}
            <div style={{ padding: '0 16px 12px' }}>
              <button
                onClick={() => { setShowNewProject(v => !v); setSelectedProject(null) }}
                style={{
                  width: '100%', padding: '10px', marginTop: 12,
                  background: 'var(--accent)', color: '#fff',
                  border: 'none', borderRadius: 8,
                  fontSize: 14, fontWeight: 600, cursor: 'pointer',
                }}
              >
                + New Project
              </button>
            </div>

            {/* New project inline form */}
            {showNewProject && (
              <div style={{ padding: '0 16px 16px' }}>
                <Card style={{ padding: 16 }}>
                  <div style={{ fontFamily: 'var(--f-serif)', fontSize: 18, fontWeight: 600, marginBottom: 14 }}>New Project</div>
                  {projectFormFields(
                    { name: newName, number: newNumber, address: newAddress, client: newClient, desc: newDesc, status: newStatus },
                    { name: setNewName, number: setNewNumber, address: setNewAddress, client: setNewClient, desc: setNewDesc, status: setNewStatus }
                  )}
                  <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                    <Btn variant="outline" onClick={() => setShowNewProject(false)} style={{ flex: 1 }}>Cancel</Btn>
                    <Btn variant="primary" onClick={createProject} disabled={saving} style={{ flex: 1 }}>
                      {saving ? 'Creating…' : 'Create'}
                    </Btn>
                  </div>
                </Card>
              </div>
            )}

            {/* Project list */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredProjects.map(p => {
                const active = selectedProject?.id === p.id
                const statusColors: Record<string, string> = { ACTIVE: 'var(--green)', ON_HOLD: 'var(--amber)', COMPLETED: 'var(--accent)' }
                return (
                  <button
                    key={p.id}
                    onClick={() => selectProject(p)}
                    style={{
                      width: '100%', textAlign: 'left',
                      background: active ? 'var(--accent2)' : 'none',
                      borderLeft: active ? '3px solid var(--accent)' : '3px solid transparent',
                      borderTop: 'none', borderRight: 'none',
                      borderBottom: '1px solid var(--line)',
                      padding: '20px 24px',
                      cursor: 'pointer', transition: 'all .12s',
                      minHeight: 80,
                    }}
                    onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--stone)' }}
                    onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'none' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ fontFamily: 'var(--f-serif)', fontSize: 18, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.2, flex: 1 }}>{p.name}</div>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColors[p.status] ?? 'var(--mid)', flexShrink: 0, marginTop: 5, display: 'inline-block' }} />
                    </div>
                    <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--mid)', marginTop: 3 }}>#{p.project_number}</div>
                    {p.client_name && <div style={{ fontSize: 13, color: 'var(--mid)', marginTop: 2 }}>{p.client_name}</div>}
                  </button>
                )
              })}
              {filteredProjects.length === 0 && (
                <div style={{ padding: '28px 24px', textAlign: 'center', fontSize: 14, color: 'var(--mid)' }}>
                  {projectSearch ? 'No projects match' : 'No projects yet'}
                </div>
              )}
            </div>
          </div>

          {/* Right — project detail */}
          <div style={{ flex: 1, overflowY: 'auto', background: 'var(--off)' }}>
            {!selectedProject ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
                <svg width="40" height="40" fill="none" stroke="var(--line2)" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18"/>
                  <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/>
                  <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/>
                </svg>
                <div style={{ fontFamily: 'var(--f-serif)', fontSize: 22, color: 'var(--mid)', fontWeight: 400 }}>Select a project</div>
                <div style={{ fontSize: 14, color: 'var(--mid)', textAlign: 'center', maxWidth: 280 }}>
                  Choose a project from the list to manage its reports, drawings and engineers
                </div>
              </div>
            ) : (
              <div style={{ background: 'var(--white)', minHeight: '100%' }}>

                {/* Project header */}
                <div style={{ padding: '24px 28px', borderBottom: '1px solid var(--line)' }}>
                  {editingProject ? (
                    <>
                      <div style={{ fontFamily: 'var(--f-serif)', fontSize: 22, fontWeight: 600, color: 'var(--ink)', marginBottom: 18 }}>Edit Project</div>
                      {projectFormFields(
                        { name: editForm.name ?? '', number: editForm.project_number ?? '', address: editForm.address ?? '', client: editForm.client_name ?? '', desc: editForm.description ?? '', status: editForm.status ?? 'ACTIVE' },
                        {
                          name:    v => setEditForm(p => ({ ...p, name: v })),
                          number:  v => setEditForm(p => ({ ...p, project_number: v })),
                          address: v => setEditForm(p => ({ ...p, address: v })),
                          client:  v => setEditForm(p => ({ ...p, client_name: v })),
                          desc:    v => setEditForm(p => ({ ...p, description: v })),
                          status:  v => setEditForm(p => ({ ...p, status: v })),
                        }
                      )}
                      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                        <Btn variant="outline" onClick={() => setEditingProject(false)} style={{ flex: 1 }}>Cancel</Btn>
                        <Btn variant="primary" onClick={saveEdit} disabled={saving} style={{ flex: 1 }}>
                          {saving ? 'Saving…' : 'Save Changes'}
                        </Btn>
                      </div>
                    </>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                      <div style={{ flex: 1 }}>
                        <h2 style={{ fontFamily: 'var(--f-serif)', fontSize: 32, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>{selectedProject.name}</h2>
                        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--mid)', marginTop: 4 }}>#{selectedProject.project_number}</div>
                        {(selectedProject.client_name || selectedProject.address) && (
                          <div style={{ fontSize: 14, color: 'var(--mid)', marginTop: 4 }}>
                            {[selectedProject.client_name, selectedProject.address].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 20 }}>
                        <Badge status={selectedProject.status} />
                        <Btn variant="outline" small onClick={startEdit}>Edit</Btn>
                        <Btn variant="danger"  small onClick={() => deleteProject(selectedProject.id)}>Delete</Btn>
                      </div>
                    </div>
                  )}
                </div>

                {/* Sub-tabs */}
                {!editingProject && (
                  <div style={{ display: 'flex', borderBottom: '1px solid var(--line)', padding: '0 4px' }}>
                    <button style={subTabBtn(projTab === 'reports')}   onClick={() => { setProjTab('reports'); loadProjectInspections(selectedProject.id) }}>Reports</button>
                    <button style={subTabBtn(projTab === 'drawings')}  onClick={() => setProjTab('drawings')}>Drawings ({drawings.length})</button>
                    <button style={subTabBtn(projTab === 'engineers')} onClick={() => setProjTab('engineers')}>Engineers</button>
                  </div>
                )}

                {/* ── REPORTS TAB ── */}
                {!editingProject && projTab === 'reports' && (
                  <div style={{ padding: '24px 28px' }}>
                    {loadingInspections ? (
                      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner size={28} /></div>
                    ) : (
                      <>
                        {/* Section A — Needs AI Report */}
                        <div style={{ marginBottom: 28 }}>
                          <div style={{ background: 'var(--orange2)', padding: '10px 20px', borderRadius: 8, marginBottom: 12 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--orange)' }}>
                              ⚡ Pending AI Report — {pendingInspections.length}
                            </span>
                          </div>
                          <div style={{ background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <thead>
                                <tr>
                                  {['Report #', 'Date', 'Site Contact', 'Weather', 'Actions'].map(h => (
                                    <th key={h} style={th}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {pendingInspections.length === 0 ? (
                                  <tr>
                                    <td colSpan={5} style={{ ...td, textAlign: 'center', color: 'var(--mid)' }}>
                                      No pending reports for this project
                                    </td>
                                  </tr>
                                ) : pendingInspections.map(ins => (
                                  <tr key={ins.id}
                                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--stone)')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                  >
                                    <td style={td}>
                                      <span style={{ background: 'var(--accent2)', color: 'var(--accent)', fontFamily: 'var(--f-mono)', fontSize: 11, padding: '4px 8px', borderRadius: 5 }}>
                                        #{ins.report_no ?? '—'}
                                      </span>
                                    </td>
                                    <td style={{ ...td, fontFamily: 'var(--f-mono)', fontSize: 13 }}>{ins.date ?? '—'}</td>
                                    <td style={{ ...td, fontSize: 14 }}>{ins.site_contact ?? '—'}</td>
                                    <td style={{ ...td, fontSize: 14 }}>{ins.weather ?? '—'}</td>
                                    <td style={td}>
                                      <div style={{ display: 'flex', gap: 8 }}>
                                        <button
                                          onClick={() => router.push(`/report/${ins.id}?project_name=${encodeURIComponent(selectedProject?.name ?? '')}`)}
                                          style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                                        >
                                          Generate AI Report
                                        </button>
                                        <button
                                          onClick={() => deleteReport(ins.id)}
                                          disabled={deletingReportId === ins.id}
                                          style={{ background: 'var(--red2)', color: 'var(--red)', border: '1px solid #f5c6c0', borderRadius: 7, padding: '8px 14px', fontSize: 14, cursor: deletingReportId === ins.id ? 'not-allowed' : 'pointer', opacity: deletingReportId === ins.id ? 0.6 : 1 }}
                                        >
                                          {deletingReportId === ins.id ? '…' : 'Delete'}
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* Section B — Completed Reports */}
                        <div>
                          <div style={{ background: 'var(--green2)', padding: '10px 20px', borderRadius: 8, marginBottom: 12 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>
                              ✓ Completed Reports — {finalisedInspections.length}
                            </span>
                          </div>
                          <div style={{ background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <thead>
                                <tr>
                                  {['Report #', 'Date', 'Site Contact', 'Weather', 'Actions'].map(h => (
                                    <th key={h} style={th}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {finalisedInspections.length === 0 ? (
                                  <tr>
                                    <td colSpan={5} style={{ ...td, textAlign: 'center', color: 'var(--mid)' }}>
                                      No completed reports yet
                                    </td>
                                  </tr>
                                ) : finalisedInspections.map(ins => (
                                  <tr key={`done-${ins.id}`}
                                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--stone)')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                  >
                                    <td style={td}>
                                      <span style={{ background: 'var(--green2)', color: 'var(--green)', fontFamily: 'var(--f-mono)', fontSize: 11, padding: '4px 8px', borderRadius: 5 }}>
                                        #{ins.report_no ?? '—'}
                                      </span>
                                    </td>
                                    <td style={{ ...td, fontFamily: 'var(--f-mono)', fontSize: 13 }}>{ins.date ?? '—'}</td>
                                    <td style={{ ...td, fontSize: 14 }}>{ins.site_contact ?? '—'}</td>
                                    <td style={{ ...td, fontSize: 14 }}>{ins.weather ?? '—'}</td>
                                    <td style={td}>
                                      <div style={{ display: 'flex', gap: 8 }}>
                                        <button
                                          onClick={() => router.push(`/report/${ins.id}`)}
                                          style={{ background: 'none', color: 'var(--accent)', border: '1px solid var(--line)', borderRadius: 7, padding: '8px 14px', fontSize: 14, cursor: 'pointer' }}
                                        >
                                          Open
                                        </button>
                                        <button
                                          onClick={() => deleteReport(ins.id)}
                                          disabled={deletingReportId === ins.id}
                                          style={{ background: 'var(--red2)', color: 'var(--red)', border: '1px solid #f5c6c0', borderRadius: 7, padding: '8px 14px', fontSize: 14, cursor: deletingReportId === ins.id ? 'not-allowed' : 'pointer', opacity: deletingReportId === ins.id ? 0.6 : 1 }}
                                        >
                                          {deletingReportId === ins.id ? '…' : 'Delete'}
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* ── DRAWINGS TAB ── */}
                {!editingProject && projTab === 'drawings' && (
                  <div style={{ padding: '24px 28px' }}>
                    {/* Upload overlay */}
                    {uploadProgress && (
                      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
                        <div style={{ background: 'var(--white)', borderRadius: 12, padding: '32px 40px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                          <Spinner size={32} />
                          <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>{uploadProgress}</div>
                        </div>
                      </div>
                    )}

                    {/* Upload zone */}
                    <div
                      onClick={() => drawingInputRef.current?.click()}
                      style={{
                        height: 120, border: '2px dashed var(--line2)', borderRadius: 10,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        gap: 8, cursor: 'pointer', marginBottom: 20, transition: 'all .15s',
                        background: 'var(--stone)',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent2)'; e.currentTarget.style.borderColor = 'var(--accent)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'var(--stone)'; e.currentTarget.style.borderColor = 'var(--line2)' }}
                    >
                      <svg width="24" height="24" fill="none" stroke="var(--mid)" strokeWidth="1.5" viewBox="0 0 24 24">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="17 8 12 3 7 8"/>
                        <line x1="12" y1="3" x2="12" y2="15"/>
                      </svg>
                      <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--dark)' }}>Upload Drawing (PDF)</div>
                      <div style={{ fontSize: 13, color: 'var(--mid)' }}>Multi-page PDFs will be automatically split into individual drawings</div>
                    </div>

                    <input
                      ref={drawingInputRef}
                      type="file"
                      accept="application/pdf"
                      style={{ display: 'none' }}
                      onChange={e => {
                        const file = e.target.files?.[0]
                        if (file) handlePdfUpload(file)
                        e.target.value = ''
                      }}
                    />

                    {/* Drawing list */}
                    {drawings.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '24px 0', fontSize: 14, color: 'var(--mid)' }}>
                        No drawings yet — upload a PDF above
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {drawings.map(d => (
                          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 14, background: 'var(--stone)', border: '1px solid var(--line)', borderRadius: 8, padding: '14px 20px' }}>
                            <div style={{ background: 'var(--accent2)', color: 'var(--accent)', fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 5, fontFamily: 'var(--f-mono)', flexShrink: 0 }}>
                              {d.number || '—'}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</div>
                              <div style={{ fontSize: 12, color: 'var(--mid)', fontFamily: 'var(--f-mono)', marginTop: 2 }}>Rev {d.revision}</div>
                            </div>
                            <a href={d.file_url} target="_blank" rel="noreferrer" style={{ fontSize: 14, color: 'var(--accent)', textDecoration: 'none', fontWeight: 500, flexShrink: 0 }}>View</a>
                            <button onClick={() => deleteDrawing(d.id)} style={{ background: 'var(--red2)', color: 'var(--red)', border: '1px solid #f5c6c0', borderRadius: 6, padding: '5px 12px', fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>Delete</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── ENGINEERS TAB ── */}
                {!editingProject && projTab === 'engineers' && (
                  <div style={{ padding: '24px 28px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                      <h3 style={{ fontFamily: 'var(--f-serif)', fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>Assigned Engineers</h3>
                      <Btn variant="primary" onClick={() => setShowJoinCodePanel(v => !v)} style={{ fontSize: 14 }}>+ Add Engineer</Btn>
                    </div>

                    {showJoinCodePanel && (
                      <div style={{ background: 'var(--accent2)', border: '1px solid var(--line2)', borderRadius: 10, padding: '16px 20px', marginBottom: 20 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', marginBottom: 6 }}>How engineers join</div>
                        <div style={{ fontSize: 14, color: 'var(--dark)', lineHeight: 1.6 }}>Engineers sign up on the mobile app and enter the firm join code:</div>
                        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 22, fontWeight: 600, color: 'var(--accent)', letterSpacing: '0.25em', margin: '10px 0' }}>{joinCode}</div>
                        <div style={{ fontSize: 13, color: 'var(--mid)' }}>Once they join, they appear below and you can assign them to this project.</div>
                        <button onClick={() => setShowJoinCodePanel(false)} style={{ marginTop: 10, fontSize: 13, color: 'var(--mid)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Dismiss</button>
                      </div>
                    )}

                    {savingAssignment && (
                      <div style={{ fontSize: 12, color: 'var(--accent)', fontFamily: 'var(--f-mono)', marginBottom: 12 }}>Saving…</div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {members.map(m => {
                        const assigned = assignedUserIds.includes(m.user_id)
                        return (
                          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 0', borderBottom: '1px solid var(--line)' }}>
                            <Avatar name={m.full_name} size={44} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>{m.full_name}</div>
                              <div style={{ fontSize: 14, color: 'var(--mid)', marginTop: 2 }}>{m.email}</div>
                            </div>
                            <span style={{
                              fontSize: 12, fontWeight: 600, padding: '2px 9px', borderRadius: 99,
                              background: m.role === 'admin' ? 'var(--accent2)' : 'var(--green2)',
                              color: m.role === 'admin' ? 'var(--accent)' : 'var(--green)',
                            }}>
                              {m.role === 'admin' ? 'Admin' : 'Engineer'}
                            </span>
                            <button
                              onClick={() => toggleAssignment(m.user_id)}
                              style={{
                                fontSize: 14, fontWeight: 600, padding: '8px 18px', borderRadius: 7, cursor: 'pointer', transition: 'all .15s',
                                background: assigned ? 'var(--red2)' : 'none',
                                color: assigned ? 'var(--red)' : 'var(--accent)',
                                border: assigned ? '1px solid #f5c6c0' : '1px solid var(--accent)',
                              }}
                            >
                              {assigned ? 'Remove' : 'Add to Project'}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          TEAM TAB
      ══════════════════════════════════════════════════════ */}
      {tab === 'team' && (
        <div style={{ padding: '32px 28px', maxWidth: 860 }}>

          {/* Team heading */}
          <div style={{ marginBottom: 24 }}>
            <h1 style={{ fontFamily: 'var(--f-serif)', fontSize: 32, fontWeight: 600, color: 'var(--ink)', lineHeight: 1 }}>Team Members</h1>
            <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '1.5px', color: 'var(--mid)', marginTop: 8 }}>
              {members.length} engineers · {firmName}
            </div>
          </div>

          {/* Join code card */}
          <Card style={{ padding: 24, marginBottom: 20 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>Team Join Code</div>
            <div style={{ fontSize: 14, color: 'var(--mid)', marginBottom: 16 }}>
              Engineers enter this code when signing up on the mobile app to automatically join your firm.
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <input
                value={editingJoinCode}
                onChange={e => setEditingJoinCode(e.target.value.toUpperCase())}
                style={{
                  fontFamily: 'var(--f-mono)', fontSize: 24, fontWeight: 600,
                  letterSpacing: '4px', padding: '14px 20px',
                  border: '2px solid var(--line)', borderRadius: 8,
                  background: 'var(--stone)', color: 'var(--accent)',
                  textTransform: 'uppercase', width: 200, outline: 'none',
                }}
                onFocus={e => { e.target.style.borderColor = 'var(--accent)'; e.target.style.background = 'var(--white)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--line)'; e.target.style.background = 'var(--stone)' }}
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(editingJoinCode)
                  setCopiedCode(true)
                  setTimeout(() => setCopiedCode(false), 2000)
                }}
                style={{ padding: '10px 18px', background: 'none', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14, color: 'var(--dark)', cursor: 'pointer' }}
              >
                {copiedCode ? 'Copied!' : 'Copy'}
              </button>
              <button
                onClick={saveJoinCode}
                disabled={savingJoinCode}
                style={{ padding: '10px 18px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: savingJoinCode ? 'not-allowed' : 'pointer', opacity: savingJoinCode ? 0.7 : 1 }}
              >
                {savingJoinCode ? 'Saving…' : 'Save Code'}
              </button>
            </div>
            <div style={{ marginTop: 16, background: 'var(--accent2)', border: '1px solid #c5d8f5', borderRadius: 8, padding: '14px 18px', fontSize: 13, color: 'var(--accent)' }}>
              💡 Anyone who downloads the mobile app and enters this code will be added to {firmName} automatically. Change this code if you want to stop new members joining.
            </div>
          </Card>

          {/* Members table */}
          <Card style={{ overflow: 'hidden' }}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>Members</span>
              <Btn variant="primary" onClick={() => setShowJoinCodePanel(v => !v)}>+ Add Engineer</Btn>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Member', 'Role', 'Email', 'Status', 'Actions'].map(h => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map(m => (
                  <tr
                    key={m.id}
                    style={{ borderBottom: '1px solid var(--line)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--stone)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Avatar name={m.full_name} size={36} />
                        <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>{m.full_name}</span>
                      </div>
                    </td>
                    <td style={td}>
                      <span style={{
                        background: m.role === 'admin' ? 'var(--accent2)' : 'var(--green2)',
                        color: m.role === 'admin' ? 'var(--accent)' : 'var(--green)',
                        fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 99,
                      }}>
                        {m.role === 'admin' ? 'Admin' : 'Engineer'}
                      </span>
                    </td>
                    <td style={{ ...td, fontSize: 14, color: 'var(--mid)' }}>{m.email}</td>
                    <td style={td}>
                      <span style={{ background: 'var(--green2)', color: 'var(--green)', fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 99 }}>Active</span>
                    </td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <select
                          value={m.role}
                          onChange={e => updateMemberRole(m.id, e.target.value)}
                          style={{ fontSize: 13, border: '1px solid var(--line)', borderRadius: 6, padding: '6px 10px', color: 'var(--dark)', background: 'var(--white)', outline: 'none' }}
                        >
                          <option value="member">Engineer</option>
                          <option value="admin">Admin</option>
                        </select>
                        {m.user_id !== currentUserId && (
                          <button
                            onClick={() => removeMember(m.id, m.user_id, m.full_name)}
                            style={{ background: 'var(--red2)', color: 'var(--red)', border: '1px solid #f5c6c0', borderRadius: 6, padding: '6px 12px', fontSize: 13, cursor: 'pointer' }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

        </div>
      )}

    </Shell>
  )
}
