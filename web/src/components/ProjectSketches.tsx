'use client'
import { useEffect, useState } from 'react'
import { Btn, Card, Spinner } from '@/components/Shell'
import { addSketch, deleteSketch, loadProjectSketches, moveSketch, sketchSummary, SKETCHES_SQL_FILE, type Sketch } from '@/lib/sketches'
import SketchDropZone, { type StagedSketch } from '@/components/SketchDropZone'
import { canLabel, loadProjectCans, type Can } from '@/lib/cans'
import { noteReportRef, type SiteNote } from '@/lib/siteNotes'
import { supabase } from '@/lib/supabase'

/**
 * Every sketch on the project in one place: the ones taken from CANs, and
 * the ones attached to site notes or dropped into reports. Each shows where
 * it came from and the site note it explains (which can be changed here), so
 * a sketch can be traced to its CAN and its note. A CAN's sketches are also
 * available on site to mark up like a drawing.
 */
export default function ProjectSketches({
  projectId, siteNotes, refreshKey = 0,
}: {
  projectId: string
  siteNotes: SiteNote[]
  /** Bumped by the page when CANs add or remove sketches. */
  refreshKey?: number
}) {
  const [sketches, setSketches] = useState<Sketch[]>([])
  const [cans, setCans] = useState<Map<string, Can>>(new Map())
  /** Sketches with an on-site copy (a hidden drawing companion). */
  const [onSiteIds, setOnSiteIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [tableMissing, setTableMissing] = useState(false)
  const [message, setMessage] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const [{ sketches, tableMissing }, canList, companions] = await Promise.all([
        loadProjectSketches(projectId),
        loadProjectCans(projectId).catch(() => ({ cans: [] as Can[], tableMissing: true })),
        // No sketch_id column before cans.sql runs — then nothing is on site.
        supabase.from('drawings').select('sketch_id').eq('project_id', projectId).not('sketch_id', 'is', null),
      ])
      setOnSiteIds(new Set((companions.data ?? []).map((d: any) => d.sketch_id as string)))
      setSketches(sketches)
      setTableMissing(tableMissing)
      setCans(new Map(canList.cans.map(c => [c.id, c])))
    } catch (err: any) {
      setMessage('Could not load sketches: ' + err.message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId, refreshKey])

  const noteById = new Map(siteNotes.map(n => [n.id, n]))
  const noteLabel = (n: SiteNote) => `${n.zoneLabel}${noteReportRef(n) ? ` — ${noteReportRef(n)}` : ''}`

  const relink = async (s: Sketch, noteId: string) => {
    const note = noteId ? noteById.get(noteId) : undefined
    try {
      // A General sketch keeps the report it was added to; one linked to a
      // note follows that note's report.
      await moveSketch(s.id, note?.id ?? null, note ? note.inspectionId : s.inspectionId)
      setSketches(prev => prev.map(x => x.id === s.id
        ? { ...x, observationId: note?.id ?? null, inspectionId: note ? note.inspectionId : x.inspectionId }
        : x))
    } catch (err: any) {
      setMessage('Could not change the site note: ' + err.message)
    }
  }

  /** Dropped files: each becomes a sketch on the note picked for it — and so
   *  is offered in that note's report — or, with no note, sits here on the
   *  project. */
  const addFiles = async (staged: StagedSketch[]) => {
    const added: Sketch[] = []
    for (const st of staged) {
      const note = st.observationId ? noteById.get(st.observationId) : undefined
      added.push(await addSketch(st.file, {
        projectId,
        inspectionId: note?.inspectionId ?? null,
        observationId: note?.id ?? null,
        title: st.title,
        onSite: true,
      }))
    }
    setSketches(prev => [...added, ...prev])
    setMessage(`${added.length} sketch${added.length === 1 ? '' : 'es'} added.`)
  }

  const remove = async (s: Sketch) => {
    if (!window.confirm(`Delete "${s.title || s.fileName || 'this sketch'}"? It is removed from its site note and its report too.`)) return
    try {
      await deleteSketch(s.id)
      setSketches(prev => prev.filter(x => x.id !== s.id))
    } catch (err: any) {
      setMessage(err.message)
    }
  }

  if (tableMissing && sketches.length === 0 && !loading) {
    return (
      <Card style={{ padding: 18, fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)', lineHeight: 1.6 }}>
        Sketches need a one-off database step: run <strong>{SKETCHES_SQL_FILE}</strong> in the Supabase SQL editor, then reload.
      </Card>
    )
  }

  return (
    <div>
      <div style={{ fontFamily: 'var(--f-text)', fontSize: 13, color: 'var(--text-mid)', marginBottom: 14, lineHeight: 1.5 }}>
        Sketches from CANs, site notes and reports. Each one can be opened and marked up on site like a drawing.
      </div>

      <div style={{ marginBottom: 16 }}>
        <SketchDropZone
          noteOptions={[
            ...siteNotes.map(n => ({ id: n.id as string | null, label: noteLabel(n) })),
            { id: null, label: 'Not linked to a site note' },
          ]}
          submitLabel="Add sketches"
          onSubmit={addFiles}
        />
      </div>

      {message && (
        <div style={{
          marginBottom: 12, padding: '9px 12px', borderRadius: 8, background: 'var(--paper)',
          border: '1px solid var(--border-line)', fontFamily: 'var(--f-text)', fontSize: 13,
        }}>{message}</div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}><Spinner /></div>
      ) : sketches.length === 0 ? (
        <Card style={{ padding: 24, textAlign: 'center', fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)' }}>
          No sketches on this project yet. Drop one above, upload a CAN, or attach one to a site note or report.
        </Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          {sketches.map(s => {
            const can = s.canId ? cans.get(s.canId) : undefined
            const source = can
              ? `${canLabel(can)} · page ${s.canPage}${can.status === 'superseded' ? ' · superseded' : ''}`
              : s.observationId ? 'Attached to a site note' : 'Added to a report'
            return (
              <Card key={s.id} style={{ overflow: 'hidden', opacity: can?.status === 'superseded' ? 0.65 : 1 }}>
                <a href={s.fileUrl} target="_blank" rel="noreferrer" title="Open the original" style={{
                  display: 'block', aspectRatio: '4 / 3', background: 'white', overflow: 'hidden',
                  borderBottom: '1px solid var(--border-line)',
                }}>
                  {s.pages[0] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.pages[0].url} alt={s.title || 'Sketch'} loading="lazy"
                      style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                  )}
                </a>
                <div style={{ padding: '10px 12px' }}>
                  <div style={{
                    fontFamily: 'var(--f-text)', fontSize: 14, fontWeight: 600, color: 'var(--text-ink)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{s.title || s.fileName || 'Sketch'}</div>
                  <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--text-mid)', marginTop: 2 }}>
                    {source}
                  </div>
                  {onSiteIds.has(s.id) && can?.status !== 'superseded' && (
                    <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--sage-ink)', marginTop: 2 }}>
                      Available on site
                    </div>
                  )}
                  {!can && (
                    <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--text-mid)', marginTop: 2 }}>
                      {sketchSummary(s)}
                    </div>
                  )}
                  <select
                    value={s.observationId ?? ''}
                    onChange={e => relink(s, e.target.value)}
                    title="The site note this sketch explains"
                    style={{
                      marginTop: 8, width: '100%', fontFamily: 'var(--f-text)', fontSize: 12, padding: '5px 6px',
                      border: '1px solid var(--border-line)', borderRadius: 6, background: 'var(--paper)', color: 'var(--text-ink)',
                    }}
                  >
                    <option value="">Not linked to a site note</option>
                    {siteNotes.map(n => <option key={n.id} value={n.id}>{noteLabel(n)}</option>)}
                  </select>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <Btn small onClick={() => window.open(s.fileUrl, '_blank', 'noopener,noreferrer')}>Open</Btn>
                    <Btn small variant="danger" onClick={() => remove(s)}>Delete</Btn>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
