'use client'
import { useRouter } from 'next/navigation'

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

export default function LandingPage() {
  const router = useRouter()

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
            <button
              onClick={() => router.push('/login')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700, color: 'var(--text-ink)' }}
            >
              Login
            </button>
            <button
              onClick={() => router.push('/login')}
              style={{
                background: 'var(--marigold)', color: 'var(--indigo-deep)',
                border: 'none', borderRadius: 'var(--radius-pill)', padding: '10px 20px',
                fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 800, cursor: 'pointer',
                boxShadow: 'var(--shadow-glow-v3)',
              }}
            >
              Sign in
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
                  onClick={() => router.push('/login')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: 'var(--marigold)', color: 'var(--indigo-deep)',
                    border: 'none', borderRadius: 'var(--radius-pill)', padding: '15px 26px',
                    fontFamily: 'var(--f-heading)', fontSize: 15, fontWeight: 800, cursor: 'pointer',
                    boxShadow: 'var(--shadow-glow-v3)',
                  }}
                >
                  Sign in to SiteIQ <Icon id="arrow" size={16} />
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
    </>
  )
}
