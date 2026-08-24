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
      borderBottom: '1px solid var(--border-line)',
      borderTop: accentBorder ? `3px solid ${accentBorder}` : undefined,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: dot, display: 'inline-block', flexShrink: 0 }} />
        <span style={{ fontFamily: 'var(--f-heading)', fontSize: 16, fontWeight: 700, color: 'var(--text-ink)' }}>{title}</span>
        {count !== undefined && count > 0 && (
          <span style={{
            background: 'var(--marigold-soft)', color: 'var(--marigold-ink)',
            fontFamily: 'var(--f-heading)', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
          }}>{count}</span>
        )}
      </div>
      {action && (
        <button onClick={action.onClick} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: 'var(--f-heading)', fontSize: 13, color: 'var(--indigo)', fontWeight: 700,
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
      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '1.5px', color: 'var(--text-mid)' }}>Loading</div>
    </div>
  )

  return (
    <Shell activePage="dashboard" role={role} fullName={fullName} firmName={firmName} onSignOut={handleSignOut}>
      <style>{`
        @media (max-width: 768px) {
          .dash-content  { padding: 16px !important; }
          .dash-header   { flex-direction: column !important; align-items: flex-start !important; gap: 12px !important; }
          .dash-title    { font-size: 32px !important; }
          .stat-grid     { grid-template-columns: 1fr !important; gap: 10px !important; }
          .panel-grid    { grid-template-columns: 1fr !important; gap: 14px !important; }
        }
      `}</style>
      <div className="dash-content" style={{ padding: '32px 36px' }}>

        {/* PAGE HEADER */}
        <div className="dash-header" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 36 }}>
          <div>
            <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '2px', color: 'var(--text-mid)', marginBottom: 8 }}>
              {new Date().toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()}
            </div>
            <h1 className="dash-title" style={{ fontFamily: 'var(--f-heading)', fontSize: 40, fontWeight: 800, color: 'var(--indigo-deep)', lineHeight: 1, margin: 0 }}>
              Dashboard
            </h1>
            <div style={{ fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)', marginTop: 8 }}>
              {projects.length} project{projects.length !== 1 ? 's' : ''} · {firmName}
            </div>
          </div>
          {role === 'admin' && (
            <button
              onClick={() => router.push('/admin')}
              style={{
                background: 'var(--marigold)', color: 'var(--indigo-deep)',
                padding: '12px 24px', borderRadius: 'var(--radius-pill)',
                fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 800, border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8,
                boxShadow: 'var(--shadow-glow-v3)',
              }}
            >
              + New Project
            </button>
          )}
        </div>

        {/* STAT CARDS */}
        <div className="stat-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginBottom: 36 }}>

          {/* Card 1 — Active Projects */}
          <div
            onClick={() => router.push('/admin')}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)' }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'none' }}
            style={{
              background: 'var(--surface)', border: '1px solid var(--border-line)',
              borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card-v3)',
              padding: '28px 32px', cursor: 'pointer',
              transition: 'all .2s', position: 'relative', overflow: 'hidden',
            }}
          >
            <div style={{ position: 'absolute', top: -30, right: -30, width: 100, height: 100, borderRadius: '50%', background: 'var(--sage-soft)', opacity: 0.6, pointerEvents: 'none' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ fontFamily: 'var(--f-heading)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-mid)' }}>ACTIVE PROJECTS</div>
              <div style={{ position: 'relative', width: 30, height: 30, borderRadius: 10, background: 'var(--sage-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sage-ink)', flexShrink: 0 }}>
                <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                  <rect x="2" y="7" width="20" height="15"/><polyline points="17,22 17,7 7,7 7,22"/><polyline points="7,2 12,7 17,2"/>
                </svg>
              </div>
            </div>
            <div style={{ position: 'relative', fontFamily: 'var(--f-heading)', fontSize: 40, fontWeight: 800, lineHeight: 1, color: 'var(--text-ink)', marginBottom: 8 }}>{activeProjects.length}</div>
            <div style={{ position: 'relative', fontFamily: 'var(--f-text)', fontSize: 13, color: 'var(--text-mid)' }}>Currently on site</div>
          </div>

          {/* Card 2 — On Hold */}
          <div
            onClick={() => router.push('/admin')}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)' }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'none' }}
            style={{
              background: 'var(--surface)', border: '1px solid var(--border-line)',
              borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card-v3)',
              padding: '28px 32px', cursor: 'pointer',
              transition: 'all .2s', position: 'relative', overflow: 'hidden',
            }}
          >
            <div style={{ position: 'absolute', top: -30, right: -30, width: 100, height: 100, borderRadius: '50%', background: 'var(--marigold-soft)', opacity: 0.6, pointerEvents: 'none' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ fontFamily: 'var(--f-heading)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-mid)' }}>ON HOLD</div>
              <div style={{ position: 'relative', width: 30, height: 30, borderRadius: 10, background: 'var(--marigold-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--marigold-ink)', flexShrink: 0 }}>
                <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                  <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
                </svg>
              </div>
            </div>
            <div style={{ position: 'relative', fontFamily: 'var(--f-heading)', fontSize: 40, fontWeight: 800, lineHeight: 1, color: 'var(--text-ink)', marginBottom: 8 }}>{onHoldProjects.length}</div>
            <div style={{ position: 'relative', fontFamily: 'var(--f-text)', fontSize: 13, color: 'var(--text-mid)' }}>Awaiting client</div>
          </div>

          {/* Card 3 — Site Visits */}
          <div
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)' }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'none' }}
            style={{
              background: 'var(--surface)', border: '1px solid var(--border-line)',
              borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card-v3)',
              padding: '28px 32px',
              transition: 'all .2s', position: 'relative', overflow: 'hidden',
            }}
          >
            <div style={{ position: 'absolute', top: -30, right: -30, width: 100, height: 100, borderRadius: '50%', background: 'var(--indigo-soft)', opacity: 0.6, pointerEvents: 'none' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ fontFamily: 'var(--f-heading)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-mid)' }}>SITE VISITS THIS WEEK</div>
              <div style={{ position: 'relative', width: 30, height: 30, borderRadius: 10, background: 'var(--indigo-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--indigo)', flexShrink: 0 }}>
                <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
              </div>
            </div>
            <div style={{ position: 'relative', fontFamily: 'var(--f-heading)', fontSize: 40, fontWeight: 800, lineHeight: 1, color: 'var(--text-ink)', marginBottom: 8 }}>{siteVisitsThisWeek}</div>
            <div style={{ position: 'relative', fontFamily: 'var(--f-text)', fontSize: 13, color: 'var(--text-mid)' }}>Inspections recorded</div>
          </div>
        </div>

        {/* 2×2 PANEL GRID */}
        <div className="panel-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>

          {/* Panel 1 — Active Projects */}
          <Card style={{ overflow: 'hidden' }}>
            <PanelHeader dot="var(--sage)" title="Active Projects" action={{ label: 'View all >', onClick: () => router.push('/admin') }} />
            {activeProjects.length === 0 ? (
              <div style={{ padding: '32px 24px', textAlign: 'center', fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)' }}>No active projects</div>
            ) : activeProjects.slice(0, 5).map(p => {
              const pCount = pendingByProject(p.id)
              return (
                <div
                  key={p.id}
                  onClick={() => router.push('/admin')}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', borderBottom: '1px solid var(--border-line)', cursor: 'pointer', transition: 'background .12s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--paper)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  <div>
                    <div style={{ fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700, color: 'var(--text-ink)' }}>{p.name}</div>
                    <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--text-mid)', marginTop: 2 }}>#{p.project_number}</div>
                  </div>
                  {pCount > 0
                    ? <span style={{ background: 'var(--marigold-soft)', color: 'var(--marigold-ink)', fontFamily: 'var(--f-heading)', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99 }}>{pCount} pending</span>
                    : <span style={{ background: 'var(--sage-soft)', color: 'var(--sage-ink)', fontFamily: 'var(--f-heading)', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99 }}>Up to date</span>
                  }
                </div>
              )
            })}
          </Card>

          {/* Panel 2 — Pending Reports */}
          <Card style={{ overflow: 'hidden', borderTop: '3px solid var(--marigold)' }}>
            <PanelHeader dot="var(--marigold)" title="Pending Reports" count={pendingReports.length} />
            <div style={{ background: 'var(--marigold-soft)', padding: '10px 24px', fontFamily: 'var(--f-text)', fontSize: 12, color: 'var(--marigold-ink)', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid rgba(224,141,11,0.15)' }}>
              Completed on mobile - ready for AI report generation
            </div>
            {pendingReports.length === 0 ? (
              <div style={{ padding: '32px 24px', textAlign: 'center', fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)' }}>No pending reports - all caught up</div>
            ) : pendingReports.slice(0, 5).map(ins => (
              <div
                key={ins.id}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', borderBottom: '1px solid var(--border-line)', gap: 12 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 600, background: 'var(--indigo-soft)', color: 'var(--indigo)', padding: '3px 8px', borderRadius: 8, flexShrink: 0 }}>
                    #{ins.report_no}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--f-text)', fontSize: 14, fontWeight: 500, color: 'var(--text-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
                      {(ins.projects as any)?.name ?? '—'}
                    </div>
                    <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--text-mid)', marginTop: 1 }}>{ins.date}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 7, flexShrink: 0 }}>
                  <button
                    onClick={() => router.push(`/report/${ins.id}?project_name=${encodeURIComponent((ins.projects as any)?.name ?? '')}`)}
                    style={{ background: 'var(--indigo)', color: 'white', border: 'none', borderRadius: 'var(--radius-pill)', fontFamily: 'var(--f-heading)', fontSize: 12, fontWeight: 700, padding: '6px 14px', cursor: 'pointer' }}
                  >
                    Generate
                  </button>
                  <button
                    onClick={() => deleteInspection(ins.id)}
                    disabled={deletingId === ins.id}
                    style={{ background: 'var(--clay-soft)', color: 'var(--clay-ink)', border: '1px solid rgba(229,115,91,0.25)', borderRadius: 'var(--radius-pill)', fontSize: 12, padding: '6px 10px', cursor: deletingId === ins.id ? 'not-allowed' : 'pointer', opacity: deletingId === ins.id ? 0.6 : 1 }}
                  >
                    x
                  </button>
                </div>
              </div>
            ))}
          </Card>

          {/* Panel 3 — On Hold */}
          <Card style={{ overflow: 'hidden' }}>
            <PanelHeader dot="var(--marigold-deep)" title="On Hold" />
            {onHoldProjects.length === 0 ? (
              <div style={{ padding: '32px 24px', textAlign: 'center', fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)' }}>No projects on hold</div>
            ) : onHoldProjects.slice(0, 5).map(p => (
              <div
                key={p.id}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', borderBottom: '1px solid var(--border-line)', cursor: 'pointer', transition: 'background .12s' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--paper)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >
                <div>
                  <div style={{ fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700, color: 'var(--text-ink)' }}>{p.name}</div>
                  <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--text-mid)', marginTop: 2 }}>
                    #{p.project_number}{p.client_name ? ` · ${p.client_name}` : ''}
                  </div>
                </div>
                <span style={{ background: 'var(--marigold-soft)', color: 'var(--marigold-ink)', fontFamily: 'var(--f-heading)', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, flexShrink: 0 }}>On Hold</span>
              </div>
            ))}
          </Card>

          {/* Panel 4 — Recent Completed */}
          <Card style={{ overflow: 'hidden' }}>
            <PanelHeader dot="var(--sage)" title="Recent Completed" action={{ label: 'View all >', onClick: () => router.push('/admin') }} />
            {(finalisedReports ?? recentCompleted).length === 0 ? (
              <div style={{ padding: '32px 24px', textAlign: 'center', fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)' }}>No completed reports yet</div>
            ) : (finalisedReports ?? recentCompleted).slice(0, 4).map(ins => (
              <div
                key={ins.id}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', borderBottom: '1px solid var(--border-line)', gap: 12 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 600, background: 'var(--sage-soft)', color: 'var(--sage-ink)', padding: '3px 8px', borderRadius: 8, flexShrink: 0 }}>
                    #{ins.report_no}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--f-text)', fontSize: 14, fontWeight: 500, color: 'var(--text-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {(ins.projects as any)?.name ?? '—'}
                    </div>
                    <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--text-mid)', marginTop: 1 }}>{ins.date}</div>
                  </div>
                </div>
                <button
                  onClick={() => router.push(`/report/${ins.id}`)}
                  style={{ background: 'none', border: '1px solid var(--border-line)', color: 'var(--indigo)', borderRadius: 'var(--radius-pill)', fontFamily: 'var(--f-heading)', fontSize: 12, fontWeight: 700, padding: '6px 14px', cursor: 'pointer', transition: 'background .12s', flexShrink: 0 }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--indigo-soft)')}
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
