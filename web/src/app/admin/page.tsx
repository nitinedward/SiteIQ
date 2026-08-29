'use client'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { Shell, Badge, Btn, Spinner, Card } from '@/components/Shell'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
    'https://vbaewualqaxhbmqgnhdt.supabase.co',
  (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZiYWV3dWFscWF4aGJtcWduaGR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4NzAzNjMsImV4cCI6MjA5MzQ0NjM2M30.8s39SZtGq4r_0NXYhsAU0WdPSGqLfefm2YYK_JXjZbg'
  ).replace(/^﻿/, '').trim()
)

type Project = { id: string; name: string; project_number: string; address: string; client_name: string; status: string }
type Drawing = { id: string; title: string; number: string; revision: string; file_url: string; file_name: string; preview_url?: string | null; created_at: string; sort_order?: number | null }
type Member  = { id: string; user_id: string; full_name: string; email: string; role: string }

const STATUS_OPTIONS = ['ACTIVE', 'ON_HOLD', 'COMPLETED'] as const
const STATUS_LABELS: Record<string, string> = { ACTIVE: 'Active', ON_HOLD: 'On Hold', COMPLETED: 'Completed' }

// Split-page uploads are named "drawing-<batchId>-p<pageNumber>...", inserted
// one page at a time (page 1 first). Sorting purely by created_at puts the
// LAST page of the newest batch on top. Sort newest batch first, but pages
// within a batch in page order, using the batch id + page number embedded in
// the file name; legacy rows that don't match just fall back to created_at.
//
// If any row has a manually-set sort_order (from drag-reordering in edit
// mode), that takes priority over the batch/page heuristic entirely.
function sortDrawingsForDisplay(rows: Drawing[]): Drawing[] {
  if (rows.some(d => d.sort_order != null)) {
    return [...rows].sort((a, b) => (a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER))
  }
  const sortKey = (d: Drawing) => {
    const m = d.file_name?.match(/^drawing-(\d+)-p(\d+)/)
    return m
      ? { batch: Number(m[1]), page: Number(m[2]) }
      : { batch: new Date(d.created_at).getTime(), page: 0 }
  }
  return [...rows].sort((a, b) => {
    const ka = sortKey(a), kb = sortKey(b)
    return ka.batch !== kb.batch ? kb.batch - ka.batch : ka.page - kb.page
  })
}

// ── FORM PRIMITIVES ───────────────────────────────────────────────────────────
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label style={{
      display: 'block', fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700,
      color: 'var(--text-mid)', marginBottom: 6,
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
        background: 'var(--surface)',
        border: `1.5px solid ${focused ? 'var(--indigo)' : 'var(--border-line)'}`,
        borderRadius: 'var(--radius-sm)', fontFamily: 'var(--f-text)', fontSize: 15, color: 'var(--text-ink)',
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
        background: 'var(--surface)',
        border: `1.5px solid ${focused ? 'var(--indigo)' : 'var(--border-line)'}`,
        borderRadius: 'var(--radius-sm)', fontFamily: 'var(--f-text)', fontSize: 15, color: 'var(--text-ink)',
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
        background: 'var(--surface)', border: '1.5px solid var(--border-line)',
        borderRadius: 'var(--radius-sm)', fontFamily: 'var(--f-text)', fontSize: 15, color: 'var(--text-ink)', outline: 'none',
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
      background: 'var(--sage)', color: '#fff',
      fontFamily: 'var(--f-heading)', fontSize: size * 0.35, fontWeight: 700,
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
  const [selectedDrawingIds, setSelectedDrawingIds] = useState<string[]>([])
  const [deletingSelected, setDeletingSelected]     = useState(false)
  const [editingDrawingField, setEditingDrawingField] = useState<{ id: string; field: 'title' | 'number' | 'revision' } | null>(null)
  const [editingFieldValue, setEditingFieldValue]      = useState('')
  const [editModeDrawings, setEditModeDrawings]     = useState(false)
  const [isDraggingFile, setIsDraggingFile]         = useState(false)
  const [draggedDrawingId, setDraggedDrawingId]     = useState<string | null>(null)
  const [dragOverDrawingId, setDragOverDrawingId]   = useState<string | null>(null)
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>([])
  const [showNewProject, setShowNewProject]   = useState(false)
  const [savingAssignment, setSavingAssignment] = useState(false)

  const [editingProject, setEditingProject] = useState(false)
  const [editForm, setEditForm]             = useState<Partial<Project>>({})

  const [newName, setNewName]       = useState('')
  const [newNumber, setNewNumber]   = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [newClient, setNewClient]   = useState('')
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
  const [uploadMsg, setUploadMsg]                 = useState<{ ok: boolean; text: string } | null>(null)

  const drawingInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { loadData() }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('tab') === 'team') setTab('team')
  }, [])

  // ── existing functions (unchanged) ────────────────────────────────────────
  const loadData = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
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
    setSelectedDrawingIds([])
    const [{ data: d }, { data: pm }] = await Promise.all([
      supabase.from('drawings').select('*').eq('project_id', project.id).order('created_at', { ascending: false }),
      supabase.from('project_members').select('user_id').eq('project_id', project.id),
    ])
    setDrawings(sortDrawingsForDisplay(d ?? []))
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
      address: newAddress.trim(), client_name: newClient.trim(),
      firm_id: firmId, status: newStatus,
    }).select().single()
    if (newProj) {
      await supabase.from('project_members').insert({ project_id: newProj.id, user_id: adminUserId, added_by: adminUserId })
    }
    setNewName(''); setNewNumber(''); setNewAddress(''); setNewClient(''); setNewStatus('ACTIVE')
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
      status: editForm.status,
    }).eq('id', selectedProject.id).select().single()
    if (updated) { setSelectedProject(updated as Project); setProjects(curr => curr.map(p => p.id === updated.id ? updated as Project : p)) }
    setEditingProject(false)
    setSaving(false)
  }

  // Refresh only the drawings list — WITHOUT resetting projTab (stays on Drawings tab)
  const reloadDrawings = async () => {
    if (!selectedProject) return
    const { data } = await supabase
      .from('drawings')
      .select('*')
      .eq('project_id', selectedProject.id)
      .order('created_at', { ascending: false })
    setDrawings(sortDrawingsForDisplay(data ?? []))
  }

  const startEditDrawingField = (d: Drawing, field: 'title' | 'number' | 'revision') => {
    setEditingDrawingField({ id: d.id, field })
    setEditingFieldValue(d[field] ?? '')
  }

  const cancelEditDrawingField = () => {
    setEditingDrawingField(null)
    setEditingFieldValue('')
  }

  const saveEditDrawingField = async () => {
    if (!editingDrawingField) return
    const { id, field } = editingDrawingField
    const trimmed = editingFieldValue.trim()
    if (!trimmed) { cancelEditDrawingField(); return }
    setDrawings(curr => curr.map(d => d.id === id ? { ...d, [field]: trimmed } : d))
    setEditingDrawingField(null)
    const { error } = await supabase.from('drawings').update({ [field]: trimmed }).eq('id', id)
    if (error) {
      console.error(`[edit-${field}] failed:`, error)
      setUploadMsg({ ok: false, text: 'Update failed: ' + error.message })
      await reloadDrawings()
    }
  }

  // Persists the current visual order as sort_order = index on every row.
  // Non-fatal: if the column doesn't exist yet (migration not run), surfaces
  // a message telling the user what to run, but doesn't revert the local
  // (already-reordered) view.
  const persistDrawingOrder = async (ordered: Drawing[]) => {
    const results = await Promise.all(
      ordered.map((d, i) => supabase.from('drawings').update({ sort_order: i }).eq('id', d.id))
    )
    const failed = results.find(r => r.error)
    if (failed?.error) {
      console.error('[reorder] failed to persist:', failed.error)
      setUploadMsg({ ok: false, text: 'Order not saved — run in Supabase SQL Editor: ALTER TABLE drawings ADD COLUMN sort_order integer;' })
    }
  }

  // Live-reorders the list as the dragged row passes over another row, so
  // the rest of the list visibly shifts to make room (rather than only
  // reordering once you release).
  const handleDrawingDragOver = (targetId: string) => {
    if (dragOverDrawingId !== targetId) setDragOverDrawingId(targetId)
    const draggedId = draggedDrawingId
    if (!draggedId || draggedId === targetId) return
    setDrawings(curr => {
      const fromIdx = curr.findIndex(d => d.id === draggedId)
      const toIdx = curr.findIndex(d => d.id === targetId)
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return curr
      const next = [...curr]
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      return next
    })
  }

  // Fires once per drag gesture regardless of where it ends — the list is
  // already in its final visual order by this point (from dragOver above),
  // so just persist it.
  const handleDrawingDragEnd = () => {
    setDraggedDrawingId(null)
    setDragOverDrawingId(null)
    persistDrawingOrder(drawings)
  }

  const toggleDrawingSelected = (id: string) => {
    setSelectedDrawingIds(curr => curr.includes(id) ? curr.filter(i => i !== id) : [...curr, id])
  }

  const toggleSelectAllDrawings = () => {
    setSelectedDrawingIds(curr => curr.length === drawings.length ? [] : drawings.map(d => d.id))
  }

  const deleteSelectedDrawings = async () => {
    if (selectedDrawingIds.length === 0) return
    if (!confirm(`Delete ${selectedDrawingIds.length} selected drawing${selectedDrawingIds.length > 1 ? 's' : ''}?`)) return
    setDeletingSelected(true)
    const targets = drawings.filter(d => selectedDrawingIds.includes(d.id))
    const { error } = await supabase.from('drawings').delete().in('id', selectedDrawingIds)
    if (error) { setDeletingSelected(false); setUploadMsg({ ok: false, text: 'Delete failed: ' + error.message }); return }

    // Clean up storage objects — skip any file_name still referenced by a
    // drawing row that wasn't part of this deletion.
    const remaining = drawings.filter(d => !selectedDrawingIds.includes(d.id))
    const stillReferenced = new Set(remaining.map(d => d.file_name).filter(Boolean))
    const orphanedFiles = [...new Set(targets.map(d => d.file_name).filter(Boolean))]
      .filter(fn => !stillReferenced.has(fn))
    if (orphanedFiles.length > 0) {
      const { error: sErr } = await supabase.storage.from('drawings').remove(orphanedFiles)
      if (sErr) console.error('[bulk-delete] storage cleanup failed:', sErr)
    }

    setDeletingSelected(false)
    setSelectedDrawingIds([])
    // Stay on the Drawings tab — just refresh the list
    await reloadDrawings()
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

  // Renders page 1 of a single-page PDF to a PNG blob. Used to generate a
  // preview image per drawing — the mobile app displays this image instead
  // of rendering the raw PDF natively, since large/landscape (A3/A1) sheets
  // were getting clipped by the native PDF viewer's internal scaling.
  const renderPdfPageToPng = async (pdfBytes: Uint8Array): Promise<Blob> => {
    const pdfjsLib = await import('pdfjs-dist')
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js'
    const pdf  = await pdfjsLib.getDocument({ data: pdfBytes }).promise
    const page = await pdf.getPage(1)

    const raw = page.getViewport({ scale: 1 })
    const MAX_DIM = 2200
    const scale = Math.min(3, MAX_DIM / Math.max(raw.width, raw.height))
    const viewport = page.getViewport({ scale })

    const canvas  = document.createElement('canvas')
    canvas.width  = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')!
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG export failed')), 'image/png', 0.92)
    })
  }

  // Base64 payload only (strips the "data:image/png;base64," prefix) for
  // sending to the AI drawing-info extraction endpoint.
  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        const result = reader.result as string
        resolve(result.split(',')[1] ?? '')
      }
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })

  const handlePdfUpload = async (file: File) => {
    if (!selectedProject) return

    console.log('[drawing] File size:', file.size, 'bytes  type:', file.type)

    // Generous size guard — A3 drawings are large. Splitting below keeps each
    // uploaded object small, but reject anything absurd up front.
    const MAX_SIZE = 100 * 1024 * 1024 // 100MB
    if (file.size > MAX_SIZE) {
      alert(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 100 MB.`)
      return
    }

    setUploadProgress('Reading PDF…')
    try {
      const arrayBuffer = await file.arrayBuffer()

      // Use pdf-lib to actually SPLIT the PDF into one file per page.
      // Runs entirely client-side (no serverless timeout), page size (A3/A1) irrelevant.
      const { PDFDocument } = await import('pdf-lib')
      const sourcePdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true })
      const pageCount = sourcePdf.getPageCount()
      console.log('[split] Total pages:', pageCount)

      const baseName = file.name.replace(/\.pdf$/i, '')
      const batchId  = Date.now()

      for (let i = 0; i < pageCount; i++) {
        setUploadProgress(`Splitting & uploading page ${i + 1} of ${pageCount}…`)

        // Build a standalone single-page PDF for page i
        const newPdf = await PDFDocument.create()
        const [copiedPage] = await newPdf.copyPages(sourcePdf, [i])
        newPdf.addPage(copiedPage)
        const pdfBytes = await newPdf.save()
        const pageBlob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' })
        console.log('[split] Page', i + 1, 'size:', pageBlob.size, 'bytes')

        // Each page gets its OWN storage object → its own file_url (fixes bug 4)
        const fileName = `drawing-${batchId}-p${i + 1}.pdf`
        const { error: upErr } = await supabase.storage
          .from('drawings')
          .upload(fileName, pageBlob, { contentType: 'application/pdf', upsert: true })
        if (upErr) {
          console.error('[split] Upload failed on page', i + 1, upErr)
          alert(`Upload failed on page ${i + 1}: ${upErr.message}`)
          setUploadProgress(null)
          return
        }

        const { data: { publicUrl } } = supabase.storage.from('drawings').getPublicUrl(fileName)

        // Generate + upload a preview PNG. Strictly non-fatal — we use a
        // 20-second timeout so a hung worker never stalls the whole upload.
        let previewUrl: string | null = null
        let previewBlob: Blob | null = null
        try {
          previewBlob = await Promise.race<Blob>([
            renderPdfPageToPng(pdfBytes),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Preview render timed out')), 20000)
            ),
          ])
          const previewFileName = `drawing-${batchId}-p${i + 1}-preview.png`
          const { error: pvErr } = await supabase.storage
            .from('drawings')
            .upload(previewFileName, previewBlob, { contentType: 'image/png', upsert: true })
          if (pvErr) {
            console.error('[split] Preview upload failed on page', i + 1, pvErr)
          } else {
            previewUrl = supabase.storage.from('drawings').getPublicUrl(previewFileName).data.publicUrl
          }
        } catch (pvErr) {
          console.error('[split] Preview render/timeout on page', i + 1, pvErr)
        }

        // Read the title block via AI to get the sheet's actual drawing
        // number/revision instead of a guessed sequential number + fixed
        // "A". Strictly non-fatal — falls back to the old defaults on any
        // failure, timeout, or low-confidence (null) field.
        setUploadProgress(`Reading drawing details for page ${i + 1} of ${pageCount}…`)
        let extracted: { drawing_number: string | null; revision: string | null; title: string | null } | null = null
        if (previewBlob) {
          try {
            const imageBase64 = await blobToBase64(previewBlob)
            const extractRes = await Promise.race<Response>([
              fetch('/api/drawings/extract-info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageBase64 }),
              }),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Drawing info extraction timed out')), 20000)
              ),
            ])
            if (extractRes.ok) extracted = await extractRes.json()
            else console.error('[split] Drawing info extraction failed on page', i + 1, await extractRes.text())
          } catch (exErr) {
            console.error('[split] Drawing info extraction error on page', i + 1, exErr)
          }
        }

        const pageTitle = pageCount > 1 ? `${baseName} — Page ${i + 1} of ${pageCount}` : baseName

        // Step 1 — insert core drawing record (no preview_url so a missing
        // column can't abort the upload).
        const { data: newRow, error: insErr } = await supabase
          .from('drawings')
          .insert({
            project_id: selectedProject.id,
            title: extracted?.title || pageTitle,
            number: extracted?.drawing_number || `DWG-${String(i + 1).padStart(3, '0')}`,
            revision: extracted?.revision || 'A',
            file_url: publicUrl,
            file_name: fileName,
          })
          .select('id')
          .single()
        if (insErr) {
          console.error('[split] Insert failed on page', i + 1, insErr)
          setUploadMsg({ ok: false, text: `Saving page ${i + 1} failed: ${insErr.message}` })
          setUploadProgress(null)
          return
        }

        // Step 2 — attach preview URL if we got one (non-fatal; column may
        // not exist yet in older schemas).
        if (previewUrl && newRow) {
          await supabase
            .from('drawings')
            .update({ preview_url: previewUrl })
            .eq('id', newRow.id)
          // error intentionally ignored — preview_url is optional
        }
      }

      setUploadProgress(null)
      setUploadMsg({ ok: true, text: `Drawing uploaded and split into ${pageCount} page${pageCount > 1 ? 's' : ''}` })
      setTimeout(() => setUploadMsg(null), 5000)
      // Stay on the Drawings tab — just refresh the list
      await reloadDrawings()
    } catch (err: any) {
      console.error('[drawing] Upload error:', err)
      setUploadMsg({ ok: false, text: 'Upload failed: ' + (err?.message ?? 'Please try again.') })
      setUploadProgress(null)
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  const projectFormFields = (
    vals: { name: string; number: string; address: string; client: string; status: string },
    set: { name: (v: string) => void; number: (v: string) => void; address: (v: string) => void; client: (v: string) => void; status: (v: string) => void }
  ) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div><FieldLabel>Project Name *</FieldLabel><FInp value={vals.name} onChange={set.name} placeholder="e.g. Auckland Mall Carpark" /></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div><FieldLabel>Project Number</FieldLabel><FInp value={vals.number} onChange={set.number} placeholder="PRJ-2024-001" /></div>
        <div><FieldLabel>Status</FieldLabel><FSel value={vals.status} onChange={set.status} options={STATUS_OPTIONS.map(s => ({ value: s, label: STATUS_LABELS[s] }))} /></div>
      </div>
      <div><FieldLabel>Address</FieldLabel><FInp value={vals.address} onChange={set.address} placeholder="123 Queen St, Auckland" /></div>
      <div><FieldLabel>Client</FieldLabel><FInp value={vals.client} onChange={set.client} placeholder="e.g. Auckland Council" /></div>
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
    padding: '14px 20px', fontFamily: 'var(--f-heading)', fontSize: 14.5,
    fontWeight: 700,
    color: active ? 'var(--indigo)' : 'var(--text-mid)',
    background: 'none', border: 'none',
    borderBottom: active ? '2px solid var(--indigo)' : '2px solid transparent',
    cursor: 'pointer', transition: 'all .15s',
  })

  const subTabBtn = (active: boolean): React.CSSProperties => ({
    padding: '14px 24px', fontFamily: 'var(--f-heading)', fontSize: 14.5,
    fontWeight: 700,
    color: active ? 'var(--indigo)' : 'var(--text-mid)',
    background: 'none', border: 'none',
    borderBottom: active ? '2px solid var(--indigo)' : '2px solid transparent',
    cursor: 'pointer', transition: 'all .15s',
  })

  // ── TABLE HEADER STYLE ────────────────────────────────────────────────────
  const th: React.CSSProperties = {
    textAlign: 'left', padding: '12px 20px',
    fontFamily: 'var(--f-heading)', fontSize: 11,
    textTransform: 'uppercase', letterSpacing: '1.5px',
    color: 'var(--text-mid)', fontWeight: 700,
    borderBottom: '1px solid var(--border-line)',
    background: 'var(--paper)',
  }
  const td: React.CSSProperties = {
    padding: '14px 20px', fontFamily: 'var(--f-text)', fontSize: 15,
    borderBottom: '1px solid var(--border-line)',
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

      <style>{`
        @media (max-width: 768px) {
          .admin-layout  { flex-direction: column !important; height: auto !important; }
          .admin-sidebar { width: 100% !important; height: auto !important; border-right: none !important; border-bottom: 1px solid var(--border-line) !important; max-height: 220px !important; }
          .admin-panel   { width: 100% !important; }
        }
      `}</style>
      {/* ── Main tab bar ─────────────────────────────────── */}
      <div style={{ borderBottom: '1px solid var(--border-line)', background: 'var(--surface)', padding: '0 28px', display: 'flex', gap: 4 }}>
        <button style={tabBtn(tab === 'projects')} onClick={() => setTab('projects')}>Projects</button>
        <button style={tabBtn(tab === 'team')}     onClick={() => setTab('team')}>Team</button>
      </div>

      {/* ══════════════════════════════════════════════════════
          PROJECTS TAB
      ══════════════════════════════════════════════════════ */}
      {tab === 'projects' && (
        <div className="admin-layout" style={{ display: 'flex', gap: 20, height: 'calc(100vh - 64px - 49px)', overflow: 'hidden', padding: 20, background: 'var(--paper)', boxSizing: 'border-box' }}>

          {/* Left — project list (300px fixed) */}
          <div className="admin-sidebar" style={{
            width: 320, flexShrink: 0,
            border: '1px solid var(--border-line)',
            borderRadius: 'var(--radius-xl)',
            boxShadow: 'var(--shadow-card-v3)',
            background: 'var(--surface)',
            display: 'flex', flexDirection: 'column',
            overflowY: 'auto',
          }}>
            {/* Search */}
            <div style={{ padding: 16, borderBottom: '1px solid var(--border-line)' }}>
              <div style={{ position: 'relative' }}>
                <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-mid)', pointerEvents: 'none' }} width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                </svg>
                <input
                  value={projectSearch}
                  onChange={e => setProjectSearch(e.target.value)}
                  placeholder="Search name, number or client"
                  style={{
                    width: '100%', height: 48, padding: '0 14px 0 36px', boxSizing: 'border-box',
                    background: 'var(--paper)', border: '1px solid var(--border-line)',
                    borderRadius: 'var(--radius-md)', fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-ink)', outline: 'none',
                  }}
                  onFocus={e => { e.target.style.background = 'var(--surface)'; e.target.style.borderColor = 'var(--indigo)' }}
                  onBlur={e =>  { e.target.style.background = 'var(--paper)'; e.target.style.borderColor = 'var(--border-line)' }}
                />
              </div>
            </div>

            {/* New project button */}
            <div style={{ padding: '0 16px 12px' }}>
              <button
                onClick={() => { setShowNewProject(v => !v); setSelectedProject(null) }}
                style={{
                  width: '100%', height: 48, marginTop: 12,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  background: 'var(--marigold)', color: 'var(--text-ink)',
                  border: 'none', borderRadius: 'var(--radius-pill)',
                  fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}
              >
                + New Project
              </button>
            </div>

            {/* New project inline form */}
            {showNewProject && (
              <div style={{ padding: '0 16px 16px' }}>
                <Card style={{ padding: 16 }}>
                  <div style={{ fontFamily: 'var(--f-heading)', fontSize: 17, fontWeight: 800, color: 'var(--text-ink)', marginBottom: 14 }}>New Project</div>
                  {projectFormFields(
                    { name: newName, number: newNumber, address: newAddress, client: newClient, status: newStatus },
                    { name: setNewName, number: setNewNumber, address: setNewAddress, client: setNewClient, status: setNewStatus }
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
            <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filteredProjects.map(p => {
                const active = selectedProject?.id === p.id
                return (
                  <button
                    key={p.id}
                    onClick={() => selectProject(p)}
                    style={{
                      width: '100%', textAlign: 'left',
                      display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', alignItems: 'center', gap: 10,
                      background: active ? 'var(--indigo-soft)' : 'var(--surface)',
                      border: `1px solid ${active ? 'var(--indigo)' : 'var(--border-line)'}`,
                      borderRadius: 'var(--radius-md)',
                      padding: '16px 18px',
                      cursor: 'pointer', transition: 'all .12s',
                    }}
                    onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--paper)' }}
                    onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'var(--surface)' }}
                  >
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontFamily: 'var(--f-heading)', fontSize: 16, fontWeight: 800, color: 'var(--text-ink)', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                      <span style={{ display: 'block', fontFamily: 'var(--f-text)', fontSize: 13, color: 'var(--text-mid)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        #{p.project_number}{p.client_name ? ` · ${p.client_name}` : ''}
                      </span>
                    </span>
                    <Badge status={p.status} />
                  </button>
                )
              })}
              {filteredProjects.length === 0 && (
                <div style={{ padding: '28px 24px', textAlign: 'center', fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)' }}>
                  {projectSearch ? 'No projects match' : 'No projects yet'}
                </div>
              )}
            </div>
          </div>

          {/* Right — project detail */}
          <div className="admin-panel" style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border-line)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-card-v3)', background: 'var(--surface)' }}>
            {!selectedProject ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--indigo-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="30" height="30" fill="none" stroke="var(--indigo)" strokeWidth="1.6" viewBox="0 0 24 24">
                    <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18"/>
                    <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/>
                    <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/>
                  </svg>
                </div>
                <div style={{ fontFamily: 'var(--f-heading)', fontSize: 17, color: 'var(--text-mid)', fontWeight: 700 }}>Select a project</div>
                <div style={{ fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)', textAlign: 'center', maxWidth: 280 }}>
                  Choose a project from the list to manage its reports, drawings and engineers
                </div>
              </div>
            ) : (
              <div style={{ background: 'var(--surface)', minHeight: '100%' }}>

                {/* Project header */}
                <div style={{ padding: '24px 28px', borderBottom: '1px solid var(--border-line)' }}>
                  {editingProject ? (
                    <>
                      <div style={{ fontFamily: 'var(--f-heading)', fontSize: 20, fontWeight: 800, color: 'var(--text-ink)', marginBottom: 18 }}>Edit Project</div>
                      {projectFormFields(
                        { name: editForm.name ?? '', number: editForm.project_number ?? '', address: editForm.address ?? '', client: editForm.client_name ?? '', status: editForm.status ?? 'ACTIVE' },
                        {
                          name:    v => setEditForm(p => ({ ...p, name: v })),
                          number:  v => setEditForm(p => ({ ...p, project_number: v })),
                          address: v => setEditForm(p => ({ ...p, address: v })),
                          client:  v => setEditForm(p => ({ ...p, client_name: v })),
                          status:  v => setEditForm(p => ({ ...p, status: v })),
                        }
                      )}
                      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                        <Btn variant="outline" onClick={() => setEditingProject(false)} style={{ flex: 1 }}>Cancel</Btn>
                        <Btn variant="primary" onClick={saveEdit} disabled={saving} style={{ flex: 1 }}>
                          {saving ? 'Saving…' : 'Save Changes'}
                        </Btn>
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <Btn variant="danger" onClick={() => deleteProject(selectedProject.id)} style={{ width: '100%' }}>Delete Project</Btn>
                      </div>
                    </>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                      <div style={{ flex: 1 }}>
                        <h2 style={{ fontFamily: 'var(--f-heading)', fontSize: 28, fontWeight: 800, color: 'var(--indigo-deep)', marginBottom: 4 }}>{selectedProject.name}</h2>
                        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--text-mid)', marginTop: 4 }}>{selectedProject.project_number}</div>
                        {selectedProject.address && (
                          <div style={{ fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)', marginTop: 4 }}>
                            {selectedProject.address}
                          </div>
                        )}
                        {selectedProject.client_name && (
                          <div style={{ fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)', marginTop: 4 }}>
                            {selectedProject.client_name}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 20 }}>
                        <Badge status={selectedProject.status} />
                        <Btn variant="outline" small onClick={startEdit}>Edit</Btn>
                      </div>
                    </div>
                  )}
                </div>

                {/* Sub-tabs */}
                {!editingProject && (
                  <div style={{ display: 'flex', borderBottom: '1px solid var(--border-line)', padding: '0 4px' }}>
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
                        <h3 style={{ fontFamily: 'var(--f-heading)', fontSize: 18, fontWeight: 800, color: 'var(--indigo-deep)', marginBottom: 12 }}>Reports</h3>
                        {(() => {
                          const allReports = [...pendingInspections, ...finalisedInspections]
                            .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
                          if (allReports.length === 0) {
                            return (
                              <div style={{ padding: '24px 0', fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)' }}>
                                No reports yet — once an engineer completes a site visit on mobile, it appears here.
                              </div>
                            )
                          }
                          return (
                            <div>
                              {allReports.map((ins, i) => {
                                const isFinal = finalisedInspections.some(f => f.id === ins.id)
                                return (
                                  <div key={ins.id} style={{
                                    display: 'flex', alignItems: 'center', gap: 16, padding: '16px 4px',
                                    borderBottom: i < allReports.length - 1 ? '1px solid var(--border-line)' : 'none',
                                  }}>
                                    <span style={{ background: 'var(--paper)', color: 'var(--text-mid)', fontFamily: 'var(--f-mono)', fontSize: 12, padding: '6px 12px', borderRadius: 'var(--radius-pill)', flexShrink: 0 }}>
                                      #{ins.report_no ?? '—'}
                                    </span>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ fontFamily: 'var(--f-heading)', fontSize: 15, fontWeight: 700, color: 'var(--text-ink)' }}>Site inspection report</div>
                                      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--text-mid)', marginTop: 2 }}>{ins.date ?? '—'}</div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
                                      <Badge status={isFinal ? 'final' : 'pending'} />
                                      <button
                                        onClick={() => router.push(`/report/${ins.id}?project_name=${encodeURIComponent(selectedProject?.name ?? '')}`)}
                                        style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700, color: 'var(--text-ink)' }}
                                      >
                                        Open
                                        <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                                      </button>
                                      <button
                                        onClick={() => deleteReport(ins.id)}
                                        disabled={deletingReportId === ins.id}
                                        title="Delete report"
                                        style={{ background: 'none', border: 'none', padding: 4, color: 'var(--text-mid)', cursor: deletingReportId === ins.id ? 'not-allowed' : 'pointer', opacity: deletingReportId === ins.id ? 0.5 : 0.7 }}
                                      >
                                        <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
                                          <polyline points="3 6 5 6 21 6"/>
                                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                        </svg>
                                      </button>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )
                        })()}
                      </>
                    )}
                  </div>
                )}

                {/* ── DRAWINGS TAB ── */}
                {!editingProject && projTab === 'drawings' && (
                  <div
                    onDragOver={e => { e.preventDefault(); if (!isDraggingFile) setIsDraggingFile(true) }}
                    onDragLeave={e => { if (e.currentTarget === e.target) setIsDraggingFile(false) }}
                    onDrop={e => {
                      e.preventDefault()
                      setIsDraggingFile(false)
                      const file = e.dataTransfer.files?.[0]
                      if (file && file.type === 'application/pdf') handlePdfUpload(file)
                    }}
                    style={{
                      padding: '24px 28px',
                      outline: isDraggingFile ? '2px dashed var(--indigo)' : 'none',
                      outlineOffset: -8,
                      background: isDraggingFile ? 'var(--indigo-soft)' : 'transparent',
                      transition: 'background .15s',
                    }}
                  >
                    {/* Inline message toast (replaces alert() to prevent nav quirks) */}
                    {uploadMsg && (
                      <div style={{
                        marginBottom: 16, padding: '12px 18px',
                        borderRadius: 'var(--radius-sm)', fontFamily: 'var(--f-text)', fontSize: 14, fontWeight: 500,
                        background: uploadMsg.ok ? 'var(--sage-soft)' : 'var(--clay-soft)',
                        color: uploadMsg.ok ? 'var(--sage-ink)' : 'var(--clay-ink)',
                        border: `1px solid ${uploadMsg.ok ? 'rgba(91,146,121,.3)' : 'rgba(229,115,91,.3)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      }}>
                        <span>{uploadMsg.text}</span>
                        <button
                          type="button"
                          onClick={() => setUploadMsg(null)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'inherit', lineHeight: 1, padding: '0 4px' }}
                        >×</button>
                      </div>
                    )}

                    {/* Upload overlay */}
                    {uploadProgress && (
                      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
                        <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-md)', padding: '32px 40px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                          <Spinner size={32} />
                          <div style={{ fontFamily: 'var(--f-text)', fontSize: 15, fontWeight: 500, color: 'var(--text-ink)' }}>{uploadProgress}</div>
                        </div>
                      </div>
                    )}

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
                      <>
                        {/* Upload zone — only shown before the first drawing exists.
                            Drag-and-drop keeps working on the whole tab (see wrapper
                            above) even once this is hidden. */}
                        <div
                          onClick={() => drawingInputRef.current?.click()}
                          style={{
                            height: 120, border: '2px dashed var(--border-line)', borderRadius: 'var(--radius-md)',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                            gap: 8, cursor: 'pointer', marginBottom: 20, transition: 'all .15s',
                            background: 'var(--paper)',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'var(--indigo-soft)'; e.currentTarget.style.borderColor = 'var(--indigo)' }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'var(--paper)'; e.currentTarget.style.borderColor = 'var(--border-line)' }}
                        >
                          <svg width="24" height="24" fill="none" stroke="var(--text-mid)" strokeWidth="1.5" viewBox="0 0 24 24">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="17 8 12 3 7 8"/>
                            <line x1="12" y1="3" x2="12" y2="15"/>
                          </svg>
                          <div style={{ fontFamily: 'var(--f-heading)', fontSize: 15, fontWeight: 700, color: 'var(--text-ink)' }}>Upload Drawing (PDF)</div>
                          <div style={{ fontFamily: 'var(--f-text)', fontSize: 13, color: 'var(--text-mid)' }}>Drag & drop, or click to browse — multi-page PDFs are automatically split</div>
                        </div>
                        <div style={{ textAlign: 'center', padding: '24px 0', fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)' }}>
                          No drawings yet — upload a PDF above
                        </div>
                      </>
                    ) : (
                      <>
                        {/* Count + Upload + subtle Edit toggle */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 4px 12px' }}>
                          <span style={{ fontFamily: 'var(--f-text)', fontSize: 13, color: 'var(--text-mid)' }}>
                            {drawings.length} drawing{drawings.length !== 1 ? 's' : ''}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                            <button
                              type="button"
                              onClick={() => drawingInputRef.current?.click()}
                              style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700,
                                color: 'var(--indigo)',
                              }}
                            >
                              + Upload
                            </button>
                            <button
                              type="button"
                              onClick={() => { setEditModeDrawings(v => !v); setSelectedDrawingIds([]) }}
                              style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700,
                                color: editModeDrawings ? 'var(--indigo)' : 'var(--text-mid)',
                              }}
                            >
                              {editModeDrawings ? 'Done' : 'Edit'}
                            </button>
                          </div>
                        </div>

                        {/* Select-all / bulk-delete toolbar — only while editing */}
                        {editModeDrawings && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '4px 4px 12px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--f-text)', fontSize: 13, color: 'var(--text-ink)', cursor: 'pointer', userSelect: 'none' }}>
                              <input
                                type="checkbox"
                                checked={drawings.length > 0 && selectedDrawingIds.length === drawings.length}
                                ref={el => { if (el) el.indeterminate = selectedDrawingIds.length > 0 && selectedDrawingIds.length < drawings.length }}
                                onChange={toggleSelectAllDrawings}
                                style={{ width: 16, height: 16, cursor: 'pointer' }}
                              />
                              Select all
                            </label>
                            {selectedDrawingIds.length > 0 && (
                              <>
                                <span style={{ fontFamily: 'var(--f-text)', fontSize: 13, color: 'var(--text-mid)' }}>{selectedDrawingIds.length} selected</span>
                                <button
                                  type="button"
                                  onClick={deleteSelectedDrawings}
                                  disabled={deletingSelected}
                                  style={{ background: 'var(--clay-soft)', color: 'var(--clay-ink)', border: '1px solid rgba(229,115,91,.3)', borderRadius: 'var(--radius-pill)', padding: '6px 14px', fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700, cursor: deletingSelected ? 'not-allowed' : 'pointer', opacity: deletingSelected ? 0.6 : 1 }}
                                >
                                  {deletingSelected ? 'Deleting…' : `Delete Selected (${selectedDrawingIds.length})`}
                                </button>
                              </>
                            )}
                          </div>
                        )}

                        <div>
                          {drawings.map((d, i) => {
                            const checked = selectedDrawingIds.includes(d.id)
                            return (
                              <div
                                key={d.id}
                                draggable={editModeDrawings}
                                onDragStart={() => setDraggedDrawingId(d.id)}
                                onDragOver={e => { if (editModeDrawings) { e.preventDefault(); handleDrawingDragOver(d.id) } }}
                                onDrop={e => e.preventDefault()}
                                onDragEnd={handleDrawingDragEnd}
                                onClick={() => { if (!editModeDrawings) window.open(d.file_url, '_blank', 'noopener,noreferrer') }}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 16, padding: '16px 4px',
                                  borderBottom: i < drawings.length - 1 ? '1px solid var(--border-line)' : 'none',
                                  background: checked || dragOverDrawingId === d.id ? 'var(--indigo-soft)' : 'transparent',
                                  cursor: editModeDrawings ? 'grab' : 'pointer',
                                  opacity: draggedDrawingId === d.id ? 0.4 : 1,
                                }}
                              >
                                {editModeDrawings && (
                                  <span style={{ color: 'var(--text-mid)', fontSize: 15, flexShrink: 0, userSelect: 'none', cursor: 'grab' }}>⠿</span>
                                )}
                                {editModeDrawings && (
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onClick={e => e.stopPropagation()}
                                    onChange={() => toggleDrawingSelected(d.id)}
                                    style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
                                  />
                                )}
                                {editingDrawingField?.id === d.id && editingDrawingField.field === 'number' ? (
                                  <input
                                    autoFocus
                                    value={editingFieldValue}
                                    onClick={e => e.stopPropagation()}
                                    onChange={e => setEditingFieldValue(e.target.value)}
                                    onBlur={saveEditDrawingField}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') { e.preventDefault(); saveEditDrawingField() }
                                      if (e.key === 'Escape') { e.preventDefault(); cancelEditDrawingField() }
                                    }}
                                    style={{ width: 70, background: 'var(--white)', color: 'var(--text-mid)', fontSize: 12, fontWeight: 700, padding: '6px 10px', borderRadius: 'var(--radius-pill)', fontFamily: 'var(--f-mono)', border: '1px solid var(--indigo)', flexShrink: 0 }}
                                  />
                                ) : (
                                  <div
                                    onClick={e => { if (editModeDrawings) { e.stopPropagation(); startEditDrawingField(d, 'number') } }}
                                    style={{
                                      background: 'var(--paper)', color: 'var(--text-mid)', fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 'var(--radius-pill)', fontFamily: 'var(--f-mono)', flexShrink: 0,
                                      cursor: editModeDrawings ? 'text' : 'default',
                                      border: editModeDrawings ? '1px dashed var(--indigo)' : '1px solid transparent',
                                    }}
                                  >
                                    {d.number || '—'}
                                  </div>
                                )}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  {editingDrawingField?.id === d.id && editingDrawingField.field === 'title' ? (
                                    <input
                                      autoFocus
                                      value={editingFieldValue}
                                      onClick={e => e.stopPropagation()}
                                      onChange={e => setEditingFieldValue(e.target.value)}
                                      onBlur={saveEditDrawingField}
                                      onKeyDown={e => {
                                        if (e.key === 'Enter') { e.preventDefault(); saveEditDrawingField() }
                                        if (e.key === 'Escape') { e.preventDefault(); cancelEditDrawingField() }
                                      }}
                                      style={{ width: '100%', fontFamily: 'var(--f-text)', fontSize: 15, fontWeight: 500, color: 'var(--text-ink)', background: 'var(--white)', border: '1px solid var(--indigo)', borderRadius: 6, padding: '3px 8px' }}
                                    />
                                  ) : (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                      <div style={{ fontFamily: 'var(--f-heading)', fontSize: 15, fontWeight: 700, color: 'var(--text-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</div>
                                      {editModeDrawings && (
                                        <button
                                          type="button"
                                          title="Rename"
                                          onClick={e => { e.stopPropagation(); startEditDrawingField(d, 'title') }}
                                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, flexShrink: 0, color: 'var(--text-mid)', fontSize: 11, lineHeight: 1, opacity: 0.6 }}
                                        >
                                          ✏️
                                        </button>
                                      )}
                                    </div>
                                  )}
                                  {editingDrawingField?.id === d.id && editingDrawingField.field === 'revision' ? (
                                    <input
                                      autoFocus
                                      value={editingFieldValue}
                                      onClick={e => e.stopPropagation()}
                                      onChange={e => setEditingFieldValue(e.target.value)}
                                      onBlur={saveEditDrawingField}
                                      onKeyDown={e => {
                                        if (e.key === 'Enter') { e.preventDefault(); saveEditDrawingField() }
                                        if (e.key === 'Escape') { e.preventDefault(); cancelEditDrawingField() }
                                      }}
                                      style={{ width: 60, marginTop: 2, fontSize: 12, color: 'var(--text-ink)', fontFamily: 'var(--f-mono)', background: 'var(--white)', border: '1px solid var(--indigo)', borderRadius: 4, padding: '1px 6px' }}
                                    />
                                  ) : (
                                    <div
                                      onClick={e => { if (editModeDrawings) { e.stopPropagation(); startEditDrawingField(d, 'revision') } }}
                                      style={{
                                        fontSize: 12, color: 'var(--text-mid)', fontFamily: 'var(--f-mono)', marginTop: 2, width: 'fit-content',
                                        cursor: editModeDrawings ? 'text' : 'default',
                                        borderBottom: editModeDrawings ? '1px dashed var(--text-mid)' : 'none',
                                      }}
                                    >
                                      Rev {d.revision}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* ── ENGINEERS TAB ── */}
                {!editingProject && projTab === 'engineers' && (
                  <div style={{ padding: '24px 28px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                      <h3 style={{ fontFamily: 'var(--f-heading)', fontSize: 17, fontWeight: 800, color: 'var(--text-ink)' }}>Assigned Engineers</h3>
                      <Btn variant="primary" onClick={() => setShowJoinCodePanel(v => !v)} style={{ fontSize: 14 }}>+ Add Engineer</Btn>
                    </div>

                    {showJoinCodePanel && (
                      <div style={{ background: 'var(--indigo-soft)', border: '1px solid var(--border-line)', borderRadius: 'var(--radius-md)', padding: '16px 20px', marginBottom: 20 }}>
                        <div style={{ fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700, color: 'var(--indigo)', marginBottom: 6 }}>How engineers join</div>
                        <div style={{ fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-ink)', lineHeight: 1.6 }}>Engineers sign up on the mobile app and enter the firm join code:</div>
                        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 22, fontWeight: 600, color: 'var(--indigo)', letterSpacing: '0.25em', margin: '10px 0' }}>{joinCode}</div>
                        <div style={{ fontFamily: 'var(--f-text)', fontSize: 13, color: 'var(--text-mid)' }}>Once they join, they appear below and you can assign them to this project.</div>
                        <button onClick={() => setShowJoinCodePanel(false)} style={{ marginTop: 10, fontFamily: 'var(--f-text)', fontSize: 13, color: 'var(--text-mid)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Dismiss</button>
                      </div>
                    )}

                    {savingAssignment && (
                      <div style={{ fontSize: 12, color: 'var(--indigo)', fontFamily: 'var(--f-mono)', marginBottom: 12 }}>Saving…</div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {members.map(m => {
                        const assigned = assignedUserIds.includes(m.user_id)
                        return (
                          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 0', borderBottom: '1px solid var(--border-line)' }}>
                            <Avatar name={m.full_name} size={44} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontFamily: 'var(--f-heading)', fontSize: 15, fontWeight: 700, color: 'var(--text-ink)' }}>{m.full_name}</div>
                              <div style={{ fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)', marginTop: 2 }}>{m.email}</div>
                            </div>
                            <span style={{
                              fontFamily: 'var(--f-heading)', fontSize: 12, fontWeight: 700, padding: '2px 9px', borderRadius: 99,
                              background: m.role === 'admin' ? 'var(--indigo-soft)' : 'var(--sage-soft)',
                              color: m.role === 'admin' ? 'var(--indigo)' : 'var(--sage-ink)',
                            }}>
                              {m.role === 'admin' ? 'Admin' : 'Engineer'}
                            </span>
                            <button
                              onClick={() => toggleAssignment(m.user_id)}
                              style={{
                                fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700, padding: '8px 18px', borderRadius: 'var(--radius-pill)', cursor: 'pointer', transition: 'all .15s',
                                background: assigned ? 'var(--clay-soft)' : 'none',
                                color: assigned ? 'var(--clay-ink)' : 'var(--indigo)',
                                border: assigned ? '1px solid rgba(229,115,91,.3)' : '1px solid var(--indigo)',
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
            <h1 style={{ fontFamily: 'var(--f-heading)', fontSize: 30, fontWeight: 800, color: 'var(--indigo-deep)', lineHeight: 1 }}>Team Members</h1>
            <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '1.5px', color: 'var(--text-mid)', marginTop: 8 }}>
              {members.length} engineers · {firmName}
            </div>
          </div>

          {/* Join code card */}
          <Card style={{ padding: 24, marginBottom: 20 }}>
            <div style={{ fontFamily: 'var(--f-heading)', fontSize: 16, fontWeight: 800, color: 'var(--text-ink)', marginBottom: 6 }}>Team Join Code</div>
            <div style={{ fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)', marginBottom: 16 }}>
              Engineers enter this code when signing up on the mobile app to automatically join your firm.
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <input
                value={editingJoinCode}
                onChange={e => setEditingJoinCode(e.target.value.toUpperCase())}
                style={{
                  fontFamily: 'var(--f-mono)', fontSize: 24, fontWeight: 600,
                  letterSpacing: '4px', padding: '14px 20px',
                  border: '2px solid var(--border-line)', borderRadius: 'var(--radius-sm)',
                  background: 'var(--paper)', color: 'var(--indigo)',
                  textTransform: 'uppercase', width: 200, outline: 'none',
                }}
                onFocus={e => { e.target.style.borderColor = 'var(--indigo)'; e.target.style.background = 'var(--surface)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--border-line)'; e.target.style.background = 'var(--paper)' }}
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(editingJoinCode)
                  setCopiedCode(true)
                  setTimeout(() => setCopiedCode(false), 2000)
                }}
                style={{ padding: '10px 18px', background: 'none', border: '1px solid var(--border-line)', borderRadius: 'var(--radius-pill)', fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700, color: 'var(--text-ink)', cursor: 'pointer' }}
              >
                {copiedCode ? 'Copied!' : 'Copy'}
              </button>
              <button
                onClick={saveJoinCode}
                disabled={savingJoinCode}
                style={{ padding: '10px 18px', background: 'var(--indigo)', color: '#fff', border: 'none', borderRadius: 'var(--radius-pill)', fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700, cursor: savingJoinCode ? 'not-allowed' : 'pointer', opacity: savingJoinCode ? 0.7 : 1 }}
              >
                {savingJoinCode ? 'Saving…' : 'Save Code'}
              </button>
            </div>
            <div style={{ marginTop: 16, background: 'var(--indigo-soft)', border: '1px solid var(--border-line)', borderRadius: 'var(--radius-sm)', padding: '14px 18px', fontFamily: 'var(--f-text)', fontSize: 13, color: 'var(--indigo)' }}>
              💡 Anyone who downloads the mobile app and enters this code will be added to {firmName} automatically. Change this code if you want to stop new members joining.
            </div>
          </Card>

          {/* Members table */}
          <Card style={{ overflow: 'hidden' }}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--f-heading)', fontSize: 16, fontWeight: 800, color: 'var(--text-ink)' }}>Members</span>
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
                    style={{ borderBottom: '1px solid var(--border-line)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--paper)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Avatar name={m.full_name} size={36} />
                        <span style={{ fontFamily: 'var(--f-heading)', fontSize: 15, fontWeight: 700, color: 'var(--text-ink)' }}>{m.full_name}</span>
                      </div>
                    </td>
                    <td style={td}>
                      <span style={{
                        background: m.role === 'admin' ? 'var(--indigo-soft)' : 'var(--sage-soft)',
                        color: m.role === 'admin' ? 'var(--indigo)' : 'var(--sage-ink)',
                        fontFamily: 'var(--f-heading)', fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 99,
                      }}>
                        {m.role === 'admin' ? 'Admin' : 'Engineer'}
                      </span>
                    </td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{m.email}</td>
                    <td style={td}>
                      <span style={{ background: 'var(--sage-soft)', color: 'var(--sage-ink)', fontFamily: 'var(--f-heading)', fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 99 }}>Active</span>
                    </td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <select
                          value={m.role}
                          onChange={e => updateMemberRole(m.id, e.target.value)}
                          style={{ fontFamily: 'var(--f-text)', fontSize: 13, border: '1px solid var(--border-line)', borderRadius: 'var(--radius-sm)', padding: '6px 10px', color: 'var(--text-ink)', background: 'var(--surface)', outline: 'none' }}
                        >
                          <option value="member">Engineer</option>
                          <option value="admin">Admin</option>
                        </select>
                        {m.user_id !== currentUserId && (
                          <button
                            onClick={() => removeMember(m.id, m.user_id, m.full_name)}
                            style={{ background: 'var(--clay-soft)', color: 'var(--clay-ink)', border: '1px solid rgba(229,115,91,.3)', borderRadius: 'var(--radius-pill)', padding: '6px 12px', fontSize: 13, cursor: 'pointer' }}
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
