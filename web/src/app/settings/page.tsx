'use client'
import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { Shell, Btn, Card, Spinner } from '@/components/Shell'
import { loadReportTemplates, type ReportTemplate } from '@/lib/reportTemplates'

type Project = { id: string; name: string; project_number: string }
type Drawing = { id: string; title: string; number: string; file_url: string; project_id: string }
type Firm    = { id: string; name: string; join_code?: string; report_template_url: string | null }
type MsToken = { connected_email: string; expires_at: string; onedrive_folder_id: string | null } | null

export default function SettingsPage() {
  const router = useRouter()

  // ── state ──────────────────────────────────────────────
  const [firm, setFirm]             = useState<Firm | null>(null)
  const [firmId, setFirmId]         = useState('')
  const [fullName, setFullName]     = useState('')
  const [projects, setProjects]     = useState<Project[]>([])
  const [drawings, setDrawings]     = useState<Drawing[]>([])
  const [loading, setLoading]       = useState(true)

  const [templateDragging, setTemplateDragging]   = useState(false)
  const [drawingDragging, setDrawingDragging]     = useState(false)
  const [templateUploading, setTemplateUploading] = useState(false)
  const [templates, setTemplates]                 = useState<ReportTemplate[]>([])
  const [newTemplateName, setNewTemplateName]     = useState('')
  const [templateBusyId, setTemplateBusyId]       = useState<string | null>(null)
  const [renamingId, setRenamingId]               = useState<string | null>(null)
  const [renameValue, setRenameValue]             = useState('')
  const [drawingUploading, setDrawingUploading]   = useState(false)
  const [drawingTitle, setDrawingTitle]           = useState('')
  const [drawingNumber, setDrawingNumber]         = useState('')
  const [selectedProject, setSelectedProject]     = useState('')
  const [pendingDrawing, setPendingDrawing]       = useState<File | null>(null)
  const [uploadSuccess, setUploadSuccess]         = useState('')

  // firm name editing
  const [firmNameEdit, setFirmNameEdit]   = useState('')
  const [savingFirmName, setSavingFirmName] = useState(false)

  // Microsoft 365 state
  const [msToken, setMsToken]         = useState<MsToken>(null)
  const [msLoading, setMsLoading]     = useState(true)
  const [disconnecting, setDisconnecting] = useState(false)

  const templateInputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef  = useRef<HTMLInputElement>(null)
  const replaceTargetRef = useRef<ReportTemplate | null>(null)
  const drawingInputRef  = useRef<HTMLInputElement>(null)

  const SUPABASE_URL      = 'https://vbaewualqaxhbmqgnhdt.supabase.co'
  const SUPABASE_ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').replace(/^﻿/, '').trim()

  // ── load MS token (called on mount + after connect/disconnect) ──
  const loadMsToken = async () => {
    setMsLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setMsLoading(false); return }

      const { data: member } = await supabase
        .from('firm_members')
        .select('firm_id')
        .eq('user_id', user.id)
        .single()

      if (member?.firm_id) {
        const { data: token } = await supabase
          .from('microsoft_tokens')
          .select('connected_email, expires_at, onedrive_folder_id')
          .eq('firm_id', member.firm_id)
          .single()
        setMsToken(token ?? null)
        setFirmId(member.firm_id)
      }
    } catch { /* silently fail */ }
    setMsLoading(false)
  }

  // ── data load ─────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: member } = await supabase
        .from('firm_members')
        .select('firm_id, role, full_name, firms(id, name, join_code, report_template_url)')
        .eq('user_id', user.id)
        .single()

      if (member?.role !== 'admin') { router.push('/dashboard'); return }

      setFullName(member.full_name)
      const firmData = (member?.firms as any)
      setFirm(firmData)
      setFirmId(firmData?.id ?? '')
      setFirmNameEdit(firmData?.name ?? '')
      setTemplates(await loadReportTemplates(firmData?.id ?? ''))

      const { data: proj } = await supabase
        .from('projects')
        .select('id, name, project_number')
        .eq('firm_id', firmData?.id)
        .order('created_at', { ascending: false })
      setProjects((proj ?? []) as Project[])
      if (proj && proj.length > 0) setSelectedProject(proj[0].id)

      const { data: draw } = await supabase
        .from('drawings')
        .select('*')
        .in('project_id', (proj ?? []).map((p: any) => p.id))
        .order('created_at', { ascending: false })
      setDrawings((draw ?? []) as Drawing[])

      setLoading(false)

      // Load MS token status
      loadMsToken()
    }
    load()

    // Handle redirect params from OAuth callback
    const params = new URLSearchParams(window.location.search)
    const msStatus = params.get('ms')
    if (msStatus === 'connected') {
      setUploadSuccess('Microsoft 365 connected successfully')
      setTimeout(() => setUploadSuccess(''), 4000)
      window.history.replaceState({}, '', '/settings')
      loadMsToken()
    } else if (msStatus === 'error') {
      const reason = params.get('reason') ?? 'unknown'
      // show after a tick so state is ready
      setTimeout(() => alert(`Microsoft 365 connection failed: ${reason}`), 300)
      window.history.replaceState({}, '', '/settings')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── FIRM NAME SAVE ─────────────────────────────────────
  const saveFirmName = async () => {
    if (!firm || !firmNameEdit.trim()) return
    setSavingFirmName(true)
    await supabase.from('firms').update({ name: firmNameEdit.trim() }).eq('id', firm.id)
    setFirm(prev => prev ? { ...prev, name: firmNameEdit.trim() } : prev)
    setSavingFirmName(false)
    setUploadSuccess('Firm name saved!')
    setTimeout(() => setUploadSuccess(''), 3000)
  }

  // ── REPORT TEMPLATES ───────────────────────────────────
  const flash = (msg: string) => { setUploadSuccess(msg); setTimeout(() => setUploadSuccess(''), 3000) }

  const reloadTemplates = async (id = firm?.id ?? '') => setTemplates(await loadReportTemplates(id))

  /** Upload a .docx to the report-templates bucket, overwriting that path. Returns its URL. */
  const putTemplateFile = async (fileName: string, file: File) => {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/report-templates/${fileName}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'x-upsert': 'true' },
      body: await file.arrayBuffer(),
    })
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
    return `${SUPABASE_URL}/storage/v1/object/report-templates/${fileName}`
  }

  // firms.report_template_url mirrors the default template: installed mobile
  // apps check it before offering AI reports. The legacy cache is keyed on it.
  const mirrorDefault = async (fileUrl: string | null) => {
    await supabase.from('firms').update({ report_template_url: fileUrl }).eq('id', firm!.id)
    setFirm(prev => prev ? { ...prev, report_template_url: fileUrl } : prev)
    await fetch('/api/docs/cache-template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firmId: firm!.id }),
    }).catch(() => { /* non-critical */ })
  }

  const addTemplate = async (file: File) => {
    if (!file.name.endsWith('.docx')) { alert('Please upload a .docx Word document'); return }
    const name = newTemplateName.trim() || file.name.replace(/\.docx$/i, '')
    setTemplateUploading(true)
    try {
      const id = crypto.randomUUID()
      const fileUrl = await putTemplateFile(`template-${firm!.id}-${id}.docx`, file)
      const isDefault = templates.length === 0
      const { error } = await supabase.from('report_templates').insert({ id, firm_id: firm!.id, name, file_url: fileUrl, is_default: isDefault })
      if (error) throw error
      if (isDefault) await mirrorDefault(fileUrl)
      setNewTemplateName('')
      await reloadTemplates()
      flash(`Template "${name}" added`)
    } catch (err) { console.error(err); alert('Upload failed. Please try again.') }
    finally { setTemplateUploading(false) }
  }

  const replaceTemplate = async (t: ReportTemplate, file: File) => {
    if (!file.name.endsWith('.docx')) { alert('Please upload a .docx Word document'); return }
    setTemplateBusyId(t.id)
    try {
      // Same path, so the default keeps matching firms.report_template_url.
      await putTemplateFile(t.file_url.split('/').pop()!, file)
      // updated_at is part of the server's cache key, so the new file is used straight away.
      const { error } = await supabase.from('report_templates').update({ updated_at: new Date().toISOString() }).eq('id', t.id)
      if (error) throw error
      if (t.is_default) await mirrorDefault(t.file_url)
      await reloadTemplates()
      flash(`Template "${t.name}" replaced`)
    } catch (err) { console.error(err); alert('Upload failed. Please try again.') }
    finally { setTemplateBusyId(null) }
  }

  const renameTemplate = async (t: ReportTemplate) => {
    const name = renameValue.trim()
    setRenamingId(null)
    if (!name || name === t.name) return
    const { error } = await supabase.from('report_templates').update({ name }).eq('id', t.id)
    if (error) { alert('Could not rename the template.'); return }
    await reloadTemplates()
  }

  const makeDefault = async (t: ReportTemplate) => {
    setTemplateBusyId(t.id)
    try {
      // Clear the old default first: at most one default per firm is enforced.
      const cleared = await supabase.from('report_templates').update({ is_default: false }).eq('firm_id', firm!.id).eq('is_default', true)
      if (cleared.error) throw cleared.error
      const set = await supabase.from('report_templates').update({ is_default: true }).eq('id', t.id)
      if (set.error) throw set.error
      await mirrorDefault(t.file_url)
      await reloadTemplates()
      flash(`"${t.name}" is now the default template`)
    } catch (err) { console.error(err); alert('Could not change the default template.'); await reloadTemplates() }
    finally { setTemplateBusyId(null) }
  }

  const deleteTemplate = async (t: ReportTemplate) => {
    if (t.is_default && templates.length > 1) { alert('Make another template the default before removing this one.'); return }
    if (!confirm(`Remove the template "${t.name}"?\n\nProjects using it will switch to the firm default for new reports. Reports already generated are not changed.`)) return
    setTemplateBusyId(t.id)
    try {
      const { error } = await supabase.from('report_templates').delete().eq('id', t.id)
      if (error) throw error
      if (t.is_default) await mirrorDefault(null)
      await reloadTemplates()
      flash(`Template "${t.name}" removed`)
    } catch (err) { console.error(err); alert('Could not remove the template.') }
    finally { setTemplateBusyId(null) }
  }

  // ── DRAWING UPLOAD ─────────────────────────────────────
  const uploadDrawing = async () => {
    if (!pendingDrawing || !drawingTitle.trim() || !selectedProject) { alert('Please fill in the drawing title and select a project'); return }
    setDrawingUploading(true)
    try {
      const fileName = `drawing-${Date.now()}-${pendingDrawing.name.replace(/\s/g, '-')}`
      const buffer   = await pendingDrawing.arrayBuffer()
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/drawings/${fileName}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/pdf', 'x-upsert': 'true' },
        body: buffer,
      })
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
      const fileUrl = `${SUPABASE_URL}/storage/v1/object/public/drawings/${fileName}`
      const { data: newDrawing } = await supabase.from('drawings').insert({ title: drawingTitle.trim(), number: drawingNumber.trim() || '-', file_url: fileUrl, project_id: selectedProject }).select().single()
      if (newDrawing) setDrawings(prev => [newDrawing as Drawing, ...prev])
      setPendingDrawing(null); setDrawingTitle(''); setDrawingNumber('')
      setUploadSuccess('Drawing uploaded successfully!')
      setTimeout(() => setUploadSuccess(''), 3000)
    } catch { alert('Upload failed. Please try again.') }
    finally { setDrawingUploading(false) }
  }

  const handleDrop = (e: React.DragEvent, type: 'template' | 'drawing') => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]; if (!file) return
    if (type === 'template') { setTemplateDragging(false); addTemplate(file) }
    else { setDrawingDragging(false); if (!file.name.endsWith('.pdf')) { alert('Please upload a PDF file'); return }; setPendingDrawing(file); if (!drawingTitle) setDrawingTitle(file.name.replace('.pdf', '')) }
  }

  // ── MICROSOFT 365 ──────────────────────────────────────
  const connectMicrosoft = () => {
    const connectUrl = `/api/auth/microsoft?state=${firmId}`
    window.location.href = connectUrl
  }

  const disconnectMicrosoft = async () => {
    if (!confirm(
      'Disconnect Microsoft 365?\n\n' +
      'Reports already saved to OneDrive will not ' +
      'be affected. New reports will no longer sync ' +
      'automatically.'
    )) return

    setDisconnecting(true)
    try {
      await fetch('/api/auth/microsoft/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firmId }),
      })
      setMsToken(null)
      setUploadSuccess('Microsoft 365 disconnected')
      setTimeout(() => setUploadSuccess(''), 3000)
    } catch {
      alert('Failed to disconnect')
    }
    setDisconnecting(false)
  }

  const handleSignOut = async () => { await supabase.auth.signOut(); router.push('/') }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <Spinner size={28} />
    </div>
  )

  const labelStyle: React.CSSProperties = {
    display: 'block', fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700,
    color: 'var(--text-mid)', marginBottom: 8,
  }
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 16px',
    background: 'var(--surface)', border: '1.5px solid var(--border-line)',
    borderRadius: 'var(--radius-sm)', fontFamily: 'var(--f-text)', fontSize: 15, color: 'var(--text-ink)', outline: 'none',
  }

  return (
    <Shell
      activePage="settings"
      role="admin"
      fullName={fullName}
      firmName={firm?.name}
      onSignOut={handleSignOut}
    >
      <style>{`
        @media (max-width: 768px) {
          .settings-content { padding: 16px !important; }
          .settings-card > div { padding: 16px !important; }
        }
      `}</style>
      <div className="settings-content" style={{ maxWidth: 680, margin: '0 auto', padding: '28px 24px 48px', display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* Page heading */}
        <div>
          <h1 style={{ fontFamily: 'var(--f-heading)', fontSize: 26, fontWeight: 800, color: 'var(--indigo-deep)', lineHeight: 1.1 }}>Settings</h1>
          <div style={{ fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)', marginTop: 8 }}>
            Firm details, report templates and integrations for {firm?.name}.
          </div>
        </div>

        {/* Success toast */}
        {uploadSuccess && (
          <div style={{ background: 'var(--sage-soft)', border: '1px solid rgba(91,146,121,.3)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontFamily: 'var(--f-text)', fontSize: 13, color: 'var(--sage-ink)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
            {uploadSuccess}
          </div>
        )}

        {/* ── CARD 1: Firm Details ─────────────────────────── */}
        <Card className="settings-card">
          <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border-line)' }}>
            <h2 style={{ fontFamily: 'var(--f-heading)', fontSize: 15, fontWeight: 800, color: 'var(--text-ink)' }}>Firm details</h2>
          </div>
          <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <label style={labelStyle}>Firm Name</label>
              <div style={{ display: 'flex', gap: 10 }}>
                <input
                  value={firmNameEdit}
                  onChange={e => setFirmNameEdit(e.target.value)}
                  style={{ ...inputStyle, flex: 1 }}
                  onFocus={e => { e.target.style.borderColor = 'var(--indigo)' }}
                  onBlur={e =>  { e.target.style.borderColor = 'var(--border-line)' }}
                />
                <Btn variant="primary" onClick={saveFirmName} disabled={savingFirmName || firmNameEdit === firm?.name}>
                  {savingFirmName ? 'Saving…' : 'Save'}
                </Btn>
              </div>
            </div>
            <div>
              <label style={labelStyle}>Join Code</label>
              <p style={{ fontFamily: 'var(--f-text)', fontSize: 12, color: 'var(--text-mid)', marginBottom: 8, lineHeight: 1.5 }}>
                Share this with engineers — they enter it when signing up on the mobile app.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ background: 'var(--indigo-soft)', border: '1px solid var(--border-line)', borderRadius: 'var(--radius-sm)', padding: '10px 18px', flex: 1 }}>
                  <span style={{ fontFamily: 'var(--f-mono)', fontSize: 19, fontWeight: 600, color: 'var(--indigo)', letterSpacing: '0.22em' }}>
                    {firm?.join_code ?? '—'}
                  </span>
                </div>
                <Btn variant="outline" onClick={() => navigator.clipboard.writeText(firm?.join_code ?? '').then(() => alert('Copied!'))}>
                  Copy
                </Btn>
              </div>
            </div>
          </div>
        </Card>

        {/* ── CARD 2: Report Template ──────────────────────── */}
        <Card className="settings-card">
          <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border-line)' }}>
            <h2 style={{ fontFamily: 'var(--f-heading)', fontSize: 15, fontWeight: 800, color: 'var(--text-ink)', marginBottom: 3 }}>Report templates</h2>
            <p style={{ fontFamily: 'var(--f-text)', fontSize: 13, color: 'var(--text-mid)', lineHeight: 1.6, marginBottom: 10 }}>
              Upload a Word template (.docx) for each letterhead, e.g. one per office. Each project uses the template chosen for it, or the default. Changing a project's template only affects reports generated afterwards. Use these placeholders where AI content is inserted:
            </p>
            <div style={{ background: 'var(--paper)', border: '1px solid var(--border-line)', borderRadius: 'var(--radius-sm)', padding: '9px 12px', fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--text-ink)', lineHeight: 1.8 }}>
              {'{{project_name}}  {{date}}  {{report_no}}  {{engineer_name}}  {{weather}}'}<br/>
              {'{{site_contact}}  {{purpose}}  {{findings}}  {{recommendations}}'}
            </div>
          </div>
          <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {templates.length > 0 && (
              <div style={{ border: '1px solid var(--border-line)', borderRadius: 'var(--radius-sm)' }}>
                {templates.map((t, i) => (
                  <div key={t.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
                    padding: '12px 14px', borderTop: i === 0 ? 'none' : '1px solid var(--border-line)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0, flex: '1 1 200px' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--sage)', flexShrink: 0 }} />
                      {renamingId === t.id ? (
                        <input
                          autoFocus value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onBlur={() => renameTemplate(t)}
                          onKeyDown={e => { if (e.key === 'Enter') renameTemplate(t); if (e.key === 'Escape') setRenamingId(null) }}
                          style={{ ...inputStyle, padding: '6px 10px', fontSize: 14 }}
                        />
                      ) : (
                        <span
                          title="Click to rename"
                          onClick={() => { setRenamingId(t.id); setRenameValue(t.name) }}
                          style={{ fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-ink)', cursor: 'text', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          {t.name}
                        </span>
                      )}
                      {t.is_default && (
                        <span style={{ background: 'var(--indigo-soft)', color: 'var(--indigo)', fontFamily: 'var(--f-heading)', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, flexShrink: 0 }}>
                          Default
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {templateBusyId === t.id ? <Spinner size={16} /> : (
                        <>
                          {!t.is_default && <Btn variant="outline" small onClick={() => makeDefault(t)}>Make default</Btn>}
                          <Btn variant="outline" small onClick={() => { replaceTargetRef.current = t; replaceInputRef.current?.click() }}>Replace</Btn>
                          <Btn variant="outline" small onClick={() => deleteTemplate(t)}>Remove</Btn>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div>
              <label style={labelStyle}>{templates.length > 0 ? 'Add another template' : 'Add a template'}</label>
              <input
                value={newTemplateName}
                onChange={e => setNewTemplateName(e.target.value)}
                placeholder="Template name, e.g. Auckland office"
                style={{ ...inputStyle, marginBottom: 10 }}
              />
              <div
                onDragOver={e => { e.preventDefault(); setTemplateDragging(true) }}
                onDragLeave={() => setTemplateDragging(false)}
                onDrop={e => handleDrop(e, 'template')}
                onClick={() => templateInputRef.current?.click()}
                style={{
                  border: `2px dashed ${templateDragging ? 'var(--indigo)' : 'var(--border-line)'}`,
                  borderRadius: 'var(--radius-md)', padding: 28, textAlign: 'center', cursor: 'pointer',
                  background: templateDragging ? 'var(--indigo-soft)' : 'var(--paper)',
                  transition: 'all .15s',
                }}
              >
                {templateUploading ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                    <Spinner size={22} />
                    <div style={{ fontFamily: 'var(--f-text)', fontSize: 13, color: 'var(--text-mid)' }}>Uploading…</div>
                  </div>
                ) : (
                  <>
                    <div style={{ fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700, color: 'var(--text-ink)' }}>Drop your Word template here</div>
                    <div style={{ fontFamily: 'var(--f-text)', fontSize: 12, color: 'var(--text-mid)', marginTop: 4 }}>or click to browse · .docx only</div>
                  </>
                )}
              </div>
            </div>
            <input ref={templateInputRef} type="file" accept=".docx" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) addTemplate(f) }} />
            <input ref={replaceInputRef} type="file" accept=".docx" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; const t = replaceTargetRef.current; if (f && t) replaceTemplate(t, f) }} />
          </div>
        </Card>

        {/* ── CARD 3: Microsoft 365 ────────────────────────── */}
        <Card className="settings-card">
          <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border-line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h2 style={{ fontFamily: 'var(--f-heading)', fontSize: 15, fontWeight: 800, color: 'var(--text-ink)', marginBottom: 3 }}>
                Microsoft 365
              </h2>
              <p style={{ fontFamily: 'var(--f-text)', fontSize: 13, color: 'var(--text-mid)' }}>
                Edit reports in Word Online and save to OneDrive automatically
              </p>
            </div>
            {msToken && (
              <span style={{
                background: 'var(--sage-soft)',
                color: 'var(--sage-ink)',
                fontFamily: 'var(--f-heading)',
                fontSize: 11,
                fontWeight: 700,
                padding: '3px 10px',
                borderRadius: 99,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                flexShrink: 0,
              }}>
                <span>●</span> Connected
              </span>
            )}
          </div>

          <div style={{ padding: 22 }}>
            {msLoading ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-mid)', fontSize: 14 }}>
                <Spinner size={18} />
              </div>
            ) : msToken ? (
              /* CONNECTED STATE — the header already carries a "Connected"
                 pill, so this only needs the account and its actions. */
              <div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 12,
                }}>
                  <div style={{ fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-ink)' }}>
                    {msToken.connected_email}
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <a
                      href="https://onedrive.live.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        background: 'var(--surface)',
                        border: '1px solid var(--border-line)',
                        borderRadius: 'var(--radius-pill)',
                        padding: '7px 14px',
                        fontSize: 13,
                        color: 'var(--indigo)',
                        fontWeight: 700,
                        textDecoration: 'none',
                        fontFamily: 'var(--f-heading)',
                      }}
                    >
                      Open OneDrive ↗
                    </a>
                    <button
                      onClick={disconnectMicrosoft}
                      disabled={disconnecting}
                      style={{
                        background: 'var(--clay-soft)',
                        border: '1px solid rgba(229,115,91,.3)',
                        borderRadius: 'var(--radius-pill)',
                        padding: '7px 14px',
                        fontSize: 13,
                        color: 'var(--clay-ink)',
                        fontWeight: 700,
                        cursor: disconnecting ? 'not-allowed' : 'pointer',
                        fontFamily: 'var(--f-heading)',
                      }}
                    >
                      {disconnecting ? 'Disconnecting...' : 'Disconnect'}
                    </button>
                  </div>
                </div>

                <div style={{
                  fontFamily: 'var(--f-text)', fontSize: 12.5,
                  color: 'var(--text-mid)', lineHeight: 1.55, marginTop: 12,
                }}>
                  Reports open in Word Online and save to your OneDrive under <strong style={{ color: 'var(--text-ink)' }}>SiteIQ Reports/</strong>.
                </div>
              </div>
            ) : (
              /* DISCONNECTED STATE */
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 16,
              }}>
                <div style={{ fontFamily: 'var(--f-text)', fontSize: 13.5, color: 'var(--text-mid)', lineHeight: 1.55 }}>
                  Not connected. Connect a Microsoft 365 work account to edit reports in Word Online.
                </div>
                <button
                  onClick={connectMicrosoft}
                  style={{
                    background: 'var(--indigo)',
                    color: 'white',
                    border: 'none',
                    borderRadius: 'var(--radius-pill)',
                    padding: '10px 22px',
                    fontFamily: 'var(--f-heading)',
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  Connect
                </button>
              </div>
            )}
          </div>
        </Card>

      </div>
    </Shell>
  )
}
