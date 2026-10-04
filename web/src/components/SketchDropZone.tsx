'use client'
import { useRef, useState } from 'react'
import { SKETCH_ACCEPT } from '@/lib/sketches'

/** A file waiting to become a sketch, with what it will be linked to. */
export type StagedSketch = { file: File; observationId: string | null; title: string }

export type SketchNoteOption = { id: string | null; label: string }

/** While staged, a file on the report page has no note until one is picked
 *  ('unchosen'), so nothing is linked to a note by accident. */
type Pending = { file: File; observationId: string | null | 'unchosen'; title: string }

/**
 * Where sketch files are dropped: a Bluebeam PDF, or a scan or photo of a
 * paper sketch. Each file is staged with the site note it belongs to and an
 * optional title, then handed to `onSubmit` together.
 *
 * With `noteOptions`, every file gets a note picker (the report page). Without,
 * the files all go to `fixedNoteId` (a site note's own panel).
 */
export default function SketchDropZone({
  noteOptions,
  fixedNoteId = null,
  submitLabel,
  disabled = false,
  onSubmit,
}: {
  noteOptions?: SketchNoteOption[]
  fixedNoteId?: string | null
  submitLabel: string
  disabled?: boolean
  onSubmit: (staged: StagedSketch[]) => Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [staged, setStaged] = useState<Pending[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const stage = (files: FileList | File[]) => {
    const fresh: Pending[] = Array.from(files).map(file => ({
      file,
      observationId: noteOptions ? 'unchosen' : fixedNoteId,
      title: '',
    }))
    setStaged(prev => [...prev, ...fresh])
    setError('')
  }

  const unchosen = staged.filter(s => s.observationId === 'unchosen').length

  const submit = async () => {
    if (staged.length === 0 || unchosen > 0) return
    setBusy(true)
    setError('')
    try {
      await onSubmit(staged.map(s => ({
        file: s.file,
        observationId: s.observationId === 'unchosen' ? null : s.observationId,
        title: s.title,
      })))
      setStaged([])
    } catch (err: any) {
      setError(err?.message ?? 'Could not add the sketch')
    } finally {
      setBusy(false)
    }
  }

  const locked = disabled || busy

  return (
    <div>
      <div
        onClick={() => !locked && inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); if (!locked) setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault()
          setDragOver(false)
          if (!locked && e.dataTransfer.files.length) stage(e.dataTransfer.files)
        }}
        style={{
          border: `1.5px dashed ${dragOver ? 'var(--indigo)' : 'var(--border-line)'}`,
          background: dragOver ? 'var(--indigo-soft, var(--paper))' : 'var(--paper)',
          borderRadius: 'var(--radius-md)',
          padding: '14px 12px', textAlign: 'center',
          cursor: locked ? 'not-allowed' : 'pointer',
          opacity: locked ? 0.6 : 1,
          fontFamily: 'var(--f-text)', fontSize: 12, color: 'var(--text-mid)', lineHeight: 1.5,
        }}
      >
        <div style={{ fontWeight: 600, color: 'var(--text-ink)' }}>Drop sketches here, or click to choose</div>
        <div>Bluebeam PDF, or a scan or photo of a hand sketch</div>
        <input
          ref={inputRef}
          type="file"
          accept={SKETCH_ACCEPT}
          multiple
          style={{ display: 'none' }}
          onChange={e => { if (e.target.files?.length) stage(e.target.files); e.target.value = '' }}
        />
      </div>

      {staged.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {staged.map((s, i) => (
            <div key={i} style={{
              border: '1px solid var(--border-line)', borderRadius: 'var(--radius-md)',
              padding: '8px 10px', background: 'var(--surface)',
              display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{
                  flex: 1, minWidth: 0, fontFamily: 'var(--f-text)', fontSize: 12, fontWeight: 600,
                  color: 'var(--text-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {s.file.name}
                </div>
                <button
                  onClick={() => setStaged(prev => prev.filter((_, j) => j !== i))}
                  disabled={busy}
                  title="Remove"
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-mid)', fontSize: 14 }}
                >×</button>
              </div>
              {noteOptions && (
                <select
                  value={s.observationId === 'unchosen' ? '' : (s.observationId ?? '__general')}
                  onChange={e => {
                    const v = e.target.value
                    setStaged(prev => prev.map((p, j) => j === i
                      ? { ...p, observationId: v === '' ? 'unchosen' : v === '__general' ? null : v }
                      : p))
                  }}
                  disabled={busy}
                  style={{
                    fontFamily: 'var(--f-text)', fontSize: 12, padding: '5px 6px',
                    border: `1px solid ${s.observationId === 'unchosen' ? 'var(--marigold-ink, #b7791f)' : 'var(--border-line)'}`,
                    borderRadius: 6, background: 'var(--paper)', color: 'var(--text-ink)',
                  }}
                >
                  <option value="">Which site note is this for?</option>
                  {noteOptions.map(o => (
                    <option key={o.id ?? '__general'} value={o.id ?? '__general'}>{o.label}</option>
                  ))}
                </select>
              )}
              <input
                value={s.title}
                onChange={e => setStaged(prev => prev.map((p, j) => j === i ? { ...p, title: e.target.value } : p))}
                placeholder="Title (optional), e.g. Lintel detail at GL-Nw"
                disabled={busy}
                style={{
                  fontFamily: 'var(--f-text)', fontSize: 12, padding: '5px 6px',
                  border: '1px solid var(--border-line)', borderRadius: 6,
                  background: 'var(--paper)', color: 'var(--text-ink)',
                }}
              />
            </div>
          ))}

          <button
            onClick={submit}
            disabled={locked || unchosen > 0}
            style={{
              border: 'none', borderRadius: 8, padding: '8px 12px',
              background: locked || unchosen > 0 ? 'var(--paper)' : 'var(--indigo)',
              color: locked || unchosen > 0 ? 'var(--text-mid)' : 'white',
              fontFamily: 'var(--f-heading)', fontSize: 12, fontWeight: 700,
              cursor: locked || unchosen > 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {busy
              ? 'Uploading…'
              : unchosen > 0
                ? `Choose a site note for ${unchosen === 1 ? 'the file' : `${unchosen} files`}`
                : `${submitLabel} (${staged.length})`}
          </button>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 6, fontFamily: 'var(--f-text)', fontSize: 12, color: 'var(--rose-ink, #c53030)' }}>
          {error}
        </div>
      )}
    </div>
  )
}
