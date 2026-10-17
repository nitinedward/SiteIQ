'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Btn, Spinner } from '@/components/Shell'
import type { SiteNote } from '@/lib/siteNotes'
import { noteRefLabel, reportOrder, compareReportOrder } from '@/lib/noteRefs'
import { reportNoLabel } from '@/lib/reportFileName'
import { closeoutFileUrl, closeoutPost, uploadCloseoutFile } from '@/lib/closeoutClient'
import {
  PS1_KEYS, PS1_FIELD_INFO, PACK_SECTIONS, authorComplete,
  type Ps1Key, type ProjectCloseout, type FirmPs4Settings, type Ps4Author, type PackMode, type PackSectionId,
} from '@/lib/closeout'

/**
 * The project's Close-out tab: the design PS1 (read, then checked detail by
 * detail), what goes in the pack, whether it's ready, and a DRAFT of the
 * pack to download. The PS4 goes first; without one the pack is just the
 * reports and registers. Sending the PS4 to its author to approve and sign
 * comes in the next phase.
 */

type Report = { id: string; report_no: string | null; date: string | null; created_at: string | null; purpose: string | null }

const card: React.CSSProperties = { border: '1px solid var(--border-line)', borderRadius: 'var(--radius-md)', background: 'var(--surface)', overflow: 'hidden' }
const cardHead: React.CSSProperties = { padding: '16px 20px', borderBottom: '1px solid var(--border-line)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }
const h2: React.CSSProperties = { fontFamily: 'var(--f-heading)', fontSize: 15, fontWeight: 800, color: 'var(--text-ink)' }
const hint: React.CSSProperties = { fontFamily: 'var(--f-text)', fontSize: 12, color: 'var(--text-mid)', lineHeight: 1.5 }
const label: React.CSSProperties = { display: 'block', fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700, color: 'var(--text-mid)', marginBottom: 6 }
const input: React.CSSProperties = {
  width: '100%', padding: '10px 14px', boxSizing: 'border-box', background: 'var(--surface)',
  border: '1.5px solid var(--border-line)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--f-text)',
  fontSize: 14, color: 'var(--text-ink)', outline: 'none',
}
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontFamily: 'var(--f-heading)', fontSize: 11, fontWeight: 700, color: 'var(--text-mid)', letterSpacing: '.04em', textTransform: 'uppercase', background: 'var(--paper)' }
const td: React.CSSProperties = { padding: '9px 14px', fontFamily: 'var(--f-text)', fontSize: 13, color: 'var(--text-ink)', verticalAlign: 'top', borderTop: '1px solid var(--border-line)' }

function Badge({ tone, children }: { tone: 'sage' | 'marigold' | 'clay' | 'indigo'; children: React.ReactNode }) {
  const map = {
    sage: ['var(--sage-ink)', 'var(--sage-soft)'], marigold: ['var(--marigold-ink)', 'var(--marigold-soft)'],
    clay: ['var(--clay-ink)', 'var(--clay-soft)'], indigo: ['var(--indigo)', 'var(--indigo-soft)'],
  }[tone]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 99, fontFamily: 'var(--f-heading)', fontSize: 11, fontWeight: 700, color: map[0], background: map[1], whiteSpace: 'nowrap' }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />{children}
    </span>
  )
}

function Step({ n }: { n: number }) {
  return <span style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--indigo)', color: '#fff', fontFamily: 'var(--f-heading)', fontWeight: 800, fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{n}</span>
}

export default function ProjectCloseout({ projectId, projectNumber, notes: projectNotes, onOpenNote }: {
  projectId: string
  projectNumber: string
  /** The project's site notes, as the page holds them, so closing one in
   *  its popup shows here straight away. */
  notes: SiteNote[]
  onOpenNote: (noteId: string) => void
}) {
  const [loading, setLoading] = useState(true)
  const [setupMissing, setSetupMissing] = useState(false)
  const [closeout, setCloseout] = useState<ProjectCloseout>({})
  const [settings, setSettings] = useState<FirmPs4Settings>({})
  const [authors, setAuthors] = useState<Ps4Author[]>([])
  const [reports, setReports] = useState<Report[]>([])
  const [unfinalised, setUnfinalised] = useState(0)
  const notes = useMemo(() => [...projectNotes].sort((a, b) => (a.ref ?? 9999) - (b.ref ?? 9999)), [projectNotes])

  const [mode, setMode] = useState<PackMode>('ps4')
  const [sections, setSections] = useState<Record<PackSectionId, boolean>>({ summary: true, reportReg: true, noteReg: true, reports: true })
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [choosingReports, setChoosingReports] = useState(false)

  const [ps1Busy, setPs1Busy] = useState(false)
  const [error, setError] = useState('')
  const [compiling, setCompiling] = useState(false)
  const [draft, setDraft] = useState<{ url: string; downloadUrl: string; pageCount: number; warnings: string[] } | null>(null)
  const ps1Input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      setLoading(true)
      const { data: project, error: pErr } = await supabase.from('projects').select('closeout, firm_id').eq('id', projectId).single()
      if (pErr) { if (live) { setSetupMissing(/closeout/.test(pErr.message)); setLoading(false) } return }
      const firmId = (project as any).firm_id
      const [firm, authorRows, insp] = await Promise.all([
        supabase.from('firms').select('ps4_settings').eq('id', firmId).single(),
        supabase.from('ps4_authors').select('*').eq('firm_id', firmId).order('created_at'),
        supabase.from('inspections').select('id, report_no, date, created_at, purpose, status, report_status').eq('project_id', projectId),
      ])
      if (!live) return
      if (authorRows.error) setSetupMissing(true)
      setCloseout(((project as any).closeout ?? {}) as ProjectCloseout)
      setSettings(((firm.data as any)?.ps4_settings ?? {}) as FirmPs4Settings)
      setAuthors(((authorRows.data ?? []) as Ps4Author[]))
      const all = (insp.data ?? []) as any[]
      setReports(all.filter(r => r.report_status === 'finalised').sort((a, b) => compareReportOrder(reportOrder(a), reportOrder(b))))
      setUnfinalised(all.filter(r => r.status === 'COMPLETED' && r.report_status !== 'finalised').length)
      setLoading(false)
    })()
    return () => { live = false }
  }, [projectId])

  const save = async (patch: Record<string, unknown>) => {
    setError('')
    try {
      const { closeout: next } = await closeoutPost<{ closeout: ProjectCloseout }>('project', { projectId, patch })
      setCloseout(next)
    } catch (err: any) { setError(err.message) }
  }

  const uploadPs1 = async (file: File) => {
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { setError('The PS1 must be a PDF.'); return }
    setPs1Busy(true)
    setError('')
    try {
      const path = await uploadCloseoutFile('ps1', file, { projectId })
      const { closeout: next } = await closeoutPost<{ closeout: ProjectCloseout }>('ps1', { projectId, path, fileName: file.name })
      setCloseout(next)
    } catch (err: any) { setError(err.message) }
    setPs1Busy(false)
  }

  const isPs4 = mode === 'ps4'
  const ps1 = closeout.ps1
  const checkedCount = ps1 ? PS1_KEYS.filter(k => ps1.checked[k]).length : 0
  const ps1Done = !!ps1 && checkedCount === PS1_KEYS.length
  const consentOk = !!closeout.consentNo?.trim()
  const activeAuthors = authors.filter(a => a.active)
  const author = authors.find(a => a.id === closeout.authorId) ?? null
  const authorReady = !!author && author.active && authorComplete(author)
  const openNotes = notes.filter(n => n.status !== 'CLOSED')
  const included = reports.filter(r => !excluded.has(r.id))
  const formOk = !!settings.formPath

  const sendBlocked = !isPs4 || openNotes.length > 0 || !ps1Done || !consentOk || !authorReady || !formOk || included.length === 0

  const checks = useMemo(() => {
    const rows: { ok: boolean | null; title: string; detail: React.ReactNode }[] = [
      { ok: included.length > 0, title: 'Site reports finalised', detail: `${included.length} in the pack${unfinalised ? ` · ${unfinalised} not finalised yet, so left out` : ''}` },
      { ok: openNotes.length === 0 || !isPs4, title: 'Site notes closed', detail: openNotes.length === 0 ? `All ${notes.length} closed` : `${notes.length - openNotes.length} of ${notes.length} closed${isPs4 ? '' : ' · open notes show as open'}` },
    ]
    if (isPs4) {
      rows.push(
        { ok: formOk, title: 'PS4 form', detail: formOk ? (settings.formName ?? 'Uploaded') : <>Upload it in <Link href="/settings" style={{ color: 'var(--indigo)', fontWeight: 600 }}>Settings</Link></> },
        { ok: ps1Done, title: 'PS1 details checked', detail: ps1 ? `${checkedCount} of ${PS1_KEYS.length}` : 'No PS1 uploaded' },
        { ok: consentOk, title: 'Building consent no.', detail: consentOk ? closeout.consentNo : 'Type it in under Design PS1' },
        { ok: authorReady, title: 'PS4 author ready', detail: !author ? 'Choose one below' : authorReady ? 'CPEng, qualifications and signature on file' : <>Finish their details in <Link href="/settings" style={{ color: 'var(--indigo)', fontWeight: 600 }}>Settings</Link></> },
      )
    }
    return rows
  }, [included.length, unfinalised, openNotes.length, notes.length, isPs4, formOk, settings.formName, ps1Done, ps1, checkedCount, consentOk, closeout.consentNo, author, authorReady])

  const contents = [
    ...(isPs4 ? [{ title: 'PS4, with the site report register in its schedule', pages: '3 pp' }] : []),
    ...PACK_SECTIONS.filter(s => sections[s.id] && !(isPs4 && s.id === 'reportReg')).map(s => ({
      title: s.title,
      pages: s.id === 'reports' ? `${included.length} report${included.length === 1 ? '' : 's'}` : s.id === 'noteReg' ? `${notes.length} notes` : '1 p',
    })),
  ]

  const compile = async () => {
    setCompiling(true)
    setError('')
    setDraft(null)
    try {
      const result = await closeoutPost<{ url: string; downloadUrl: string; pageCount: number; warnings: string[] }>('compile', {
        projectId, mode,
        sections: PACK_SECTIONS.filter(s => sections[s.id]).map(s => s.id),
        reportIds: excluded.size ? included.map(r => r.id) : undefined,
        authorId: closeout.authorId,
      })
      setDraft(result)
    } catch (err: any) { setError(err.message) }
    setCompiling(false)
  }

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner /></div>
  if (setupMissing) {
    return (
      <div style={{ ...card, padding: 20, ...hint, fontSize: 13 }}>
        Close-out packs need a one-off database step first: run <code>web/sql/closeout.sql</code> in the Supabase SQL editor, then reload.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
      {/* ── Left column ── */}
      <div style={{ flex: '999 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* 1. PS1 */}
        <section style={card} aria-labelledby="co-ps1">
          <div style={cardHead}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Step n={1} /><h3 id="co-ps1" style={h2}>Design PS1</h3></span>
            {ps1 && (ps1Done ? <Badge tone="sage">All {PS1_KEYS.length} checked</Badge> : <Badge tone="marigold">{checkedCount} of {PS1_KEYS.length} checked</Badge>)}
          </div>
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <input ref={ps1Input} type="file" accept="application/pdf,.pdf" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadPs1(f) }} />
            {!ps1 ? (
              <div style={{ border: '1.5px dashed var(--border-line)', borderRadius: 'var(--radius-sm)', padding: 20, background: 'var(--paper)', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ ...hint, fontSize: 13 }}>Upload the designer&rsquo;s PS1. SiteIQ reads it and fills in the PS4 from it; you check each detail.</div>
                <Btn variant="primary" onClick={() => ps1Input.current?.click()} disabled={ps1Busy}>{ps1Busy ? 'Reading the PS1…' : 'Upload PS1 (PDF)'}</Btn>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, background: 'var(--paper)', border: '1px solid var(--border-line)', borderRadius: 'var(--radius-sm)', padding: '10px 14px' }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700, color: 'var(--text-ink)' }}>{ps1.fileName}</div>
                    <div style={hint}>{ps1.source === 'form'
                      ? 'Read from its fillable boxes, so the values are exact'
                      : 'Read by AI from a flattened PDF. Check each value carefully'}</div>
                  </div>
                  <Btn variant="outline" small onClick={async () => { try { window.open(await closeoutFileUrl(`kind=ps1&projectId=${projectId}`), '_blank', 'noopener,noreferrer') } catch (e: any) { setError(e.message) } }}>View</Btn>
                  <Btn variant="outline" small onClick={() => ps1Input.current?.click()} disabled={ps1Busy}>{ps1Busy ? 'Reading…' : 'Replace'}</Btn>
                </div>

                <div style={{ overflowX: 'auto', border: '1px solid var(--border-line)', borderRadius: 'var(--radius-sm)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
                    <thead><tr>
                      <th style={th}>From the PS1</th><th style={th}>Value</th><th style={th}>Goes into PS4</th><th style={{ ...th, textAlign: 'right' }}>Checked</th>
                    </tr></thead>
                    <tbody>
                      {PS1_KEYS.map(key => (
                        <Ps1Row key={`${key}-${ps1.uploadedAt}`} k={key} value={ps1.fields[key]} checked={!!ps1.checked[key]}
                          legalNA={ps1.legalNA}
                          onSave={v => save({ ps1Fields: { [key]: v }, ps1Checked: { [key]: true } })}
                          onToggle={() => save({ ps1Checked: { [key]: !ps1.checked[key] } })}
                          onLegalNA={na => save({ legalNA: na })} />
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={hint}>Click a value to correct it; a corrected value counts as checked. Corrections are kept on the project, not in the PS1.</div>
              </>
            )}

            <div>
              <div style={{ ...label, marginBottom: 10 }}>Not on a PS1, so you fill these in</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
                <SavedInput id="co-consent" label="Building consent no." value={closeout.consentNo ?? ''} placeholder="e.g. BCO10345678" onSave={v => save({ consentNo: v })} />
                <SavedInput id="co-amend" label="Amendment no(s). (optional)" value={closeout.amendmentNo ?? ''} placeholder="None" onSave={v => save({ amendmentNo: v })} />
                <div>
                  <span style={label}>Job number</span>
                  <div style={{ ...input, background: 'var(--paper)', fontFamily: 'var(--f-mono)', fontSize: 13 }}>{projectNumber || '—'}</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 2. Pack */}
        <section style={card} aria-labelledby="co-pack">
          <div style={cardHead}><span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Step n={2} /><h3 id="co-pack" style={h2}>What goes in the pack</h3></span></div>
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div role="radiogroup" aria-label="Pack type" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
              {([
                ['ps4', 'PS4 close-out', 'PS4 first, then the summary, registers and reports. Goes to the PS4 author to approve and sign.'],
                ['reports', 'Reports & register only', 'No PS4, no approval. Download straight away. Open notes show as open.'],
              ] as const).map(([id, title, desc]) => {
                const on = mode === id
                return (
                  <button key={id} role="radio" aria-checked={on} onClick={() => { setMode(id); setDraft(null) }} style={{
                    display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'left', padding: '14px 16px', cursor: 'pointer',
                    borderRadius: 'var(--radius-sm)', background: on ? 'var(--indigo-soft)' : 'var(--surface)',
                    border: `1.5px solid ${on ? 'var(--indigo)' : 'var(--border-line)'}`,
                  }}>
                    <span style={{ fontFamily: 'var(--f-heading)', fontSize: 15, fontWeight: 800, color: 'var(--text-ink)' }}>{title}</span>
                    <span style={{ ...hint, fontSize: 13 }}>{desc}</span>
                  </button>
                )
              })}
            </div>

            <div style={{ border: '1px solid var(--border-line)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
              <div style={{ ...th, padding: '9px 14px' }}>Sections, in pack order</div>
              {isPs4 && <SectionRow n="1" title="PS4 – Producer statement, construction review" desc="Your firm's PS4 form, filled in. Its schedule (page 2) lists the PS1 documents and every site report." checked locked note="Always first" />}
              {(() => {
                let n = isPs4 ? 1 : 0
                return PACK_SECTIONS.map(s => {
                  const inSchedule = isPs4 && s.id === 'reportReg'
                  const checked = inSchedule || sections[s.id]
                  if (checked && !inSchedule) n += 1
                  return (
                    <SectionRow key={s.id} n={inSchedule ? '1' : checked ? String(n) : '–'} title={s.title}
                      desc={inSchedule ? 'Printed in the PS4 schedule (page 2), under the PS1 documents' : s.desc}
                      checked={checked} locked={inSchedule} note={inSchedule ? 'In the PS4' : ''}
                      onToggle={() => { setSections(prev => ({ ...prev, [s.id]: !prev[s.id] })); setDraft(null) }} />
                  )
                })
              })()}
            </div>

            <div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                <span style={{ fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700, color: 'var(--text-ink)' }}>
                  Site reports <span style={{ color: 'var(--text-mid)', fontWeight: 500 }}>· {included.length} of {reports.length} finalised</span>
                </span>
                {reports.length > 0 && <Btn variant="outline" small onClick={() => setChoosingReports(v => !v)}>{choosingReports ? 'Done' : 'Choose reports'}</Btn>}
              </div>
              {reports.length === 0 && <div style={hint}>No finalised reports on this project yet.</div>}
              {choosingReports ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border-line)', borderRadius: 'var(--radius-sm)', padding: 6 }}>
                  {reports.map(r => (
                    <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', fontFamily: 'var(--f-text)', fontSize: 13, cursor: 'pointer' }}>
                      <input type="checkbox" checked={!excluded.has(r.id)} style={{ width: 16, height: 16, accentColor: 'var(--indigo)' }}
                        onChange={() => { setExcluded(prev => { const next = new Set(prev); next.has(r.id) ? next.delete(r.id) : next.add(r.id); return next }); setDraft(null) }} />
                      <span style={{ fontFamily: 'var(--f-mono)', fontSize: 12 }}>{reportNoLabel(r.report_no)}</span>
                      <span style={{ color: 'var(--text-mid)' }}>{r.date}{r.purpose ? ` · ${r.purpose}` : ''}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {included.map(r => (
                    <span key={r.id} style={{ fontFamily: 'var(--f-mono)', fontSize: 11, background: 'var(--indigo-soft)', color: 'var(--indigo)', padding: '3px 10px', borderRadius: 99 }}>{reportNoLabel(r.report_no)}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Notes register preview */}
        <section style={card} aria-labelledby="co-reg">
          <div style={cardHead}>
            <div>
              <h3 id="co-reg" style={h2}>Site notes closed register</h3>
              <div style={hint}>Every site note on the project, as it will be listed in the pack</div>
            </div>
            {notes.length === 0 ? <Badge tone="indigo">No site notes</Badge>
              : openNotes.length === 0 ? <Badge tone="sage">All {notes.length} closed</Badge>
              : <Badge tone="clay">{openNotes.length} of {notes.length} open</Badge>}
          </div>
          {notes.length > 0 && (
            <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                <thead><tr><th style={th}>Note</th><th style={th}>Item</th><th style={th}>Raised in</th><th style={th}>Status</th></tr></thead>
                <tbody>
                  {notes.map(n => (
                    <tr key={n.id}>
                      <td style={{ ...td, fontFamily: 'var(--f-mono)', fontSize: 12, whiteSpace: 'nowrap' }}>{noteRefLabel(n.ref) ?? '—'}</td>
                      <td style={td}>
                        <button onClick={() => onOpenNote(n.id)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--f-text)', fontSize: 13, color: 'var(--text-ink)' }}>
                          <strong style={{ fontWeight: 600 }}>{n.zoneLabel}</strong>{n.description ? `: ${n.description.length > 90 ? n.description.slice(0, 89) + '…' : n.description}` : ''}
                        </button>
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--text-mid)' }}>{n.reportNo ? reportNoLabel(n.reportNo) : '—'}{n.visitDate ? ` · ${n.visitDate}` : ''}</td>
                      <td style={td}>{n.status === 'CLOSED' ? <Badge tone="sage">Closed</Badge> : <Badge tone="clay">Open</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* ── Right column ── */}
      <aside style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <section style={card} aria-labelledby="co-ready">
          <div style={cardHead}><span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Step n={3} /><h3 id="co-ready" style={h2}>Ready to send?</h3></span></div>
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {checks.map(c => (
              <div key={c.title} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span aria-hidden="true" style={{
                  flex: '0 0 22px', width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--f-heading)', fontSize: 12, fontWeight: 800, color: '#fff', background: c.ok ? 'var(--sage)' : 'var(--clay)',
                }}>{c.ok ? '✓' : '!'}</span>
                <span>
                  <span style={{ display: 'block', fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700, color: 'var(--text-ink)' }}>{c.title}</span>
                  <span style={hint}>{c.detail}</span>
                </span>
              </div>
            ))}
            {isPs4 && openNotes.length > 0 && (
              <div role="status" style={{ background: 'var(--clay-soft)', border: '1px solid rgba(229,115,91,.3)', color: 'var(--clay-ink)', borderRadius: 'var(--radius-sm)', padding: '12px 14px', fontFamily: 'var(--f-text)', fontSize: 13, lineHeight: 1.5 }}>
                <strong style={{ fontFamily: 'var(--f-heading)' }}>The PS4 can&rsquo;t be sent until every site note is closed.</strong>{' '}
                Still open:{' '}
                {openNotes.slice(0, 8).map((n, i) => (
                  <span key={n.id}>{i > 0 && ', '}<button onClick={() => onOpenNote(n.id)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--clay-ink)', fontWeight: 600, textDecoration: 'underline', cursor: 'pointer', fontSize: 13 }}>{noteRefLabel(n.ref) ?? n.zoneLabel}</button></span>
                ))}
                {openNotes.length > 8 && ` and ${openNotes.length - 8} more`}. Close them, or switch to &ldquo;Reports &amp; register only&rdquo;.
              </div>
            )}
          </div>
        </section>

        <section style={card} aria-labelledby="co-send">
          <div style={cardHead}><h3 id="co-send" style={h2}>{isPs4 ? 'PS4 close-out pack' : 'Reports & register pack'}</h3></div>
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--f-text)', fontSize: 13, color: 'var(--text-ink)' }}>
              <li style={{ color: 'var(--text-mid)' }}>Contents</li>
              {contents.map(c => <li key={c.title}><span style={{ fontWeight: 600 }}>{c.title}</span> <span style={{ color: 'var(--text-mid)' }}>· {c.pages}</span></li>)}
            </ol>

            {isPs4 && (
              <div>
                <label style={label} htmlFor="co-author">PS4 author</label>
                {authors.length === 0 ? (
                  <div style={hint}>No PS4 authors yet. Add them in <Link href="/settings" style={{ color: 'var(--indigo)', fontWeight: 600 }}>Settings</Link>.</div>
                ) : (
                  <>
                    <select id="co-author" value={closeout.authorId ?? ''} onChange={e => { save({ authorId: e.target.value || null }); setDraft(null) }} style={{ ...input, fontSize: 15 }}>
                      <option value="">Choose…</option>
                      {activeAuthors.map(a => <option key={a.id} value={a.id}>{a.name}{authorComplete(a) ? '' : ' (details missing)'}</option>)}
                      {author && !author.active && <option value={author.id}>{author.name} (inactive)</option>}
                    </select>
                    {author && <div style={{ ...hint, marginTop: 6 }}>The project&rsquo;s default. Approval goes to <strong style={{ color: 'var(--text-ink)' }}>{author.email}</strong>.</div>}
                  </>
                )}
              </div>
            )}

            <Btn variant="outline" onClick={compile} disabled={compiling || included.length === 0} style={{ justifyContent: 'center' }}>
              {compiling ? 'Putting the pack together…' : draft ? 'Rebuild draft' : 'Build draft pack'}
            </Btn>
            {compiling && <div style={hint}>Fetching and merging {included.length} report{included.length === 1 ? '' : 's'}. This can take a minute.</div>}
            {draft && (
              <div style={{ background: 'var(--sage-soft)', border: '1px solid rgba(91,146,121,.3)', borderRadius: 'var(--radius-sm)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700, color: 'var(--sage-ink)' }}>Draft ready · {draft.pageCount} pages</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <a href={draft.url} target="_blank" rel="noreferrer" style={{ padding: '6px 14px', borderRadius: 999, fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700, background: 'var(--indigo)', color: '#fff' }}>Open</a>
                  <a href={draft.downloadUrl} style={{ padding: '6px 14px', borderRadius: 999, fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700, background: 'var(--surface)', color: 'var(--text-ink)', border: '1.5px solid var(--border-line)' }}>Download</a>
                </div>
                {draft.warnings.length > 0 && (
                  <ul style={{ margin: 0, paddingLeft: 18, ...hint, color: 'var(--marigold-ink)' }}>
                    {draft.warnings.map(w => <li key={w}>{w}</li>)}
                  </ul>
                )}
                <div style={hint}>The link works for 10 minutes; rebuild for a fresh one.</div>
              </div>
            )}

            {isPs4 && (
              <>
                <Btn variant="primary" disabled style={{ justifyContent: 'center' }}>Send to PS4 author</Btn>
                <div style={hint}>
                  {sendBlocked
                    ? 'Everything under "Ready to send?" needs a tick first. '
                    : 'Ready. '}
                  Emailing the pack to the author to approve and sign is coming in the next update; for now, download the draft.
                </div>
              </>
            )}
            {error && <div style={{ ...hint, fontSize: 13, color: 'var(--clay-ink)' }}>{error}</div>}
          </div>
        </section>
      </aside>
    </div>
  )
}

function SectionRow({ n, title, desc, checked, locked, note, onToggle }: {
  n: string; title: string; desc: string; checked: boolean; locked?: boolean; note?: string; onToggle?: () => void
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', minHeight: 44, borderTop: '1px solid var(--border-line)', cursor: locked ? 'default' : 'pointer', opacity: checked ? 1 : 0.55 }}>
      <span style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--text-mid)', width: 16 }}>{n}</span>
      <input type="checkbox" checked={checked} disabled={locked} onChange={onToggle} style={{ width: 18, height: 18, accentColor: 'var(--indigo)', margin: 0 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700, color: 'var(--text-ink)' }}>{title}</span>
        <span style={hint}>{desc}</span>
      </span>
      {note && <span style={{ ...hint, whiteSpace: 'nowrap' }}>{note}</span>}
    </label>
  )
}

function SavedInput({ id, label: text, value, placeholder, onSave }: { id: string; label: string; value: string; placeholder?: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <div>
      <label style={label} htmlFor={id}>{text}</label>
      <input id={id} value={v} placeholder={placeholder} onChange={e => setV(e.target.value)}
        onBlur={() => { if (v.trim() !== value.trim()) onSave(v.trim()) }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        style={input} />
    </div>
  )
}

function Ps1Row({ k, value, checked, legalNA, onSave, onToggle, onLegalNA }: {
  k: Ps1Key; value: string; checked: boolean; legalNA: boolean
  onSave: (v: string) => void; onToggle: () => void; onLegalNA: (na: boolean) => void
}) {
  const info = PS1_FIELD_INFO[k]
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const done = () => { setEditing(false); if (v.trim() !== value.trim()) onSave(v.trim()) }

  return (
    <tr>
      <th scope="row" style={{ ...td, fontFamily: 'var(--f-heading)', fontWeight: 700, whiteSpace: 'nowrap', textAlign: 'left' }}>{info.label}</th>
      <td style={{ ...td, minWidth: 200 }}>
        {editing ? (
          info.multiline
            ? <textarea autoFocus rows={5} value={v} onChange={e => setV(e.target.value)} onBlur={done} style={{ ...input, resize: 'vertical' }} />
            : <input autoFocus value={v} onChange={e => setV(e.target.value)} onBlur={done} onKeyDown={e => { if (e.key === 'Enter') done(); if (e.key === 'Escape') { setV(value); setEditing(false) } }} style={input} />
        ) : (
          <button onClick={() => setEditing(true)} title="Click to correct" style={{
            background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'text', width: '100%',
            fontFamily: 'var(--f-text)', fontSize: 13, color: value ? 'var(--text-ink)' : 'var(--text-mid)', whiteSpace: 'pre-wrap',
          }}>{k === 'legal' && legalNA ? 'N/A' : value || 'Not filled in. Click to add'}</button>
        )}
        {k === 'legal' && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6, ...hint, cursor: 'pointer' }}>
            <input type="checkbox" checked={legalNA} onChange={e => onLegalNA(e.target.checked)} style={{ accentColor: 'var(--indigo)' }} /> N/A
          </label>
        )}
      </td>
      <td style={{ ...td, ...hint }}>{info.target}</td>
      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
        <button onClick={onToggle} aria-pressed={checked} aria-label={`${info.label}: ${checked ? 'checked' : 'not checked'}`} style={{
          padding: '5px 12px', borderRadius: 999, fontFamily: 'var(--f-heading)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          background: checked ? 'var(--sage-soft)' : 'var(--surface)', color: checked ? 'var(--sage-ink)' : 'var(--text-ink)',
          border: checked ? '1px solid rgba(91,146,121,.3)' : '1.5px solid var(--border-line)',
        }}>{checked ? '✓ Checked' : 'Check'}</button>
      </td>
    </tr>
  )
}
