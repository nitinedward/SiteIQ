'use client'
import { useEffect, useState } from 'react'
import SketchDropZone, { type StagedSketch } from '@/components/SketchDropZone'
import { addSketch, deleteSketch, loadNoteSketches, sketchSummary, SKETCHES_SQL_FILE, type Sketch } from '@/lib/sketches'

/**
 * A site note's sketches, on the note itself (Site Notes tab).
 *
 * Attaching one here links it to this note; the next time the note's report
 * is opened it is there in the report's Sketches, ticked and marked new
 * (lib/sketchSelection). The report page lists the same sketches, so each
 * can be traced from either side.
 */
export default function NoteSketches({
  noteId, inspectionId, projectId, reportRef, sectionTitleStyle,
}: {
  noteId: string
  inspectionId: string | null
  projectId: string
  /** "Site Report 005", or null for a note outside a site visit. */
  reportRef: string | null
  sectionTitleStyle: React.CSSProperties
}) {
  const [sketches, setSketches] = useState<Sketch[]>([])
  const [loading, setLoading] = useState(true)
  const [tableMissing, setTableMissing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadNoteSketches([noteId])
      .then(({ byNote, tableMissing }) => {
        if (cancelled) return
        setSketches(byNote.get(noteId) ?? [])
        setTableMissing(tableMissing)
      })
      .catch(err => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [noteId])

  const attach = async (staged: StagedSketch[]) => {
    const added: Sketch[] = []
    for (const s of staged) {
      added.push(await addSketch(s.file, { projectId, inspectionId, observationId: noteId, title: s.title }))
    }
    setSketches(prev => [...prev, ...added])
  }

  const remove = async (sketch: Sketch) => {
    const label = sketch.title || sketch.fileName || 'this sketch'
    if (!window.confirm(`Delete "${label}"? It is removed from this note, and from its report the next time the report's sketches are updated.`)) return
    try {
      await deleteSketch(sketch.id)
      setSketches(prev => prev.filter(s => s.id !== sketch.id))
    } catch (err: any) {
      setError(err.message)
    }
  }

  return (
    <div style={{ marginTop: 24 }}>
      <div style={sectionTitleStyle}>Sketches ({sketches.length})</div>

      {loading ? (
        <div style={{ fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)' }}>Loading…</div>
      ) : tableMissing ? (
        <div style={{ fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)', lineHeight: 1.5 }}>
          Sketches need a one-off database step: run <strong>{SKETCHES_SQL_FILE}</strong> in the Supabase SQL editor.
        </div>
      ) : (
        <>
          {sketches.length > 0 && (
            <div style={{
              display: 'grid', gap: 10, marginBottom: 12,
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            }}>
              {sketches.map(s => (
                <div key={s.id} style={{
                  border: '1px solid var(--border-line)', borderRadius: 'var(--radius-md, 14px)',
                  overflow: 'hidden', background: 'var(--surface)',
                }}>
                  <a href={s.fileUrl} target="_blank" rel="noreferrer" title="Open the original" style={{
                    display: 'block', aspectRatio: '4 / 3', background: 'white', overflow: 'hidden',
                  }}>
                    {s.pages[0] && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.pages[0].url} alt={s.title || 'Sketch'} loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                    )}
                  </a>
                  <div style={{ padding: '8px 10px' }}>
                    <div style={{
                      fontFamily: 'var(--f-text)', fontSize: 13, fontWeight: 600, color: 'var(--text-ink)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{s.title || s.fileName || 'Sketch'}</div>
                    <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--text-mid)', marginTop: 2 }}>
                      {sketchSummary(s)}
                    </div>
                    <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
                      <a href={s.fileUrl} target="_blank" rel="noreferrer" style={{
                        fontFamily: 'var(--f-text)', fontSize: 12, color: 'var(--indigo)', textDecoration: 'none',
                      }}>Open original</a>
                      <button onClick={() => remove(s)} style={{
                        border: 'none', background: 'none', padding: 0, cursor: 'pointer',
                        fontFamily: 'var(--f-text)', fontSize: 12, color: 'var(--rose-ink, #c53030)',
                      }}>Delete</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <SketchDropZone fixedNoteId={noteId} submitLabel="Attach to note" onSubmit={attach} />
          <div style={{ fontFamily: 'var(--f-text)', fontSize: 12, color: 'var(--text-mid)', marginTop: 6, lineHeight: 1.5 }}>
            {reportRef
              ? `Attached sketches show up in ${reportRef}'s Sketches, ready to add to the report.`
              : 'This note isn’t in a site report yet; its sketches go into the report it is added to.'}
          </div>
        </>
      )}

      {error && (
        <div style={{ marginTop: 6, fontFamily: 'var(--f-text)', fontSize: 12, color: 'var(--rose-ink, #c53030)' }}>{error}</div>
      )}
    </div>
  )
}
