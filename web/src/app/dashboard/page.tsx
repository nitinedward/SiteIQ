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
  report_status?: string | null
  projects: { name: string; project_number: string } | null
}
type WeekBucket = { label: string; completed: number; pending: number }

// ── DATE HELPERS ─────────────────────────────────────────────────────────────
// inspections.date is stored as free text like "24 August 2026" (day + full
// month name + year), NOT an ISO/date column. The built-in Date constructor's
// handling of non-ISO strings is implementation-defined (Safari is strict,
// Chrome/Node are lenient), so this parses the known format explicitly rather
// than relying on `new Date(str)`.
const MONTH_NAMES = ['january','february','march','april','may','june','july','august','september','october','november','december']

function parseVisitDate(raw: string): Date | null {
  if (!raw) return null
  const match = raw.trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/)
  if (!match) return null
  const monthIndex = MONTH_NAMES.indexOf(match[2].toLowerCase())
  if (monthIndex === -1) return null
  const d = new Date(parseInt(match[3], 10), monthIndex, parseInt(match[1], 10))
  return isNaN(d.getTime()) ? null : d
}

// Calendar days between the site visit and today (midnight to midnight, so
// same-day time-of-day doesn't cause an off-by-one).
function daysSinceVisit(visitDate: string): number {
  const v = parseVisitDate(visitDate)
  if (!v) return 0
  const vMidnight = new Date(v)
  vMidnight.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.max(0, Math.round((today.getTime() - vMidnight.getTime()) / 86400000))
}

// A report is overdue when its site visit was more than 2 days ago and the
// report has not yet been finalised.
function isOverdue(visitDate: string, status?: string | null): boolean {
  if (status === 'finalised') return false
  return daysSinceVisit(visitDate) > 2
}

// ── WEEKLY CHART HELPERS ─────────────────────────────────────────────────────
// Monday-start weeks, most recent 6 weeks including the current one. Buckets
// by created_at (a proper timestamp) rather than the free-text visit date.
function getWeekBuckets(): { start: Date; end: Date; label: string }[] {
  const now = new Date()
  const diffToMonday = (now.getDay() + 6) % 7
  const thisMonday = new Date(now)
  thisMonday.setHours(0, 0, 0, 0)
  thisMonday.setDate(now.getDate() - diffToMonday)

  const buckets: { start: Date; end: Date; label: string }[] = []
  for (let i = 5; i >= 0; i--) {
    const start = new Date(thisMonday)
    start.setDate(thisMonday.getDate() - i * 7)
    const end = new Date(start)
    end.setDate(start.getDate() + 7)
    buckets.push({ start, end, label: start.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' }) })
  }
  return buckets
}

// ── PANEL HEADER ──────────────────────────────────────────────────────────────
function PanelHeader({
  title, count, action, accentBorder, extra,
}: {
  dot?: string; title: string
  count?: number; action?: { label: string; onClick: () => void }
  accentBorder?: string
  extra?: React.ReactNode
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '18px 24px',
      borderBottom: '1px solid var(--border-line)',
      borderTop: accentBorder ? `3px solid ${accentBorder}` : undefined,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontFamily: 'var(--f-heading)', fontSize: 17, fontWeight: 700, color: 'var(--indigo-deep)' }}>{title}</span>
        {count !== undefined && count > 0 && (
          <span style={{
            background: 'var(--secondary, var(--paper))', color: 'var(--text-mid)',
            fontFamily: 'var(--f-heading)', fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 99,
          }}>{count}</span>
        )}
        {extra}
      </div>
      {action && (
        <button onClick={action.onClick} style={{
          display: 'flex', alignItems: 'center', gap: 4,
          background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: 'var(--f-heading)', fontSize: 13, color: 'var(--indigo)', fontWeight: 700,
        }}>
          {action.label}
          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
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

  // new: weekly reports chart (additive — failure never affects the rest of the dashboard)
  const [weeklyChart, setWeeklyChart]         = useState<WeekBucket[]>([])
  const [weeklyChartLoading, setWeeklyChartLoading] = useState(true)
  const [weeklyChartError, setWeeklyChartError]     = useState(false)

  useEffect(() => { load() }, [])

  // existing load() — queries unchanged
  const load = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

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

      // Additive: fired without awaiting so it can never delay or break the
      // existing dashboard load; failures are caught inside and only affect
      // the new chart card's own empty/error state.
      loadWeeklyReports(projectIds)
    } else {
      setWeeklyChartLoading(false)
    }

    setLoading(false)
  }

  // new: weekly reports chart data — additive, wrapped so failures never
  // surface outside this card
  const loadWeeklyReports = async (projectIds: string[]) => {
    try {
      const buckets = getWeekBuckets()
      const { data, error } = await supabase
        .from('inspections')
        .select('report_status, created_at')
        .in('project_id', projectIds)
        .eq('status', 'COMPLETED')
        .gte('created_at', buckets[0].start.toISOString())
      if (error) throw error

      const counts: WeekBucket[] = buckets.map(b => ({ label: b.label, completed: 0, pending: 0 }))
      ;(data ?? []).forEach((row: any) => {
        const created = new Date(row.created_at)
        const idx = buckets.findIndex(b => created >= b.start && created < b.end)
        if (idx === -1) return
        if (row.report_status === 'finalised') counts[idx].completed++
        else counts[idx].pending++
      })
      setWeeklyChart(counts)
    } catch (err) {
      console.error('[loadWeeklyReports] error:', err)
      setWeeklyChartError(true)
    } finally {
      setWeeklyChartLoading(false)
    }
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

  // new: overdue = visit date more than 2 days ago and not yet finalised
  const overdueCount = pendingReports.filter(i => isOverdue(i.date, i.report_status)).length
  const sortedPendingReports = [...pendingReports].sort((a, b) => {
    const aOverdue = isOverdue(a.date, a.report_status)
    const bOverdue = isOverdue(b.date, b.report_status)
    return aOverdue === bOverdue ? 0 : aOverdue ? -1 : 1
  })

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
            <div style={{ fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)', marginBottom: 8 }}>
              {new Date().toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
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
              borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-card-v3)',
              padding: '28px 32px', cursor: 'pointer', transition: 'all .2s',
            }}
          >
            <div style={{ width: 44, height: 44, borderRadius: 16, background: 'var(--sage-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sage-ink)' }}>
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                <rect x="2" y="7" width="20" height="15"/><polyline points="17,22 17,7 7,7 7,22"/><polyline points="7,2 12,7 17,2"/>
              </svg>
            </div>
            <div style={{ fontFamily: 'var(--f-heading)', fontSize: 36, fontWeight: 800, lineHeight: 1, color: 'var(--indigo-deep)', marginTop: 24 }}>{activeProjects.length}</div>
            <div style={{ fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700, color: 'var(--text-ink)', marginTop: 8 }}>Active projects</div>
            <div style={{ fontFamily: 'var(--f-text)', fontSize: 13, color: 'var(--text-mid)', marginTop: 2 }}>Currently on site</div>
          </div>

          {/* Card 2 — On Hold */}
          <div
            onClick={() => router.push('/admin')}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)' }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'none' }}
            style={{
              background: 'var(--surface)', border: '1px solid var(--border-line)',
              borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-card-v3)',
              padding: '28px 32px', cursor: 'pointer', transition: 'all .2s',
            }}
          >
            <div style={{ width: 44, height: 44, borderRadius: 16, background: 'var(--marigold-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--marigold-ink)' }}>
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
              </svg>
            </div>
            <div style={{ fontFamily: 'var(--f-heading)', fontSize: 36, fontWeight: 800, lineHeight: 1, color: 'var(--indigo-deep)', marginTop: 24 }}>{onHoldProjects.length}</div>
            <div style={{ fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700, color: 'var(--text-ink)', marginTop: 8 }}>On hold</div>
            <div style={{ fontFamily: 'var(--f-text)', fontSize: 13, color: 'var(--text-mid)', marginTop: 2 }}>Awaiting client sign-off</div>
          </div>

          {/* Card 3 — Site Visits */}
          <div
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)' }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'none' }}
            style={{
              background: 'var(--surface)', border: '1px solid var(--border-line)',
              borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-card-v3)',
              padding: '28px 32px', transition: 'all .2s',
            }}
          >
            <div style={{ width: 44, height: 44, borderRadius: 16, background: 'var(--indigo-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--indigo)' }}>
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </div>
            <div style={{ fontFamily: 'var(--f-heading)', fontSize: 36, fontWeight: 800, lineHeight: 1, color: 'var(--indigo-deep)', marginTop: 24 }}>{siteVisitsThisWeek}</div>
            <div style={{ fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700, color: 'var(--text-ink)', marginTop: 8 }}>Site visits this week</div>
            <div style={{ fontFamily: 'var(--f-text)', fontSize: 13, color: 'var(--text-mid)', marginTop: 2 }}>Inspections recorded</div>
          </div>
        </div>

        {/* 2×2 PANEL GRID */}
        <div className="panel-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>

          {/* Panel 1 — Active Projects */}
          <Card style={{ overflow: 'hidden' }}>
            <PanelHeader dot="var(--sage)" title="Active Projects" action={{ label: 'View all', onClick: () => router.push('/admin') }} />
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
                    <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--text-mid)', marginTop: 2 }}>{p.project_number}</div>
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
            <PanelHeader
              dot="var(--marigold)"
              title="Pending Reports"
              count={pendingReports.length}
              extra={overdueCount > 0 ? (
                <span style={{
                  background: '#FBE4DF', color: '#E5735B',
                  fontFamily: 'var(--f-heading)', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                }}>{overdueCount} overdue</span>
              ) : undefined}
            />
            {pendingReports.length === 0 ? (
              <div style={{ padding: '32px 24px', textAlign: 'center', fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)' }}>No pending reports - all caught up</div>
            ) : sortedPendingReports.slice(0, 5).map(ins => {
              const overdue = isOverdue(ins.date, ins.report_status)
              return (
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 1 }}>
                      <span style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--text-mid)' }}>{ins.date}</span>
                      <span style={{
                        background: overdue ? '#FBE4DF' : 'var(--sage-soft)',
                        color: overdue ? '#E5735B' : 'var(--sage-ink)',
                        fontFamily: 'var(--f-heading)', fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 20,
                      }}>{overdue ? `Overdue · ${daysSinceVisit(ins.date)}d` : `${daysSinceVisit(ins.date)}d`}</span>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 7, flexShrink: 0 }}>
                  <button
                    onClick={() => router.push(`/report/${ins.id}?project_name=${encodeURIComponent((ins.projects as any)?.name ?? '')}`)}
                    style={{ background: 'var(--indigo)', color: 'white', border: 'none', borderRadius: 'var(--radius-pill)', fontFamily: 'var(--f-heading)', fontSize: 12, fontWeight: 700, padding: '6px 14px', cursor: 'pointer' }}
                  >
                    View
                  </button>
                  <button
                    onClick={() => deleteInspection(ins.id)}
                    disabled={deletingId === ins.id}
                    style={{ background: 'none', border: 'none', color: 'var(--text-mid)', borderRadius: 'var(--radius-pill)', fontSize: 13, padding: '6px 10px', cursor: deletingId === ins.id ? 'not-allowed' : 'pointer', opacity: deletingId === ins.id ? 0.6 : 1, transition: 'background .12s, color .12s' }}
                    onMouseEnter={e => { if (deletingId !== ins.id) { e.currentTarget.style.background = 'var(--clay-soft)'; e.currentTarget.style.color = 'var(--clay-ink)' } }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-mid)' }}
                  >
                    ✕
                  </button>
                </div>
              </div>
              )
            })}
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
            <PanelHeader dot="var(--sage)" title="Recent Completed" action={{ label: 'View all', onClick: () => router.push('/admin') }} />
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

        {/* WEEKLY REPORTS CHART — additive */}
        <div style={{ marginTop: 24 }}>
          <Card style={{ padding: '22px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
              <span style={{ fontFamily: 'var(--f-heading)', fontSize: 16, fontWeight: 700, color: 'var(--text-ink)' }}>Reports — last 6 weeks</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--f-text)', fontSize: 12, color: 'var(--text-mid)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--sage)', display: 'inline-block' }} /> Completed
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--f-text)', fontSize: 12, color: 'var(--text-mid)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--marigold)', display: 'inline-block' }} /> Pending
                </span>
              </div>
            </div>

            {weeklyChartError || (!weeklyChartLoading && weeklyChart.every(w => w.completed + w.pending === 0)) ? (
              <div style={{ padding: '36px 0', textAlign: 'center', fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)' }}>
                Not enough report history yet
              </div>
            ) : weeklyChartLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '36px 0' }}><Spinner size={24} /></div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 14, padding: '0 4px' }}>
                {(() => {
                  const maxTotal = Math.max(1, ...weeklyChart.map(w => w.completed + w.pending))
                  return weeklyChart.map(w => {
                    const total = w.completed + w.pending
                    const barHeight = total === 0 ? 0 : Math.max(6, (total / maxTotal) * 110)
                    const pendingHeight = total === 0 ? 0 : (w.pending / total) * barHeight
                    const completedHeight = barHeight - pendingHeight
                    return (
                      <div key={w.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--text-mid)' }}>{total}</div>
                        <div style={{ width: '100%', maxWidth: 32, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: 110 }}>
                          {pendingHeight > 0 && (
                            <div style={{ width: '100%', height: pendingHeight, background: 'var(--marigold)', borderTopLeftRadius: 6, borderTopRightRadius: 6 }} />
                          )}
                          {completedHeight > 0 && (
                            <div style={{ width: '100%', height: completedHeight, background: 'var(--sage)', borderTopLeftRadius: pendingHeight > 0 ? 0 : 6, borderTopRightRadius: pendingHeight > 0 ? 0 : 6 }} />
                          )}
                          {total === 0 && (
                            <div style={{ width: '100%', height: 4, background: 'var(--border-line)', borderRadius: 2 }} />
                          )}
                        </div>
                        <div style={{ fontFamily: 'var(--f-text)', fontSize: 11, color: 'var(--text-mid)' }}>{w.label}</div>
                      </div>
                    )
                  })
                })()}
              </div>
            )}
          </Card>
        </div>
      </div>
    </Shell>
  )
}
