'use client'

/**
 * The report page's "Emailed to" line: who the report's {{emailed_to}}
 * names, and where that comes from — this report's own choice, the
 * project's nominated person, or the site contact recorded on the visit
 * (lib/reportRecipients, emailedToName). "Change" picks someone for just
 * this report. Names only.
 *
 * The header is filled when the report text is built, so a change shows
 * after the next "Use My Notes Text" or "Rewrite with AI".
 *
 * Shown only once sql/emailed_to.sql has run (the report has the column).
 */

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { emailedToName, parseEmailedTo, parseRecipients, type EmailedTo } from '@/lib/reportRecipients'

const FOLLOW_PROJECT = '__project__'
const SITE_CONTACT = '__site_contact__'
const OTHER_PERSON = '__other__'

export default function EmailedToPicker({ inspectionId, projectId, report, disabled }: {
  inspectionId: string
  projectId: string
  report: { emailed_to?: unknown; site_contact?: string | null }
  disabled?: boolean
}) {
  const [own, setOwn] = useState<EmailedTo | null>(parseEmailedTo(report.emailed_to))
  const [project, setProject] = useState<{ emailed_to?: unknown; report_recipients?: unknown } | null>(null)
  const [editing, setEditing] = useState(false)
  const [choice, setChoice] = useState(FOLLOW_PROJECT)
  const [other, setOther] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  // Every column, so a project without the emailed_to column still loads.
  useEffect(() => {
    if (!projectId) return
    supabase.from('projects').select('*').eq('id', projectId).single()
      .then(({ data }) => setProject(data ?? null))
  }, [projectId])

  const siteContact = String(report.site_contact ?? '').trim()
  const names = [...new Set(parseRecipients(project?.report_recipients).map(r => r.name).filter(Boolean))]
  const projectChoice = parseEmailedTo(project?.emailed_to)
  const shown = emailedToName({ emailed_to: own, site_contact: siteContact }, project)
  const source = own
    ? 'chosen for this report'
    : projectChoice && 'name' in projectChoice ? 'the project’s choice' : 'site contact'
  const projectDefault = projectChoice && 'name' in projectChoice ? projectChoice.name : siteContact || 'site contact'

  const startEditing = () => {
    if (!own) { setChoice(FOLLOW_PROJECT); setOther('') }
    else if (!('name' in own)) { setChoice(SITE_CONTACT); setOther('') }
    else if (names.includes(own.name)) { setChoice(own.name); setOther('') }
    else { setChoice(OTHER_PERSON); setOther(own.name) }
    setError(''); setSaved(false); setEditing(true)
  }

  const save = async () => {
    const next: EmailedTo | null =
      choice === FOLLOW_PROJECT ? null
        : choice === SITE_CONTACT ? { siteContact: true }
          : choice === OTHER_PERSON ? (other.trim() ? { name: other.trim() } : null)
            : { name: choice }
    if (choice === OTHER_PERSON && !other.trim()) { setError('Type a name, or pick another option.'); return }
    setSaving(true); setError('')
    const { error: updateError } = await supabase.from('inspections').update({ emailed_to: next }).eq('id', inspectionId)
    setSaving(false)
    if (updateError) { setError('Could not save: ' + updateError.message); return }
    setOwn(next); setEditing(false); setSaved(true)
  }

  const text = { fontFamily: 'var(--f-text)', fontSize: 12.5, color: 'var(--text-ink)' } as const
  const muted = { fontFamily: 'var(--f-text)', fontSize: 11.5, color: 'var(--text-mid)', lineHeight: 1.45 } as const
  const link = {
    background: 'none', border: 'none', padding: 0, cursor: disabled ? 'default' : 'pointer',
    color: 'var(--indigo)', fontFamily: 'var(--f-text)', fontSize: 12.5, fontWeight: 600, textDecoration: 'underline',
  } as const

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{
        display: 'block', marginBottom: 4,
        fontFamily: 'var(--f-heading)', fontSize: 11, fontWeight: 700, color: 'var(--text-mid)',
      }}>
        Emailed to
      </div>
      {!editing ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={text}>{shown || '—'}</span>
          <span style={muted}>({source})</span>
          {!disabled && <button type="button" style={link} onClick={startEditing}>Change</button>}
        </div>
      ) : (
        <div>
          <select
            value={choice}
            onChange={e => setChoice(e.target.value)}
            style={{
              width: '100%', padding: '7px 10px', border: '1px solid var(--border-line)',
              borderRadius: 'var(--radius-sm, 8px)', background: 'var(--paper)', color: 'var(--text-ink)',
              fontFamily: 'var(--f-text)', fontSize: 12.5,
            }}
          >
            <option value={FOLLOW_PROJECT}>As the project says ({projectDefault})</option>
            <option value={SITE_CONTACT}>The site contact{siteContact ? ` (${siteContact})` : ''}</option>
            {names.map(n => <option key={n} value={n}>{n}</option>)}
            <option value={OTHER_PERSON}>Someone else…</option>
          </select>
          {choice === OTHER_PERSON && (
            <input
              value={other}
              onChange={e => setOther(e.target.value)}
              placeholder="Name"
              style={{
                marginTop: 6, width: '100%', padding: '7px 10px', border: '1px solid var(--border-line)',
                borderRadius: 'var(--radius-sm, 8px)', background: 'var(--paper)', color: 'var(--text-ink)',
                fontFamily: 'var(--f-text)', fontSize: 12.5, boxSizing: 'border-box',
              }}
            />
          )}
          <div style={{ display: 'flex', gap: 12, marginTop: 6, alignItems: 'center' }}>
            <button type="button" style={link} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" style={{ ...link, color: 'var(--text-mid)' }} onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
          </div>
        </div>
      )}
      {error && <div style={{ ...muted, color: 'var(--clay)', marginTop: 4 }}>{error}</div>}
      {saved && (
        <div style={{ ...muted, marginTop: 4 }}>
          Saved. It goes into the report next time its text is rebuilt (Use My Notes Text or Rewrite with AI).
        </div>
      )}
    </div>
  )
}
