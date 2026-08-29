'use client'
import { useRouter } from 'next/navigation'

// ── DESIGN TOKENS (kept for backward compat) ──────────────────────────────────
export const DS = {
  bgPage:    '#f8f7f5',
  bgCard:    '#ffffff',
  bgSubtle:  '#f0ede8',
  borderL:   '#e4e0d9',
  borderM:   '#ccc8c0',
  textPri:   '#1a1917',
  textSec:   '#2c2a27',
  textMut:   '#9b968d',
  navy:      '#2c5282',
  navyL:     '#edf2fb',
  success:   '#27705a',
  successBg: '#e6f4ef',
  warning:   '#b8860b',
  warningBg: '#fef9e7',
  danger:    '#c0392b',
  dangerBg:  '#fdf0ef',
  orange:    '#c05621',
  orangeBg:  '#fef3e2',
  serif:     "'Cormorant', serif",
  sans:      "'Outfit', sans-serif",
  mono:      "'JetBrains Mono', monospace",
} as const

export const GLOBAL_CSS = ''

// ── NAV ICONS ─────────────────────────────────────────────────────────────────
function NavIcon({ id }: { id: string }) {
  const paths: Record<string, React.ReactNode> = {
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1"/>
        <rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="14" y="14" width="7" height="7" rx="1"/>
        <rect x="3" y="14" width="7" height="7" rx="1"/>
      </>
    ),
    projects: (
      <>
        <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18"/>
        <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/>
        <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/>
        <path d="M10 6h4M10 10h4M10 14h4"/>
      </>
    ),
    team: (
      <>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </>
    ),
  }
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7"
      viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      {paths[id] ?? null}
    </svg>
  )
}

// ── SHELL PROPS ───────────────────────────────────────────────────────────────
export interface ShellProps {
  activePage:    string
  role?:         string
  fullName?:     string
  firmName?:     string
  onSignOut?:    () => void
  onNavClick?:   (id: string) => void
  statusCounts?: { active: number; onHold: number; completed: number }
  children:      React.ReactNode
}

// ── NAV BUTTON ────────────────────────────────────────────────────────────────
function NavBtn({ id, label, active, onClick }: {
  id: string; label: string; active: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: 'calc(100% - 20px)', padding: '10px 14px',
        margin: '1px 10px',
        borderRadius: 'var(--radius-pill)',
        fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700,
        color: active ? 'var(--indigo)' : 'var(--text-mid)',
        background: active ? 'var(--indigo-soft)' : 'none',
        border: 'none', textAlign: 'left', cursor: 'pointer',
        transition: 'background .15s, color .15s',
      }}
      onMouseEnter={e => {
        if (!active) {
          e.currentTarget.style.background = 'var(--paper)'
          e.currentTarget.style.color = 'var(--text-ink)'
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          e.currentTarget.style.background = 'none'
          e.currentTarget.style.color = 'var(--text-mid)'
        }
      }}
    >
      <span style={{ color: active ? 'var(--indigo)' : 'var(--text-mid)' }}>
        <NavIcon id={id} />
      </span>
      {label}
    </button>
  )
}

const PAGE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard', projects: 'Projects', team: 'Team', settings: 'Settings',
}

// ── SHELL ─────────────────────────────────────────────────────────────────────
export function Shell({ activePage, role = '', fullName = '', firmName = '', onSignOut, children }: ShellProps) {
  const router   = useRouter()
  const initials = fullName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'

  return (
    <>
      <style>{`
        @media (max-width: 768px) {
          .shell-grid        { grid-template-columns: 1fr !important; }
          .shell-sidebar     { display: none !important; }
          .shell-main        { grid-column: 1 / -1 !important; }
          .shell-topbar      { grid-column: 1 / -1 !important; padding: 0 16px !important; }
          .shell-content     { padding-bottom: 70px !important; }
          .bottom-nav        { display: flex !important; }
          .topbar-user-name  { display: none !important; }
        }
      `}</style>
      <div className="shell-grid" style={{
        display: 'grid',
        gridTemplateColumns: '240px 1fr',
        gridTemplateRows: '64px 1fr',
        height: '100vh',
        overflow: 'hidden',
        fontFamily: 'var(--f-text)',
        background: 'var(--paper)',
      }}>

      {/* ── SIDEBAR (spans full height, brand lives here) ─────── */}
      <div className="shell-sidebar" style={{
        gridRow: '1 / -1', gridColumn: '1',
        background: 'var(--surface)',
        borderRight: '1px solid var(--border-line)',
        display: 'flex', flexDirection: 'column',
        overflowY: 'auto',
      }}>

        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 20px 16px' }}>
          <div style={{
            width: 32, height: 32, borderRadius: 'var(--radius-sm)',
            background: 'var(--marigold)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <svg width="15" height="15" fill="none" stroke="#fff" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </div>
          <span className="topbar-brand" style={{ fontFamily: 'var(--f-heading)', fontSize: 20, fontWeight: 800, color: 'var(--text-ink)' }}>
            SiteIQ
          </span>
        </div>

        {/* Section label */}
        <div style={{
          fontFamily: 'var(--f-heading)', fontSize: 10, fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '2px',
          color: 'var(--text-mid)', padding: '0 20px 8px',
        }}>
          Workspace
        </div>

        {/* Primary nav */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <NavBtn id="dashboard" label="Dashboard" active={activePage === 'dashboard'} onClick={() => router.push('/dashboard')} />
          <NavBtn id="projects"  label="Projects"  active={activePage === 'projects'}  onClick={() => router.push('/admin')} />
          <NavBtn id="team"      label="Team"       active={activePage === 'team'}      onClick={() => router.push('/admin?tab=team')} />
        </div>

        {/* Bottom section */}
        <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border-line)', padding: '12px 0 16px' }}>
          <NavBtn id="settings" label="Settings" active={activePage === 'settings'} onClick={() => router.push('/settings')} />

          <button
            onClick={() => onSignOut?.()}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              width: 'calc(100% - 20px)', margin: '1px 10px',
              padding: '10px 14px', borderRadius: 'var(--radius-pill)',
              fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700,
              color: 'var(--clay)',
              background: 'none', border: 'none',
              textAlign: 'left', cursor: 'pointer',
              transition: 'background .15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--clay-soft)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Sign out
          </button>
        </div>
      </div>

      {/* ── HEADER (above main content only — breadcrumb + user) ── */}
      <div className="shell-topbar" style={{
        gridRow: '1', gridColumn: '2',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 28px',
        background: 'var(--paper)',
        borderBottom: '1px solid var(--border-line)',
        zIndex: 50,
      }}>
        {/* LEFT — breadcrumb (+ brand mark on mobile, where the sidebar is hidden) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="mobile-only" style={{
            width: 28, height: 28, borderRadius: 'var(--radius-sm)',
            background: 'var(--marigold)', boxSizing: 'border-box', padding: 7,
            flexShrink: 0,
          }}>
            <svg width="13" height="13" fill="none" stroke="#fff" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </div>
          <div style={{ fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)' }}>
            {firmName || 'SiteIQ'}
            <span style={{ margin: '0 6px' }}>/</span>
            <span style={{ fontFamily: 'var(--f-heading)', fontWeight: 700, color: 'var(--text-ink)' }}>
              {PAGE_LABELS[activePage] ?? activePage}
            </span>
          </div>
        </div>

        {/* RIGHT — user */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ lineHeight: 1.25, textAlign: 'right' }}>
            <div className="topbar-user-name" style={{ fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700, color: 'var(--text-ink)' }}>{fullName}</div>
            <div style={{ fontFamily: 'var(--f-text)', fontSize: 12, color: 'var(--text-mid)' }}>
              {role === 'admin' ? 'Administrator' : 'Engineer'}
            </div>
          </div>
          <div style={{
            width: 34, height: 34, borderRadius: '50%',
            background: 'var(--paper)', border: '1px solid var(--border-line)', color: 'var(--text-ink)',
            fontFamily: 'var(--f-heading)', fontSize: 12, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            {initials}
          </div>
        </div>
      </div>

      {/* ── MAIN ─────────────────────────────────────────────── */}
      <div className="shell-main shell-content" style={{ gridRow: '2', gridColumn: '2', overflowY: 'auto', background: 'var(--paper)', animation: 'fadeIn 0.2s ease-out' }}>
        {children}
      </div>

    </div>

    {/* ── BOTTOM NAV (mobile only) ─────────────────────────── */}
    <nav className="bottom-nav" style={{
      display: 'none',
      position: 'fixed',
      bottom: 0, left: 0, right: 0,
      height: 60,
      background: 'var(--surface)',
      borderTop: '1px solid var(--border-line)',
      zIndex: 100,
      alignItems: 'center',
      justifyContent: 'space-around',
      padding: '0 8px',
    }}>
      <button onClick={() => router.push('/dashboard')} style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
        background: 'none', border: 'none', cursor: 'pointer', padding: '8px 16px',
        color: activePage === 'dashboard' ? 'var(--indigo)' : 'var(--text-mid)', flex: 1,
      }}>
        <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
          <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
          <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
        </svg>
        <span style={{ fontSize: 10, fontWeight: activePage === 'dashboard' ? 600 : 400 }}>Dashboard</span>
      </button>
      <button onClick={() => router.push('/admin')} style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
        background: 'none', border: 'none', cursor: 'pointer', padding: '8px 16px',
        color: activePage === 'projects' ? 'var(--indigo)' : 'var(--text-mid)', flex: 1,
      }}>
        <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
        </svg>
        <span style={{ fontSize: 10, fontWeight: activePage === 'projects' ? 600 : 400 }}>Projects</span>
      </button>
      <button onClick={() => router.push('/admin?tab=team')} style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
        background: 'none', border: 'none', cursor: 'pointer', padding: '8px 16px',
        color: activePage === 'team' ? 'var(--indigo)' : 'var(--text-mid)', flex: 1,
      }}>
        <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
        </svg>
        <span style={{ fontSize: 10, fontWeight: activePage === 'team' ? 600 : 400 }}>Team</span>
      </button>
      <button onClick={() => router.push('/settings')} style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
        background: 'none', border: 'none', cursor: 'pointer', padding: '8px 16px',
        color: activePage === 'settings' ? 'var(--indigo)' : 'var(--text-mid)', flex: 1,
      }}>
        <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
        </svg>
        <span style={{ fontSize: 10, fontWeight: activePage === 'settings' ? 600 : 400 }}>Settings</span>
      </button>
    </nav>
    </>
  )
}

// ── SHARED PRIMITIVES ─────────────────────────────────────────────────────────

export function Btn({
  children, variant = 'outline', onClick, disabled, small, style: extra,
}: {
  children: React.ReactNode
  variant?: 'primary' | 'outline' | 'ghost' | 'danger' | 'success' | 'orange'
  onClick?: () => void
  disabled?: boolean
  small?: boolean
  style?: React.CSSProperties
}) {
  const pad  = small ? '6px 14px' : '9px 20px'
  const size = small ? 13 : 14
  const base: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: pad, borderRadius: 'var(--radius-pill)',
    fontFamily: 'var(--f-heading)', fontSize: size, fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    border: 'none', transition: 'all .15s', opacity: disabled ? 0.5 : 1,
  }
  const vs: Record<string, React.CSSProperties> = {
    primary: { background: 'var(--indigo)',       color: '#fff',              border: '1px solid var(--indigo)' },
    outline: { background: 'var(--surface)',      color: 'var(--text-ink)',   border: '1.5px solid var(--border-line)' },
    ghost:   { background: 'var(--paper)',        color: 'var(--text-ink)',   border: 'none' },
    danger:  { background: 'var(--clay-soft)',    color: 'var(--clay-ink)',   border: '1px solid rgba(229,115,91,.3)' },
    success: { background: 'var(--sage-soft)',    color: 'var(--sage-ink)',   border: '1px solid rgba(91,146,121,.3)' },
    orange:  { background: 'var(--marigold-soft)',color: 'var(--marigold-ink)', border: '1px solid rgba(224,141,11,.3)' },
  }
  return (
    <button onClick={onClick} disabled={disabled} style={{ ...base, ...vs[variant], ...extra }}>
      {children}
    </button>
  )
}

export function Badge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    ACTIVE:    { label: 'Active',    color: 'var(--sage-ink)',     bg: 'var(--sage-soft)'     },
    ON_HOLD:   { label: 'On Hold',   color: 'var(--marigold-ink)', bg: 'var(--marigold-soft)' },
    COMPLETED: { label: 'Completed', color: 'var(--indigo)',       bg: 'var(--indigo-soft)'   },
    draft:     { label: 'Draft',     color: 'var(--marigold-ink)', bg: 'var(--marigold-soft)' },
    final:     { label: 'Finalised', color: 'var(--sage-ink)',     bg: 'var(--sage-soft)'     },
    pending:   { label: 'Pending',   color: 'var(--marigold-ink)', bg: 'var(--marigold-soft)' },
  }
  const s = map[status] ?? { label: status, color: 'var(--text-mid)', bg: 'var(--paper)' }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 10px', borderRadius: 99,
      fontFamily: 'var(--f-heading)', fontSize: 11, fontWeight: 700,
      color: s.color, background: s.bg,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }}/>
      {s.label}
    </span>
  )
}

export function Spinner({ size = 24 }: { size?: number }) {
  return (
    <div style={{
      width: size, height: size,
      border: '2px solid var(--border-line)',
      borderTopColor: 'var(--indigo)',
      borderRadius: '50%', animation: 'spin .8s linear infinite',
      flexShrink: 0,
    }}/>
  )
}

export function Card({ children, style, className }: { children: React.ReactNode; style?: React.CSSProperties; className?: string }) {
  return (
    <div className={className} style={{
      background: 'var(--surface)',
      border: '1px solid var(--border-line)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-card-v3)',
      ...style,
    }}>
      {children}
    </div>
  )
}
