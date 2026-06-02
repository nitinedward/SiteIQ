'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { Shell, Spinner, Card } from '@/components/Shell'

// ── TYPES ─────────────────────────────────────────────────────────────────────
type Project = {
  id: string; name: string; project_number: string
  address: string; client_name: string; status: string; created_at: string
}
type Inspection = {
  id: string; project_id: string; date: string; report_no: string
  weather: string; site_contact: string; status: string; created_at: string
  projects: { name: string; project_number: string } | null
}

// ── PANEL HEADER ──────────────────────────────────────────────────────────────
function PanelHeader({
  dot, title, count, action, accentBorder,
}: {
  dot: string; title: string
  count?: number; action?: { label: string; onClick: () => void }
  accentBorder?: string
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '18px 24px',
      borderBottom: '1px solid var(--line)',
      borderTop: accentBorder ? `3px solid ${accentBorder}` : undefined,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: dot, display: 'inline-block', flexShrink: 0 }} />
        <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>{title}</span>
        {count !== undefined && count > 0 && (
          <span style={{
            background: 'var(--orange2)', color: 'var(--orange)',
            fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
          }}>{count}</span>
        )}
      </div>
      {action && (
        <button onClick={action.onClick} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 13, color: 'var(--accent)', fontWeight: 500,
        }}>
          {action.label}
        </button>
      )}
    </div>
  )
}

// ── PAGE ───────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter()

  // existing state (kept exactly as-is)
  const [loading, setLoading]                 = useState(true)
  const [role, setRole]                       = useState('')
  const [fullName, setFullName]               = useState('')
  const [firmName, setFirmName]               = useState('')
  const [projects, setProjects]               = useState<Project[]>([])
  const [inspections, setInspections]         = useState<Inspection[]>([])
  const [search, setSearch]                   = useState('')
  const [view, setView]                       = useState<'projects' | 'reports'>('projects')
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [loadingReports, setLoadingReports]   = useState(false)
  const [activeNav, setActiveNav]             = useState('dashboard')

  // new: inspections split by report_status
  const [pendingReports, setPendingReports]     = useState<Inspection[]>([])
  const [finalisedReports, setFinalisedReports] = useState<Inspection[]>([])

  // new: delete tracking
  const [deletingId, setDeletingId]           = useState<string | null>(null)

  useEffect(() => { load() }, [])

  // existing load() — queries unchanged
  const load = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/'); return }

    const { data: member } = await supabase
      .from('firm_members')
      .select('firm_id, role, full_name, firms(name)')
      .eq('user_id', user.id)
      .single()

    if (!member) { setLoading(false); return }

    const firm = member.firms as any
    setRole(member.role)
    setFullName(member.full_name)
    setFirmName(firm?.name ?? '')

    let projs: Project[] = []
    if (member.role === 'admin') {
      const { data } = await supabase.from('projects').select('*').eq('firm_id', member.firm_id).order('created_at', { ascending: false })
      projs = data ?? []
    } else {
      const { data: assignments } = await supabase.from('project_members').select('project_id').eq('user_id', user.id)
      const ids = (assignments ?? []).map((a: any) => a.project_id)
      if (ids.length > 0) {
        const { data } = await supabase.from('projects').select('*').in('id', ids).order('created_at', { ascending: false })
        projs = data ?? []
      }
    }
    setProjects(projs)

    if (projs.length > 0) {
      const projectIds = projs.map(p => p.id)
      const { data: pendingData } = await supabase
        .from('inspections')
        .select('*, projects(name, project_number)')
        .in('project_id', projectIds)
        .eq('status', 'COMPLETED')
        .or('report_status.eq.pending,report_status.is.null')
        .order('created_at', { ascending: false })
      const { data: finalisedData } = await supabase
        .from('inspections')
        .select('*, projects(name, project_number)')
        .in('project_id', projectIds)
        .eq('status', 'COMPLETED')
        .eq('report_status', 'finalised')
        .order('created_at', { ascending: false })
        .limit(4)
      setPendingReports((pendingData as Inspection[]) ?? [])
      setFinalisedReports((finalisedData as Inspection[]) ?? [])
    }

    setLoading(false)
  }

  // existing loadReports() — unchanged
  const loadReports = async (project: Project) => {
    setSelectedProject(project)
    setView('reports')
    setSearch('')
    setLoadingReports(true)
    const { data } = await supabase
      .from('inspections')
      .select('*, projects(name, project_number)')
      .eq('project_id', project.id)
      .eq('status', 'COMPLETED')
      .order('created_at', { ascending: false })
    setInspections((data as Inspection[]) ?? [])
    setLoadingReports(false)
  }

  const handleSignOut = async () => { await supabase.auth.signOut(); router.push('/') }

  // delete a site report (also removes observations and zones)
  const deleteInspection = async (id: string) => {
    if (!confirm('Delete this site report? This cannot be undone.')) return
    setDeletingId(id)
    await supabase.from('observations').delete().eq('inspection_id', id)
    await supabase.from('zones').delete().eq('inspection_id', id)
    await supabase.from('inspections').delete().eq('id', id)
    setPendingReports(prev => prev.filter(i => i.id !== id))
    setFinalisedReports(prev => prev.filter(i => i.id !== id))
    setDeletingId(null)
  }

  // derived data
  const activeProjects  = projects.filter(p => p.status === 'ACTIVE')
  const onHoldProjects  = projects.filter(p => p.status === 'ON_HOLD')
  const oneWeekAgo      = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const allInspections  = [...pendingReports, ...finalisedReports]
  const siteVisitsThisWeek = allInspections.filter(i => new Date(i.created_at) >= oneWeekAgo).length
  const recentCompleted = finalisedReports.slice(0, 4)
  const pendingByProject = (projectId: string) =>
    pendingReports.filter(i => i.project_id === projectId).length

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 16 }}>
      <Spinner size={32} />
      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '1.5px', color: 'var(--mid)' }}>Loading</div>
    </div>
  )

  return (
    <Shell activePage="dashboard" role={role} fullName={fullName} firmName={firmName} onSignOut={handleSignOut}>
      <div style={{ padding: 32 }}>

        {/* Page heading */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontFamily: 'var(--f-serif)', fontSize: 36, fontWeight: 500, color: 'var(--ink)', lineHeight: 1 }}>Dashboard</h1>
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '1.5px', color: 'var(--mid)', marginTop: 8 }}>
            {projects.length} project{projects.length !== 1 ? 's' : ''} · {firmName}
          </div>
        </div>

        {/* ── 3 stat cards ─────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginBottom: 32 }}>

          <Card style={{ padding: 36, cursor: 'pointer', transition: 'all .15s' }}
            // @ts-ignore — inline onMouseEnter handled via JS
          >
            <div
              onClick={() => router.push('/admin')}
              onMouseEnter={e => { const el = e.currentTarget.parentElement as HTMLElement; if (el) { el.style.boxShadow = '0 4px 12px rgba(0,0,0,.08)'; el.style.transform = 'translateY(-1px)' } }}
              onMouseLeave={e => { const el = e.currentTarget.parentElement as HTMLElement; if (el) { el.style.boxShadow = '0 1px 3px rgba(0,0,0,.06)'; el.style.transform = 'none' } }}
              style={{ cursor: 'pointer' }}
            >
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '2px', color: 'var(--mid)', marginBottom: 16 }}>ACTIVE PROJECTS</div>
              <div style={{ fontFamily: 'var(--f-serif)', fontSize: 64, fontWeight: 600, color: 'var(--green)', lineHeight: 1 }}>{activeProjects.length}</div>
              <div style={{ fontSize: 14, color: 'var(--mid)', marginTop: 10 }}>Currently on site</div>
            </div>
          </Card>

          <Card style={{ padding: 36, cursor: 'pointer', transition: 'all .15s' }}>
            <div
              onClick={() => router.push('/admin')}
              onMouseEnter={e => { const el = e.currentTarget.parentElement as HTMLElement; if (el) { el.style.boxShadow = '0 4px 12px rgba(0,0,0,.08)'; el.style.transform = 'translateY(-1px)' } }}
              onMouseLeave={e => { const el = e.currentTarget.parentElement as HTMLElement; if (el) { el.style.boxShadow = '0 1px 3px rgba(0,0,0,.06)'; el.style.transform = 'none' } }}
              style={{ cursor: 'pointer' }}
            >
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '2px', color: 'var(--mid)', marginBottom: 16 }}>ON HOLD</div>
              <div style={{ fontFamily: 'var(--f-serif)', fontSize: 64, fontWeight: 600, color: 'var(--amber)', lineHeight: 1 }}>{onHoldProjects.length}</div>
              <div style={{ fontSize: 14, color: 'var(--mid)', marginTop: 10 }}>Awaiting client</div>
            </div>
          </Card>

          <Card style={{ padding: 36, borderLeft: '3px solid var(--accent)', cursor: 'pointer', transition: 'all .15s' }}>
            <div
              onMouseEnter={e => { const el = e.currentTarget.parentElement as HTMLElement; if (el) { el.style.boxShadow = '0 4px 12px rgba(0,0,0,.08)'; el.style.transform = 'translateY(-1px)' } }}
              onMouseLeave={e => { const el = e.currentTarget.parentElement as HTMLElement; if (el) { el.style.boxShadow = '0 1px 3px rgba(0,0,0,.06)'; el.style.transform = 'none' } }}
              style={{ cursor: 'pointer' }}
            >
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '2px', color: 'var(--mid)', marginBottom: 16 }}>SITE VISITS THIS WEEK</div>
              <div style={{ fontFamily: 'var(--f-serif)', fontSize: 64, fontWeight: 600, color: 'var(--accent)', lineHeight: 1 }}>{siteVisitsThisWeek}</div>
              <div style={{ fontSize: 14, color: 'var(--mid)', marginTop: 10 }}>inspections recorded</div>
            </div>
          </Card>
        </div>

        {/* ── 2×2 panel grid ───────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

          {/* Panel 1 — Active Projects */}
          <Card>
            <PanelHeader
              dot="var(--green)"
              title="Active Projects"
              action={{ label: 'View all →', onClick: () => router.push('/admin') }}
            />
            {activeProjects.length === 0 ? (
              <div style={{ padding: '32px 24px', textAlign: 'center', fontSize: 14, color: 'var(--mid)' }}>No active projects</div>
            ) : activeProjects.slice(0, 5).map(p => {
              const pCount = pendingByProject(p.id)
              return (
                <div
                  key={p.id}
                  onClick={() => router.push('/admin')}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '16px 24px', borderBottom: '1px solid var(--line)',
                    cursor: 'pointer', transition: 'background .12s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--stone)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{p.name}</div>
                    <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--mid)', marginTop: 3 }}>#{p.project_number}</div>
                  </div>
                  {pCount > 0
                    ? <span style={{ background: 'var(--orange2)', color: 'var(--orange)', fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 99 }}>{pCount} pending</span>
                    : <span style={{ background: 'var(--green2)', color: 'var(--green)', fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 99 }}>Up to date</span>
                  }
                </div>
              )
            })}
          </Card>

          {/* Panel 2 — Pending Reports (MOST IMPORTANT) */}
          <Card style={{ borderTop: '3px solid var(--orange)' }}>
            <PanelHeader
              dot="var(--orange)"
              title="Pending Reports"
              count={pendingReports.length}
              action={{ label: 'View all →', onClick: () => router.push('/admin') }}
            />
            {/* Orange info bar */}
            <div style={{
              background: 'var(--orange2)', padding: '12px 20px',
              fontSize: 13, color: 'var(--orange)',
              borderBottom: '1px solid var(--line)',
            }}>
              ⚡ These inspections were completed on mobile and are ready for AI report generation
            </div>
            {pendingReports.length === 0 ? (
              <div style={{ padding: '32px 24px', textAlign: 'center', fontSize: 14, color: 'var(--mid)' }}>No pending reports</div>
            ) : pendingReports.slice(0, 6).map(ins => (
              <div
                key={ins.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '14px 24px', borderBottom: '1px solid var(--line)',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                  <div style={{
                    background: 'var(--accent2)', color: 'var(--accent)',
                    fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 500,
                    padding: '4px 8px', borderRadius: 5, flexShrink: 0,
                  }}>
                    #{ins.report_no}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {(ins.projects as any)?.name ?? '—'}
                    </div>
                    <div style={{ fontFamily: 'var(--f-mono)', fontSize: 13, color: 'var(--mid)', marginTop: 2 }}>{ins.date}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button
                    onClick={() => router.push(`/report/${ins.id}?project_name=${encodeURIComponent((ins.projects as any)?.name ?? '')}`)}
                    style={{
                      background: 'var(--accent)', color: '#fff',
                      border: 'none', borderRadius: 6, padding: '7px 16px',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    Generate Report
                  </button>
                  <button
                    onClick={() => deleteInspection(ins.id)}
                    disabled={deletingId === ins.id}
                    style={{
                      background: 'var(--red2)', color: 'var(--red)',
                      border: '1px solid #f5c6c0', borderRadius: 6, padding: '7px 12px',
                      fontSize: 13, fontWeight: 500, cursor: deletingId === ins.id ? 'not-allowed' : 'pointer',
                      opacity: deletingId === ins.id ? 0.6 : 1,
                    }}
                  >
                    {deletingId === ins.id ? '…' : 'Delete'}
                  </button>
                </div>
              </div>
            ))}
          </Card>

          {/* Panel 3 — On Hold */}
          <Card>
            <PanelHeader dot="var(--amber)" title="On Hold" />
            {onHoldProjects.length === 0 ? (
              <div style={{ padding: '32px 24px', textAlign: 'center', fontSize: 14, color: 'var(--mid)' }}>No projects on hold</div>
            ) : onHoldProjects.slice(0, 5).map(p => (
              <div
                key={p.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '16px 24px', borderBottom: '1px solid var(--line)',
                }}
              >
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{p.name}</div>
                  <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--mid)', marginTop: 3 }}>
                    #{p.project_number}{p.client_name ? ` · ${p.client_name}` : ''}
                  </div>
                </div>
                <span style={{ background: 'var(--amber2)', color: 'var(--amber)', fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 99, flexShrink: 0 }}>
                  On Hold
                </span>
              </div>
            ))}
          </Card>

          {/* Panel 4 — Recent Completed */}
          <Card>
            <PanelHeader
              dot="var(--green)"
              title="Recent Completed"
              action={{ label: 'View all →', onClick: () => router.push('/admin') }}
            />
            {recentCompleted.length === 0 ? (
              <div style={{ padding: '32px 24px', textAlign: 'center', fontSize: 14, color: 'var(--mid)' }}>No completed inspections yet</div>
            ) : recentCompleted.map(ins => (
              <div
                key={ins.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '14px 24px', borderBottom: '1px solid var(--line)',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                  <div style={{
                    background: 'var(--green2)', color: 'var(--green)',
                    fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 500,
                    padding: '4px 8px', borderRadius: 5, flexShrink: 0,
                  }}>
                    #{ins.report_no}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {(ins.projects as any)?.name ?? '—'}
                    </div>
                    <div style={{ fontFamily: 'var(--f-mono)', fontSize: 13, color: 'var(--mid)', marginTop: 2 }}>
                      {ins.date}{ins.site_contact ? ` · ${ins.site_contact}` : ''}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => router.push(`/report/${ins.id}`)}
                  style={{
                    background: 'none', color: 'var(--accent)',
                    border: '1px solid var(--line)', borderRadius: 6, padding: '6px 14px',
                    fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
                    transition: 'background .12s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  Open
                </button>
              </div>
            ))}
          </Card>

        </div>
      </div>
    </Shell>
  )
}
