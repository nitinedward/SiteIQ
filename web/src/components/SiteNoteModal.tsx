'use client'
import { useEffect, useState } from 'react'
import { Spinner } from '@/components/Shell'
import {
  SiteNote, NoteStatus, NoteResponse, formatNoteDate, measurementLabel,
  loadNoteResponses, addNoteResponse, deleteNoteResponse, isImageResponse,
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
  // Several files can be queued at once — dropping a handful of photos of
  // the remedial work is the common case. Each becomes its own response,
  // since a response row carries one file.
  const [files, setFiles]               = useState<File[]>([])
  const [dragging, setDragging]         = useState(false)
  const [savingResponse, setSavingResponse] = useState(false)
  const [responseError, setResponseError]   = useState('')

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
        if (!cancelled) setResponseError('Could not load the responses on this note.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [note.id])

  const addFiles = (incoming: FileList | File[] | null) => {
    const list = Array.from(incoming ?? [])
    if (list.length === 0) return
    setFiles(curr => [...curr, ...list])
    setResponseError('')
  }

  const saveResponse = async (alsoClose: boolean) => {
    setResponseError('')
    setSavingResponse(true)

    // Saved one at a time so a single failure part-way through still keeps
    // whatever already landed, rather than the list disagreeing with the
    // database. The comment goes on the first response of the batch.
    const created: NoteResponse[] = []
    try {
      if (files.length === 0) {
        created.push(await addNoteResponse({ observationId: note.id, comment }))
      } else {
        for (let i = 0; i < files.length; i++) {
          created.push(await addNoteResponse({
            observationId: note.id,
            comment: i === 0 ? comment : '',
            file: files[i],
          }))
        }
      }
      setComment('')
      setFiles([])
      if (alsoClose && note.status === 'OPEN') onToggleStatus('CLOSED')
    } catch (err: any) {
      setResponseError(err?.message ?? 'Could not save the response.')
      // Anything that did save stays queued out of the file list.
      setFiles(curr => curr.slice(created.length))
      if (created.length > 0) setComment('')
    } finally {
      if (created.length > 0) {
        const next = [...responses, ...created]
        setResponses(next)
        onResponsesChanged?.(note.id, next.length)
      }
      setSavingResponse(false)
    }
  }

  const removeResponse = async (id: string) => {
    if (!confirm('Remove this response?')) return
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
        // Files can be dropped anywhere on an open note, not just on the
        // attach button — dragging a photo or a PDF straight onto the note
        // is the quickest way to record what came back from site.
        onDragOver={e => {
          if (tableMissing) return
          e.preventDefault()
          if (!dragging) setDragging(true)
        }}
        onDragLeave={e => { if (e.currentTarget === e.target) setDragging(false) }}
        onDrop={e => {
          if (tableMissing) return
          e.preventDefault()
          setDragging(false)
          addFiles(e.dataTransfer?.files ?? null)
        }}
        style={{
          position: 'relative',
          background: 'var(--surface)', border: '1px solid var(--border-line)',
          borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-card-v3)',
          width: 'min(920px, 100%)', maxHeight: '90vh',
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

          {/* What came back from site — the contractor's reply, a photo of
              the remedial work, an email or a PDF. Saving one can close the
              note in the same click, which is the usual way a note ends. */}
          <div style={{ marginTop: 24 }}>
            <div style={sectionTitle}>Response ({responses.length})</div>

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
                          <button
                            onClick={() => removeResponse(r.id)}
                            title="Remove this response"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-mid)', fontSize: 13, padding: 2 }}
                          >✕</button>
                        </div>

                        {r.comment && (
                          <div style={{
                            fontFamily: 'var(--f-text)', fontSize: 14, lineHeight: 1.6,
                            color: 'var(--text-ink)', marginTop: 6, whiteSpace: 'pre-wrap',
                          }}>{r.comment}</div>
                        )}

                        {r.fileUrl && (
                          isImageResponse(r) ? (
                            <a href={r.fileUrl} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: 10 }}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={r.fileUrl} alt={r.fileName ?? 'Response attachment'}
                                style={{
                                  maxWidth: 260, width: '100%', borderRadius: 'var(--radius-sm, 10px)',
                                  border: '1px solid var(--border-line)', display: 'block',
                                }}
                              />
                            </a>
                          ) : (
                            <a
                              href={r.fileUrl} target="_blank" rel="noreferrer"
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 10,
                                background: 'var(--surface)', border: '1px solid var(--border-line)',
                                borderRadius: 'var(--radius-pill)', padding: '7px 14px',
                                fontFamily: 'var(--f-heading)', fontSize: 12.5, fontWeight: 700,
                                color: 'var(--indigo)', textDecoration: 'none',
                              }}
                            >
                              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                              {r.fileName ?? 'Attachment'}
                            </a>
                          )
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div style={{
                  border: '1px solid var(--border-line)', borderRadius: 'var(--radius-md, 14px)',
                  padding: '14px 16px', background: 'var(--surface)',
                }}>
                  <textarea
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
                        : files.length > 1 ? `Save ${files.length} responses` : 'Save response'}
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
                    {files.length > 1 && ' — each file is saved as its own response, with your note on the first'}.
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
      </div>
    </div>
  )
}
