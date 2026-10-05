'use client'
import SketchDropZone, { type StagedSketch } from '@/components/SketchDropZone'
import { SKETCHES_SQL_FILE, sketchSummary, type Sketch } from '@/lib/sketches'
import SketchNoteLink from '@/components/SketchNoteLink'

/** A sketch as the report page holds it: ticked or not, and whether it has
 *  appeared since the report's sketch section was last written (attached to
 *  a site note elsewhere) — see lib/sketchSelection. */
export type ReportSketchItem = Sketch & { selected: boolean; isNew: boolean }

/** One of the report's site notes, numbered as the report lists them. */
export type ReportNote = { id: string; label: string; number: number }

/**
 * The Sketches block of the report page's attachments panel.
 *
 * Lists the report's sketches in the order the report prints them — by site
 * note, General last — with the S-number each will carry, so what is ticked
 * here reads the same as the report. Dropping files in adds them straight
 * to the report; ticks and moves are applied with "Update report".
 */
export default function ReportSketchesPanel({
  items, notes, tableMissing, readOnly, busy, dirty,
  onToggle, onUpdateReport, onAddFiles, onMove, onRename, onDelete,
}: {
  items: ReportSketchItem[]
  notes: ReportNote[]
  tableMissing: boolean
  readOnly: boolean
  busy: boolean
  /** Ticks differ from what the report holds. */
  dirty: boolean
  onToggle: (id: string) => void
  onUpdateReport: () => void
  onAddFiles: (staged: StagedSketch[]) => Promise<void>
  onMove: (id: string, observationId: string | null) => void | Promise<void>
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
}) {
  const noteOf = new Map(notes.map(n => [n.id, n]))
  const ordered = [...items].sort((a, b) =>
    (noteOf.get(a.observationId ?? '')?.number ?? Infinity) - (noteOf.get(b.observationId ?? '')?.number ?? Infinity) ||
    a.createdAt.localeCompare(b.createdAt)
  )
  // The numbers the report will print: ticked sketches, counted in order.
  const sNumber = new Map<string, number>()
  ordered.filter(s => s.selected).forEach((s, i) => sNumber.set(s.id, i + 1))

  const newTicked = items.filter(s => s.isNew && s.selected).length
  const noteOptions = [
    ...notes.map(n => ({ id: n.id as string | null, label: `Site note ${n.number}: ${n.label}` })),
    { id: null, label: 'General (not tied to a site note)' },
  ]

  const smallButton = {
    border: 'none', background: 'none', padding: 0, cursor: 'pointer',
    fontFamily: 'var(--f-text)', fontSize: 11, color: 'var(--indigo)',
  } as const

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700, color: 'var(--indigo-deep)' }}>
          Sketches
        </div>
        {items.length > 0 && (
          <div style={{ fontFamily: 'var(--f-text)', fontSize: 11, color: 'var(--text-mid)' }}>
            {sNumber.size} of {items.length} in report
          </div>
        )}
      </div>

      {tableMissing ? (
        <div style={{
          border: '1px solid var(--border-line)', borderRadius: 'var(--radius-md)', padding: '12px',
          fontFamily: 'var(--f-text)', fontSize: 12, color: 'var(--text-mid)', lineHeight: 1.5,
        }}>
          Sketches need a one-off database step: run <code>{SKETCHES_SQL_FILE}</code> in the Supabase SQL editor, then reload.
        </div>
      ) : (
        <>
          {newTicked > 0 && !readOnly && (
            <div style={{
              border: '1px solid var(--marigold-ink, #b7791f)', background: 'var(--marigold-soft, #fffaf0)',
              borderRadius: 'var(--radius-md)', padding: '8px 10px', marginBottom: 10,
              display: 'flex', alignItems: 'center', gap: 8,
              fontFamily: 'var(--f-text)', fontSize: 12, color: 'var(--text-ink)',
            }}>
              <div style={{ flex: 1 }}>
                {newTicked} new sketch{newTicked === 1 ? '' : 'es'} from site notes {newTicked === 1 ? "isn't" : "aren't"} in the report yet.
              </div>
              <button
                onClick={onUpdateReport}
                disabled={busy}
                style={{
                  border: 'none', borderRadius: 6, padding: '5px 10px', whiteSpace: 'nowrap',
                  background: busy ? 'var(--paper)' : 'var(--indigo)', color: busy ? 'var(--text-mid)' : 'white',
                  fontFamily: 'var(--f-heading)', fontSize: 11, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer',
                }}
              >
                Add to report
              </button>
            </div>
          )}

          {ordered.map(s => {
            const note = s.observationId ? noteOf.get(s.observationId) : undefined
            const n = sNumber.get(s.id)
            return (
              <div key={s.id} style={{
                border: `1.5px solid ${s.selected ? 'var(--sage)' : 'var(--border-line)'}`,
                background: s.selected ? 'var(--sage-soft)' : 'var(--surface)',
                borderRadius: 'var(--radius-md)', marginBottom: 8, overflow: 'hidden',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '10px 12px' }}>
                  <div
                    onClick={() => !readOnly && !busy && onToggle(s.id)}
                    title={s.selected ? 'In the report — click to leave it out' : 'Click to include it'}
                    style={{
                      width: 20, height: 20, borderRadius: 6, flexShrink: 0, marginTop: 1,
                      border: `2px solid ${s.selected ? 'var(--sage)' : 'var(--border-line)'}`,
                      background: s.selected ? 'var(--sage)' : 'var(--paper)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: readOnly || busy ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {s.selected && (
                      <svg width="10" height="10" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
                        <polyline points="20,6 9,17 4,12"/>
                      </svg>
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      fontFamily: 'var(--f-text)', fontSize: 12, fontWeight: 600, color: 'var(--text-ink)',
                    }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {n ? `S${n} · ` : ''}{s.title || s.fileName || 'Sketch'}
                      </span>
                      {s.isNew && (
                        <span style={{
                          flexShrink: 0, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
                          padding: '1px 5px', borderRadius: 4,
                          background: 'var(--marigold-soft, #fffaf0)', color: 'var(--marigold-ink, #b7791f)',
                        }}>New</span>
                      )}
                    </div>
                    <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--text-mid)', marginTop: 2 }}>
                      {sketchSummary(s)}
                    </div>

                    {readOnly ? (
                      <div style={{ fontFamily: 'var(--f-text)', fontSize: 11, color: 'var(--text-mid)', marginTop: 4 }}>
                        {note ? `Site note ${note.number}: ${note.label}` : 'General'}
                      </div>
                    ) : (
                      <SketchNoteLink
                        compact
                        value={s.observationId}
                        options={noteOptions}
                        onChange={noteId => onMove(s.id, noteId)}
                        disabled={busy}
                      />
                    )}

                    <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
                      <a href={s.fileUrl} target="_blank" rel="noreferrer" style={{ ...smallButton, textDecoration: 'none' }}>
                        Open original
                      </a>
                      {!readOnly && (
                        <>
                          <button
                            style={smallButton}
                            disabled={busy}
                            onClick={() => {
                              const next = window.prompt('Sketch title', s.title)
                              if (next !== null && next.trim() !== s.title) onRename(s.id, next)
                            }}
                          >Rename</button>
                          <button
                            style={{ ...smallButton, color: 'var(--rose-ink, #c53030)' }}
                            disabled={busy}
                            onClick={() => {
                              if (window.confirm(`Delete "${s.title || s.fileName || 'this sketch'}"? It is removed from its site note too, and from the report the next time it is updated.`)) {
                                onDelete(s.id)
                              }
                            }}
                          >Delete</button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {s.pages[0] && (
                  <div style={{ borderTop: '1px solid var(--border-line)', overflow: 'hidden', maxHeight: 110, background: 'white' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.pages[0].url} alt={s.title || 'Sketch'} style={{ width: '100%', display: 'block', objectFit: 'contain' }} />
                  </div>
                )}
              </div>
            )
          })}

          {dirty && !readOnly && (
            <button
              onClick={onUpdateReport}
              disabled={busy}
              style={{
                width: '100%', marginBottom: 10, border: 'none', borderRadius: 8, padding: '8px 12px',
                background: busy ? 'var(--paper)' : 'var(--indigo)', color: busy ? 'var(--text-mid)' : 'white',
                fontFamily: 'var(--f-heading)', fontSize: 12, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer',
              }}
            >
              Update sketches in report
            </button>
          )}

          {!readOnly && (
            <SketchDropZone
              noteOptions={noteOptions}
              submitLabel="Add to report"
              disabled={busy}
              onSubmit={onAddFiles}
            />
          )}

          {readOnly && items.length === 0 && (
            <div style={{ fontFamily: 'var(--f-text)', fontSize: 12, color: 'var(--text-mid)' }}>No sketches.</div>
          )}
        </>
      )}
    </div>
  )
}
