'use client'
import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { Shell, Btn, Card, Spinner } from '@/components/Shell'

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
  const drawingInputRef  = useRef<HTMLInputElement>(null)

  const SUPABASE_URL      = 'https://vbaewualqaxhbmqgnhdt.supabase.co'
  const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

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
      if (!user) { router.push('/'); return }

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

  // ── TEMPLATE UPLOAD ────────────────────────────────────
  const uploadTemplate = async (file: File) => {
    if (!file.name.endsWith('.docx')) { alert('Please upload a .docx Word document'); return }
    setTemplateUploading(true)
    try {
      const fileName = `template-${firm?.id}.docx`
      const buffer   = await file.arrayBuffer()
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/report-templates/${fileName}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'x-upsert': 'true' },
        body: buffer,
      })
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
      const templateUrl = `${SUPABASE_URL}/storage/v1/object/report-templates/${fileName}`
      await supabase.from('firms').update({ report_template_url: templateUrl }).eq('id', firm!.id)
      setFirm(prev => prev ? { ...prev, report_template_url: templateUrl } : prev)
      // Bust the server-side template cache so the next generate picks up the new file
      await fetch('/api/docs/cache-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firmId: firm!.id }),
      }).catch(() => { /* non-critical */ })
      setUploadSuccess('Template uploaded successfully!')
      setTimeout(() => setUploadSuccess(''), 3000)
    } catch { alert('Upload failed. Please try again.') }
    finally { setTemplateUploading(false) }
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
      const { data: newDrawing } = await supabase.from('drawings').insert({ title: drawingTitle.trim(), number: drawingNumber.trim() || '—', file_url: fileUrl, project_id: selectedProject }).select().single()
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
    if (type === 'template') { setTemplateDragging(false); uploadTemplate(file) }
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
    display: 'block', fontSize: 15, fontWeight: 500,
    color: 'var(--dark)', marginBottom: 8,
  }
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 16px',
    background: 'var(--stone)', border: '1px solid var(--line)',
    borderRadius: 8, fontSize: 15, color: 'var(--ink)', outline: 'none',
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
      <div className="settings-content" style={{ maxWidth: 680, margin: '0 auto', padding: '32px 24px 56px', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Page heading */}
        <div>
          <h1 style={{ fontSize: 36, fontWeight: 500, color: 'var(--ink)', lineHeight: 1 }}>Settings</h1>
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '1.5px', color: 'var(--mid)', marginTop: 8 }}>
            {firm?.name}
          </div>
        </div>

        {/* Success toast */}
        {uploadSuccess && (
          <div style={{ background: 'var(--green2)', border: '1px solid #b3ddd1', borderRadius: 6, padding: '10px 14px', fontSize: 13, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
            {uploadSuccess}
          </div>
        )}

        {/* ── CARD 1: Firm Details ─────────────────────────── */}
        <Card className="settings-card">
          <div style={{ padding: '22px 28px', borderBottom: '1px solid var(--line)' }}>
            <h2 style={{ fontFamily: 'var(--f-serif)', fontSize: 17, fontWeight: 600, color: 'var(--ink)' }}>Firm Details</h2>
          </div>
          <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <label style={labelStyle}>Firm Name</label>
              <div style={{ display: 'flex', gap: 10 }}>
                <input
                  value={firmNameEdit}
                  onChange={e => setFirmNameEdit(e.target.value)}
                  style={{ ...inputStyle, flex: 1 }}
                  onFocus={e => { e.target.style.background = 'var(--white)'; e.target.style.borderColor = 'var(--accent)' }}
                  onBlur={e =>  { e.target.style.background = 'var(--stone)'; e.target.style.borderColor = 'var(--line)' }}
                />
                <Btn variant="primary" onClick={saveFirmName} disabled={savingFirmName || firmNameEdit === firm?.name}>
                  {savingFirmName ? 'Saving…' : 'Save'}
                </Btn>
              </div>
            </div>
            <div>
              <label style={labelStyle}>Join Code</label>
              <p style={{ fontSize: 12, color: 'var(--mid)', marginBottom: 8, lineHeight: 1.5 }}>
                Share this with engineers — they enter it when signing up on the mobile app.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ background: 'var(--accent2)', border: '1px solid var(--line2)', borderRadius: 8, padding: '10px 18px', flex: 1 }}>
                  <span style={{ fontFamily: 'var(--f-mono)', fontSize: 24, fontWeight: 500, color: 'var(--accent)', letterSpacing: '0.3em' }}>
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
          <div style={{ padding: '22px 28px', borderBottom: '1px solid var(--line)' }}>
            <h2 style={{ fontFamily: 'var(--f-serif)', fontSize: 20, fontWeight: 500, color: 'var(--ink)', marginBottom: 4 }}>Report Template</h2>
            <p style={{ fontSize: 13, color: 'var(--mid)', lineHeight: 1.6, marginBottom: 10 }}>
              Upload your firm's Word template (.docx). Use these placeholders where AI content is inserted:
            </p>
            <div style={{ background: 'var(--stone)', border: '1px solid var(--line)', borderRadius: 6, padding: '9px 12px', fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--dark)', lineHeight: 1.8 }}>
              {'{{project_name}}  {{date}}  {{report_no}}  {{engineer_name}}  {{weather}}'}<br/>
              {'{{site_contact}}  {{purpose}}  {{findings}}  {{recommendations}}'}
            </div>
          </div>
          <div style={{ padding: 28 }}>
            {firm?.report_template_url ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--green2)', border: '1px solid #b3ddd1', borderRadius: 8, padding: '14px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ fontSize: 28 }}>📄</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Template uploaded</div>
                    <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 2 }}>AI reports are enabled for your firm</div>
                  </div>
                </div>
                <Btn variant="outline" small onClick={() => templateInputRef.current?.click()}>Replace</Btn>
              </div>
            ) : (
              <div
                onDragOver={e => { e.preventDefault(); setTemplateDragging(true) }}
                onDragLeave={() => setTemplateDragging(false)}
                onDrop={e => handleDrop(e, 'template')}
                onClick={() => templateInputRef.current?.click()}
                style={{
                  border: `2px dashed ${templateDragging ? 'var(--accent)' : 'var(--line2)'}`,
                  borderRadius: 8, padding: 36, textAlign: 'center', cursor: 'pointer',
                  background: templateDragging ? 'var(--accent2)' : 'var(--stone)',
                  transition: 'all .15s',
                }}
              >
                {templateUploading ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                    <Spinner size={22} />
                    <div style={{ fontSize: 13, color: 'var(--mid)' }}>Uploading…</div>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 32, marginBottom: 10 }}>📄</div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--dark)' }}>Drop your Word template here</div>
                    <div style={{ fontSize: 12, color: 'var(--mid)', marginTop: 4 }}>or click to browse · .docx files only</div>
                  </>
                )}
              </div>
            )}
            <input ref={templateInputRef} type="file" accept=".docx" style={{ display: 'none' }}
              onChange={e => e.target.files?.[0] && uploadTemplate(e.target.files[0])} />
          </div>
        </Card>

        {/* ── CARD 3: Microsoft 365 ────────────────────────── */}
        <Card className="settings-card">
          <div style={{ padding: '22px 28px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h2 style={{ fontFamily: 'var(--f-serif)', fontSize: 20, fontWeight: 500, color: 'var(--ink)', marginBottom: 4 }}>
                Microsoft 365
              </h2>
              <p style={{ fontSize: 13, color: 'var(--mid)' }}>
                Edit reports in Word Online and save to OneDrive automatically
              </p>
            </div>
            {msToken && (
              <span style={{
                background: 'var(--green2)',
                color: 'var(--green)',
                fontSize: 11,
                fontWeight: 600,
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

          <div style={{ padding: 28 }}>
            {msLoading ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--mid)', fontSize: 14 }}>
                <Spinner size={18} />
              </div>
            ) : msToken ? (
              /* CONNECTED STATE */
              <div>
                <div style={{
                  background: 'var(--green2)',
                  border: '1px solid #bbf7d0',
                  borderRadius: 10,
                  padding: '16px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 16,
                  flexWrap: 'wrap',
                  gap: 12,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 40, height: 40,
                      background: 'var(--accent)',
                      borderRadius: 8,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'white',
                      fontSize: 18,
                      fontWeight: 700,
                    }}>⊞</div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
                        Connected
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--mid)', marginTop: 2 }}>
                        {msToken.connected_email}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <a
                      href="https://onedrive.live.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        background: 'var(--white)',
                        border: '1px solid var(--line)',
                        borderRadius: 7,
                        padding: '7px 14px',
                        fontSize: 13,
                        color: 'var(--accent)',
                        fontWeight: 500,
                        textDecoration: 'none',
                        fontFamily: 'var(--f-body)',
                      }}
                    >
                      Open OneDrive ↗
                    </a>
                    <button
                      onClick={disconnectMicrosoft}
                      disabled={disconnecting}
                      style={{
                        background: 'var(--red2)',
                        border: '1px solid #f5c6c3',
                        borderRadius: 7,
                        padding: '7px 14px',
                        fontSize: 13,
                        color: 'var(--red)',
                        fontWeight: 500,
                        cursor: disconnecting ? 'not-allowed' : 'pointer',
                        fontFamily: 'var(--f-body)',
                      }}
                    >
                      {disconnecting ? 'Disconnecting...' : 'Disconnect'}
                    </button>
                  </div>
                </div>

                <div style={{
                  background: 'var(--accent2)',
                  border: '1px solid #c5d8f5',
                  borderRadius: 8,
                  padding: '12px 16px',
                  fontSize: 13,
                  color: 'var(--accent)',
                  lineHeight: 1.5,
                }}>
                  ✅ Reports will automatically open in Word Online for editing. Files are saved to your OneDrive under
                  <strong> SiteIQ Reports/</strong>
                </div>
              </div>
            ) : (
              /* DISCONNECTED STATE */
              <div style={{
                background: 'var(--accent2)',
                border: '1px solid #c5d8f5',
                borderRadius: 10,
                padding: '20px 24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 16,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{
                    width: 44, height: 44,
                    background: 'var(--accent)',
                    borderRadius: 10,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: 20,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}>⊞</div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
                      Not connected
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--mid)', marginTop: 3 }}>
                      Connect your Microsoft 365 work account to edit reports in Word Online
                    </div>
                  </div>
                </div>
                <button
                  onClick={connectMicrosoft}
                  style={{
                    background: 'var(--accent)',
                    color: 'white',
                    border: 'none',
                    borderRadius: 8,
                    padding: '10px 22px',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'var(--f-body)',
                    flexShrink: 0,
                  }}
                >
                  Connect Microsoft 365
                </button>
              </div>
            )}
          </div>
        </Card>

        {/* ── CARD 4: Danger Zone ──────────────────────────── */}
        <div style={{ border: '1px solid var(--red)', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
          <div style={{ padding: '22px 28px', borderBottom: '1px solid var(--red)', background: 'var(--red2)' }}>
            <h2 style={{ fontFamily: 'var(--f-serif)', fontSize: 17, fontWeight: 600, color: 'var(--red)' }}>Danger Zone</h2>
            <p style={{ fontSize: 13, color: 'var(--red)', opacity: 0.75, marginTop: 2 }}>Irreversible actions — proceed with caution</p>
          </div>
          <div style={{ padding: 28, background: 'var(--white)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Delete Account</div>
                <div style={{ fontSize: 13, color: 'var(--mid)', marginTop: 4 }}>Permanently delete your firm and all associated data</div>
              </div>
              <Btn variant="danger" onClick={() => { if (confirm('This will permanently delete your firm and all data. This cannot be undone. Are you sure?')) alert('Please contact support to delete your account.') }}>
                Delete Account
              </Btn>
            </div>
          </div>
        </div>

      </div>
    </Shell>
  )
}
