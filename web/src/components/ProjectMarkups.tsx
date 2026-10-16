'use client'
import { useEffect, useMemo, useState } from 'react'
import { shapeSpace } from '@/lib/zoneHotspots'
import { noteRefLabel } from '@/lib/noteRefs'
import { SiteNote, NoteStatus, formatNoteDate } from '@/lib/siteNotes'
import PhotoViewer from '@/components/PhotoViewer'

/**
 * Mark-ups tab: every drawing on the project as a thumbnail strip, and the
 * chosen one with all its site notes' mark-ups drawn on it — open in clay,
 * closed in sage — beside the selected note's details.
 *
 * The drawing shown is the preview image the phone marks up on, so shapes
 * are placed in that image's own space (shapeSpace) and land exactly where
 * they were drawn on site. Notes come from the project page's site-note
 * list, so closing one here updates the Site Notes tab and its count too.
 */

export type MarkupDrawing = {
  id: string
  title: string
  number: string
  revision: string
  file_url: string
  preview_url?: string | null
}

type Filter = 'all' | 'open' | 'closed'

const ZOOMS = [50, 75, 100, 125, 150, 200, 300]

const tone = (status: NoteStatus) => status === 'OPEN'
  ? { stroke: 'var(--clay)', soft: 'var(--clay-soft)', ink: 'var(--clay-ink)', fill: 'rgba(229,115,91,.14)' }
  : { stroke: 'var(--sage)', soft: 'var(--sage-soft)', ink: 'var(--sage-ink)', fill: 'rgba(91,146,121,.14)' }

const refLabel = (n: SiteNote) => noteRefLabel(n.ref) ?? 'Note'

export default function ProjectMarkups({
  drawings, notes, savingNoteId, onToggleStatus, onOpenNote, onOpenReport,
}: {
  drawings: MarkupDrawing[]
  notes: SiteNote[]
  savingNoteId: string | null
  onToggleStatus: (noteId: string, next: NoteStatus) => void
  onOpenNote: (noteId: string) => void
  onOpenReport: (inspectionId: string) => void
}) {
  // Notes with a mark-up, by the drawing it's on.
  const notesByDrawing = useMemo(() => {
    const map = new Map<string, SiteNote[]>()
    for (const n of notes) {
      const id = n.zone?.drawing_id
      if (!id) continue
      if (!map.has(id)) map.set(id, [])
      map.get(id)!.push(n)
    }
    return map
  }, [notes])

  const [drawingId, setDrawingId] = useState<string | null>(null)
  const [filter, setFilter]       = useState<Filter>('all')
  const [report, setReport]       = useState<string>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [zoom, setZoom]           = useState(100)
  const [natural, setNatural]     = useState<{ w: number; h: number } | null>(null)

  // Start on the first drawing that has mark-ups.
  useEffect(() => {
    if (drawingId && drawings.some(d => d.id === drawingId)) return
    const first = drawings.find(d => notesByDrawing.has(d.id)) ?? drawings[0]
    setDrawingId(first?.id ?? null)
  }, [drawings, notesByDrawing, drawingId])

  const drawing = drawings.find(d => d.id === drawingId) ?? null
  const onDrawing = drawing ? notesByDrawing.get(drawing.id) ?? [] : []

  const reportOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const n of onDrawing) {
      if (n.inspectionId && !seen.has(n.inspectionId)) seen.set(n.inspectionId, n.reportNo ? `SR ${n.reportNo}` : 'Report')
    }
    return [...seen.entries()].sort((a, b) => b[1].localeCompare(a[1], undefined, { numeric: true }))
  }, [onDrawing])

  const byReport = onDrawing.filter(n => report === 'all' || n.inspectionId === report)
  const counts = {
    all: byReport.length,
    open: byReport.filter(n => n.status === 'OPEN').length,
    closed: byReport.filter(n => n.status === 'CLOSED').length,
  }
  const visible = byReport
    .filter(n => filter === 'all' || (filter === 'open' ? n.status === 'OPEN' : n.status === 'CLOSED'))
    .sort((a, b) => (a.ref ?? 0) - (b.ref ?? 0))
  const selected = visible.find(n => n.id === selectedId) ?? null

  const pickDrawing = (id: string) => {
    if (id === drawingId) return
    setDrawingId(id)
    setReport('all')
    setFilter('all')
    setSelectedId(null)
    setNatural(null)
  }

  // Keep a valid selection: the first visible note when the current one drops out.
  useEffect(() => {
    if (selectedId && visible.some(n => n.id === selectedId)) return
    setSelectedId(visible[0]?.id ?? null)
  }, [visible, selectedId])

  if (drawings.length === 0) {
    return <Empty text="No drawings on this project yet. Upload them on the Drawings tab, then mark them up on site." />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* ── Drawing strip ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700, color: 'var(--text-ink)' }}>
          Project drawings <span style={{ color: 'var(--text-mid)', fontWeight: 500 }}>({drawings.length})</span>
        </div>
        <div style={{ display: 'flex', gap: 10, overflowX: 'auto', padding: '2px 2px 10px', scrollSnapType: 'x proximity' }}>
          {drawings.map(d => {
            const ns = notesByDrawing.get(d.id) ?? []
            const open = ns.filter(n => n.status === 'OPEN').length
            const on = d.id === drawingId
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => pickDrawing(d.id)}
                aria-pressed={on}
                title={`${d.number} · ${d.title}`}
                style={{
                  flex: '0 0 150px', width: 150, minWidth: 150, maxWidth: 150, boxSizing: 'border-box', overflow: 'hidden',
                  display: 'flex', flexDirection: 'column', gap: 8, padding: 8, textAlign: 'left',
                  borderRadius: 'var(--radius-md)', cursor: 'pointer', scrollSnapAlign: 'start',
                  background: on ? 'var(--indigo-soft)' : 'var(--white)',
                  border: on ? '2px solid var(--indigo)' : '1px solid var(--border-line)',
                }}
              >
                <div style={{
                  position: 'relative', width: 132, height: 93, flex: '0 0 93px', boxSizing: 'border-box',
                  background: 'var(--white)', border: '1px solid var(--border-line)', borderRadius: 6, overflow: 'hidden',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {d.preview_url
                    ? <img src={d.preview_url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    : <span style={{ fontSize: 11, color: 'var(--text-mid)' }}>No preview</span>}
                  {open > 0 && (
                    <span style={{
                      position: 'absolute', top: 5, right: 5, minWidth: 20, height: 20, padding: '0 6px', boxSizing: 'border-box',
                      borderRadius: 99, background: 'var(--clay)', color: '#fff', fontSize: 11, fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }} aria-label={`${open} open`}>{open}</span>
                  )}
                </div>
                <div style={{ width: 132, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, color: 'var(--text-mid)' }}>{d.number}</div>
                  <div style={{ fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700, color: 'var(--text-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</div>
                  <div style={{ fontFamily: 'var(--f-text)', fontSize: 12, color: 'var(--text-mid)' }}>
                    {ns.length ? `${ns.length} mark-up${ns.length === 1 ? '' : 's'} · ${open} open` : 'No mark-ups yet'}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {drawing && (
        <div style={{ background: 'var(--white)', border: '1px solid var(--border-line)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>

          {/* ── Toolbar ── */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border-line)' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
              <div role="group" aria-label="Show site notes" style={{ display: 'inline-flex', background: 'var(--paper)', borderRadius: 99, padding: 4, gap: 2 }}>
                {(['all', 'open', 'closed'] as Filter[]).map(f => (
                  <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f} style={{
                    border: 'none', borderRadius: 99, padding: '0 14px', minHeight: 34, cursor: 'pointer',
                    fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700,
                    background: filter === f ? 'var(--indigo)' : 'transparent',
                    color: filter === f ? '#fff' : 'var(--text-mid)',
                  }}>{f === 'all' ? 'All' : f === 'open' ? 'Open' : 'Closed'} ({counts[f]})</button>
                ))}
              </div>
              <label style={{ display: 'inline-flex', alignItems: 'center' }}>
                <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Site report</span>
                <select value={report} onChange={e => setReport(e.target.value)} style={{
                  fontFamily: 'var(--f-text)', fontSize: 13, minHeight: 38, padding: '0 10px',
                  border: '1px solid var(--border-line)', borderRadius: 10, background: 'var(--white)', color: 'var(--text-ink)',
                }}>
                  <option value="all">All site reports</option>
                  {reportOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </label>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <IconBtn label="Zoom out" onClick={() => setZoom(z => ZOOMS[Math.max(0, ZOOMS.indexOf(z) - 1)])}>−</IconBtn>
              <span style={{ fontFamily: 'var(--f-mono)', fontSize: 12.5, minWidth: 46, textAlign: 'center' }}>{zoom}%</span>
              <IconBtn label="Zoom in" onClick={() => setZoom(z => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + 1)])}>+</IconBtn>
              <button type="button" onClick={() => setZoom(100)} style={{
                minHeight: 36, padding: '0 14px', borderRadius: 99, border: '1px solid var(--border-line)', background: 'var(--white)',
                fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700, color: 'var(--text-ink)', cursor: 'pointer',
              }}>Fit</button>
              <a href={drawing.file_url} target="_blank" rel="noreferrer" style={{
                marginLeft: 4, fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700, color: 'var(--indigo)', textDecoration: 'none', padding: '0 8px',
              }}>Open PDF ↗</a>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap' }}>

            {/* ── Drawing ── */}
            <div style={{ flex: '999 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border-line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 16px' }}>
                <div style={{ fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700, color: 'var(--text-ink)' }}>{drawing.number} · {drawing.title}</div>
                <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--text-mid)' }}>Rev {drawing.revision}</div>
              </div>
              <div style={{ background: 'var(--paper)', padding: 16, overflow: 'auto', maxHeight: '72vh' }}>
                {drawing.preview_url ? (
                  <div style={{ position: 'relative', width: `${zoom}%`, minWidth: zoom > 100 ? 600 * zoom / 100 : undefined, margin: '0 auto', background: '#fff', boxShadow: 'var(--shadow-card)' }}>
                    <img
                      src={drawing.preview_url}
                      alt={`${drawing.number} ${drawing.title}`}
                      onLoad={e => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                      style={{ display: 'block', width: '100%', height: 'auto' }}
                    />
                    {natural && (
                      <MarkupLayer
                        notes={visible}
                        width={natural.w}
                        height={natural.h}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                      />
                    )}
                  </div>
                ) : (
                  <Empty text="This drawing has no preview image yet, so its mark-ups can't be shown here. Open the PDF instead." />
                )}
              </div>

              {/* ── Notes on this drawing ── */}
              <div style={{ padding: '14px 16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div style={{ fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700, color: 'var(--text-ink)' }}>Site notes on this drawing</div>
                  <div style={{ fontFamily: 'var(--f-text)', fontSize: 12.5, color: 'var(--text-mid)' }}>{visible.length} {visible.length === 1 ? 'item' : 'items'}</div>
                </div>
                {visible.length === 0 ? (
                  <div style={{ fontFamily: 'var(--f-text)', fontSize: 13.5, color: 'var(--text-mid)' }}>
                    {onDrawing.length === 0 ? 'No site notes have been marked on this drawing yet.' : 'No site notes match these filters.'}
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 8 }}>
                    {visible.map(n => {
                      const on = n.id === selectedId
                      return (
                        <button key={n.id} type="button" onClick={() => setSelectedId(n.id)} aria-pressed={on} style={{
                          display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', textAlign: 'left', cursor: 'pointer',
                          borderRadius: 'var(--radius-md)', background: on ? 'var(--indigo-soft)' : 'var(--white)',
                          border: on ? '1.5px solid var(--indigo)' : '1px solid var(--border-line)', minWidth: 0,
                        }}>
                          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: tone(n.status).stroke, marginTop: 6, flex: '0 0 8px' }} />
                          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                            <span style={{ fontFamily: 'var(--f-heading)', fontSize: 13.5, fontWeight: 700, color: 'var(--text-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {refLabel(n)} · {n.zoneLabel}
                            </span>
                            <span style={{ fontFamily: 'var(--f-text)', fontSize: 12, color: 'var(--text-mid)' }}>
                              {n.reportNo ? `SR ${n.reportNo}` : 'No report'} · {n.photos.length} photo{n.photos.length === 1 ? '' : 's'}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* ── Selected note ── */}
            <aside aria-label="Selected site note" style={{ flex: '1 1 300px', minWidth: 0, maxWidth: '100%', padding: 18, boxSizing: 'border-box' }}>
              {selected ? (
                <NotePanel
                  note={selected}
                  saving={savingNoteId === selected.id}
                  onToggleStatus={next => onToggleStatus(selected.id, next)}
                  onOpenNote={() => onOpenNote(selected.id)}
                  onOpenReport={selected.inspectionId ? () => onOpenReport(selected.inspectionId!) : undefined}
                />
              ) : (
                <div style={{ fontFamily: 'var(--f-text)', fontSize: 13.5, color: 'var(--text-mid)', padding: '40px 0', textAlign: 'center' }}>
                  Select a site note on the drawing to see its details.
                </div>
              )}
            </aside>
          </div>
        </div>
      )}
    </div>
  )
}

/** The mark-ups over the drawing image, in the image's own pixel space. */
function MarkupLayer({ notes, width, height, selectedId, onSelect }: {
  notes: SiteNote[]
  width: number
  height: number
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  // Line weights and pin size relative to the sheet, so they read the same
  // on any drawing size and at any zoom.
  const unit = Math.max(width, height) / 1000
  const shapes = notes.map(n => {
    const z = n.zone!
    const t = tone(n.status)
    const on = n.id === selectedId
    const [sw, sh] = shapeSpace(z, width, height)
    let anchor = { x: (z.x_percent / 100) * width, y: (z.y_percent / 100) * height }
    let el: React.ReactNode = null
    const common = {
      onClick: () => onSelect(n.id),
      style: { cursor: 'pointer', stroke: t.stroke, fill: t.fill } as React.CSSProperties,
      strokeWidth: (on ? 4 : 2.5) * unit,
    }
    try {
      if (z.markup_type === 'rectangle' && z.shape_data) {
        const r = JSON.parse(z.shape_data)
        const x = (r.x / sw) * width, y = (r.y / sh) * height
        const w = (r.width / sw) * width, h = (r.height / sh) * height
        el = <rect x={x} y={y} width={w} height={h} {...common} />
        anchor = { x: x + w / 2, y }
      } else if (z.markup_type === 'freehand' && z.shape_data) {
        const pts: { x: number; y: number }[] = JSON.parse(z.shape_data)
        if (pts.length >= 2) {
          const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(p.x / sw) * width} ${(p.y / sh) * height}`).join(' ')
          el = <path d={d} {...common} style={{ ...common.style, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }} strokeWidth={(on ? 5 : 3.5) * unit} />
          anchor = { x: anchor.x, y: Math.min(...pts.map(p => (p.y / sh) * height)) }
        }
      }
    } catch { /* unreadable shape: shown as a pin */ }
    if (!el) {
      el = <circle cx={anchor.x} cy={anchor.y} r={9 * unit} {...common} />
      anchor = { x: anchor.x, y: anchor.y - 9 * unit }
    }
    return { n, t, on, el, anchor }
  })

  return (
    <>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}
      >
        {shapes.map(s => <g key={s.n.id}>{s.el}</g>)}
      </svg>
      {shapes.map(s => (
        <button
          key={s.n.id}
          type="button"
          onClick={() => onSelect(s.n.id)}
          aria-pressed={s.on}
          style={{
            position: 'absolute', left: `${(s.anchor.x / width) * 100}%`, top: `${(s.anchor.y / height) * 100}%`,
            transform: 'translate(-50%, calc(-100% - 4px))', whiteSpace: 'nowrap', cursor: 'pointer',
            fontFamily: 'var(--f-heading)', fontSize: 11, fontWeight: s.on ? 800 : 700, color: s.t.ink,
            background: s.t.soft, border: `${s.on ? 2 : 1}px solid ${s.t.stroke}`, borderRadius: 99, padding: '2px 9px',
            boxShadow: s.on ? '0 2px 8px rgba(31,38,51,.22)' : 'none', zIndex: s.on ? 2 : 1,
          }}
        >
          {refLabel(s.n)} · {s.n.zoneLabel}
        </button>
      ))}
    </>
  )
}

function NotePanel({ note, saving, onToggleStatus, onOpenNote, onOpenReport }: {
  note: SiteNote
  saving: boolean
  onToggleStatus: (next: NoteStatus) => void
  onOpenNote: () => void
  onOpenReport?: () => void
}) {
  const [viewing, setViewing] = useState<number | null>(null)
  // A different note selected: don't carry the open viewer over to it.
  useEffect(() => { setViewing(null) }, [note.id])
  const t = tone(note.status)
  const text = note.reportText || note.description
  const shown = note.photos.slice(0, 6)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--text-mid)' }}>
          {refLabel(note)}{note.reportNo ? ` · SR ${note.reportNo}` : ''} · {formatNoteDate(note)}
        </div>
        <div style={{ fontFamily: 'var(--f-heading)', fontSize: 20, fontWeight: 800, color: 'var(--text-ink)' }}>{note.zoneLabel}</div>
        <span style={{ alignSelf: 'flex-start', background: t.soft, color: t.ink, fontFamily: 'var(--f-heading)', fontSize: 12, fontWeight: 700, padding: '3px 11px', borderRadius: 99 }}>
          ● {note.status === 'OPEN' ? 'Open' : 'Closed'}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700, color: 'var(--text-ink)' }}>
          {note.reportText ? 'In the report' : 'Recorded on site'}
        </div>
        <p style={{ margin: 0, fontFamily: 'var(--f-text)', fontSize: 14, lineHeight: 1.6, color: 'var(--text-ink)', whiteSpace: 'pre-wrap' }}>
          {text || <span style={{ color: 'var(--text-mid)' }}>Nothing was dictated for this note.</span>}
        </p>
      </div>

      {note.photos.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700, color: 'var(--text-ink)' }}>
            Photos <span style={{ color: 'var(--text-mid)', fontWeight: 500 }}>({note.photos.length})</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
            {shown.map((url, i) => (
              <button key={url} type="button" onClick={() => setViewing(i)} aria-label={`View photo ${i + 1} of ${note.photos.length}`} style={{ display: 'block', aspectRatio: '1', padding: 0, border: 'none', borderRadius: 8, overflow: 'hidden', background: 'var(--paper)', cursor: 'zoom-in' }}>
                <img src={url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </button>
            ))}
          </div>
          {note.photos.length > shown.length && (
            <button type="button" onClick={() => setViewing(shown.length)} style={{ alignSelf: 'flex-start', border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--f-text)', fontSize: 12.5, color: 'var(--indigo)' }}>
              +{note.photos.length - shown.length} more — view all
            </button>
          )}
        </div>
      )}

      {viewing !== null && (
        <PhotoViewer
          photos={note.photos}
          startIndex={viewing}
          title={`${refLabel(note)} · ${note.zoneLabel}`}
          subtitle={note.reportNo ? `SR ${note.reportNo} · ${formatNoteDate(note)}` : formatNoteDate(note)}
          onClose={() => setViewing(null)}
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {onOpenReport && (
          <button type="button" onClick={onOpenReport} style={primaryBtn}>
            View site report{note.reportNo ? ` SR ${note.reportNo}` : ''} ↗
          </button>
        )}
        <button type="button" onClick={onOpenNote} style={secondaryBtn}>Open site note (comments, files)</button>
        <button
          type="button"
          disabled={saving}
          onClick={() => onToggleStatus(note.status === 'OPEN' ? 'CLOSED' : 'OPEN')}
          style={{ ...secondaryBtn, opacity: saving ? 0.6 : 1, cursor: saving ? 'wait' : 'pointer' }}
        >
          {saving ? 'Saving…' : note.status === 'OPEN' ? '✓ Close site note' : 'Reopen site note'}
        </button>
      </div>
    </div>
  )
}

const primaryBtn: React.CSSProperties = {
  minHeight: 44, borderRadius: 99, border: 'none', background: 'var(--indigo)', color: '#fff',
  fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700, cursor: 'pointer',
}
const secondaryBtn: React.CSSProperties = {
  minHeight: 44, borderRadius: 99, border: '1px solid var(--border-line)', background: 'var(--white)', color: 'var(--text-ink)',
  fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700, cursor: 'pointer',
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} style={{
      width: 36, height: 36, border: 'none', background: 'transparent', borderRadius: 10, cursor: 'pointer',
      fontSize: 18, color: 'var(--text-ink)',
    }}>{children}</button>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ padding: '32px 16px', textAlign: 'center', fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)' }}>{text}</div>
  )
}
