'use client'
import { useEffect, useRef, useState } from 'react'
import { Spinner } from '@/components/Shell'
import {
  SiteNote, NoteStatus, NoteResponse, formatNoteDate, measurementLabel,
  loadNoteResponses, addNoteResponse, deleteNoteResponse, isImageFile, isViewableFile,
  MAX_RESPONSE_FILE_BYTES,
} from '@/lib/siteNotes'

/** The full site note: what was dictated on site, the photos taken, anything
 *  measured, and the drawing with this note's markup rendered on it — the
 *  same view of an observation the report gives, without opening the report.
 *
 *  The drawing is rendered in the browser with the same routine the report
 *  uses to put marked-up drawings into the .docx, so the pin here is exactly
 *  the pin that ends up in the document. */
export function SiteNoteModal({
  note, saving, onClose, onToggleStatus, onOpenReport, onResponsesChanged,
}: {
  note: SiteNote
  saving: boolean
  onClose: () => void
  onToggleStatus: (next: NoteStatus) => void
  onOpenReport?: () => void
  /** Keeps the list row's response count in step with what's added here. */
  onResponsesChanged?: (noteId: string, count: number) => void
}) {
  const [markupUrl, setMarkupUrl]   = useState<string | null>(null)
  const [markupState, setMarkupState] = useState<'idle' | 'loading' | 'error'>('idle')

  const [responses, setResponses]       = useState<NoteResponse[]>([])
  const [loadingResponses, setLoading]  = useState(true)
  const [tableMissing, setTableMissing] = useState(false)
  const [comment, setComment]           = useState('')
  // Files queued against the comment being written — they are saved with
  // it as one entry, not as uploads of their own.
  const [files, setFiles]               = useState<File[]>([])
  const [dragging, setDragging]         = useState(false)
  // The comment box is opened by the + rather than sitting there empty.
  const [composing, setComposing]       = useState(false)
  // Thumbnails that failed to load — the file link stays regardless.
  const [brokenThumbs, setBrokenThumbs] = useState<Record<string, boolean>>({})
  const [savingResponse, setSavingResponse] = useState(false)
  const [responseError, setResponseError]   = useState('')

  // ── Window position and size ──────────────────────────────────────────
  // A note is something you read against the report or the drawing beside
  // it, so it opens centred and can then be dragged by its header and
  // resized from its bottom-right corner.
  const MIN_W = 420
  const MIN_H = 360
  const [box, setBox] = useState(() => {
    if (typeof window === 'undefined') return { x: 40, y: 40, w: 920, h: 700 }
    const w = Math.min(920, window.innerWidth - 40)
    const h = Math.min(Math.round(window.innerHeight * 0.9), window.innerHeight - 40)
    return { x: Math.max(20, (window.innerWidth - w) / 2), y: Math.max(20, (window.innerHeight - h) / 2), w, h }
  })
  const dragFrom   = useRef<{ dx: number; dy: number } | null>(null)
  const resizeFrom = useRef<{ x: number; y: number; w: number; h: number } | null>(null)

  const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

  const startDrag = (e: React.PointerEvent) => {
    // Buttons in the header keep working — only bare header space drags.
    if ((e.target as HTMLElement).closest('button')) return
    dragFrom.current = { dx: e.clientX - box.x, dy: e.clientY - box.y }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onDragMove = (e: React.PointerEvent) => {
    if (!dragFrom.current) return
    setBox(b => ({
      ...b,
      // Always leave a strip on screen to drag it back by.
      x: clamp(e.clientX - dragFrom.current!.dx, 60 - b.w, window.innerWidth - 60),
      y: clamp(e.clientY - dragFrom.current!.dy, 0, window.innerHeight - 60),
    }))
  }

  const endDrag = (e: React.PointerEvent) => {
    dragFrom.current = null
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* already released */ }
  }

  const startResize = (e: React.PointerEvent) => {
    e.stopPropagation()
    resizeFrom.current = { x: e.clientX, y: e.clientY, w: box.w, h: box.h }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onResizeMove = (e: React.PointerEvent) => {
    const from = resizeFrom.current
    if (!from) return
    setBox(b => ({
      ...b,
      w: clamp(from.w + (e.clientX - from.x), MIN_W, window.innerWidth - b.x - 10),
      h: clamp(from.h + (e.clientY - from.y), MIN_H, window.innerHeight - b.y - 10),
    }))
  }

  const endResize = (e: React.PointerEvent) => {
    resizeFrom.current = null
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* already released */ }
  }

  // Keep it reachable if the browser window shrinks under it.
  useEffect(() => {
    const onResize = () => setBox(b => ({
      x: clamp(b.x, 60 - b.w, window.innerWidth - 60),
      y: clamp(b.y, 0, window.innerHeight - 60),
      w: Math.min(b.w, window.innerWidth - 20),
      h: Math.min(b.h, window.innerHeight - 20),
    }))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

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

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadNoteResponses(note.id)
      .then(({ responses: rows, tableMissing: missing }) => {
        if (cancelled) return
        setResponses(rows)
        setTableMissing(missing)
      })
      .catch(err => {
        console.error('[siteNote] could not load responses:', err)
        if (!cancelled) setResponseError('Could not load the comments on this note.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [note.id])

  const addFiles = (incoming: FileList | File[] | null) => {
    const list = Array.from(incoming ?? [])
    if (list.length === 0) return
    setFiles(curr => [...curr, ...list])
    // Dropping a file IS asking to comment, so the box opens with it rather
    // than the file queueing somewhere the user can't see.
    setComposing(true)
    setResponseError('')
  }

  // One comment and the files attached to it are saved as a single entry in
  // the note's history — the files belong to what was said, rather than
  // arriving as separate uploads of their own.
  const saveResponse = async (alsoClose: boolean) => {
    setResponseError('')
    setSavingResponse(true)
    try {
      const created = await addNoteResponse({ observationId: note.id, comment, files })
      const next = [...responses, created]
      setResponses(next)
      onResponsesChanged?.(note.id, next.length)
      setComment('')
      setFiles([])
      setComposing(false)
      if (alsoClose && note.status === 'OPEN') onToggleStatus('CLOSED')
    } catch (err: any) {
      setResponseError(err?.message ?? 'Could not save the comment.')
    } finally {
      setSavingResponse(false)
    }
  }

  const removeResponse = async (id: string) => {
    if (!confirm('Remove this comment and its files?')) return
    try {
      await deleteNoteResponse(id)
      const next = responses.filter(r => r.id !== id)
      setResponses(next)
      onResponsesChanged?.(note.id, next.length)
    } catch (err: any) {
      setResponseError(err?.message ?? 'Could not remove the response.')
    }
  }

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
        const { blob } = await captureDrawingWithMarkup(note.drawing!.file_url, [note.zone!] as any[], 1)
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
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Site note — ${note.zoneLabel}`}
        // Files can be dropped anywhere on an open note, not just on the
        // attach button — dragging a photo or a PDF straight onto the note
        // is the quickest way to record what came back from site.
        onDragOver={e => {
          if (tableMissing || !isOpen) return
          e.preventDefault()
          if (!dragging) setDragging(true)
        }}
        onDragLeave={e => { if (e.currentTarget === e.target) setDragging(false) }}
        onDrop={e => {
          // A closed note takes nothing — including a dropped file, which
          // would otherwise vanish with no explanation.
          if (tableMissing || !isOpen) return
          e.preventDefault()
          setDragging(false)
          addFiles(e.dataTransfer?.files ?? null)
        }}
        style={{
          position: 'fixed',
          left: box.x, top: box.y, width: box.w, height: box.h,
          background: 'var(--surface)', border: '1px solid var(--border-line)',
          borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-card-v3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          outline: dragging ? '2px dashed var(--indigo)' : 'none', outlineOffset: -10,
        }}
      >
        {dragging && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 5,
            background: 'rgba(237,242,251,.92)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
            pointerEvents: 'none', borderRadius: 'var(--radius-xl)',
          }}>
            <svg width="30" height="30" fill="none" stroke="var(--indigo)" strokeWidth="1.7" viewBox="0 0 24 24">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <div style={{ fontFamily: 'var(--f-heading)', fontSize: 15, fontWeight: 800, color: 'var(--indigo-deep)' }}>
              Drop to attach to this note
            </div>
            <div style={{ fontFamily: 'var(--f-text)', fontSize: 13, color: 'var(--indigo)' }}>
              Photos, PDFs, emails or documents
            </div>
          </div>
        )}
        {/* Header — also the handle the window is dragged by. */}
        <div
          onPointerDown={startDrag}
          onPointerMove={onDragMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          style={{
            padding: '22px 26px', borderBottom: '1px solid var(--border-line)',
            display: 'flex', alignItems: 'flex-start', gap: 16,
            cursor: dragFrom.current ? 'grabbing' : 'grab', touchAction: 'none',
          }}
        >
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

          {/* How the report puts it — shown beside the site note rather than
              replacing it, so what was observed and what was written stay
              separately readable. */}
          {note.reportText && (
            <div style={{ marginTop: 24 }}>
              <div style={sectionTitle}>As worded in the report</div>
              <div style={{
                background: 'var(--accent2, #edf2fb)',
                border: '1px solid var(--accent3, #dbeafe)',
                borderRadius: 'var(--radius-md, 14px)', padding: '16px 18px',
                fontFamily: 'var(--f-text)', fontSize: 15, lineHeight: 1.65,
                color: 'var(--text-ink)', whiteSpace: 'pre-wrap',
              }}>
                {note.reportText}
              </div>
            </div>
          )}

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

          {/* What came back from site — the contractor's reply, a photo of
              the remedial work, an email or a PDF. Saving one can close the
              note in the same click, which is the usual way a note ends.
              A closed note is a record: it is read-only until reopened. */}
          <div style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
              <div style={{ ...sectionTitle, marginBottom: 0 }}>Comments ({responses.length})</div>
              {isOpen && !composing && !tableMissing && !loadingResponses && (
                <button
                  onClick={() => setComposing(true)}
                  title="Add a comment"
                  aria-label="Add a comment"
                  style={{
                    width: 30, height: 30, flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: 'var(--indigo-soft)', color: 'var(--indigo)',
                    border: 'none', borderRadius: '50%', cursor: 'pointer',
                    transition: 'background .15s, color .15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--indigo)'; e.currentTarget.style.color = '#fff' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--indigo-soft)'; e.currentTarget.style.color = 'var(--indigo)' }}
                >
                  <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                </button>
              )}
            </div>

            {!isOpen && !loadingResponses && !tableMissing && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 9,
                background: 'var(--sage-soft)', border: '1px solid var(--sage)',
                borderRadius: 'var(--radius-md, 14px)', padding: '12px 15px', marginBottom: 14,
              }}>
                <svg width="15" height="15" fill="none" stroke="var(--sage-ink)" strokeWidth="2" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                  <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                <span style={{ fontFamily: 'var(--f-text)', fontSize: 13.5, color: 'var(--sage-ink)', lineHeight: 1.5 }}>
                  This note is closed, so it’s locked. Reopen it to add a response or change anything.
                </span>
              </div>
            )}

            {loadingResponses ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}><Spinner size={20} /></div>
            ) : tableMissing ? (
              <div style={{
                background: 'var(--marigold-soft)', border: '1px solid var(--marigold)',
                borderRadius: 'var(--radius-md, 14px)', padding: '16px 18px',
              }}>
                <div style={{ fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700, color: 'var(--marigold-ink)' }}>
                  One-off setup needed
                </div>
                <div style={{ fontFamily: 'var(--f-text)', fontSize: 13.5, color: 'var(--marigold-ink)', marginTop: 6, lineHeight: 1.6 }}>
                  Responses need a table that isn’t in the database yet. Run <strong>web/sql/note_responses.sql</strong> once
                  in the Supabase SQL editor, then reopen this note.
                </div>
              </div>
            ) : (
              <>
                {responses.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
                    {responses.map(r => (
                      <div key={r.id} style={{
                        border: '1px solid var(--border-line)', borderRadius: 'var(--radius-md, 14px)',
                        background: 'var(--paper)', padding: '14px 16px',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, color: 'var(--text-mid)' }}>
                            {new Date(r.createdAt).toLocaleString('en-NZ', {
                              day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                          {isOpen && (
                            <button
                              onClick={() => removeResponse(r.id)}
                              title="Delete this comment and its files"
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: 5,
                                background: 'none', border: 'none', cursor: 'pointer',
                                fontFamily: 'var(--f-heading)', fontSize: 12, fontWeight: 700,
                                color: 'var(--text-mid)', padding: '2px 4px', borderRadius: 6,
                                transition: 'color .15s, background .15s',
                              }}
                              onMouseEnter={e => { e.currentTarget.style.color = 'var(--clay-ink)'; e.currentTarget.style.background = 'var(--clay-soft)' }}
                              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-mid)'; e.currentTarget.style.background = 'none' }}
                            >
                              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                              </svg>
                              Delete
                            </button>
                          )}
                        </div>

                        {r.comment && (
                          <div style={{
                            fontFamily: 'var(--f-text)', fontSize: 14, lineHeight: 1.6,
                            color: 'var(--text-ink)', marginTop: 6, whiteSpace: 'pre-wrap',
                          }}>{r.comment}</div>
                        )}

                        {r.files.length > 0 && (
                          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {r.files.map((f, i) => {
                              const thumbKey = `${r.id}:${i}`
                              return (
                                <div key={thumbKey}>
                                  {/* A thumbnail is a preview, not the only
                                      way in: the link below it is always
                                      there, so a file the browser can't
                                      render (or an image that fails to load)
                                      is still openable. */}
                                  {isImageFile(f) && !brokenThumbs[thumbKey] && (
                                    <a href={f.url} target="_blank" rel="noreferrer" style={{ display: 'block', marginBottom: 8 }}>
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={f.url} alt={f.name}
                                        onError={() => setBrokenThumbs(curr => ({ ...curr, [thumbKey]: true }))}
                                        style={{
                                          maxWidth: 260, width: '100%', borderRadius: 'var(--radius-sm, 10px)',
                                          border: '1px solid var(--border-line)', display: 'block',
                                        }}
                                      />
                                    </a>
                                  )}

                                  <a
                                    href={f.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    // Word, Excel and the like can't be shown
                                    // in a tab, so they're offered as a
                                    // download instead of a view that would
                                    // never appear.
                                    download={isViewableFile(f) ? undefined : (f.name || true)}
                                    style={{
                                      display: 'inline-flex', alignItems: 'center', gap: 7,
                                      background: 'var(--surface)', border: '1px solid var(--border-line)',
                                      borderRadius: 'var(--radius-pill)', padding: '7px 14px',
                                      fontFamily: 'var(--f-heading)', fontSize: 12.5, fontWeight: 700,
                                      color: 'var(--indigo)', textDecoration: 'none', maxWidth: '100%',
                                    }}
                                  >
                                    {isViewableFile(f) ? (
                                      <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                                    ) : (
                                      <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                    )}
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {isViewableFile(f) ? 'View' : 'Download'} {f.name || 'attachment'}
                                    </span>
                                  </a>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Nothing to write in until it's asked for: an open note
                    shows a + to start a comment, a closed one shows nothing
                    at all, since it's a record rather than a draft. */}
                {/* The + beside the heading is what opens a comment box —
                    nothing sits here waiting to be filled in. */}
                {isOpen && !composing && responses.length === 0 && (
                  <div style={{ fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)' }}>
                    No comments yet — use + to record what came back from site.
                  </div>
                )}

                {isOpen && composing && (
                <div style={{
                  border: '1px solid var(--border-line)', borderRadius: 'var(--radius-md, 14px)',
                  padding: '14px 16px', background: 'var(--surface)',
                }}>
                  <textarea
                    autoFocus
                    value={comment}
                    onChange={e => setComment(e.target.value)}
                    placeholder="What came back from site? e.g. contractor confirmed the bolts were replaced on 12 Sept."
                    rows={3}
                    style={{
                      width: '100%', resize: 'vertical',
                      fontFamily: 'var(--f-text)', fontSize: 14, lineHeight: 1.6, color: 'var(--text-ink)',
                      background: 'var(--paper)', border: '1px solid var(--border-line)',
                      borderRadius: 'var(--radius-sm, 10px)', padding: '11px 13px', outline: 'none',
                    }}
                    onFocus={e => { e.target.style.borderColor = 'var(--indigo)' }}
                    onBlur={e => { e.target.style.borderColor = 'var(--border-line)' }}
                  />

                  {files.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                      {files.map((f, i) => {
                        const tooBig = f.size > MAX_RESPONSE_FILE_BYTES
                        return (
                          <span key={`${f.name}-${i}`} style={{
                            display: 'inline-flex', alignItems: 'center', gap: 8, maxWidth: '100%',
                            background: tooBig ? 'var(--clay-soft)' : 'var(--paper)',
                            border: `1px solid ${tooBig ? 'rgba(229,115,91,.4)' : 'var(--border-line)'}`,
                            borderRadius: 'var(--radius-pill)', padding: '6px 12px',
                          }}>
                            <span style={{
                              fontFamily: 'var(--f-mono)', fontSize: 11.5,
                              color: tooBig ? 'var(--clay-ink)' : 'var(--text-mid)',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240,
                            }}>
                              {f.name} · {(f.size / 1e6).toFixed(1)} MB{tooBig ? ' · too large' : ''}
                            </span>
                            <button
                              onClick={() => setFiles(curr => curr.filter((_, idx) => idx !== i))}
                              title="Remove"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-mid)', fontSize: 13, padding: 0 }}
                            >✕</button>
                          </span>
                        )
                      })}
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
                    <label style={{
                      display: 'inline-flex', alignItems: 'center', gap: 7,
                      background: 'var(--paper)', border: '1px solid var(--border-line)',
                      borderRadius: 'var(--radius-pill)', padding: '8px 15px', cursor: 'pointer',
                      fontFamily: 'var(--f-heading)', fontSize: 12.5, fontWeight: 700, color: 'var(--text-ink)',
                    }}>
                      <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                      Attach files
                      <input
                        type="file"
                        multiple
                        onChange={e => { addFiles(e.target.files); e.target.value = '' }}
                        style={{ display: 'none' }}
                      />
                    </label>

                    <span style={{ fontFamily: 'var(--f-text)', fontSize: 12, color: 'var(--text-mid)' }}>
                      or drop them anywhere on this note
                    </span>

                    <span style={{ flex: 1 }} />

                    <button
                      onClick={() => { setComposing(false); setComment(''); setFiles([]); setResponseError('') }}
                      disabled={savingResponse}
                      style={{
                        background: 'none', border: 'none',
                        fontFamily: 'var(--f-heading)', fontSize: 12.5, fontWeight: 700,
                        color: 'var(--text-mid)', cursor: savingResponse ? 'not-allowed' : 'pointer',
                        padding: '9px 6px',
                      }}
                    >
                      Cancel
                    </button>

                    <button
                      onClick={() => saveResponse(false)}
                      disabled={savingResponse || saving}
                      style={{
                        background: 'var(--surface)', color: 'var(--text-ink)',
                        border: '1px solid var(--border-line)', borderRadius: 'var(--radius-pill)',
                        padding: '9px 18px', fontFamily: 'var(--f-heading)', fontSize: 12.5, fontWeight: 700,
                        cursor: savingResponse ? 'not-allowed' : 'pointer', opacity: savingResponse ? 0.6 : 1,
                      }}
                    >
                      {savingResponse
                        ? 'Saving…'
                        : files.length > 0
                          ? `Save comment with ${files.length} file${files.length === 1 ? '' : 's'}`
                          : 'Save comment'}
                    </button>

                    {isOpen && (
                      <button
                        onClick={() => saveResponse(true)}
                        disabled={savingResponse || saving}
                        style={{
                          background: 'var(--indigo)', color: '#fff', border: 'none',
                          borderRadius: 'var(--radius-pill)', padding: '9px 18px',
                          fontFamily: 'var(--f-heading)', fontSize: 12.5, fontWeight: 700,
                          cursor: savingResponse ? 'not-allowed' : 'pointer', opacity: savingResponse ? 0.6 : 1,
                        }}
                      >
                        {savingResponse ? 'Saving…' : 'Save and close note'}
                      </button>
                    )}
                  </div>

                  <div style={{ fontFamily: 'var(--f-text)', fontSize: 12, color: 'var(--text-mid)', marginTop: 10 }}>
                    Photos, PDFs, emails or documents up to {MAX_RESPONSE_FILE_BYTES / 1e6} MB each
                    {files.length > 0 && ' — they are saved with this comment as one entry'}.
                    Response files are kept with the note — they are not added to the report.
                  </div>

                  {responseError && (
                    <div style={{
                      marginTop: 10, background: 'var(--clay-soft)', color: 'var(--clay-ink)',
                      border: '1px solid rgba(229,115,91,.3)', borderRadius: 'var(--radius-sm, 10px)',
                      padding: '9px 12px', fontFamily: 'var(--f-text)', fontSize: 13,
                    }}>{responseError}</div>
                  )}
                </div>
                )}

                {!isOpen && responses.length === 0 && (
                  <div style={{ fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)' }}>
                    This note was closed without a response recorded against it.
                  </div>
                )}
              </>
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

        {/* Resize corner */}
        <div
          onPointerDown={startResize}
          onPointerMove={onResizeMove}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          title="Drag to resize"
          style={{
            position: 'absolute', right: 2, bottom: 2, width: 20, height: 20,
            cursor: 'nwse-resize', touchAction: 'none',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 3,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="var(--text-mid)" strokeWidth="1.4" aria-hidden="true">
            <path d="M11 5 5 11M11 9l-2 2"/>
          </svg>
        </div>
      </div>
    </div>
  )
}
