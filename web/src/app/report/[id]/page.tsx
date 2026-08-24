'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
import { captureDrawingWithMarkup } from '@/lib/captureDrawing'
import dynamic from 'next/dynamic'

const OnlyOfficeEditor = dynamic(() => import('@/components/OnlyOfficeEditor'), { ssr: false })

// ── TYPES ──────────────────────────────────────────────────────────────────────
type Inspection = {
  id: string; date: string; report_no: string; weather: string
  site_contact: string; contact_phone: string; purpose: string
}
type PageData = {
  inspection: Inspection
  project: { name: string; project_number: string } | null
  engineerName: string
}
type SelectedPhoto = {
  url: string; observationId: string; zoneLabel: string; selected: boolean
}
type DrawingInfo = {
  id: string; title: string; number: string; revision: string
  file_url: string; zone_count: number
  selected: boolean; captured: boolean; capturing: boolean
  capturedBlob: Blob | null; previewUrl: string | null
}

// ── MAIN PAGE ──────────────────────────────────────────────────────────────────
export default function ReportPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  const inspectionId = id

  const [pageData,           setPageData]           = useState<PageData | null>(null)
  const [loading,            setLoading]             = useState(true)
  const [reportStatus,       setReportStatus]        = useState('pending')
  const [finalisingReport,   setFinalisingReport]    = useState(false)
  const [docReady,           setDocReady]            = useState(false)
  const [generating,         setGenerating]          = useState(false)
  const [generatingAI,       setGeneratingAI]        = useState(false)
  const [editorKey,          setEditorKey]           = useState(0)
  const [selectedPhotos,     setSelectedPhotos]      = useState<SelectedPhoto[]>([])
  const [drawings,           setDrawings]            = useState<DrawingInfo[]>([])
  const [loadingAttachments, setLoadingAttachments]  = useState(false)
  const [downloading,        setDownloading]         = useState(false)
  const [editorError,        setEditorError]         = useState(false)
  const [inserting,          setInserting]           = useState(false)
  const [reloadingEditor,    setReloadingEditor]     = useState(false)
  const [mobileTab,          setMobileTab]            = useState<'document' | 'attachments'>('document')

  // ── LOAD DATA ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const [inspRes, memberRes] = await Promise.all([
        supabase.from('inspections').select('*, projects(name, project_number)').eq('id', id).single(),
        supabase.from('firm_members').select('full_name, firm_id, role').eq('user_id', user.id).single(),
      ])

      setPageData({
        inspection:  inspRes.data as Inspection,
        project:     (inspRes.data as any)?.projects ?? null,
        engineerName: memberRes.data?.full_name ?? '',
      })
      setReportStatus((inspRes.data as any)?.report_status ?? 'pending')
      setLoading(false)

      loadAttachments(id)
      generateDoc()

      checkOnlyOffice().then(running => {
        if (!running) {
          console.warn(
            '[ReportPage] OnlyOffice not detected at',
            process.env.NEXT_PUBLIC_ONLYOFFICE_SERVER_URL ?? 'http://localhost'
          )
        }
      })
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // ── ONLYOFFICE HEALTH CHECK ──────────────────────────────────────────────────
  const checkOnlyOffice = async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/docs/health', { signal: AbortSignal.timeout(5000) })
      const data = await res.json()
      return data.healthy === true
    } catch {
      return false
    }
  }

  // ── GENERATE DOC ─────────────────────────────────────────────────────────────
  const generateDoc = useCallback(async () => {
    setGenerating(true)
    try {
      const res = await fetch('/api/docs/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ inspectionId }),
      })
      if (!res.ok) throw new Error('Generate failed')
      const data = await res.json()
      setDocReady(true)
      if (data.skipped) {
        // Doc already exists — show the editor without changing the OO session key.
        // A stable editorKey means force-save in finaliseReport always targets
        // the correct active OO session.
        console.log('[generateDoc] Doc exists, showing without remount')
      } else {
        // Newly created — remount editor so OO loads the fresh file.
        console.log('[generateDoc] New doc generated, remounting editor')
        setReloadingEditor(true)
        setEditorKey(prev => prev + 1)
        setTimeout(() => setReloadingEditor(false), 4000)
      }
    } catch (err) {
      console.error('[generateDoc] error:', err)
      alert('Could not generate document. Please refresh.')
    } finally {
      setGenerating(false)
    }
  }, [inspectionId])

  // ── AI GENERATE ──────────────────────────────────────────────────────────────
  const generateAIReport = async () => {
    if (!confirm('Generate AI report content? This will replace the current document.')) return
    setGeneratingAI(true)
    try {
      const res = await fetch('/api/docs/ai-generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ inspectionId }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'AI generation failed')
      }
      const data = await res.json()
      console.log('[ai-generate] Success:', data)
      setReloadingEditor(true)
      setEditorKey(prev => prev + 1)
      setTimeout(() => setReloadingEditor(false), 4000)
    } catch (err: any) {
      console.error('[generateAIReport] error:', err)
      alert('AI generation failed: ' + err.message)
    } finally {
      setGeneratingAI(false)
    }
  }

  // ── DOWNLOAD DOC (appends selected attachments at download time) ──────────────
  const downloadDoc = async () => {
    try {
      setDownloading(true)

      const selectedPhotosList = selectedPhotos
        .filter(p => p.selected)
        .map(p => ({ url: p.url, zoneLabel: p.zoneLabel }))

      const selectedDrawingsList = drawings
        .filter(d => d.selected && d.captured && d.capturedBlob)

      const hasAttachments =
        selectedPhotosList.length > 0 ||
        selectedDrawingsList.length > 0

      if (hasAttachments) {
        const drawingsWithData = await Promise.all(
          selectedDrawingsList.map(async d => {
            if (!d.capturedBlob) return null
            const buf    = await d.capturedBlob.arrayBuffer()
            const base64 = Buffer.from(buf).toString('base64')
            return {
              title:    d.title,
              number:   d.number,
              revision: d.revision,
              dataUrl:  `data:image/png;base64,${base64}`,
            }
          })
        )
        const validDrawings = drawingsWithData.filter(Boolean)

        const appendRes = await fetch('/api/docs/append', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            inspectionId,
            photos:   selectedPhotosList,
            drawings: validDrawings,
          }),
        })

        if (!appendRes.ok) {
          const err = await appendRes.json()
          throw new Error('Could not attach photos: ' + (err.error || 'Unknown error'))
        }
      }

      const res = await fetch(
        `/api/docs/${inspectionId}?download=true&t=${Date.now()}`,
        { cache: 'no-store' }
      )
      if (!res.ok) throw new Error('Document not ready. Generate the report first.')

      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `SiteReport_${reportNo || inspectionId}.docx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

    } catch (err: any) {
      console.error('Download error:', err)
      alert('Download failed: ' + err.message)
    } finally {
      setDownloading(false)
    }
  }

  // ── INSERT ATTACHMENTS INTO EDITOR ───────────────────────────────────────────
  const insertAttachments = async () => {
    const photos = selectedPhotos
      .filter(p => p.selected)
      .map(p => ({ url: p.url, zoneLabel: p.zoneLabel }))

    const drawingsList: any[] = []
    for (const d of drawings.filter(dr => dr.selected && dr.captured && dr.capturedBlob)) {
      const buf = await d.capturedBlob!.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      const base64 = btoa(binary)
      drawingsList.push({
        title: d.title,
        number: d.number,
        revision: d.revision || 'A',
        pngBase64: `data:image/png;base64,${base64}`,
      })
    }

    if (photos.length === 0 && drawingsList.length === 0) {
      alert('Select photos or drawings first.')
      return
    }

    setInserting(true)
    try {
      const res = await fetch('/api/docs/append', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inspectionId,
          photos,
          drawings: drawingsList,
        }),
      })
      const data = await res.json()
      console.log('[insert] Result:', data)
      if (!res.ok) throw new Error(data.error)

      setReloadingEditor(true)
      setEditorKey(prev => prev + 1)
      setMobileTab('document')
      setTimeout(() => setReloadingEditor(false), 3000)

    } catch (err: any) {
      alert('Insert failed: ' + err.message)
    } finally {
      setInserting(false)
    }
  }

  // ── FINALISE / REOPEN ─────────────────────────────────────────────────────────
  const finaliseReport = async () => {
    if (!confirm('Finalise this report? It will move to Completed. You can still edit it later.')) return
    setFinalisingReport(true)
    try {
      // Force-save the OO document before updating status.
      // Without this, edits in OO memory may not yet be in Supabase.
      const docKey = `doc-${inspectionId}-${editorKey}`
      console.log('[finalise] Force saving OO doc, key:', docKey)
      try {
        const fsRes = await fetch('/api/docs/forcesave', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: docKey }),
        })
        const fsData = await fsRes.json().catch(() => ({}))
        console.log('[finalise] Force save response:', JSON.stringify(fsData))
        // Wait for OO to call our callback AND for Supabase upload to complete.
        // error:0 = success, error:6 = no active session (OO already closed the
        // doc and sent status-2 callback earlier, so Supabase already has it).
        console.log('[finalise] Waiting for callback to complete...')
        await new Promise(r => setTimeout(r, 8000))
      } catch (fsErr) {
        console.warn('[finalise] Force save failed, continuing:', fsErr)
      }

      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('inspections')
        .update({ report_status: 'finalised', finalised_at: new Date().toISOString(), finalised_by: user?.id })
        .eq('id', id)
      if (error) throw error

      setReportStatus('finalised')
      console.log('[finalise] Done')
    } catch (err: any) {
      console.error('[finalise] Error:', err)
      alert('Could not finalise report: ' + err.message)
    } finally {
      setFinalisingReport(false)
    }
  }

  const reopenReport = async () => {
    if (!confirm('Move this report back to Pending for editing?')) return
    await supabase
      .from('inspections')
      .update({ report_status: 'pending', finalised_at: null, finalised_by: null })
      .eq('id', id)
    setReportStatus('pending')
  }

  // ── LOAD ATTACHMENTS ──────────────────────────────────────────────────────────
  const loadAttachments = useCallback(async (inspId: string) => {
    setLoadingAttachments(true)
    console.log('[loadAttachments] Loading for inspection:', inspId)
    try {
      const { data: obsData, error: obsError } = await supabase
        .from('observations')
        .select('id, zone_label, photos, transcript, severity, zone_id')
        .eq('inspection_id', inspId)

      if (obsError) console.error('[loadAttachments] observations error:', obsError)
      console.log('[loadAttachments] Observations loaded:', obsData?.length ?? 0)

      console.log('=== PHOTO DEBUG ===')
      console.log('Total observations:', obsData?.length ?? 0)
      obsData?.forEach((ob: any, i: number) => {
        console.log(`Obs ${i}:`, {
          id: ob.id,
          zone_label: ob.zone_label,
          photos_raw: ob.photos,
          photos_type: typeof ob.photos,
          is_array: Array.isArray(ob.photos),
          is_null: ob.photos === null,
          is_string: typeof ob.photos === 'string',
        })
      })

      const allPhotos: SelectedPhoto[] = []
      ;(obsData ?? []).forEach((ob: any) => {
        let photos: string[] = []
        if (Array.isArray(ob.photos)) {
          photos = ob.photos
        } else if (typeof ob.photos === 'string') {
          try { photos = JSON.parse(ob.photos) } catch { photos = [] }
        } else if (ob.photos && typeof ob.photos === 'object') {
          photos = Object.values(ob.photos) as string[]
        }
        console.log(`[loadAttachments] Zone "${ob.zone_label}": ${photos.length} photos`)
        photos.forEach((url: string) => {
          if (url && typeof url === 'string' && url.startsWith('http')) {
            allPhotos.push({
              url, observationId: ob.id,
              zoneLabel: ob.zone_label || 'General Observation',
              selected: true,
            })
          }
        })
      })
      console.log('[loadAttachments] Total photos found:', allPhotos.length)
      setSelectedPhotos(allPhotos)

      const { data: zonesData, error: zonesError } = await supabase
        .from('zones')
        .select('drawing_id, drawings (id, title, number, revision, file_url)')
        .eq('inspection_id', inspId)

      if (zonesError) console.error('[loadAttachments] zones error:', zonesError)
      console.log('[loadAttachments] Zones loaded:', zonesData?.length ?? 0)

      const drawingMap = new Map<string, DrawingInfo>()
      ;(zonesData ?? []).forEach((z: any) => {
        const d = z.drawings
        if (!d) return
        if (drawingMap.has(d.id)) {
          drawingMap.get(d.id)!.zone_count++
        } else {
          drawingMap.set(d.id, {
            id: d.id, title: d.title || 'Untitled Drawing',
            number: d.number || '—', revision: d.revision || 'A',
            file_url: d.file_url, zone_count: 1,
            selected: false, captured: false, capturing: false,
            capturedBlob: null, previewUrl: null,
          })
        }
      })
      const drawingList = Array.from(drawingMap.values())
      console.log('[loadAttachments] Drawings found:', drawingList.length)
      setDrawings(drawingList)
    } finally {
      setLoadingAttachments(false)
    }
  }, [])

  // ── CAPTURE DRAWING ───────────────────────────────────────────────────────────
  const captureDrawing = async (drawingId: string) => {
    const drawing = drawings.find(d => d.id === drawingId)
    if (!drawing) return
    setDrawings(prev => prev.map(d => d.id === drawingId ? { ...d, capturing: true } : d))
    try {
      const { data: zonesData } = await supabase
        .from('zones').select('*')
        .eq('drawing_id', drawingId).eq('inspection_id', id)

      const blob       = await captureDrawingWithMarkup(drawing.file_url, (zonesData ?? []) as any[], 1)
      const previewUrl = URL.createObjectURL(blob)
      setDrawings(prev => prev.map(d =>
        d.id === drawingId
          ? { ...d, capturing: false, captured: true, selected: true, capturedBlob: blob, previewUrl }
          : d
      ))
    } catch (err) {
      console.error('[captureDrawing] error:', err)
      setDrawings(prev => prev.map(d => d.id === drawingId ? { ...d, capturing: false } : d))
      alert('Could not capture drawing.')
    }
  }

  // ── TOGGLE HELPERS ────────────────────────────────────────────────────────────
  const togglePhoto = (url: string) => {
    setSelectedPhotos(prev => prev.map(p => p.url === url ? { ...p, selected: !p.selected } : p))
  }
  const toggleAllInZone = (zoneLabel: string) => {
    const zone   = selectedPhotos.filter(p => p.zoneLabel === zoneLabel)
    const allSel = zone.every(p => p.selected)
    setSelectedPhotos(prev => prev.map(p =>
      p.zoneLabel === zoneLabel ? { ...p, selected: !allSel } : p
    ))
  }
  const toggleDrawingSelect = (drawingId: string) => {
    setDrawings(prev => prev.map(d => d.id === drawingId ? { ...d, selected: !d.selected } : d))
  }

  // ── LOADING ───────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: 'var(--paper)', flexDirection: 'column', gap: 12,
    }}>
      <div style={{
        width: 28, height: 28, border: '2px solid var(--indigo)',
        borderTopColor: 'transparent', borderRadius: '50%',
        animation: 'spin .8s linear infinite',
      }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '1.5px', color: 'var(--text-mid)' }}>Loading</div>
    </div>
  )
  if (!pageData) return null

  const projectName     = pageData.project?.name ?? ''
  const reportNo        = pageData.inspection?.report_no ?? ''
  const selPhotoCount   = selectedPhotos.filter(p => p.selected).length
  const selDrawingCount = drawings.filter(d => d.selected && d.captured).length
  const totalAttachments = selPhotoCount + selDrawingCount

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant:wght@400;500;600&family=Outfit:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        :root {
          --white: #ffffff; --off: #f8f7f5; --stone: #f0ede8;
          --line: #e4e0d9; --line2: #ccc8c0; --mid: #9b968d;
          --dark: #2c2a27; --ink: #1a1917; --accent: #2c5282;
          --accent2: #edf2fb; --accent3: #dbeafe;
          --red: #c0392b; --red2: #fdf0ef;
          --green: #27705a; --green2: #e6f4ef;
          --amber: #b8860b; --amber2: #fef9e7;
          --orange: #c05621; --orange2: #fef3e2;
          --f-serif: 'Cormorant', Georgia, serif;
          --f-body: 'Outfit', sans-serif;
          --f-mono: 'JetBrains Mono', monospace;
          --r1: 6px; --r2: 10px; --r3: 14px; --r4: 20px;
        }
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        html,body{height:100%;font-family:var(--f-text);background:var(--paper);-webkit-font-smoothing:antialiased;}
        @keyframes spin{to{transform:rotate(360deg)}}

        /* ── Mobile tab bar (hidden on desktop) ── */
        .mobile-tab-bar { display: none; }

        @media (max-width: 768px) {
          /* Tab bar */
          .mobile-tab-bar { display: flex !important; }

          /* Layout becomes vertical, panels toggled by JS class */
          .report-layout { flex-direction: column !important; }

          /* Document tab active */
          .panel-show-document .report-left-panel  { display: none !important; }
          .panel-show-document .report-editor-area { display: flex !important; width: 100% !important; }

          /* Attachments tab active */
          .panel-show-attachments .report-left-panel  { display: flex !important; width: 100% !important; height: 100% !important; border-right: none !important; border-bottom: 1px solid var(--border-line); }
          .panel-show-attachments .report-editor-area { display: none !important; }

          /* Topbar */
          .report-topbar          { padding: 0 12px !important; flex-wrap: wrap !important; height: auto !important; min-height: 52px !important; gap: 6px !important; }
          .report-topbar-actions  { gap: 6px !important; }
          .report-breadcrumb      { display: none !important; }
          .report-btn-text        { display: none !important; }

          /* Sticky footer on attachments tab */
          .report-panel-footer { position: sticky !important; bottom: 0 !important; z-index: 10 !important; }
        }
      `}</style>

      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--paper)', overflow: 'hidden' }}>

        {/* ── TOPBAR ───────────────────────────────────────────────────────── */}
        <header className="report-topbar" style={{
          height: 56, display: 'flex', alignItems: 'center',
          padding: '0 20px', gap: 12, background: 'var(--surface)',
          borderBottom: '1px solid var(--border-line)', flexShrink: 0, zIndex: 20,
        }}>
          {/* Brand */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <div style={{ width: 22, height: 22, background: 'var(--indigo)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="11" height="11" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            </div>
            <span style={{ fontFamily: 'var(--f-heading)', fontSize: 16, fontWeight: 800, color: 'var(--text-ink)' }}>
              Site<span style={{ color: 'var(--indigo)' }}>IQ</span>
            </span>
          </div>

          <div className="report-breadcrumb" style={{ width: 1, height: 18, background: 'var(--border-line)' }} />

          <button
            onClick={() => router.push('/dashboard')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-mid)', fontSize: 12, fontWeight: 700, fontFamily: 'var(--f-heading)' }}
          >
            ← Dashboard
          </button>

          <div className="report-breadcrumb" style={{ width: 1, height: 18, background: 'var(--border-line)' }} />

          {/* Title */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'var(--f-heading)', fontSize: 15, fontWeight: 700, color: 'var(--text-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {projectName}
            </span>
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--text-mid)' }}>#{reportNo}</span>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: '2px 8px', borderRadius: 99, fontFamily: 'var(--f-heading)', fontSize: 10, fontWeight: 700,
              background: reportStatus === 'finalised' ? 'var(--sage-soft)' : 'var(--marigold-soft)',
              color: reportStatus === 'finalised' ? 'var(--sage-ink)' : 'var(--marigold-ink)',
            }}>
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
              {reportStatus === 'finalised' ? 'Finalised' : 'Pending Review'}
            </span>
          </div>

          {/* Action buttons */}
          <div className="report-topbar-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {editorError && (
              <button
                onClick={() => { setEditorError(false); setEditorKey(prev => prev + 1) }}
                style={{
                  background: 'var(--marigold-soft)', color: 'var(--marigold-ink)',
                  border: '1px solid rgba(224,141,11,0.3)',
                  borderRadius: 'var(--radius-pill)', padding: '7px 14px',
                  fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                }}
              >
                ⚠ Editor Offline — Retry
              </button>
            )}
            {reportStatus === 'pending' ? (
              <button
                onClick={finaliseReport}
                disabled={finalisingReport}
                style={{
                  background: 'var(--sage)', color: 'white', border: 'none', borderRadius: 'var(--radius-pill)',
                  padding: '7px 18px', fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  opacity: finalisingReport ? 0.6 : 1,
                }}
              >
                {finalisingReport
                  ? <>⏳<span className="report-btn-text"> Finalising…</span></>
                  : <>✓<span className="report-btn-text"> Finalise Report</span></>}
              </button>
            ) : (
              <button
                onClick={reopenReport}
                style={{
                  background: 'var(--surface)', color: 'var(--text-ink)',
                  border: '1px solid var(--border-line)', borderRadius: 'var(--radius-pill)',
                  padding: '7px 18px', fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ✏<span className="report-btn-text"> Edit Report</span>
              </button>
            )}
            <button
              onClick={downloadDoc}
              disabled={downloading || !docReady}
              style={{
                background: 'var(--surface)',
                border: '1.5px solid var(--indigo)',
                borderRadius: 'var(--radius-pill)',
                padding: '8px 16px',
                fontFamily: 'var(--f-heading)',
                fontSize: 13,
                fontWeight: 700,
                cursor: downloading || !docReady ? 'not-allowed' : 'pointer',
                color: 'var(--indigo)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                opacity: !docReady ? 0.5 : 1,
                transition: 'all 0.15s',
              }}
            >
              {downloading ? (
                <>
                  <div style={{
                    width: 12, height: 12,
                    border: '2px solid var(--border-line)',
                    borderTopColor: 'var(--indigo)',
                    borderRadius: '50%',
                    animation: 'spin 0.7s linear infinite',
                    flexShrink: 0,
                  }} />
                  <span className="report-btn-text">Preparing...</span>
                </>
              ) : totalAttachments > 0 ? (
                <>⬇<span className="report-btn-text"> Download with {totalAttachments}{totalAttachments === 1 ? ' attachment' : ' attachments'}</span></>
              ) : (
                <>⬇<span className="report-btn-text"> Download</span></>
              )}
            </button>
          </div>
        </header>

        {/* ── MOBILE TAB BAR ───────────────────────────────────────────────── */}
        <div className="mobile-tab-bar" style={{ borderBottom: '1px solid var(--border-line)', background: 'var(--surface)', flexShrink: 0 }}>
          <button
            onClick={() => setMobileTab('document')}
            style={{
              flex: 1, padding: '12px 16px', background: 'none', border: 'none',
              borderBottom: mobileTab === 'document' ? '2px solid var(--indigo)' : '2px solid transparent',
              color: mobileTab === 'document' ? 'var(--indigo)' : 'var(--text-mid)',
              fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700,
              cursor: 'pointer', display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: 6,
            }}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <polyline points="14,2 14,8 20,8"/>
            </svg>
            Document
          </button>
          <button
            onClick={() => setMobileTab('attachments')}
            style={{
              flex: 1, padding: '12px 16px', background: 'none', border: 'none',
              borderBottom: mobileTab === 'attachments' ? '2px solid var(--indigo)' : '2px solid transparent',
              color: mobileTab === 'attachments' ? 'var(--indigo)' : 'var(--text-mid)',
              fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700,
              cursor: 'pointer', display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: 6,
            }}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
            </svg>
            Attachments
            {totalAttachments > 0 && (
              <span style={{
                background: 'var(--indigo)', color: 'white', borderRadius: 99,
                fontSize: 10, fontWeight: 700, padding: '1px 6px',
                fontFamily: 'var(--f-mono)',
              }}>
                {totalAttachments}
              </span>
            )}
          </button>
        </div>

        {/* ── BODY ─────────────────────────────────────────────────────────── */}
        <div className={`report-layout ${mobileTab === 'document' ? 'panel-show-document' : 'panel-show-attachments'}`} style={{ flex: 1, display: 'flex', overflow: 'hidden', background: 'var(--paper)' }}>

          {/* ── LEFT PANEL ───────────────────────────────────────────────── */}
          <div className="report-left-panel" style={{
            width: 272,
            background: 'var(--surface)',
            borderRight: '1px solid var(--border-line)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            flexShrink: 0,
          }}>

            {/* ── INDIGO HEADER ─────────────────────────────────────────── */}
            <div style={{
              background: 'var(--indigo-deep)',
              padding: '14px 16px',
              flexShrink: 0,
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 12,
              }}>
                <div>
                  <div style={{ fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 800, color: 'white', lineHeight: 1 }}>
                    Attachments
                  </div>
                  <div style={{ fontFamily: 'var(--f-text)', fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 3 }}>
                    Included when you download
                  </div>
                </div>
              </div>

              {/* 3 stat counters */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                {([
                  {
                    label: 'Photos',
                    value: selPhotoCount,
                    total: selectedPhotos.length,
                    highlight: false,
                  },
                  {
                    label: 'Drawings',
                    value: selDrawingCount,
                    total: drawings.length,
                    highlight: false,
                  },
                  {
                    label: 'Total',
                    value: totalAttachments,
                    total: null as number | null,
                    highlight: true,
                  },
                ] as const).map(stat => (
                  <div
                    key={stat.label}
                    style={{
                      background: stat.highlight
                        ? 'rgba(255,255,255,0.15)'
                        : 'rgba(255,255,255,0.1)',
                      borderRadius: 8,
                      padding: '8px 10px',
                      textAlign: 'center',
                      border: stat.highlight
                        ? '1px solid rgba(255,255,255,0.2)'
                        : 'none',
                    }}
                  >
                    <div style={{
                      fontSize: 20,
                      fontWeight: 700,
                      color: 'white',
                      lineHeight: 1,
                      fontFamily: 'var(--f-mono)',
                    }}>
                      {stat.value}
                      {stat.total !== null && (
                        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}>
                          /{stat.total}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 3 }}>
                      {stat.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── AI GENERATE BUTTON ──────────────────────────────────── */}
            <div style={{
              padding: '12px 14px',
              borderBottom: '1px solid var(--border-line)',
              flexShrink: 0,
            }}>
              <button
                onClick={generateAIReport}
                disabled={generatingAI || !docReady}
                style={{
                  width: '100%',
                  background: generatingAI ? 'var(--paper)' : 'var(--marigold)',
                  color: generatingAI ? 'var(--text-mid)' : 'var(--indigo-deep)',
                  border: 'none',
                  borderRadius: 'var(--radius-pill)',
                  padding: '10px 14px',
                  fontFamily: 'var(--f-heading)',
                  fontSize: 13,
                  fontWeight: 800,
                  cursor: generatingAI || !docReady ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 7,
                  transition: 'all 0.15s',
                  opacity: !docReady ? 0.5 : 1,
                  boxShadow: generatingAI ? 'none' : 'var(--shadow-glow-v3)',
                }}
              >
                {generatingAI ? (
                  <>
                    <div style={{
                      width: 13, height: 13,
                      border: '2px solid var(--border-line)',
                      borderTopColor: 'var(--indigo)',
                      borderRadius: '50%',
                      animation: 'spin 0.7s linear infinite',
                    }} />
                    Generating...
                  </>
                ) : '✨ Generate AI Report'}
              </button>
            </div>

            {/* ── SCROLLABLE CONTENT ──────────────────────────────────── */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px' }}>

              {loadingAttachments ? (
                <div style={{
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  padding: '32px 16px', gap: 12,
                  color: 'var(--text-mid)', fontSize: 13,
                }}>
                  <div style={{
                    width: 24, height: 24,
                    border: '2px solid var(--border-line)',
                    borderTopColor: 'var(--indigo)',
                    borderRadius: '50%',
                    animation: 'spin 0.7s linear infinite',
                  }} />
                  Loading attachments...
                </div>
              ) : (
                <>
                  {/* ── DRAWINGS ──────────────────────────────────────── */}
                  <div style={{ marginBottom: 20 }}>
                    <div style={{
                      display: 'flex', alignItems: 'center',
                      justifyContent: 'space-between', marginBottom: 10,
                    }}>
                      <div style={{
                        fontFamily: 'var(--f-heading)', fontSize: 11,
                        fontWeight: 700, textTransform: 'uppercase',
                        letterSpacing: '1.2px', color: 'var(--text-mid)',
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                        <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                          <polyline points="14,2 14,8 20,8"/>
                        </svg>
                        Drawings
                      </div>
                    </div>

                    {drawings.length === 0 ? (
                      <div style={{
                        background: 'var(--paper)', borderRadius: 'var(--radius-sm)',
                        padding: '16px 14px', textAlign: 'center',
                        fontFamily: 'var(--f-text)', fontSize: 12, color: 'var(--text-mid)', lineHeight: 1.5,
                      }}>
                        No drawings were marked up during this inspection
                      </div>
                    ) : drawings.map(d => (
                      <div
                        key={d.id}
                        style={{
                          border: `1.5px solid ${d.selected && d.captured ? 'var(--sage)' : 'var(--border-line)'}`,
                          borderRadius: 'var(--radius-sm)', marginBottom: 8,
                          overflow: 'hidden',
                          background: d.selected && d.captured ? 'var(--sage-soft)' : 'var(--surface)',
                          transition: 'all 0.15s',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px' }}>
                          {/* Checkbox-style capture/toggle control */}
                          <div
                            onClick={() => {
                              if (d.captured) {
                                toggleDrawingSelect(d.id)
                              } else {
                                captureDrawing(d.id)
                              }
                            }}
                            style={{
                              width: 20, height: 20, borderRadius: 6,
                              border: `2px solid ${d.captured && d.selected ? 'var(--sage)' : d.capturing ? 'var(--indigo)' : 'var(--border-line)'}`,
                              background: d.captured && d.selected ? 'var(--sage)' : 'var(--paper)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              cursor: d.capturing ? 'not-allowed' : 'pointer',
                              flexShrink: 0, transition: 'all 0.15s',
                            }}
                          >
                            {d.capturing ? (
                              <div style={{
                                width: 10, height: 10,
                                border: '1.5px solid var(--border-line)',
                                borderTopColor: 'var(--indigo)',
                                borderRadius: '50%',
                                animation: 'spin 0.7s linear infinite',
                              }} />
                            ) : d.captured && d.selected ? (
                              <svg width="10" height="10" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
                                <polyline points="20,6 9,17 4,12"/>
                              </svg>
                            ) : d.captured ? (
                              <div style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--border-line)' }} />
                            ) : (
                              <svg width="10" height="10" fill="none" stroke="var(--text-mid)" strokeWidth="1.8" viewBox="0 0 24 24">
                                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                                <circle cx="12" cy="13" r="4"/>
                              </svg>
                            )}
                          </div>

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontFamily: 'var(--f-text)', fontSize: 12, fontWeight: 600, color: 'var(--text-ink)',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {d.title}
                            </div>
                            <div style={{
                              fontFamily: 'var(--f-mono)', fontSize: 10,
                              color: 'var(--text-mid)', marginTop: 2,
                              display: 'flex', alignItems: 'center', gap: 4,
                            }}>
                              {d.number} · {d.zone_count} zone{d.zone_count !== 1 ? 's' : ''}
                              {' · '}
                              {d.capturing ? (
                                <span style={{ color: 'var(--indigo)' }}>Capturing...</span>
                              ) : d.captured ? (
                                <span style={{ color: 'var(--sage-ink)' }}>✓ Ready</span>
                              ) : (
                                <span style={{ color: 'var(--marigold-ink)' }}>Tap to capture</span>
                              )}
                            </div>
                          </div>
                        </div>

                        {d.previewUrl && (
                          <div style={{ borderTop: '1px solid var(--border-line)', overflow: 'hidden', maxHeight: 100 }}>
                            <img
                              src={d.previewUrl}
                              alt={d.title}
                              style={{ width: '100%', display: 'block', objectFit: 'contain', background: 'var(--paper)' }}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* ── DIVIDER ───────────────────────────────────────── */}
                  <div style={{ height: 1, background: 'var(--border-line)', margin: '4px 0 16px' }} />

                  {/* ── PHOTOS ────────────────────────────────────────── */}
                  <div>
                    <div style={{
                      display: 'flex', alignItems: 'center',
                      justifyContent: 'space-between', marginBottom: 10,
                    }}>
                      <div style={{
                        fontFamily: 'var(--f-heading)', fontSize: 11,
                        fontWeight: 700, textTransform: 'uppercase',
                        letterSpacing: '1.2px', color: 'var(--text-mid)',
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                        <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                          <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                          <circle cx="12" cy="13" r="4"/>
                        </svg>
                        Photos ({selPhotoCount}/{selectedPhotos.length})
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => setSelectedPhotos(prev => prev.map(p => ({ ...p, selected: true })))}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            fontSize: 11, color: 'var(--indigo)', fontWeight: 700,
                            fontFamily: 'var(--f-heading)', padding: '2px 4px',
                          }}
                        >All</button>
                        <button
                          onClick={() => setSelectedPhotos(prev => prev.map(p => ({ ...p, selected: false })))}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            fontSize: 11, color: 'var(--text-mid)',
                            fontFamily: 'var(--f-heading)', fontWeight: 700, padding: '2px 4px',
                          }}
                        >None</button>
                      </div>
                    </div>

                    {selectedPhotos.length === 0 ? (
                      <div style={{
                        background: 'var(--paper)', borderRadius: 'var(--radius-sm)',
                        padding: '16px 14px', textAlign: 'center',
                        fontFamily: 'var(--f-text)', fontSize: 12, color: 'var(--text-mid)', lineHeight: 1.5,
                      }}>
                        No photos were taken during this inspection
                      </div>
                    ) : (
                      Object.entries(
                        selectedPhotos.reduce(
                          (acc, p) => {
                            if (!acc[p.zoneLabel]) acc[p.zoneLabel] = []
                            acc[p.zoneLabel].push(p)
                            return acc
                          },
                          {} as Record<string, SelectedPhoto[]>
                        )
                      ).map(([zone, photos]) => (
                        <div key={zone} style={{ marginBottom: 16 }}>
                          {/* Zone header */}
                          <div
                            onClick={() => toggleAllInZone(zone)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              padding: '7px 10px', background: 'var(--paper)',
                              borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                              marginBottom: 8, transition: 'background 0.12s',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--border-line)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'var(--paper)')}
                          >
                            <div
                              style={{
                                width: 16, height: 16, borderRadius: 5,
                                border: `2px solid ${photos.every(p => p.selected) ? 'var(--sage)' : 'var(--border-line)'}`,
                                background: photos.every(p => p.selected) ? 'var(--sage)' : 'var(--surface)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                flexShrink: 0, transition: 'all 0.12s',
                              }}
                              onClick={e => { e.stopPropagation(); toggleAllInZone(zone) }}
                            >
                              {photos.every(p => p.selected) && (
                                <svg width="8" height="8" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
                                  <polyline points="20,6 9,17 4,12"/>
                                </svg>
                              )}
                            </div>
                            <span style={{ flex: 1, fontFamily: 'var(--f-heading)', fontSize: 12, fontWeight: 700, color: 'var(--text-ink)' }}>
                              {zone}
                            </span>
                            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--text-mid)' }}>
                              {photos.filter(p => p.selected).length}/{photos.length}
                            </span>
                          </div>

                          {/* Photo grid — 2 columns */}
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(2, 1fr)',
                            gap: 6,
                          }}>
                            {photos.map(photo => (
                              <div
                                key={photo.url}
                                onClick={() => togglePhoto(photo.url)}
                                style={{
                                  position: 'relative',
                                  aspectRatio: '4/3',
                                  cursor: 'pointer',
                                  borderRadius: 'var(--radius-sm)',
                                  overflow: 'hidden',
                                  border: `2px solid ${photo.selected ? 'var(--sage)' : 'transparent'}`,
                                  opacity: photo.selected ? 1 : 0.35,
                                  transition: 'all 0.15s',
                                  transform: photo.selected ? 'scale(1)' : 'scale(0.97)',
                                }}
                              >
                                <img
                                  src={photo.url}
                                  alt={photo.zoneLabel}
                                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                                />
                                {photo.selected && (
                                  <div style={{
                                    position: 'absolute', top: 5, right: 5,
                                    width: 18, height: 18,
                                    background: 'var(--sage)',
                                    borderRadius: '50%',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                                  }}>
                                    <svg width="9" height="9" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
                                      <polyline points="20,6 9,17 4,12"/>
                                    </svg>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>

            {/* ── FOOTER ──────────────────────────────────────────────── */}
            <div className="report-panel-footer" style={{
              padding: '12px 14px',
              borderTop: '1px solid var(--border-line)',
              background: 'var(--paper)',
              flexShrink: 0,
            }}>
              {/* Summary text */}
              <div style={{
                fontSize: 11, color: 'var(--text-mid)',
                textAlign: 'center', marginBottom: 10,
                fontFamily: 'var(--f-mono)', lineHeight: 1.5,
              }}>
                {(() => {
                  const pc = selPhotoCount
                  const dc = selDrawingCount
                  const zc = new Set(
                    selectedPhotos.filter(p => p.selected).map(p => p.zoneLabel)
                  ).size

                  if (pc === 0 && dc === 0) {
                    return (
                      <span style={{ color: 'var(--text-mid)' }}>
                        Select photos or drawings to include in report
                      </span>
                    )
                  }

                  const parts: string[] = []
                  if (pc > 0) parts.push(
                    `${pc} photo${pc !== 1 ? 's' : ''}` +
                    (zc > 0 ? ` from ${zc} zone${zc !== 1 ? 's' : ''}` : '')
                  )
                  if (dc > 0) parts.push(`${dc} drawing${dc !== 1 ? 's' : ''}`)

                  return (
                    <span style={{ color: 'var(--text-ink)' }}>
                      {parts.join(' · ')}
                      <br />
                      <span style={{ color: 'var(--sage-ink)', fontWeight: 700 }}>
                        ✓ Will be included on download
                      </span>
                    </span>
                  )
                })()}
              </div>

              {/* Insert into Document button */}
              <button
                onClick={insertAttachments}
                disabled={inserting || !docReady ||
                  (selectedPhotos.filter(p => p.selected).length === 0
                  && drawings.filter(d => d.selected && d.captured).length === 0)}
                style={{
                  width: '100%',
                  background: inserting ? 'var(--paper)' : 'var(--indigo)',
                  color: inserting ? 'var(--text-mid)' : 'white',
                  border: 'none',
                  borderRadius: 'var(--radius-pill)',
                  padding: '11px 14px',
                  fontFamily: 'var(--f-heading)',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 7,
                  marginBottom: 8,
                  opacity: (!docReady ||
                    (selectedPhotos.filter(p => p.selected).length === 0
                    && drawings.filter(d => d.selected && d.captured).length === 0))
                    ? 0.5 : 1,
                }}
              >
                {inserting ? '⏳ Inserting...' : 'Insert into Document'}
              </button>

              {/* Download button */}
              <button
                onClick={downloadDoc}
                disabled={downloading || !docReady}
                style={{
                  width: '100%',
                  background: downloading ? 'var(--paper)' : 'var(--indigo)',
                  color: downloading ? 'var(--text-mid)' : 'white',
                  border: 'none',
                  borderRadius: 'var(--radius-pill)',
                  padding: '11px 14px',
                  fontFamily: 'var(--f-heading)',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: downloading || !docReady ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 7,
                  transition: 'all 0.15s',
                  opacity: !docReady ? 0.5 : 1,
                }}
              >
                {downloading ? (
                  <>
                    <div style={{
                      width: 13, height: 13,
                      border: '2px solid var(--border-line)',
                      borderTopColor: 'white',
                      borderRadius: '50%',
                      animation: 'spin 0.7s linear infinite',
                    }} />
                    Preparing download...
                  </>
                ) : totalAttachments > 0
                  ? `⬇ Download with ${totalAttachments} attachment${totalAttachments !== 1 ? 's' : ''}`
                  : '⬇ Download Report'
                }
              </button>
            </div>
          </div>

          {/* ── ONLYOFFICE EDITOR ────────────────────────────────────────── */}
          <div className="report-editor-area" style={{ flex: 1, overflow: 'hidden', position: 'relative', background: 'var(--paper)' }}>
            {generating ? (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                height: '100%', flexDirection: 'column', gap: 16,
                background: 'var(--paper)',
              }}>
                <div style={{
                  width: 40, height: 40, border: '3px solid var(--border-line)',
                  borderTopColor: 'var(--indigo)', borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }} />
                <div style={{
                  fontSize: 14, color: 'var(--text-mid)',
                  fontFamily: 'var(--f-mono)',
                  textTransform: 'uppercase', letterSpacing: '1px',
                }}>
                  Preparing document…
                </div>
              </div>
            ) : docReady ? (
              <div style={{
                height: '100%',
                padding: '16px 20px',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}>
                <div style={{
                  flex: 1,
                  overflow: 'hidden',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-card-v3)',
                  border: '1px solid var(--border-line)',
                }}>
                  <OnlyOfficeEditor
                    key={editorKey}
                    sessionKey={editorKey}
                    inspectionId={inspectionId}
                    fileName={`Report_${reportNo || inspectionId}.docx`}
                    editable={reportStatus !== 'finalised'}
                    onReady={() => { console.log('[OnlyOffice] editor ready'); setEditorError(false) }}
                    onError={() => setEditorError(true)}
                  />
                </div>
              </div>
            ) : null}
            {reloadingEditor && (
              <div style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(250,248,244,0.9)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 14,
                zIndex: 20,
                borderRadius: 'var(--radius-md)',
              }}>
                <div style={{
                  width: 36, height: 36,
                  border: '3px solid var(--border-line)',
                  borderTopColor: 'var(--indigo)',
                  borderRadius: '50%',
                  animation: 'spin 0.7s linear infinite',
                }}/>
                <div style={{
                  fontSize: 14, color: 'var(--text-mid)',
                  fontFamily: 'var(--f-mono)',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}>
                  Updating document...
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  )
}
