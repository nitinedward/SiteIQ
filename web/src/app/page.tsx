'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router                        = useRouter()
  const [email, setEmail]             = useState('')
  const [password, setPassword]       = useState('')
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState('')
  const [focusEmail, setFocusEmail]   = useState(false)
  const [focusPass, setFocusPass]     = useState(false)

  // ── auth logic unchanged ──────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/dashboard')
    }
  }

  const features = [
    'Field inspection capture on mobile',
    'AI-powered report generation',
    'Structural drawing markup',
  ]

  return (
    <>
      <style>{`
        @media (max-width: 768px) {
          .login-left-panel  { display: none !important; }
          .login-right-panel { width: 100% !important; padding: 40px 28px !important; }
          .login-heading     { font-size: 32px !important; }
        }
      `}</style>
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: 'var(--f-body)' }}>

      {/* LEFT PANEL (42%) */}
      <div className="login-left-panel" style={{
        width: '42%', minWidth: 380, flexShrink: 0,
        background: 'linear-gradient(145deg, #1e3a5f 0%, #2c5282 60%, #2d6a8f 100%)',
        position: 'relative', overflow: 'hidden',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: '60px 56px',
      }}>

        {/* Circle 1 */}
        <div style={{ position: 'absolute', top: -120, right: -120, width: 380, height: 380, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', pointerEvents: 'none' }} />

        {/* Circle 2 */}
        <div style={{ position: 'absolute', bottom: -180, left: -140, width: 520, height: 520, borderRadius: '50%', background: 'rgba(255,255,255,0.03)', pointerEvents: 'none' }} />

        {/* Grid overlay */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: `linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px)`,
          backgroundSize: '48px 48px',
        }} />

        {/* Content */}
        <div style={{ position: 'relative', zIndex: 1 }}>

          {/* Logo mark */}
          <div style={{
            width: 48, height: 48, borderRadius: 14,
            background: 'rgba(255,255,255,0.12)',
            border: '1px solid rgba(255,255,255,0.2)',
            backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 28,
          }}>
            <svg width="22" height="22" fill="none" stroke="white" strokeWidth="1.8" viewBox="0 0 24 24">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
              <polyline points="9,22 9,12 15,12 15,22"/>
            </svg>
          </div>

          {/* Brand name */}
          <div style={{ fontFamily: 'var(--f-serif)', fontSize: 56, fontWeight: 600, color: '#fff', lineHeight: 1, marginBottom: 12 }}>
            SiteIQ
          </div>

          {/* Tagline */}
          <div style={{ fontSize: 16, lineHeight: 1.6, color: 'rgba(255,255,255,0.65)', marginBottom: 48 }}>
            Structural Engineering<br />Inspection Platform
          </div>

          {/* Divider */}
          <div style={{ width: 40, height: 2, background: 'rgba(255,255,255,0.25)', borderRadius: 1, marginBottom: 32 }} />

          {/* Feature list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {features.map(f => (
              <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 22, height: 22, flexShrink: 0,
                  background: 'rgba(255,255,255,0.12)', borderRadius: '50%',
                  border: '1px solid rgba(255,255,255,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="10" height="10" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
                    <polyline points="20,6 9,17 4,12"/>
                  </svg>
                </div>
                <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)' }}>{f}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Version tag */}
        <div style={{
          position: 'absolute', bottom: 32, left: 56,
          fontFamily: 'var(--f-mono)', fontSize: 10,
          textTransform: 'uppercase', letterSpacing: '1.5px',
          color: 'rgba(255,255,255,0.25)',
        }}>
          SiteIQ · v1.0
        </div>
      </div>

      {/* RIGHT PANEL (58%) */}
      <div className="login-right-panel" style={{
        flex: 1, background: 'white',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '60px',
      }}>
        <div style={{ width: '100%', maxWidth: 400 }}>

          {/* Eyebrow */}
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '2px', color: 'var(--mid)', marginBottom: 16 }}>
            Welcome back
          </div>

          {/* Heading */}
          <h2 className="login-heading" style={{ fontFamily: 'var(--f-serif)', fontSize: 42, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.1, margin: '0 0 8px 0' }}>
            Sign in to SiteIQ
          </h2>

          {/* Subtext */}
          <p style={{ fontSize: 15, color: 'var(--mid)', margin: '0 0 40px 0' }}>
            Enter your credentials to continue
          </p>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--dark)' }}>Email address</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@firm.com" required
                style={{
                  padding: '12px 16px',
                  background: focusEmail ? 'white' : 'var(--stone)',
                  border: `1.5px solid ${focusEmail ? 'var(--accent)' : 'var(--line)'}`,
                  borderRadius: 'var(--r2)', fontSize: 15, color: 'var(--ink)',
                  outline: 'none', transition: 'all .15s', width: '100%',
                  boxShadow: focusEmail ? '0 0 0 3px var(--accent2)' : 'none',
                }}
                onFocus={() => setFocusEmail(true)}
                onBlur={() => setFocusEmail(false)}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--dark)' }}>Password</label>
              <input
                type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" required
                style={{
                  padding: '12px 16px',
                  background: focusPass ? 'white' : 'var(--stone)',
                  border: `1.5px solid ${focusPass ? 'var(--accent)' : 'var(--line)'}`,
                  borderRadius: 'var(--r2)', fontSize: 15, color: 'var(--ink)',
                  outline: 'none', transition: 'all .15s', width: '100%',
                  boxShadow: focusPass ? '0 0 0 3px var(--accent2)' : 'none',
                }}
                onFocus={() => setFocusPass(true)}
                onBlur={() => setFocusPass(false)}
              />
            </div>

            {error && (
              <div style={{ background: 'var(--red2)', border: '1px solid rgba(192,57,43,.2)', borderRadius: 'var(--r1)', padding: '10px 14px', fontSize: 13, color: 'var(--red)' }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%', padding: '13px 24px', marginTop: 8,
                background: 'var(--accent)', color: 'white',
                border: 'none', borderRadius: 'var(--r2)',
                fontSize: 15, fontWeight: 600, letterSpacing: '0.3px',
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all .2s', opacity: loading ? 0.7 : 1,
              }}
              onMouseEnter={e => {
                if (!loading) {
                  e.currentTarget.style.background = '#1e3a5f'
                  e.currentTarget.style.transform = 'translateY(-1px)'
                  e.currentTarget.style.boxShadow = 'var(--shadow-md)'
                }
              }}
              onMouseLeave={e => {
                if (!loading) {
                  e.currentTarget.style.background = 'var(--accent)'
                  e.currentTarget.style.transform = 'translateY(0)'
                  e.currentTarget.style.boxShadow = 'none'
                }
              }}
              onMouseDown={e => { if (!loading) e.currentTarget.style.transform = 'translateY(0)' }}
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <p style={{ marginTop: 24, fontSize: 14, color: 'var(--mid)', textAlign: 'center' }}>
            New to SiteIQ?{' '}
            <button
              onClick={() => router.push('/signup')}
              style={{ color: 'var(--accent)', fontWeight: 500, cursor: 'pointer', background: 'none', border: 'none', textDecoration: 'underline', fontSize: 14 }}
            >
              Create an account
            </button>
          </p>
        </div>
      </div>
    </div>
    </>
  )
}
