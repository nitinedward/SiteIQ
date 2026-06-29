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
        borderRadius: 'var(--r2)',
        fontSize: 14, fontWeight: active ? 600 : 500,
        color: active ? 'var(--accent)' : 'var(--mid)',
        background: active ? 'var(--accent2)' : 'none',
        border: 'none', textAlign: 'left', cursor: 'pointer',
        transition: 'background .15s, color .15s',
        boxShadow: active ? 'inset 2px 0 0 var(--accent)' : 'none',
      }}
      onMouseEnter={e => {
        if (!active) {
          e.currentTarget.style.background = 'var(--stone)'
          e.currentTarget.style.color = 'var(--dark)'
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          e.currentTarget.style.background = 'none'
          e.currentTarget.style.color = 'var(--mid)'
        }
      }}
    >
      <span style={{ color: active ? 'var(--accent)' : 'var(--mid)' }}>
        <NavIcon id={id} />
      </span>
      {label}
    </button>
  )
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
          .topbar-firm-pill  { display: none !important; }
          .topbar-brand      { font-size: 18px !important; }
          .topbar-user-name  { display: none !important; }
        }
      `}</style>
      <div className="shell-grid" style={{
        display: 'grid',
        gridTemplateColumns: '240px 1fr',
        gridTemplateRows: '60px 1fr',
        height: '100vh',
        overflow: 'hidden',
        fontFamily: 'var(--f-body)',
        background: 'var(--off)',
      }}>

      {/* ── TOPBAR ───────────────────────────────────────────── */}
      <div className="shell-topbar" style={{
        gridColumn: '1 / -1',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 28px',
        background: 'var(--white)',
        borderBottom: '1px solid var(--line)',
        zIndex: 50,
      }}>

        {/* LEFT — brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 'var(--r2)',
            background: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <svg width="15" height="15" fill="none" stroke="#fff" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </div>
          <span className="topbar-brand" style={{ fontFamily: 'var(--f-serif)', fontSize: 22, fontWeight: 600, color: 'var(--ink)' }}>
            Site<span style={{ color: 'var(--accent)' }}>IQ</span>
          </span>
        </div>

        {/* CENTRE — live pill */}
        <div className="topbar-firm-pill" style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--stone)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r4)', padding: '5px 14px 5px 10px',
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: '#22c55e',
            animation: 'pulse 2s infinite',
            display: 'inline-block', flexShrink: 0,
          }} />
          <span style={{
            fontFamily: 'var(--f-mono)', fontSize: 11,
            textTransform: 'uppercase', letterSpacing: '1.5px',
            color: 'var(--dark)',
          }}>
            {firmName || 'SiteIQ'}
          </span>
        </div>

        {/* RIGHT — user chip */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '5px 6px 5px 14px',
          background: 'var(--stone)', borderRadius: 'var(--r4)', border: '1px solid var(--line)',
        }}>
          <div style={{ lineHeight: 1.25 }}>
            <div className="topbar-user-name" style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{fullName}</div>
            <div style={{
              fontFamily: 'var(--f-mono)', fontSize: 10,
              textTransform: 'uppercase', letterSpacing: '1px',
              color: role === 'admin' ? 'var(--accent)' : 'var(--mid)',
            }}>
              {role === 'admin' ? 'Administrator' : 'Engineer'}
            </div>
          </div>
          <div style={{
            width: 30, height: 30, borderRadius: '50%',
            background: 'var(--accent)', color: '#fff',
            fontSize: 12, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            {initials}
          </div>
        </div>
      </div>

      {/* ── SIDEBAR ──────────────────────────────────────────── */}
      <div className="shell-sidebar" style={{
        background: 'var(--white)',
        borderRight: '1px solid var(--line)',
        display: 'flex', flexDirection: 'column',
        padding: '20px 0',
        overflowY: 'auto',
      }}>

        {/* Section label */}
        <div style={{
          fontFamily: 'var(--f-mono)', fontSize: 10,
          textTransform: 'uppercase', letterSpacing: '2px',
          color: 'var(--mid)', padding: '0 20px 8px',
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
        <div style={{ marginTop: 'auto', borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <NavBtn id="settings" label="Settings" active={activePage === 'settings'} onClick={() => router.push('/settings')} />

          <button
            onClick={() => onSignOut?.()}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              width: 'calc(100% - 20px)', margin: '1px 10px',
              padding: '10px 14px', borderRadius: 'var(--r2)',
              fontSize: 14, fontWeight: 500,
              color: 'var(--red)',
              background: 'none', border: 'none',
              textAlign: 'left', cursor: 'pointer',
              transition: 'background .15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--red2)')}
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

      {/* ── MAIN ─────────────────────────────────────────────── */}
      <div className="shell-main shell-content" style={{ overflowY: 'auto', background: 'var(--off)', animation: 'fadeIn 0.2s ease-out' }}>
        {children}
      </div>

    </div>

    {/* ── BOTTOM NAV (mobile only) ─────────────────────────── */}
    <nav className="bottom-nav" style={{
      display: 'none',
      position: 'fixed',
      bottom: 0, left: 0, right: 0,
      height: 60,
      background: 'var(--white)',
      borderTop: '1px solid var(--line)',
      zIndex: 100,
      alignItems: 'center',
      justifyContent: 'space-around',
      padding: '0 8px',
    }}>
      <button onClick={() => router.push('/dashboard')} style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
        background: 'none', border: 'none', cursor: 'pointer', padding: '8px 16px',
        color: activePage === 'dashboard' ? 'var(--accent)' : 'var(--mid)', flex: 1,
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
        color: activePage === 'projects' ? 'var(--accent)' : 'var(--mid)', flex: 1,
      }}>
        <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
        </svg>
        <span style={{ fontSize: 10, fontWeight: activePage === 'projects' ? 600 : 400 }}>Projects</span>
      </button>
      <button onClick={() => router.push('/admin?tab=team')} style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
        background: 'none', border: 'none', cursor: 'pointer', padding: '8px 16px',
        color: activePage === 'team' ? 'var(--accent)' : 'var(--mid)', flex: 1,
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
        color: activePage === 'settings' ? 'var(--accent)' : 'var(--mid)', flex: 1,
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
    padding: pad, borderRadius: 'var(--r2)', fontSize: size, fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    border: 'none', transition: 'all .15s', opacity: disabled ? 0.5 : 1,
  }
  const vs: Record<string, React.CSSProperties> = {
    primary: { background: 'var(--accent)',   color: '#fff',          border: '1px solid var(--accent)' },
    outline: { background: 'var(--white)',    color: 'var(--dark)',   border: '1.5px solid var(--line)' },
    ghost:   { background: 'var(--stone)',    color: 'var(--dark)',   border: 'none' },
    danger:  { background: 'var(--red2)',     color: 'var(--red)',    border: '1px solid rgba(192,57,43,.2)' },
    success: { background: 'var(--green2)',   color: 'var(--green)',  border: '1px solid #b3ddd1' },
    orange:  { background: 'var(--orange2)',  color: 'var(--orange)', border: '1px solid rgba(192,86,33,.2)' },
  }
  return (
    <button onClick={onClick} disabled={disabled} style={{ ...base, ...vs[variant], ...extra }}>
      {children}
    </button>
  )
}

export function Badge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    ACTIVE:    { label: 'Active',    color: 'var(--green)',  bg: 'var(--green2)'  },
    ON_HOLD:   { label: 'On Hold',   color: 'var(--amber)',  bg: 'var(--amber2)'  },
    COMPLETED: { label: 'Completed', color: 'var(--accent)', bg: 'var(--accent2)' },
    draft:     { label: 'Draft',     color: 'var(--amber)',  bg: 'var(--amber2)'  },
    final:     { label: 'Final',     color: 'var(--green)',  bg: 'var(--green2)'  },
    pending:   { label: 'Pending',   color: 'var(--orange)', bg: 'var(--orange2)' },
  }
  const s = map[status] ?? { label: status, color: 'var(--mid)', bg: 'var(--stone)' }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 10px', borderRadius: 99,
      fontSize: 11, fontWeight: 600,
      color: s.color, background: s.bg,
      fontFamily: 'var(--f-mono)',
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
      border: '2px solid var(--line)',
      borderTopColor: 'var(--accent)',
      borderRadius: '50%', animation: 'spin .8s linear infinite',
      flexShrink: 0,
    }}/>
  )
}

export function Card({ children, style, className }: { children: React.ReactNode; style?: React.CSSProperties; className?: string }) {
  return (
    <div className={className} style={{
      background: 'var(--white)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--r3)',
      boxShadow: 'var(--shadow-card)',
      ...style,
    }}>
      {children}
    </div>
  )
}
