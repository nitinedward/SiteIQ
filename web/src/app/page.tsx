'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { createFirm, joinFirm } from '@/lib/firm'

// ── ICONS ──────────────────────────────────────────────────────────────────
function Icon({ id, size = 20 }: { id: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    building: (
      <>
        <path d="M3 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16" />
        <path d="M3 21h18" />
        <path d="M15 21v-4a1 1 0 0 0-1-1h-3a1 1 0 0 0-1 1v4" />
        <path d="M9 8h1M9 12h1M14 8h1M14 12h1" />
      </>
    ),
    camera: (
      <>
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
      </>
    ),
    sparkles: (
      <>
        <path d="M12 3l1.6 4.9L18.5 9.5l-4.9 1.6L12 16l-1.6-4.9L5.5 9.5l4.9-1.6L12 3z" />
        <path d="M19 15l.7 2.1L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.9L19 15z" />
      </>
    ),
    pencil: (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
      </>
    ),
    mic: (
      <>
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10a7 7 0 0 0 14 0" />
        <path d="M12 19v3" />
      </>
    ),
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    check: <polyline points="20 6 9 17 4 12" />,
    arrow: (
      <>
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
      </>
    ),
    x: (
      <>
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </>
    ),
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[id] ?? null}
    </svg>
  )
}

// ── FEATURE DATA (real, already-shipped capabilities) ───────────────────────
const FEATURES = [
  {
    icon: 'camera', accent: 'sage',
    title: 'Field capture',
    body: "Take photos and record notes on your phone, right at the point of observation on site.",
  },
  {
    icon: 'sparkles', accent: 'marigold',
    title: 'AI report generation',
    body: 'Your notes and photos are drafted into a formatted Word report, ready to review in the browser.',
  },
  {
    icon: 'pencil', accent: 'indigo',
    title: 'Drawing markup',
    body: 'Pin, mark up, and annotate structural drawings on site. Findings stay linked to the exact location.',
  },
  {
    icon: 'mic', accent: 'sage',
    title: 'Voice dictation',
    body: 'Talk through observations hands-free while you work. Whisper transcribes it for the report.',
  },
  {
    icon: 'grid', accent: 'indigo',
    title: 'Web dashboard',
    body: 'The office reviews, edits and finalises reports in one place — synced straight from the field.',
  },
] as const

const ACCENT: Record<string, { bg: string; fg: string }> = {
  sage:     { bg: 'var(--sage-soft)',     fg: 'var(--sage-ink)' },
  marigold: { bg: 'var(--marigold-soft)', fg: 'var(--marigold-ink)' },
  indigo:   { bg: 'var(--indigo-soft)',   fg: 'var(--indigo)' },
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 46, padding: '0 14px',
  background: 'var(--surface)', border: '1.5px solid var(--border-line)',
  borderRadius: 'var(--radius-sm)', fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-ink)',
  outline: 'none',
}
const fieldLabelStyle: React.CSSProperties = {
  display: 'block', fontFamily: 'var(--f-heading)', fontSize: 12, fontWeight: 700, color: 'var(--text-mid)', marginBottom: 6,
}

type SignupMode = 'create' | 'join'
type SignupSuccess = { type: 'create'; joinCode: string } | { type: 'join'; firmName: string } | null

export default function LandingPage() {
  const router = useRouter()

  // ── login dropdown state ───────────────────────────────────────────────
  const [loginOpen, setLoginOpen]         = useState(false)
  const [loginEmail, setLoginEmail]       = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginLoading, setLoginLoading]   = useState(false)
  const [loginError, setLoginError]       = useState('')

  const closeLogin = () => { setLoginOpen(false); setLoginError('') }

  // Same auth call as /login — signInWithPassword, redirect to /dashboard on success
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginLoading(true)
    setLoginError('')
    const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password: loginPassword })
    if (error) {
      setLoginError(error.message)
      setLoginLoading(false)
    } else {
      router.push('/dashboard')
    }
  }

  // ── signup modal state ─────────────────────────────────────────────────
  const [signupOpen, setSignupOpen]       = useState(false)
  const [signupMode, setSignupMode]       = useState<SignupMode>('create')
  const [fullName, setFullName]           = useState('')
  const [signupEmail, setSignupEmail]     = useState('')
  const [signupPassword, setSignupPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [firmName, setFirmName]           = useState('')
  const [joinCode, setJoinCode]           = useState('')
  const [signupLoading, setSignupLoading] = useState(false)
  const [signupError, setSignupError]     = useState('')
  const [signupSuccess, setSignupSuccess] = useState<SignupSuccess>(null)

  const closeSignup = () => {
    setSignupOpen(false); setSignupError(''); setSignupSuccess(null)
    setFullName(''); setSignupEmail(''); setSignupPassword(''); setConfirmPassword(''); setFirmName(''); setJoinCode('')
  }

  // Same validation + createFirm/joinFirm logic as the mobile app's signup screen
  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSignupError('')
    if (!fullName.trim())  { setSignupError('Please enter your full name.'); return }
    if (!signupEmail.trim()) { setSignupError('Please enter your email.'); return }
    if (!signupPassword)   { setSignupError('Please enter a password.'); return }
    if (signupPassword.length < 6) { setSignupError('Password must be at least 6 characters.'); return }
    if (signupPassword !== confirmPassword) { setSignupError('Passwords do not match.'); return }
    if (signupMode === 'create' && !firmName.trim()) { setSignupError('Please enter your firm name.'); return }
    if (signupMode === 'join' && !joinCode.trim())   { setSignupError('Please enter the join code.'); return }

    setSignupLoading(true)
    const { data, error } = await supabase.auth.signUp({
      email: signupEmail.trim(), password: signupPassword,
      options: { data: { full_name: fullName.trim(), firm_name: signupMode === 'create' ? firmName.trim() : '' } },
    })

    if (error) { setSignupError(error.message); setSignupLoading(false); return }
    const userId = data.user?.id
    if (!userId) { setSignupError('Could not create account. Please try again.'); setSignupLoading(false); return }

    if (signupMode === 'create') {
      const result = await createFirm(firmName.trim(), userId, signupEmail.trim(), fullName.trim())
      setSignupLoading(false)
      if (!result) { setSignupError('Account created but could not set up your firm.'); return }
      setSignupSuccess({ type: 'create', joinCode: result.joinCode })
    } else {
      const result = await joinFirm(joinCode.trim(), userId, signupEmail.trim(), fullName.trim())
      setSignupLoading(false)
      if (!result) { setSignupError('That join code is incorrect. Please check with your admin.'); return }
      setSignupSuccess({ type: 'join', firmName: result.firmName })
    }
  }

  return (
    <>
      <style>{`
        @media (max-width: 860px) {
          .lp-nav-links   { display: none !important; }
          .lp-hero-grid   { grid-template-columns: 1fr !important; }
          .lp-hero-visual { display: none !important; }
          .lp-hero-title  { font-size: 40px !important; }
          .lp-features    { grid-template-columns: 1fr !important; }
          .lp-steps       { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <div style={{ background: 'var(--paper)', minHeight: '100vh', fontFamily: 'var(--f-text)' }}>

        {/* ── NAV ─────────────────────────────────────────────────────── */}
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 40px', borderBottom: '1px solid var(--border-line)',
          background: 'var(--surface)', position: 'sticky', top: 0, zIndex: 30,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--indigo)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>
              <Icon id="building" size={17} />
            </div>
            <span style={{ fontFamily: 'var(--f-heading)', fontSize: 20, fontWeight: 800, color: 'var(--text-ink)' }}>
              Site<span style={{ color: 'var(--indigo)' }}>IQ</span>
            </span>
          </div>

          <nav className="lp-nav-links" style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
            <a href="#features" style={{ fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 600, color: 'var(--text-ink)' }}>Features</a>
            <a href="#how-it-works" style={{ fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 600, color: 'var(--text-ink)' }}>How it works</a>
          </nav>

          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            {/* LOGIN — inline dropdown, no navigation */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => { setLoginOpen(v => !v); setLoginError('') }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700, color: 'var(--text-ink)' }}
              >
                Login
              </button>

              {loginOpen && (
                <>
                  <div onClick={closeLogin} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 12px)', right: 0, width: 300, zIndex: 41,
                    background: 'var(--surface)', border: '1px solid var(--border-line)',
                    borderRadius: 'var(--radius-md)', boxShadow: '0 16px 40px rgba(44,57,80,.18)',
                    padding: 20,
                  }}>
                    <div style={{ fontFamily: 'var(--f-heading)', fontSize: 15, fontWeight: 800, color: 'var(--indigo-deep)', marginBottom: 14 }}>
                      Sign in to SiteIQ
                    </div>
                    <form onSubmit={handleLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div>
                        <label style={fieldLabelStyle}>Email</label>
                        <input type="email" required autoFocus value={loginEmail} onChange={e => setLoginEmail(e.target.value)} placeholder="you@firm.com" style={inputStyle} />
                      </div>
                      <div>
                        <label style={fieldLabelStyle}>Password</label>
                        <input type="password" required value={loginPassword} onChange={e => setLoginPassword(e.target.value)} placeholder="••••••••" style={inputStyle} />
                      </div>
                      {loginError && (
                        <div style={{ background: 'var(--clay-soft)', border: '1px solid rgba(229,115,91,.3)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: 12, color: 'var(--clay-ink)' }}>
                          {loginError}
                        </div>
                      )}
                      <button
                        type="submit" disabled={loginLoading}
                        style={{
                          width: '100%', height: 44, background: 'var(--indigo)', color: '#fff', border: 'none',
                          borderRadius: 'var(--radius-pill)', fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700,
                          cursor: loginLoading ? 'not-allowed' : 'pointer', opacity: loginLoading ? 0.7 : 1, marginTop: 2,
                        }}
                      >
                        {loginLoading ? 'Signing in…' : 'Sign in'}
                      </button>
                    </form>
                  </div>
                </>
              )}
            </div>

            <button
              onClick={() => setSignupOpen(true)}
              style={{
                background: 'var(--marigold)', color: 'var(--indigo-deep)',
                border: 'none', borderRadius: 'var(--radius-pill)', padding: '10px 20px',
                fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 800, cursor: 'pointer',
                boxShadow: 'var(--shadow-glow-v3)',
              }}
            >
              Sign up
            </button>
          </div>
        </header>

        {/* ── HERO ────────────────────────────────────────────────────── */}
        <section style={{ padding: '72px 40px 40px', maxWidth: 1240, margin: '0 auto' }}>
          <div className="lp-hero-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 56, alignItems: 'center' }}>

            <div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: 'var(--indigo-soft)', borderRadius: 'var(--radius-pill)',
                padding: '6px 14px 6px 10px', marginBottom: 24,
              }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--sage)', display: 'inline-block' }} />
                <span style={{ fontFamily: 'var(--f-heading)', fontSize: 12, fontWeight: 700, color: 'var(--indigo)' }}>For NZ &amp; AU structural engineers</span>
              </div>

              <h1 className="lp-hero-title" style={{
                fontFamily: 'var(--f-heading)', fontWeight: 800, fontSize: 54, lineHeight: 1.05,
                color: 'var(--indigo-deep)', margin: '0 0 20px', textWrap: 'balance' as any,
              }}>
                Site inspections, done before you leave site.
              </h1>

              <p style={{ fontSize: 17, lineHeight: 1.6, color: 'var(--text-mid)', maxWidth: 480, margin: '0 0 32px' }}>
                Capture photos, voice notes and drawing markup on your phone. SiteIQ turns them into a professional Word report in minutes — reviewed and finalised in the browser.
              </p>

              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
                <button
                  onClick={() => setSignupOpen(true)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: 'var(--marigold)', color: 'var(--indigo-deep)',
                    border: 'none', borderRadius: 'var(--radius-pill)', padding: '15px 26px',
                    fontFamily: 'var(--f-heading)', fontSize: 15, fontWeight: 800, cursor: 'pointer',
                    boxShadow: 'var(--shadow-glow-v3)',
                  }}
                >
                  Sign up <Icon id="arrow" size={16} />
                </button>
                <a
                  href="#how-it-works"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: 'var(--surface)', color: 'var(--text-ink)',
                    border: '1.5px solid var(--border-line)', borderRadius: 'var(--radius-pill)', padding: '14px 24px',
                    fontFamily: 'var(--f-heading)', fontSize: 15, fontWeight: 700,
                  }}
                >
                  See how it works
                </a>
              </div>

              <p style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--text-mid)' }}>
                Built for NZ &amp; Australian structural engineering firms.
              </p>
            </div>

            {/* HERO VISUAL — a stylised peek at the real dashboard, not a fabricated screenshot */}
            <div className="lp-hero-visual">
              <div style={{
                background: 'var(--surface)', borderRadius: 'var(--radius-xl)',
                border: '1px solid var(--border-line)', boxShadow: '0 24px 60px rgba(44,57,80,.16)',
                overflow: 'hidden',
              }}>
                <div style={{ display: 'flex', gap: 6, padding: '14px 18px', borderBottom: '1px solid var(--border-line)' }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--clay)' }} />
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--marigold)' }} />
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--sage)' }} />
                </div>
                <div style={{ padding: 24, background: 'var(--paper)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
                    {[
                      { label: 'ACTIVE', value: '4', accent: 'sage' },
                      { label: 'ON HOLD', value: '1', accent: 'marigold' },
                      { label: 'VISITS', value: '7', accent: 'indigo' },
                    ].map(s => (
                      <div key={s.label} style={{ background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border-line)', padding: '12px 10px' }}>
                        <div style={{ fontFamily: 'var(--f-heading)', fontSize: 10, fontWeight: 700, color: 'var(--text-mid)', marginBottom: 6 }}>{s.label}</div>
                        <div style={{ fontFamily: 'var(--f-heading)', fontSize: 22, fontWeight: 800, color: ACCENT[s.accent].fg }}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border-line)', overflow: 'hidden' }}>
                    {[
                      { name: 'Lynn Mall Seismic Upgrade', tag: 'Up to date', accent: 'sage' },
                      { name: 'Riverside Substation', tag: '2 pending', accent: 'marigold' },
                    ].map(row => (
                      <div key={row.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid var(--border-line)' }}>
                        <span style={{ fontFamily: 'var(--f-heading)', fontSize: 12, fontWeight: 700, color: 'var(--text-ink)' }}>{row.name}</span>
                        <span style={{
                          background: ACCENT[row.accent].bg, color: ACCENT[row.accent].fg,
                          fontFamily: 'var(--f-heading)', fontSize: 10, fontWeight: 700,
                          padding: '3px 9px', borderRadius: 99,
                        }}>{row.tag}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

          </div>
        </section>

        {/* ── FEATURES ────────────────────────────────────────────────── */}
        <section id="features" style={{ padding: '80px 40px', maxWidth: 1240, margin: '0 auto' }}>
          <h2 style={{
            fontFamily: 'var(--f-heading)', fontWeight: 800, fontSize: 34, lineHeight: 1.15,
            color: 'var(--indigo-deep)', margin: '0 0 14px', maxWidth: 560, textWrap: 'balance' as any,
          }}>
            Everything the report needs, captured once.
          </h2>
          <p style={{ fontSize: 16, color: 'var(--text-mid)', maxWidth: 520, marginBottom: 44 }}>
            One tool for the field and the office. No re-typing, no lost photos, no version confusion.
          </p>

          <div className="lp-features" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
            {FEATURES.map(f => (
              <div key={f.title} style={{
                background: 'var(--surface)', border: '1px solid var(--border-line)',
                borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card-v3)', padding: 26,
              }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 12,
                  background: ACCENT[f.accent].bg, color: ACCENT[f.accent].fg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18,
                }}>
                  <Icon id={f.icon} size={19} />
                </div>
                <div style={{ fontFamily: 'var(--f-heading)', fontSize: 17, fontWeight: 800, color: 'var(--text-ink)', marginBottom: 8 }}>{f.title}</div>
                <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-mid)' }}>{f.body}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── HOW IT WORKS ────────────────────────────────────────────── */}
        <section id="how-it-works" style={{ padding: '0 40px 88px', maxWidth: 1240, margin: '0 auto' }}>
          <div style={{
            background: 'var(--indigo-deep)', borderRadius: 'var(--radius-xl)',
            padding: '52px 44px', color: '#fff',
          }}>
            <h2 style={{ fontFamily: 'var(--f-heading)', fontWeight: 800, fontSize: 30, margin: '0 0 8px', textWrap: 'balance' as any }}>
              How it works
            </h2>
            <p style={{ fontSize: 15, color: 'rgba(255,255,255,.65)', marginBottom: 40, maxWidth: 480 }}>
              From the site visit to a finalised report, without leaving either app twice.
            </p>

            <div className="lp-steps" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 28 }}>
              {[
                { n: '01', title: 'Capture on site', body: 'Photograph findings, dictate notes, and mark up drawings on your phone — even offline.' },
                { n: '02', title: 'AI drafts the report', body: 'Back in range, SiteIQ turns your capture into a structured Word report against your firm’s template.' },
                { n: '03', title: 'Review & finalise', body: 'The office reviews the draft in the browser, inserts photos and drawings, then finalises.' },
              ].map(step => (
                <div key={step.n}>
                  <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--marigold)', marginBottom: 10, letterSpacing: '1px' }}>{step.n}</div>
                  <div style={{ fontFamily: 'var(--f-heading)', fontSize: 17, fontWeight: 800, marginBottom: 8 }}>{step.title}</div>
                  <div style={{ fontSize: 14, lineHeight: 1.6, color: 'rgba(255,255,255,.7)' }}>{step.body}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FOOTER ──────────────────────────────────────────────────── */}
        <footer style={{
          borderTop: '1px solid var(--border-line)', padding: '28px 40px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{ width: 24, height: 24, borderRadius: 7, background: 'var(--indigo)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              <Icon id="building" size={12} />
            </div>
            <span style={{ fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 800, color: 'var(--text-ink)' }}>SiteIQ</span>
          </div>
          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--text-mid)' }}>© {new Date().getFullYear()} SiteIQ · Structural inspection platform</span>
          <button
            onClick={() => router.push('/login')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700, color: 'var(--indigo)' }}
          >
            Login →
          </button>
        </footer>

      </div>

      {/* ── SIGN UP MODAL ─────────────────────────────────────────────── */}
      {signupOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={closeSignup} style={{ position: 'absolute', inset: 0, background: 'rgba(44,57,80,.45)' }} />
          <div style={{
            position: 'relative', width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto',
            background: 'var(--surface)', borderRadius: 'var(--radius-xl)', boxShadow: '0 30px 70px rgba(0,0,0,.3)',
            padding: 32,
          }}>
            <button
              onClick={closeSignup}
              aria-label="Close"
              style={{ position: 'absolute', top: 20, right: 20, background: 'var(--paper)', border: 'none', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-mid)' }}
            >
              <Icon id="x" size={16} />
            </button>

            {signupSuccess ? (
              <div style={{ paddingTop: 8 }}>
                <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--sage-soft)', color: 'var(--sage-ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
                  <Icon id="check" size={22} />
                </div>
                {signupSuccess.type === 'create' ? (
                  <>
                    <h3 style={{ fontFamily: 'var(--f-heading)', fontSize: 22, fontWeight: 800, color: 'var(--indigo-deep)', margin: '0 0 8px' }}>Firm created!</h3>
                    <p style={{ fontSize: 14, color: 'var(--text-mid)', lineHeight: 1.6, marginBottom: 16 }}>
                      Welcome to SiteIQ. Share this join code with your engineers so they can join your firm from the mobile app:
                    </p>
                    <div style={{ background: 'var(--indigo-soft)', borderRadius: 'var(--radius-sm)', padding: '16px 18px', textAlign: 'center', marginBottom: 24 }}>
                      <span style={{ fontFamily: 'var(--f-mono)', fontSize: 26, fontWeight: 700, color: 'var(--indigo)', letterSpacing: '0.3em' }}>{signupSuccess.joinCode}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <h3 style={{ fontFamily: 'var(--f-heading)', fontSize: 22, fontWeight: 800, color: 'var(--indigo-deep)', margin: '0 0 8px' }}>Welcome to {signupSuccess.firmName}!</h3>
                    <p style={{ fontSize: 14, color: 'var(--text-mid)', lineHeight: 1.6, marginBottom: 24 }}>
                      Your account has been added to the firm. You're ready to go.
                    </p>
                  </>
                )}
                <button
                  onClick={() => router.push('/dashboard')}
                  style={{ width: '100%', height: 50, background: 'var(--indigo)', color: '#fff', border: 'none', borderRadius: 'var(--radius-pill)', fontFamily: 'var(--f-heading)', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
                >
                  Continue to dashboard
                </button>
              </div>
            ) : (
              <>
                <h3 style={{ fontFamily: 'var(--f-heading)', fontSize: 22, fontWeight: 800, color: 'var(--indigo-deep)', margin: '0 0 4px' }}>Create your account</h3>
                <p style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 20 }}>Join SiteIQ to start capturing inspections</p>

                <div style={{ display: 'flex', background: 'var(--paper)', borderRadius: 'var(--radius-sm)', padding: 4, marginBottom: 18 }}>
                  <button
                    type="button" onClick={() => setSignupMode('create')}
                    style={{
                      flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                      fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700,
                      background: signupMode === 'create' ? 'var(--indigo)' : 'none',
                      color: signupMode === 'create' ? '#fff' : 'var(--text-mid)',
                    }}
                  >
                    Create Firm
                  </button>
                  <button
                    type="button" onClick={() => setSignupMode('join')}
                    style={{
                      flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                      fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700,
                      background: signupMode === 'join' ? 'var(--indigo)' : 'none',
                      color: signupMode === 'join' ? '#fff' : 'var(--text-mid)',
                    }}
                  >
                    Join Firm
                  </button>
                </div>

                {signupMode === 'create' && (
                  <div style={{ background: 'var(--indigo-soft)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: 12.5, color: 'var(--indigo)', lineHeight: 1.5, marginBottom: 18 }}>
                    You'll be the Admin — create projects and manage your team.
                  </div>
                )}

                <form onSubmit={handleSignupSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <label style={fieldLabelStyle}>Full name</label>
                    <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Sarah Chen" style={inputStyle} />
                  </div>

                  {signupMode === 'create' ? (
                    <div>
                      <label style={fieldLabelStyle}>Firm name</label>
                      <input value={firmName} onChange={e => setFirmName(e.target.value)} placeholder="Chen Structural Engineers" style={inputStyle} />
                    </div>
                  ) : (
                    <div>
                      <label style={fieldLabelStyle}>Join code</label>
                      <input
                        value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())}
                        placeholder="ABC123" maxLength={6}
                        style={{ ...inputStyle, fontFamily: 'var(--f-mono)', fontWeight: 700, letterSpacing: '4px', textAlign: 'center', textTransform: 'uppercase' }}
                      />
                    </div>
                  )}

                  <div>
                    <label style={fieldLabelStyle}>Email</label>
                    <input type="email" value={signupEmail} onChange={e => setSignupEmail(e.target.value)} placeholder="engineer@yourfirm.com" style={inputStyle} />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={fieldLabelStyle}>Password</label>
                      <input type="password" value={signupPassword} onChange={e => setSignupPassword(e.target.value)} placeholder="6+ characters" style={inputStyle} />
                    </div>
                    <div>
                      <label style={fieldLabelStyle}>Confirm</label>
                      <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Re-enter" style={inputStyle} />
                    </div>
                  </div>

                  {signupError && (
                    <div style={{ background: 'var(--clay-soft)', border: '1px solid rgba(229,115,91,.3)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: 13, color: 'var(--clay-ink)' }}>
                      {signupError}
                    </div>
                  )}

                  <button
                    type="submit" disabled={signupLoading}
                    style={{
                      width: '100%', height: 50, marginTop: 4,
                      background: 'var(--marigold)', color: 'var(--indigo-deep)', border: 'none',
                      borderRadius: 'var(--radius-pill)', fontFamily: 'var(--f-heading)', fontSize: 15, fontWeight: 800,
                      cursor: signupLoading ? 'not-allowed' : 'pointer', opacity: signupLoading ? 0.7 : 1,
                      boxShadow: 'var(--shadow-glow-v3)',
                    }}
                  >
                    {signupLoading ? 'Creating account…' : signupMode === 'create' ? 'Create Firm & Account' : 'Join Firm & Sign Up'}
                  </button>
                </form>

                <p style={{ marginTop: 16, textAlign: 'center', fontSize: 13, color: 'var(--text-mid)' }}>
                  Already have an account?{' '}
                  <button
                    onClick={() => { closeSignup(); setLoginOpen(true) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--indigo)', fontWeight: 700, fontSize: 13 }}
                  >
                    Sign in
                  </button>
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
