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

  const inputStyle = (focused: boolean): React.CSSProperties => ({
    width: '100%', padding: '12px 16px',
    background: focused ? 'var(--white)' : 'var(--stone)',
    border: `1px solid ${focused ? 'var(--accent)' : 'var(--line)'}`,
    borderRadius: 8, fontSize: 15, color: 'var(--ink)',
    outline: 'none', transition: 'all .15s',
  })

  const features = [
    'Field inspection capture',
    'AI-powered report generation',
    'Structural drawing markup',
  ]

  return (
    <div style={{ display: 'flex', height: '100vh' }}>

      {/* ── LEFT — brand panel (40%) ──────────────────────── */}
      <div style={{
        width: '40%', minWidth: 360, flexShrink: 0,
        background: 'var(--accent)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '60px',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* CSS-only grid overlay */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: `
            linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px)`,
          backgroundSize: '40px 40px',
        }} />

        {/* Content */}
        <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', maxWidth: 340 }}>
          {/* Logo */}
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto',
          }}>
            <svg width="24" height="24" fill="none" stroke="var(--accent)" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </div>

          <div style={{ fontFamily: 'var(--f-serif)', fontSize: 52, fontWeight: 600, color: '#fff', marginTop: 20, lineHeight: 1 }}>
            SiteIQ
          </div>
          <div style={{ fontSize: 17, color: 'rgba(255,255,255,0.7)', marginTop: 12 }}>
            Structural Engineering Inspection Platform
          </div>

          {/* Divider */}
          <div style={{ width: 40, height: 2, background: 'rgba(255,255,255,0.3)', margin: '28px auto' }} />

          {/* Feature lines */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
            {features.map(f => (
              <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 20, height: 20, borderRadius: '50%',
                  background: 'rgba(255,255,255,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <svg width="11" height="11" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
                <span style={{ fontSize: 15, color: 'rgba(255,255,255,0.85)' }}>{f}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── RIGHT — login form (60%) ───────────────────────── */}
      <div style={{
        flex: 1, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'white',
      }}>
        <div style={{ width: 420 }}>

          <h2 style={{
            fontFamily: 'var(--f-serif)', fontSize: 36, fontWeight: 600,
            color: 'var(--ink)', marginBottom: 8, lineHeight: 1.1,
          }}>
            Welcome back
          </h2>
          <p style={{ fontSize: 15, color: 'var(--mid)', marginBottom: 36 }}>
            Sign in to your SiteIQ account
          </p>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--dark)', marginBottom: 6 }}>
                Email address
              </label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@firm.com" required
                style={inputStyle(focusEmail)}
                onFocus={() => setFocusEmail(true)}
                onBlur={() => setFocusEmail(false)}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--dark)', marginBottom: 6 }}>
                Password
              </label>
              <input
                type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" required
                style={inputStyle(focusPass)}
                onFocus={() => setFocusPass(true)}
                onBlur={() => setFocusPass(false)}
              />
            </div>

            {error && (
              <div style={{ background: 'var(--red2)', border: '1px solid #f5c6c0', borderRadius: 6, padding: '10px 14px', fontSize: 13, color: 'var(--red)' }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%', padding: '13px 20px',
                background: loading ? 'var(--stone)' : 'var(--accent)',
                color: loading ? 'var(--mid)' : '#fff',
                border: 'none', borderRadius: 8,
                fontSize: 15, fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all .15s', marginTop: 24,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
              onMouseEnter={e => { if (!loading) e.currentTarget.style.background = '#1e3a5f' }}
              onMouseLeave={e => { if (!loading) e.currentTarget.style.background = 'var(--accent)' }}
            >
              {loading && (
                <span style={{ width: 14, height: 14, border: '2px solid var(--mid)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .8s linear infinite', display: 'inline-block' }} />
              )}
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <p style={{ marginTop: 20, fontSize: 14, color: 'var(--mid)', textAlign: 'center' }}>
            New to SiteIQ?{' '}
            <a href="/signup" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}>
              Create an account
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
