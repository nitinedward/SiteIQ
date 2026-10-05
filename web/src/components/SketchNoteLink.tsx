'use client'
import { useState } from 'react'

export type NoteLinkOption = {
  id: string | null
  label: string
  /** The note's report, shown after the label as a link that opens it. */
  report?: { label: string; href: string } | null
}

/**
 * The site note a sketch is linked to, shown fixed once set — a sketch's
 * link is part of what makes it traceable, so it shouldn't move because a
 * dropdown was brushed. "Change" opens the picker, with Save and Cancel; an
 * unlinked sketch offers "Link to a site note" instead.
 */
export default function SketchNoteLink({
  value, options, onChange, disabled = false, compact = false,
}: {
  value: string | null
  /** Must include the `null` option (no note / General) the caller wants offered. */
  options: NoteLinkOption[]
  onChange: (observationId: string | null) => void | Promise<void>
  disabled?: boolean
  /** Smaller type, for the report page's narrow panel. */
  compact?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string>(value ?? '')
  const [saving, setSaving] = useState(false)

  const size = compact ? 11 : 12
  const current = options.find(o => o.id === value)
  const linked = value !== null && !!current

  const button = (onClick: () => void, label: string, primary = false, off = false) => (
    <button
      onClick={onClick}
      disabled={off}
      style={{
        border: primary ? 'none' : '1px solid var(--border-line)', borderRadius: 6,
        padding: compact ? '3px 8px' : '4px 10px',
        background: primary ? (off ? 'var(--paper)' : 'var(--indigo)') : 'var(--surface)',
        color: primary ? (off ? 'var(--text-mid)' : 'white') : 'var(--text-ink)',
        fontFamily: 'var(--f-text)', fontSize: size, fontWeight: 600,
        cursor: off ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
      }}
    >{label}</button>
  )

  if (!editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
        <div style={{
          flex: 1, minWidth: 0, fontFamily: 'var(--f-text)', fontSize: size,
          color: linked ? 'var(--text-ink)' : 'var(--text-mid)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} title={current?.label}>
          {linked ? <>🔗 {current!.label}</> : (current?.label ?? 'Not linked to a site note')}
          {linked && current!.report && (
            <>
              {' — '}
              <a
                href={current!.report.href}
                target="_blank"
                rel="noreferrer"
                title={`Open ${current!.report.label}`}
                style={{ color: 'var(--indigo)', textDecoration: 'underline' }}
              >{current!.report.label}</a>
            </>
          )}
        </div>
        {!disabled && button(() => { setDraft(value ?? ''); setEditing(true) }, linked ? 'Change' : 'Link to a site note')}
      </div>
    )
  }

  const save = async () => {
    const next = draft === '' ? null : draft
    if (next === value) { setEditing(false); return }
    setSaving(true)
    try {
      await onChange(next)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <select
        value={draft}
        onChange={e => setDraft(e.target.value)}
        disabled={saving}
        autoFocus
        style={{
          width: '100%', fontFamily: 'var(--f-text)', fontSize: size, padding: '4px 5px',
          border: '1px solid var(--indigo)', borderRadius: 6, background: 'var(--paper)', color: 'var(--text-ink)',
        }}
      >
        {options.map(o => (
          <option key={o.id ?? '__none'} value={o.id ?? ''}>{o.report ? `${o.label} — ${o.report.label}` : o.label}</option>
        ))}
      </select>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        {button(() => setEditing(false), 'Cancel', false, saving)}
        {button(save, saving ? 'Saving…' : 'Save', true, saving)}
      </div>
    </div>
  )
}
