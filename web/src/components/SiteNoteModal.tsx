'use client'
import { useEffect, useState } from 'react'
import { Spinner } from '@/components/Shell'
import {
  SiteNote, NoteStatus, formatNoteDate, measurementLabel,
} from '@/lib/siteNotes'

/** The full site note: what was dictated on site, the photos taken, anything
 *  measured, and the drawing with this note's markup rendered on it — the
 *  same view of an observation the report gives, without opening the report.
 *
 *  The drawing is rendered in the browser with the same routine the report
 *  uses to put marked-up drawings into the .docx, so the pin here is exactly
 *  the pin that ends up in the document. */
export function SiteNoteModal({
  note, saving, onClose, onToggleStatus, onOpenReport,
}: {
  note: SiteNote
  saving: boolean
  onClose: () => void
  onToggleStatus: (next: NoteStatus) => void
  onOpenReport?: () => void
}) {
  const [markupUrl, setMarkupUrl]   = useState<string | null>(null)
  const [markupState, setMarkupState] = useState<'idle' | 'loading' | 'error'>('idle')

  const isOpen = note.status === 'OPEN'
  const tone = isOpen
    ? { bg: 'var(--marigold-soft)', fg: 'var(--marigold-ink)', dot: 'var(--marigold)' }
    : { bg: 'var(--sage-soft)',     fg: 'var(--sage-ink)',     dot: 'var(--sage)' }

  // Escape closes, and the page behind must not scroll while this is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  // pdf.js is heavy and only needed once a note is actually opened, so the
  // renderer is imported here rather than with the page.
  useEffect(() => {
    if (!note.drawing || !note.zone) return
    let cancelled = false
    let objectUrl: string | null = null

    ;(async () => {
      setMarkupState('loading')
      try {
        const { captureDrawingWithMarkup } = await import('@/lib/captureDrawing')
        const blob = await captureDrawingWithMarkup(note.drawing!.file_url, [note.zone!] as any[], 1)
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setMarkupUrl(objectUrl)
        setMarkupState('idle')
      } catch (err) {
        console.error('[siteNote] could not render the drawing markup:', err)
        if (!cancelled) setMarkupState('error')
      }
    })()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [note.id, note.drawing, note.zone])

  const sectionTitle: React.CSSProperties = {
    fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '1.4px',
    textTransform: 'uppercase', color: 'var(--text-mid)', marginBottom: 10,
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 90,
        background: 'rgba(26,25,23,.45)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Site note — ${note.zoneLabel}`}
        style={{
          background: 'var(--surface)', border: '1px solid var(--border-line)',
          borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-card-v3)',
          width: 'min(920px, 100%)', maxHeight: '90vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '22px 26px', borderBottom: '1px solid var(--border-line)',
          display: 'flex', alignItems: 'flex-start', gap: 16,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: tone.bg, color: tone.fg,
                fontFamily: 'var(--f-heading)', fontSize: 11, fontWeight: 700,
                padding: '4px 11px', borderRadius: 'var(--radius-pill)',
              }}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: tone.dot }} />
                {isOpen ? 'Open' : 'Closed'}
              </span>
              {note.reportNo && (
                <span style={{
                  background: 'var(--indigo-soft)', color: 'var(--indigo)',
                  fontFamily: 'var(--f-mono)', fontSize: 11, fontWeight: 600,
                  padding: '3px 9px', borderRadius: 8,
                }}>#{note.reportNo}</span>
              )}
            </div>
            <h2 style={{
              fontFamily: 'var(--f-heading)', fontSize: 23, fontWeight: 800,
              color: 'var(--indigo-deep)', marginTop: 10, wordBreak: 'break-word',
            }}>{note.zoneLabel}</h2>
            <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--text-mid)', marginTop: 4 }}>
              {formatNoteDate(note)}
              {note.drawing && ` · ${note.drawing.number} Rev ${note.drawing.revision}`}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-mid)', fontSize: 20, lineHeight: 1, padding: 6, flexShrink: 0,
            }}
          >✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: '22px 26px', overflowY: 'auto' }}>
          <div style={sectionTitle}>Site note</div>
          <div style={{
            background: 'var(--paper)', border: '1px solid var(--border-line)',
            borderRadius: 'var(--radius-md, 14px)', padding: '16px 18px',
            fontFamily: 'var(--f-text)', fontSize: 15, lineHeight: 1.65,
            color: note.description ? 'var(--text-ink)' : 'var(--text-mid)',
            whiteSpace: 'pre-wrap',
          }}>
            {note.description || 'No description was dictated for this note.'}
          </div>

          {note.measurements.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div style={sectionTitle}>Measurements</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {note.measurements.map((m, i) => (
                  <span key={i} style={{
                    display: 'inline-flex', alignItems: 'baseline', gap: 7,
                    background: 'var(--paper)', border: '1px solid var(--border-line)',
                    borderRadius: 'var(--radius-pill)', padding: '7px 14px',
                  }}>
                    <span style={{ fontFamily: 'var(--f-text)', fontSize: 13, color: 'var(--text-mid)' }}>
                      {measurementLabel(m)}
                    </span>
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 13, fontWeight: 600, color: 'var(--text-ink)' }}>
                      {m.value} {m.unit}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 24 }}>
            <div style={sectionTitle}>Photos ({note.photos.length})</div>
            {note.photos.length === 0 ? (
              <div style={{ fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)' }}>
                No photos were taken for this note.
              </div>
            ) : (
              <div style={{
                display: 'grid', gap: 10,
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              }}>
                {note.photos.map(url => (
                  <a
                    key={url} href={url} target="_blank" rel="noreferrer"
                    title="Open full size"
                    style={{
                      display: 'block', aspectRatio: '4 / 3', overflow: 'hidden',
                      borderRadius: 'var(--radius-md, 14px)', border: '1px solid var(--border-line)',
                      background: 'var(--paper)',
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url} alt="Site photo" loading="lazy"
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  </a>
                ))}
              </div>
            )}
          </div>

          <div style={{ marginTop: 24 }}>
            <div style={sectionTitle}>Drawing markup</div>
            {!note.drawing || !note.zone ? (
              <div style={{ fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)' }}>
                This note isn’t pinned to a drawing.
              </div>
            ) : (
              <div style={{
                border: '1px solid var(--border-line)', borderRadius: 'var(--radius-md, 14px)',
                overflow: 'hidden', background: 'var(--paper)',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  padding: '11px 14px', borderBottom: '1px solid var(--border-line)',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700,
                      color: 'var(--text-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{note.drawing.title}</div>
                    <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, color: 'var(--text-mid)', marginTop: 2 }}>
                      {note.drawing.number} · Rev {note.drawing.revision} · {note.zone.markup_type} markup
                    </div>
                  </div>
                  <a
                    href={note.drawing.file_url} target="_blank" rel="noreferrer"
                    style={{
                      fontFamily: 'var(--f-heading)', fontSize: 12.5, fontWeight: 700,
                      color: 'var(--indigo)', textDecoration: 'none', flexShrink: 0,
                    }}
                  >Open PDF</a>
                </div>

                {markupState === 'loading' && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: 40 }}>
                    <Spinner size={24} />
                    <div style={{
                      fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '1.4px',
                      textTransform: 'uppercase', color: 'var(--text-mid)',
                    }}>Rendering drawing</div>
                  </div>
                )}

                {markupState === 'error' && (
                  <div style={{ padding: 24, fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)' }}>
                    The drawing could not be rendered here. Open the PDF to view it.
                  </div>
                )}

                {markupUrl && markupState === 'idle' && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={markupUrl} alt={`${note.drawing.title} with this note's markup`}
                    style={{ width: '100%', display: 'block', background: 'white' }}
                  />
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 26px', borderTop: '1px solid var(--border-line)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          background: 'var(--paper)',
        }}>
          {note.inspectionId && onOpenReport ? (
            <button
              onClick={onOpenReport}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                background: 'none', border: 'none', cursor: 'pointer',
                fontFamily: 'var(--f-heading)', fontSize: 13.5, fontWeight: 700, color: 'var(--indigo)',
              }}
            >
              Open the report this note is in
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </button>
          ) : <span />}

          <button
            onClick={() => onToggleStatus(isOpen ? 'CLOSED' : 'OPEN')}
            disabled={saving}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              background: isOpen ? 'var(--sage-soft)' : 'var(--surface)',
              color: isOpen ? 'var(--sage-ink)' : 'var(--text-mid)',
              border: `1px solid ${isOpen ? 'var(--sage)' : 'var(--border-line)'}`,
              borderRadius: 'var(--radius-pill)', padding: '9px 18px',
              fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700,
              cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1,
            }}
          >
            {isOpen ? (
              <>
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>
                Mark as closed
              </>
            ) : (
              <>
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>
                Reopen
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
