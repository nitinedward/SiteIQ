'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Btn, Card, Spinner } from '@/components/Shell'
import { closeoutFileUrl, closeoutPost, uploadCloseoutFile } from '@/lib/closeoutClient'
import { authorComplete, looksLikeEmail, type FirmPs4Settings, type Ps4Author } from '@/lib/closeout'

/**
 * Settings › PS4 form and PS4 authors: the firm's own PS4 (the fillable
 * ACE NZ / Engineering NZ PDF) that every close-out pack fills in, and the
 * engineers who can approve and sign one. Admin only, like the rest of
 * Settings.
 */

const labelStyle: React.CSSProperties = {
  display: 'block', fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700,
  color: 'var(--text-mid)', marginBottom: 8,
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 16px', boxSizing: 'border-box',
  background: 'var(--surface)', border: '1.5px solid var(--border-line)',
  borderRadius: 'var(--radius-sm)', fontFamily: 'var(--f-text)', fontSize: 15, color: 'var(--text-ink)', outline: 'none',
}
const hint: React.CSSProperties = { fontFamily: 'var(--f-text)', fontSize: 12, color: 'var(--text-mid)', lineHeight: 1.5 }
const NEW_BADGE = (
  <span style={{ padding: '2px 8px', borderRadius: 99, background: 'var(--marigold-soft)', color: 'var(--marigold-ink)', fontFamily: 'var(--f-heading)', fontSize: 10, fontWeight: 700 }}>NEW</span>
)

type Draft = { id: string | null; name: string; email: string; cpeng: string; qualifications: string; active: boolean; signature_path: string | null }

export default function Ps4Settings({ firmId }: { firmId: string }) {
  const [settings, setSettings] = useState<FirmPs4Settings>({})
  const [authors, setAuthors] = useState<Ps4Author[]>([])
  const [sigUrls, setSigUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [setupMissing, setSetupMissing] = useState(false)
  const [error, setError] = useState('')
  const [uploadingForm, setUploadingForm] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const formInput = useRef<HTMLInputElement>(null)

  const loadAuthors = async () => {
    const { data, error } = await supabase.from('ps4_authors').select('*').eq('firm_id', firmId).order('created_at')
    if (error) { setSetupMissing(true); return }
    const list = (data ?? []) as Ps4Author[]
    setAuthors(list)
    const urls: Record<string, string> = {}
    await Promise.all(list.filter(a => a.signature_path).map(async a => {
      try { urls[a.id] = await closeoutFileUrl(`kind=signature&authorId=${a.id}`) } catch { /* no preview */ }
    }))
    setSigUrls(urls)
  }

  useEffect(() => {
    if (!firmId) return
    (async () => {
      const { data, error } = await supabase.from('firms').select('ps4_settings').eq('id', firmId).single()
      if (error) setSetupMissing(true)
      else setSettings((data?.ps4_settings ?? {}) as FirmPs4Settings)
      await loadAuthors()
      setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmId])

  const uploadForm = async (file: File) => {
    setError('')
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { setError('The PS4 form must be a PDF.'); return }
    setUploadingForm(true)
    try {
      const path = await uploadCloseoutFile('ps4form', file)
      const { settings: next } = await closeoutPost<{ settings: FirmPs4Settings }>('ps4-form', { path, fileName: file.name })
      setSettings(next)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setUploadingForm(false)
    }
  }

  const saveAce = async (aceMember: 'Is' | 'Is not' | '') => {
    const next: FirmPs4Settings = { ...settings }
    if (aceMember) next.aceMember = aceMember; else delete next.aceMember
    setSettings(next)
    const { error } = await supabase.from('firms').update({ ps4_settings: next }).eq('id', firmId)
    if (error) setError('Could not save: ' + error.message)
  }

  const openForm = async () => {
    try { window.open(await closeoutFileUrl('kind=ps4form'), '_blank', 'noopener,noreferrer') } catch (err: any) { setError(err.message) }
  }

  if (loading) {
    return <Card className="settings-card"><div style={{ padding: 22, display: 'flex', justifyContent: 'center' }}><Spinner /></div></Card>
  }
  if (setupMissing) {
    return (
      <Card className="settings-card">
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border-line)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 style={{ fontFamily: 'var(--f-heading)', fontSize: 15, fontWeight: 800, color: 'var(--text-ink)' }}>PS4 form &amp; authors</h2>{NEW_BADGE}
        </div>
        <div style={{ padding: 22, ...hint, fontSize: 13 }}>
          Close-out packs need a one-off database step first: run <code>web/sql/closeout.sql</code> in the Supabase SQL editor, then reload this page.
        </div>
      </Card>
    )
  }

  const check = settings.fieldCheck
  return (
    <>
      {/* ── PS4 form ── */}
      <Card className="settings-card">
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border-line)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 style={{ fontFamily: 'var(--f-heading)', fontSize: 15, fontWeight: 800, color: 'var(--text-ink)' }}>PS4 form</h2>{NEW_BADGE}
        </div>
        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label style={labelStyle}>Your PS4 (PDF)</label>
            <p style={{ ...hint, marginBottom: 8 }}>
              Upload the fillable ACE NZ / Engineering NZ PS4 your firm uses. SiteIQ fills in its boxes for every close-out pack.
            </p>
            <input ref={formInput} type="file" accept="application/pdf,.pdf" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadForm(f) }} />
            {settings.formPath ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, background: 'var(--paper)', border: '1px solid var(--border-line)', borderRadius: 'var(--radius-sm)', padding: '12px 14px' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700, color: 'var(--text-ink)' }}>{settings.formName ?? 'PS4.pdf'}</div>
                  {check && (check.missing.length === 0
                    ? <div style={{ ...hint, color: 'var(--sage-ink)' }}>✓ All {check.found} boxes SiteIQ fills were found</div>
                    : <div style={{ ...hint, color: 'var(--marigold-ink)' }}>{check.found} boxes found. Missing, so left blank: {check.missing.join(', ')}</div>)}
                </div>
                <Btn variant="outline" small onClick={openForm}>View</Btn>
                <Btn variant="outline" small onClick={() => formInput.current?.click()} disabled={uploadingForm}>{uploadingForm ? 'Uploading…' : 'Replace'}</Btn>
              </div>
            ) : (
              <Btn variant="primary" onClick={() => formInput.current?.click()} disabled={uploadingForm}>{uploadingForm ? 'Checking the form…' : 'Upload PS4 form'}</Btn>
            )}
          </div>
          <div>
            <label style={labelStyle} htmlFor="ps4-ace">Is your firm a member of ACE New Zealand?</label>
            <select id="ps4-ace" value={settings.aceMember ?? ''} onChange={e => saveAce(e.target.value as any)} style={inputStyle}>
              <option value="">Not set</option>
              <option value="Is">Is a member</option>
              <option value="Is not">Is not a member</option>
            </select>
            <p style={{ ...hint, marginTop: 6 }}>Sets the &ldquo;is / is not a member of ACE New Zealand&rdquo; choice on every PS4.</p>
          </div>
          {error && <div style={{ ...hint, fontSize: 13, color: 'var(--clay-ink)' }}>{error}</div>}
        </div>
      </Card>

      {/* ── PS4 authors ── */}
      <Card className="settings-card">
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border-line)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ fontFamily: 'var(--f-heading)', fontSize: 15, fontWeight: 800, color: 'var(--text-ink)' }}>PS4 authors</h2>{NEW_BADGE}
          </div>
          <Btn variant="primary" small onClick={() => setDraft({ id: null, name: '', email: '', cpeng: '', qualifications: '', active: true, signature_path: null })}>+ Add author</Btn>
        </div>
        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={hint}>
            Engineers who can approve and sign PS4s. The approval email goes to the address below, so it must be a real inbox. It can differ from their SiteIQ login, and they don&rsquo;t need one.
          </p>
          {authors.length === 0 && <div style={{ ...hint, fontSize: 13, padding: '8px 0' }}>No PS4 authors yet.</div>}
          {authors.map(a => {
            const ready = authorComplete(a)
            return (
              <button key={a.id} onClick={() => setDraft({ ...a })} style={{
                display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
                padding: '12px 14px', background: 'var(--surface)', border: '1.5px solid var(--border-line)',
                borderRadius: 'var(--radius-sm)', cursor: 'pointer', opacity: a.active ? 1 : 0.6,
              }}>
                <span style={{ flex: 1, minWidth: 200 }}>
                  <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700, color: 'var(--text-ink)' }}>{a.name}</span>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 99,
                      fontFamily: 'var(--f-heading)', fontSize: 11, fontWeight: 700,
                      color: !a.active ? 'var(--text-mid)' : ready ? 'var(--sage-ink)' : 'var(--marigold-ink)',
                      background: !a.active ? 'var(--paper)' : ready ? 'var(--sage-soft)' : 'var(--marigold-soft)',
                    }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />
                      {!a.active ? 'Inactive' : ready ? 'Ready' : a.signature_path ? 'Details missing' : 'Needs signature'}
                    </span>
                  </span>
                  <span style={{ display: 'block', fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--text-mid)', marginTop: 2 }}>
                    {a.email}{a.cpeng ? ` · CPEng ${a.cpeng}` : ''}
                  </span>
                </span>
                <span style={{ flex: '0 0 120px', height: 40, border: '1px dashed var(--border-line)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', overflow: 'hidden' }}>
                  {sigUrls[a.id]
                    ? <img src={sigUrls[a.id]} alt={`${a.name}'s signature`} style={{ maxWidth: 110, maxHeight: 34, objectFit: 'contain' }} />
                    : <span style={{ fontFamily: 'var(--f-text)', fontSize: 11, fontWeight: 600, color: 'var(--clay-ink)' }}>No signature</span>}
                </span>
                <span style={{ fontFamily: 'var(--f-heading)', fontSize: 12, fontWeight: 700, color: 'var(--indigo)' }}>Edit</span>
              </button>
            )
          })}
        </div>
      </Card>

      {draft && (
        <AuthorModal
          firmId={firmId}
          draft={draft}
          signatureUrl={draft.id ? sigUrls[draft.id] : undefined}
          onClose={() => setDraft(null)}
          onSaved={async () => { setDraft(null); await loadAuthors() }}
        />
      )}
    </>
  )
}

function AuthorModal({ firmId, draft, signatureUrl, onClose, onSaved }: {
  firmId: string
  draft: Draft
  signatureUrl?: string
  onClose: () => void
  onSaved: () => void
}) {
  const [d, setD] = useState<Draft>(draft)
  const [sigFile, setSigFile] = useState<File | null>(null)
  const [sigPreview, setSigPreview] = useState<string | undefined>(signatureUrl)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const sigInput = useRef<HTMLInputElement>(null)
  const set = (k: keyof Draft, v: any) => setD(prev => ({ ...prev, [k]: v }))

  useEffect(() => () => { if (sigFile && sigPreview) URL.revokeObjectURL(sigPreview) }, [sigFile, sigPreview])

  const pickSignature = (file: File) => {
    if (!/^image\/(png|jpeg)$/.test(file.type)) { setError('The signature must be a PNG or JPG image.'); return }
    if (file.size > 2 * 1024 * 1024) { setError('Keep the signature image under 2 MB.'); return }
    setError('')
    setSigFile(file)
    setSigPreview(URL.createObjectURL(file))
  }

  const save = async () => {
    if (!d.name.trim()) { setError('Enter their name as it goes on the PS4.'); return }
    if (!looksLikeEmail(d.email)) { setError('Enter a real email address: the approval link is sent there.'); return }
    setSaving(true)
    setError('')
    try {
      const row = {
        firm_id: firmId, name: d.name.trim(), email: d.email.trim(), cpeng: d.cpeng.trim(),
        qualifications: d.qualifications.trim(), active: d.active,
      }
      let id = d.id
      if (id) {
        const { error } = await supabase.from('ps4_authors').update(row).eq('id', id)
        if (error) throw new Error(error.message)
      } else {
        const { data, error } = await supabase.from('ps4_authors').insert(row).select('id').single()
        if (error || !data) throw new Error(error?.message ?? 'Could not add the author')
        id = data.id
      }
      if (sigFile && id) {
        const path = await uploadCloseoutFile('signature', sigFile, { authorId: id })
        await closeoutPost('signature', { authorId: id, path })
      }
      onSaved()
    } catch (err: any) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div role="dialog" aria-modal="true" aria-labelledby="ps4-author-h" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, maxHeight: 'calc(100vh - 40px)', overflowY: 'auto' }}>
        <Card style={{ padding: 24 }}>
          <div id="ps4-author-h" style={{ fontFamily: 'var(--f-heading)', fontSize: 19, fontWeight: 800, color: 'var(--text-ink)', marginBottom: 18 }}>
            {d.id ? `Edit ${draft.name}` : 'New PS4 author'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={labelStyle} htmlFor="pa-name">Full name (as on the PS4) *</label>
              <input id="pa-name" value={d.name} onChange={e => set('name', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle} htmlFor="pa-email">Email for approval requests *</label>
              <input id="pa-email" type="email" value={d.email} onChange={e => set('email', e.target.value)} style={inputStyle} />
              <p style={{ ...hint, marginTop: 6 }}>Must be a real inbox. It can be different from their SiteIQ login.</p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
              <div>
                <label style={labelStyle} htmlFor="pa-cpeng">CPEng number *</label>
                <input id="pa-cpeng" value={d.cpeng} onChange={e => set('cpeng', e.target.value)} style={{ ...inputStyle, fontFamily: 'var(--f-mono)', fontSize: 14 }} />
              </div>
              <div>
                <label style={labelStyle} htmlFor="pa-quals">Qualifications *</label>
                <input id="pa-quals" value={d.qualifications} onChange={e => set('qualifications', e.target.value)} placeholder="e.g. BE(Hons) Civil" style={inputStyle} />
              </div>
            </div>
            <div>
              <span style={labelStyle}>Signature *</span>
              <input ref={sigInput} type="file" accept="image/png,image/jpeg" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pickSignature(f) }} />
              <div style={{ border: '1.5px dashed var(--border-line)', borderRadius: 'var(--radius-sm)', padding: 14, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, background: 'var(--paper)' }}>
                <span style={{ flex: '0 0 160px', height: 56, background: '#fff', border: '1px solid var(--border-line)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {sigPreview
                    ? <img src={sigPreview} alt="Signature" style={{ maxWidth: 150, maxHeight: 50, objectFit: 'contain' }} />
                    : <span style={{ ...hint }}>None yet</span>}
                </span>
                <span style={{ flex: 1, minWidth: 160, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
                  <Btn variant="outline" small onClick={() => sigInput.current?.click()}>{sigPreview ? 'Replace signature' : 'Upload signature'}</Btn>
                  <span style={hint}>PNG or JPG. Uploaded once, kept private, and placed on a PS4 only when this author approves it.</span>
                </span>
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-ink)', minHeight: 44, cursor: 'pointer' }}>
              <input type="checkbox" checked={d.active} onChange={e => set('active', e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--indigo)' }} />
              Active: can be picked on new packs
            </label>
            {error && <div style={{ ...hint, fontSize: 13, color: 'var(--clay-ink)' }}>{error}</div>}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <Btn variant="outline" onClick={onClose} style={{ flex: 1 }}>Cancel</Btn>
            <Btn variant="primary" onClick={save} disabled={saving} style={{ flex: 1 }}>{saving ? 'Saving…' : 'Save'}</Btn>
          </div>
        </Card>
      </div>
    </div>
  )
}
