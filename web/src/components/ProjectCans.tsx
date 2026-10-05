'use client'
import { useEffect, useRef, useState } from 'react'
import { Btn, Card, Spinner } from '@/components/Shell'
import {
  analyseCan, canLabel, deleteCan, discardCanUpload, fileCan, loadProjectCans, pageThumbnails, uploadCanPdf,
  CANS_SQL_FILE, type Can, type CanReading,
} from '@/lib/cans'
import { loadProjectSketches, type Sketch } from '@/lib/sketches'
import { noteReportRef, type SiteNote } from '@/lib/siteNotes'

/**
 * The project's CANs tab: every Consultant Advice Notice issued on the
 * project, and "Upload CAN".
 *
 * Uploading reads the CAN with AI (its number, title, revision, date, and
 * which pages carry a sketch), then opens a review: the engineer corrects
 * the details, ticks or unticks sketch pages, titles them and links each to
 * a site note. Filing makes each sketch page a sketch, shown in the
 * Sketches tab, offered in the linked note's report, and opened and marked
 * up on site like a drawing.
 */

type PageChoice = { page: number; thumb: string; isSketch: boolean; title: string; noteId: string | null; aiSuggested: boolean }

type Review = {
  file: File
  canId: string
  fileUrl: string
  stage: 'reading' | 'ready' | 'filing'
  aiError: string
  progress: string
  number: string
  title: string
  revision: string
  issuedOn: string
  summary: string
  pages: PageChoice[]
}

const field: React.CSSProperties = {
  width: '100%', fontFamily: 'var(--f-text)', fontSize: 13, padding: '7px 9px',
  border: '1px solid var(--border-line)', borderRadius: 8, background: 'var(--paper)', color: 'var(--text-ink)',
}
const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '1px', textTransform: 'uppercase',
  color: 'var(--text-mid)', marginBottom: 4, display: 'block',
}

export default function ProjectCans({
  projectId, siteNotes, onChanged,
}: {
  projectId: string
  siteNotes: SiteNote[]
  /** Something CANs feed was added or removed (sketches, on-site drawings). */
  onChanged?: () => void
}) {
  const [cans, setCans] = useState<Can[]>([])
  const [sketchesByCan, setSketchesByCan] = useState<Map<string, Sketch[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [tableMissing, setTableMissing] = useState(false)
  const [review, setReview] = useState<Review | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    try {
      const [{ cans, tableMissing }, { sketches }] = await Promise.all([
        loadProjectCans(projectId),
        loadProjectSketches(projectId).catch(() => ({ sketches: [] as Sketch[], tableMissing: false })),
      ])
      setCans(cans)
      setTableMissing(tableMissing)
      const byCan = new Map<string, Sketch[]>()
      for (const s of sketches) if (s.canId) byCan.set(s.canId, [...(byCan.get(s.canId) ?? []), s])
      setSketchesByCan(byCan)
    } catch (err: any) {
      setMessage('Could not load CANs: ' + err.message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId])

  const noteOptions = siteNotes.map(n => ({
    id: n.id,
    inspectionId: n.inspectionId,
    label: `${n.zoneLabel}${noteReportRef(n) ? ` — ${noteReportRef(n)}` : ''}`,
  }))

  /** Upload, then read with AI and render page thumbnails side by side. */
  const startUpload = async (file: File) => {
    setMessage('')
    let uploaded: { canId: string; fileUrl: string }
    try {
      setReview(null)
      setBusyId('upload')
      uploaded = await uploadCanPdf(projectId, file)
    } catch (err: any) {
      setMessage(err.message)
      setBusyId(null)
      return
    }
    setBusyId(null)
    setReview({
      file, canId: uploaded.canId, fileUrl: uploaded.fileUrl,
      stage: 'reading', aiError: '', progress: '',
      number: '', title: '', revision: '', issuedOn: '', summary: '', pages: [],
    })

    const [reading, thumbs] = await Promise.all([
      analyseCan(projectId, uploaded.canId).catch((err: Error) => err),
      pageThumbnails(file).catch(() => [] as string[]),
    ])
    const ai = reading instanceof Error ? null : (reading as CanReading)
    const sketchPages = new Map((ai?.sketch_pages ?? []).map(p => [p.page, p]))
    setReview(r => r && ({
      ...r,
      stage: 'ready',
      aiError: reading instanceof Error ? reading.message : '',
      number: ai?.can_number ?? '',
      title: ai?.title ?? '',
      revision: ai?.revision ?? '',
      issuedOn: /^\d{4}-\d{2}-\d{2}$/.test(ai?.issued_on ?? '') ? ai!.issued_on : '',
      summary: ai?.summary ?? '',
      pages: thumbs.map((thumb, i) => ({
        page: i + 1,
        thumb,
        isSketch: sketchPages.has(i + 1),
        aiSuggested: sketchPages.has(i + 1),
        title: sketchPages.get(i + 1)?.title ?? '',
        noteId: null,
      })),
    }))
  }

  const cancelReview = async () => {
    if (!review) return
    const { canId } = review
    setReview(null)
    await discardCanUpload(projectId, canId)
  }

  const submitReview = async () => {
    if (!review) return
    if (!review.number.trim()) { setReview({ ...review, aiError: 'Give the CAN its number before filing it.' }); return }
    setReview({ ...review, stage: 'filing', progress: 'Filing' })
    try {
      const chosen = review.pages.filter(p => p.isSketch)
      const result = await fileCan({
        projectId,
        canId: review.canId,
        fileUrl: review.fileUrl,
        file: review.file,
        pageCount: review.pages.length,
        number: review.number,
        title: review.title,
        revision: review.revision,
        issuedOn: review.issuedOn,
        summary: review.summary,
        sketches: chosen.map(p => ({
          page: p.page,
          title: p.title,
          observationId: p.noteId,
          inspectionId: noteOptions.find(o => o.id === p.noteId)?.inspectionId ?? null,
        })),
      }, progress => setReview(r => r && ({ ...r, progress })))
      setReview(null)
      setMessage(`${canLabel(result.can)} filed${result.sketches.length ? ` with ${result.sketches.length} sketch${result.sketches.length === 1 ? '' : 'es'}, now in the Sketches tab and available on site` : ''}.`)
      await load()
      onChanged?.()
    } catch (err: any) {
      setReview(r => r && ({ ...r, stage: 'ready', aiError: err.message, progress: '' }))
    }
  }

  const remove = async (can: Can) => {
    if (!window.confirm(`Delete ${canLabel(can)}? Its sketches are deleted too.`)) return
    setBusyId(can.id)
    try {
      await deleteCan(can.id)
      await load()
      onChanged?.()
    } catch (err: any) {
      setMessage(err.message)
    } finally {
      setBusyId(null)
    }
  }

  if (tableMissing) {
    return (
      <Card style={{ padding: 18, fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)', lineHeight: 1.6 }}>
        CANs need a one-off database step: run <strong>{CANS_SQL_FILE}</strong> in the Supabase SQL editor, then reload.
      </Card>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <div style={{ fontFamily: 'var(--f-text)', fontSize: 13, color: 'var(--text-mid)', maxWidth: 560, lineHeight: 1.5 }}>
          Upload an issued CAN as a PDF. AI reads its details and finds any sketches, which you confirm; sketches are then available on site to check and mark up.
        </div>
        <Btn variant="primary" onClick={() => inputRef.current?.click()} disabled={busyId === 'upload' || !!review}>
          {busyId === 'upload' ? 'Uploading…' : '+ Upload CAN'}
        </Btn>
        <input
          ref={inputRef} type="file" accept="application/pdf,.pdf" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) startUpload(f) }}
        />
      </div>

      {message && (
        <div style={{
          marginBottom: 12, padding: '9px 12px', borderRadius: 8, background: 'var(--paper)',
          border: '1px solid var(--border-line)', fontFamily: 'var(--f-text)', fontSize: 13, color: 'var(--text-ink)',
        }}>{message}</div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}><Spinner /></div>
      ) : cans.length === 0 ? (
        <Card style={{ padding: 24, textAlign: 'center', fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)' }}>
          No CANs on this project yet.
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {cans.map(can => {
            const sketches = sketchesByCan.get(can.id) ?? []
            const superseded = can.status === 'superseded'
            return (
              <Card key={can.id} style={{ padding: '12px 14px', opacity: superseded ? 0.65 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'var(--f-heading)', fontSize: 15, fontWeight: 700, color: 'var(--text-ink)' }}>
                        {canLabel(can)}
                      </span>
                      <span style={{
                        fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px',
                        padding: '2px 6px', borderRadius: 4,
                        background: superseded ? 'var(--paper)' : 'var(--sage-soft)',
                        color: superseded ? 'var(--text-mid)' : 'var(--sage-ink)',
                      }}>{superseded ? 'Superseded' : 'Current'}</span>
                      {can.issuedOn && (
                        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, color: 'var(--text-mid)' }}>
                          Issued {new Date(can.issuedOn + 'T00:00:00').toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      )}
                    </div>
                    {can.title && (
                      <div style={{ fontFamily: 'var(--f-text)', fontSize: 14, fontWeight: 600, color: 'var(--text-ink)', marginTop: 3 }}>{can.title}</div>
                    )}
                    {can.summary && (
                      <div style={{ fontFamily: 'var(--f-text)', fontSize: 13, color: 'var(--text-mid)', marginTop: 3, lineHeight: 1.5 }}>{can.summary}</div>
                    )}
                    <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, color: 'var(--text-mid)', marginTop: 6 }}>
                      {can.pageCount} page{can.pageCount === 1 ? '' : 's'} · {sketches.length} sketch{sketches.length === 1 ? '' : 'es'}
                      {sketches.length > 0 && `: ${sketches.map(s => `p${s.canPage} ${s.title}`).join(' · ')}`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <Btn small onClick={() => window.open(can.fileUrl, '_blank', 'noopener,noreferrer')}>Open PDF</Btn>
                    <Btn small variant="danger" onClick={() => remove(can)} disabled={busyId === can.id}>
                      {busyId === can.id ? 'Deleting…' : 'Delete'}
                    </Btn>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {review && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 60,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div style={{
            background: 'var(--surface)', borderRadius: 14, width: 'min(920px, 100%)', maxHeight: '92vh',
            overflow: 'auto', padding: 20, boxShadow: '0 12px 40px rgba(0,0,0,.25)',
          }}>
            <div style={{ fontFamily: 'var(--f-heading)', fontSize: 18, fontWeight: 800, color: 'var(--indigo-deep)', marginBottom: 4 }}>
              Review CAN
            </div>
            <div style={{ fontFamily: 'var(--f-text)', fontSize: 13, color: 'var(--text-mid)', marginBottom: 14 }}>
              {review.file.name}
            </div>

            {review.stage === 'reading' ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: 40 }}>
                <Spinner size={28} />
                <div style={{ fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)' }}>
                  AI is reading the CAN and looking for sketches…
                </div>
              </div>
            ) : (
              <>
                {review.aiError && (
                  <div style={{
                    marginBottom: 12, padding: '9px 12px', borderRadius: 8,
                    background: 'var(--marigold-soft, #fffaf0)', color: 'var(--text-ink)',
                    fontFamily: 'var(--f-text)', fontSize: 13,
                  }}>{review.aiError}</div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 0.7fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div>
                    <label style={labelStyle}>CAN number</label>
                    <input style={field} value={review.number} placeholder="CAN-003"
                      onChange={e => setReview({ ...review, number: e.target.value })} />
                  </div>
                  <div>
                    <label style={labelStyle}>Title</label>
                    <input style={field} value={review.title}
                      onChange={e => setReview({ ...review, title: e.target.value })} />
                  </div>
                  <div>
                    <label style={labelStyle}>Revision</label>
                    <input style={field} value={review.revision} placeholder="A"
                      onChange={e => setReview({ ...review, revision: e.target.value })} />
                  </div>
                  <div>
                    <label style={labelStyle}>Issued</label>
                    <input style={field} type="date" value={review.issuedOn}
                      onChange={e => setReview({ ...review, issuedOn: e.target.value })} />
                  </div>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Summary</label>
                  <input style={field} value={review.summary}
                    onChange={e => setReview({ ...review, summary: e.target.value })} />
                </div>

                <div style={{ ...labelStyle, marginBottom: 8 }}>
                  Sketch pages — tick each page that is a sketch to check on site
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, marginBottom: 16 }}>
                  {review.pages.map(p => (
                    <div key={p.page} style={{
                      border: `1.5px solid ${p.isSketch ? 'var(--sage)' : 'var(--border-line)'}`,
                      background: p.isSketch ? 'var(--sage-soft)' : 'var(--paper)',
                      borderRadius: 10, overflow: 'hidden',
                    }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', cursor: 'pointer' }}>
                        <input type="checkbox" checked={p.isSketch}
                          onChange={() => setReview({ ...review, pages: review.pages.map(q => q.page === p.page ? { ...q, isSketch: !q.isSketch } : q) })} />
                        <span style={{ fontFamily: 'var(--f-text)', fontSize: 13, fontWeight: 600, color: 'var(--text-ink)' }}>
                          Page {p.page}
                        </span>
                        {p.aiSuggested && (
                          <span style={{ marginLeft: 'auto', fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--indigo)' }}>AI: sketch</span>
                        )}
                      </label>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.thumb} alt={`Page ${p.page}`} style={{ width: '100%', display: 'block', background: 'white' }} />
                      {p.isSketch && (
                        <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <input style={{ ...field, fontSize: 12, padding: '5px 7px' }} value={p.title} placeholder="Sketch title"
                            onChange={e => setReview({ ...review, pages: review.pages.map(q => q.page === p.page ? { ...q, title: e.target.value } : q) })} />
                          <select style={{ ...field, fontSize: 12, padding: '5px 7px' }} value={p.noteId ?? ''}
                            onChange={e => setReview({ ...review, pages: review.pages.map(q => q.page === p.page ? { ...q, noteId: e.target.value || null } : q) })}>
                            <option value="">Not linked to a site note</option>
                            {noteOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                  ))}
                  {review.pages.length === 0 && (
                    <div style={{ fontFamily: 'var(--f-text)', fontSize: 13, color: 'var(--text-mid)' }}>
                      The pages could not be shown. The CAN can still be filed, without sketches.
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
                  {review.stage === 'filing' && (
                    <span style={{ fontFamily: 'var(--f-text)', fontSize: 13, color: 'var(--text-mid)', marginRight: 'auto' }}>
                      {review.progress}…
                    </span>
                  )}
                  <Btn onClick={cancelReview} disabled={review.stage === 'filing'}>Cancel</Btn>
                  <Btn variant="primary" onClick={submitReview} disabled={review.stage === 'filing'}>
                    {review.stage === 'filing'
                      ? 'Filing…'
                      : `File CAN${review.pages.some(p => p.isSketch) ? ` with ${review.pages.filter(p => p.isSketch).length} sketch${review.pages.filter(p => p.isSketch).length === 1 ? '' : 'es'}` : ''}`}
                  </Btn>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
