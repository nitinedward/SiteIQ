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

  // ── LOAD DATA ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

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
    const ooUrl = process.env.NEXT_PUBLIC_ONLYOFFICE_SERVER_URL ?? 'http://localhost'
    try {
      const res = await fetch(`${ooUrl}/healthcheck`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      })
      return res.ok
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
      setDocReady(true)
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
      if (!res.ok) throw new Error('AI generation failed')
      setEditorKey(prev => prev + 1)
      alert('AI report generated. The editor will reload with the new content.')
    } catch (err) {
      console.error('[generateAIReport] error:', err)
      alert('AI generation failed. Please try again.')
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

      const res = await fetch(`/api/docs/${inspectionId}?download=true`)
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
    const { data: { user } } = await supabase.auth.getUser()
    await supabase
      .from('inspections')
      .update({ report_status: 'finalised', finalised_at: new Date().toISOString(), finalised_by: user?.id })
      .eq('id', id)
    setReportStatus('finalised')
    setFinalisingReport(false)
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
      height: '100vh', background: '#f8f7f5', flexDirection: 'column', gap: 12,
    }}>
      <div style={{
        width: 28, height: 28, border: '2px solid #2c5282',
        borderTopColor: 'transparent', borderRadius: '50%',
        animation: 'spin .8s linear infinite',
      }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, textTransform: 'uppercase', letterSpacing: '1.5px', color: '#9b968d' }}>Loading</div>
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
        html,body{height:100%;font-family:'Outfit',sans-serif;background:#f8f7f5;-webkit-font-smoothing:antialiased;}
        @keyframes spin{to{transform:rotate(360deg)}}
      `}</style>

      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#f8f7f5', overflow: 'hidden' }}>

        {/* ── TOPBAR ───────────────────────────────────────────────────────── */}
        <header style={{
          height: 56, display: 'flex', alignItems: 'center',
          padding: '0 20px', gap: 12, background: '#ffffff',
          borderBottom: '1px solid #e4e0d9', flexShrink: 0, zIndex: 20,
        }}>
          {/* Brand */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <div style={{ width: 22, height: 22, background: '#2c5282', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="11" height="11" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            </div>
            <span style={{ fontFamily: "'Cormorant',serif", fontSize: 17, fontWeight: 600, color: '#1a1917' }}>
              Site<span style={{ color: '#2c5282' }}>IQ</span>
            </span>
          </div>

          <div style={{ width: 1, height: 18, background: '#e4e0d9' }} />

          <button
            onClick={() => router.push('/dashboard')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2c5282', fontSize: 12, fontWeight: 500, fontFamily: "'Outfit',sans-serif" }}
          >
            ← Dashboard
          </button>

          <div style={{ width: 1, height: 18, background: '#e4e0d9' }} />

          {/* Title */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: "'Cormorant',serif", fontSize: 16, fontWeight: 600, color: '#1a1917', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {projectName}
            </span>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: '#9b968d' }}>#{reportNo}</span>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 600,
              background: reportStatus === 'finalised' ? '#e6f4ef' : '#fef9e7',
              color: reportStatus === 'finalised' ? '#27705a' : '#b8860b',
            }}>
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
              {reportStatus === 'finalised' ? 'Finalised' : 'Pending Review'}
            </span>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {editorError && (
              <button
                onClick={() => { setEditorError(false); setEditorKey(prev => prev + 1) }}
                style={{
                  background: '#fef9e7', color: '#b8860b',
                  border: '1px solid rgba(184,134,11,0.3)',
                  borderRadius: 7, padding: '7px 14px',
                  fontSize: 13, fontWeight: 500, cursor: 'pointer',
                  fontFamily: "'Outfit',sans-serif",
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
                  background: '#27705a', color: 'white', border: 'none', borderRadius: 7,
                  padding: '7px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  fontFamily: "'Outfit',sans-serif", opacity: finalisingReport ? 0.6 : 1,
                }}
              >
                {finalisingReport ? 'Finalising…' : '✓ Finalise Report'}
              </button>
            ) : (
              <button
                onClick={reopenReport}
                style={{
                  background: '#ffffff', color: '#2c2a27',
                  border: '1px solid #e4e0d9', borderRadius: 7,
                  padding: '7px 18px', fontSize: 13, fontWeight: 500,
                  cursor: 'pointer', fontFamily: "'Outfit',sans-serif",
                }}
              >
                ✏ Edit Report
              </button>
            )}
            <button
              onClick={downloadDoc}
              disabled={downloading || !docReady}
              style={{
                background: 'var(--white)',
                border: '1.5px solid var(--line)',
                borderRadius: 'var(--r2)',
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 500,
                cursor: downloading || !docReady ? 'not-allowed' : 'pointer',
                color: 'var(--dark)',
                fontFamily: 'var(--f-body)',
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
                    border: '2px solid var(--line)',
                    borderTopColor: 'var(--accent)',
                    borderRadius: '50%',
                    animation: 'spin 0.7s linear infinite',
                    flexShrink: 0,
                  }} />
                  Preparing...
                </>
              ) : totalAttachments > 0 ? (
                <>⬇ Download with {totalAttachments}{totalAttachments === 1 ? ' attachment' : ' attachments'}</>
              ) : (
                <>⬇ Download</>
              )}
            </button>
          </div>
        </header>

        {/* ── BODY ─────────────────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: '#e8e4de' }}>

          {/* ── LEFT PANEL ───────────────────────────────────────────────── */}
          <div style={{
            width: 272,
            background: 'var(--white)',
            borderRight: '1px solid var(--line)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            flexShrink: 0,
          }}>

            {/* ── NAVY HEADER ─────────────────────────────────────────── */}
            <div style={{
              background: 'var(--accent)',
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
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'white', lineHeight: 1 }}>
                    Attachments
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 3 }}>
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
                      color: stat.highlight ? '#4ade80' : 'white',
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
              borderBottom: '1px solid var(--line)',
              flexShrink: 0,
            }}>
              <button
                onClick={generateAIReport}
                disabled={generatingAI || !docReady}
                style={{
                  width: '100%',
                  background: generatingAI ? 'var(--stone)' : 'var(--accent)',
                  color: generatingAI ? 'var(--mid)' : 'white',
                  border: 'none',
                  borderRadius: 8,
                  padding: '10px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: generatingAI || !docReady ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--f-body)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 7,
                  transition: 'all 0.15s',
                  opacity: !docReady ? 0.5 : 1,
                }}
              >
                {generatingAI ? (
                  <>
                    <div style={{
                      width: 13, height: 13,
                      border: '2px solid var(--line2)',
                      borderTopColor: 'var(--accent)',
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
                  color: 'var(--mid)', fontSize: 13,
                }}>
                  <div style={{
                    width: 24, height: 24,
                    border: '2px solid var(--line)',
                    borderTopColor: 'var(--accent)',
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
                        fontFamily: 'var(--f-mono)', fontSize: 10,
                        fontWeight: 700, textTransform: 'uppercase',
                        letterSpacing: '1.2px', color: 'var(--mid)',
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
                        background: 'var(--stone)', borderRadius: 8,
                        padding: '16px 14px', textAlign: 'center',
                        fontSize: 12, color: 'var(--mid)', lineHeight: 1.5,
                      }}>
                        No drawings were marked up during this inspection
                      </div>
                    ) : drawings.map(d => (
                      <div
                        key={d.id}
                        style={{
                          border: `1.5px solid ${d.selected && d.captured ? 'var(--accent)' : 'var(--line)'}`,
                          borderRadius: 10, marginBottom: 8,
                          overflow: 'hidden',
                          background: d.selected && d.captured ? 'var(--accent2)' : 'var(--white)',
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
                              width: 20, height: 20, borderRadius: 5,
                              border: `2px solid ${d.captured && d.selected ? 'var(--accent)' : d.capturing ? 'var(--accent)' : 'var(--line2)'}`,
                              background: d.captured && d.selected ? 'var(--accent)' : 'var(--stone)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              cursor: d.capturing ? 'not-allowed' : 'pointer',
                              flexShrink: 0, transition: 'all 0.15s',
                            }}
                          >
                            {d.capturing ? (
                              <div style={{
                                width: 10, height: 10,
                                border: '1.5px solid var(--line)',
                                borderTopColor: 'var(--accent)',
                                borderRadius: '50%',
                                animation: 'spin 0.7s linear infinite',
                              }} />
                            ) : d.captured && d.selected ? (
                              <svg width="10" height="10" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
                                <polyline points="20,6 9,17 4,12"/>
                              </svg>
                            ) : d.captured ? (
                              <div style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--line2)' }} />
                            ) : (
                              <svg width="10" height="10" fill="none" stroke="var(--mid)" strokeWidth="1.8" viewBox="0 0 24 24">
                                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                                <circle cx="12" cy="13" r="4"/>
                              </svg>
                            )}
                          </div>

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: 12, fontWeight: 600, color: 'var(--ink)',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {d.title}
                            </div>
                            <div style={{
                              fontFamily: 'var(--f-mono)', fontSize: 10,
                              color: 'var(--mid)', marginTop: 2,
                              display: 'flex', alignItems: 'center', gap: 4,
                            }}>
                              {d.number} · {d.zone_count} zone{d.zone_count !== 1 ? 's' : ''}
                              {' · '}
                              {d.capturing ? (
                                <span style={{ color: 'var(--accent)' }}>Capturing...</span>
                              ) : d.captured ? (
                                <span style={{ color: 'var(--green)' }}>✓ Ready</span>
                              ) : (
                                <span style={{ color: 'var(--orange)' }}>Tap to capture</span>
                              )}
                            </div>
                          </div>
                        </div>

                        {d.previewUrl && (
                          <div style={{ borderTop: '1px solid var(--line)', overflow: 'hidden', maxHeight: 100 }}>
                            <img
                              src={d.previewUrl}
                              alt={d.title}
                              style={{ width: '100%', display: 'block', objectFit: 'contain', background: 'var(--stone)' }}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* ── DIVIDER ───────────────────────────────────────── */}
                  <div style={{ height: 1, background: 'var(--line)', margin: '4px 0 16px' }} />

                  {/* ── PHOTOS ────────────────────────────────────────── */}
                  <div>
                    <div style={{
                      display: 'flex', alignItems: 'center',
                      justifyContent: 'space-between', marginBottom: 10,
                    }}>
                      <div style={{
                        fontFamily: 'var(--f-mono)', fontSize: 10,
                        fontWeight: 700, textTransform: 'uppercase',
                        letterSpacing: '1.2px', color: 'var(--mid)',
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
                            fontSize: 11, color: 'var(--accent)', fontWeight: 600,
                            fontFamily: 'var(--f-body)', padding: '2px 4px',
                          }}
                        >All</button>
                        <button
                          onClick={() => setSelectedPhotos(prev => prev.map(p => ({ ...p, selected: false })))}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            fontSize: 11, color: 'var(--mid)',
                            fontFamily: 'var(--f-body)', padding: '2px 4px',
                          }}
                        >None</button>
                      </div>
                    </div>

                    {selectedPhotos.length === 0 ? (
                      <div style={{
                        background: 'var(--stone)', borderRadius: 8,
                        padding: '16px 14px', textAlign: 'center',
                        fontSize: 12, color: 'var(--mid)', lineHeight: 1.5,
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
                              padding: '7px 10px', background: 'var(--stone)',
                              borderRadius: 7, cursor: 'pointer',
                              marginBottom: 8, transition: 'background 0.12s',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--line)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'var(--stone)')}
                          >
                            <div
                              style={{
                                width: 16, height: 16, borderRadius: 4,
                                border: `2px solid ${photos.every(p => p.selected) ? 'var(--accent)' : 'var(--line2)'}`,
                                background: photos.every(p => p.selected) ? 'var(--accent)' : 'var(--white)',
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
                            <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--dark)' }}>
                              {zone}
                            </span>
                            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--mid)' }}>
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
                                  borderRadius: 8,
                                  overflow: 'hidden',
                                  border: `2px solid ${photo.selected ? 'var(--accent)' : 'transparent'}`,
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
                                    background: 'var(--accent)',
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
            <div style={{
              padding: '12px 14px',
              borderTop: '1px solid var(--line)',
              background: 'var(--stone)',
              flexShrink: 0,
            }}>
              {/* Summary text */}
              <div style={{
                fontSize: 11, color: 'var(--mid)',
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
                      <span style={{ color: 'var(--mid)' }}>
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
                    <span style={{ color: 'var(--dark)' }}>
                      {parts.join(' · ')}
                      <br />
                      <span style={{ color: 'var(--green)', fontWeight: 600 }}>
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
                  background: inserting ? 'var(--stone)' : 'var(--accent)',
                  color: inserting ? 'var(--mid)' : 'white',
                  border: 'none',
                  borderRadius: 8,
                  padding: '11px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'var(--f-body)',
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
                  background: downloading ? 'var(--stone)' : 'var(--accent)',
                  color: downloading ? 'var(--mid)' : 'white',
                  border: 'none',
                  borderRadius: 8,
                  padding: '11px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: downloading || !docReady ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--f-body)',
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
                      border: '2px solid var(--line2)',
                      borderTopColor: 'var(--accent)',
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
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative', background: '#e8e4de' }}>
            {generating ? (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                height: '100%', flexDirection: 'column', gap: 16,
                background: '#e8e4de',
              }}>
                <div style={{
                  width: 40, height: 40, border: '3px solid #e4e0d9',
                  borderTopColor: '#2c5282', borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }} />
                <div style={{
                  fontSize: 14, color: '#9b968d',
                  fontFamily: "'JetBrains Mono',monospace",
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
                  borderRadius: '8px',
                  boxShadow: [
                    '0 8px 32px rgba(0,0,0,0.16)',
                    '0 2px 8px rgba(0,0,0,0.08)',
                    '0 0 0 1px rgba(0,0,0,0.06)',
                  ].join(', '),
                  border: '1px solid #ccc8c0',
                }}>
                  <OnlyOfficeEditor
                    key={editorKey}
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
                background: 'rgba(248,247,245,0.9)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 14,
                zIndex: 20,
                borderRadius: 8,
              }}>
                <div style={{
                  width: 36, height: 36,
                  border: '3px solid var(--line)',
                  borderTopColor: 'var(--accent)',
                  borderRadius: '50%',
                  animation: 'spin 0.7s linear infinite',
                }}/>
                <div style={{
                  fontSize: 14, color: 'var(--mid)',
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
