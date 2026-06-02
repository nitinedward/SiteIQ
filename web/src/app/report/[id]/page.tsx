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

  const [pageData,          setPageData]          = useState<PageData | null>(null)
  const [loading,           setLoading]            = useState(true)
  const [reportStatus,      setReportStatus]       = useState('pending')
  const [finalisingReport,  setFinalisingReport]   = useState(false)
  const [docReady,          setDocReady]           = useState(false)
  const [generating,        setGenerating]         = useState(false)
  const [generatingAI,      setGeneratingAI]       = useState(false)
  const [editorKey,         setEditorKey]          = useState(0)
  const [selectedPhotos,    setSelectedPhotos]     = useState<SelectedPhoto[]>([])
  const [drawings,          setDrawings]           = useState<DrawingInfo[]>([])
  const [loadingAttachments, setLoadingAttachments] = useState(false)

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
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

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

  // ── DOWNLOAD DOC ─────────────────────────────────────────────────────────────
  const downloadDoc = () => {
    const url = `/api/docs/${inspectionId}?download=true`
    const a   = document.createElement('a')
    a.href     = url
    a.download = `SiteReport_${pageData?.inspection?.report_no ?? inspectionId}.docx`
    a.click()
  }

  // ── INSERT ATTACHMENTS ────────────────────────────────────────────────────────
  const insertAttachments = async () => {
    const selectedPhotoUrls   = selectedPhotos
      .filter(p => p.selected)
      .map(p => ({ url: p.url, zoneLabel: p.zoneLabel }))
    const selectedDrawingIds  = drawings
      .filter(d => d.selected && d.captured)
      .map(d => d.id)

    const res = await fetch('/api/docs/generate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        inspectionId,
        photos:     selectedPhotoUrls,
        drawingIds: selectedDrawingIds,
      }),
    })

    if (res.ok) {
      setEditorKey(prev => prev + 1)
      alert(
        `Inserted ${selectedPhotoUrls.length} photo${selectedPhotoUrls.length !== 1 ? 's' : ''} ` +
        `and ${selectedDrawingIds.length} drawing${selectedDrawingIds.length !== 1 ? 's' : ''} into the document.`
      )
    } else {
      alert('Could not insert attachments. Please try again.')
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
    try {
      const { data: obsData } = await supabase
        .from('observations')
        .select('id, zone_label, photos, transcript, severity, zone_id')
        .eq('inspection_id', inspId)
        .order('created_at', { ascending: true })

      const allPhotos: SelectedPhoto[] = []
      ;(obsData ?? []).forEach((ob: any) => {
        const photos: string[] = Array.isArray(ob.photos) ? ob.photos
          : (() => { try { return JSON.parse(ob.photos || '[]') } catch { return [] } })()
        photos.forEach(url => {
          allPhotos.push({
            url, observationId: ob.id,
            zoneLabel: ob.zone_label || 'General Observation',
            selected: true,
          })
        })
      })
      setSelectedPhotos(allPhotos)

      const { data: zonesData } = await supabase
        .from('zones')
        .select('drawing_id, drawings (id, title, number, revision, file_url)')
        .eq('inspection_id', inspId)

      const drawingMap = new Map<string, DrawingInfo>()
      ;(zonesData ?? []).forEach((z: any) => {
        const d = z.drawings
        if (!d) return
        if (drawingMap.has(d.id)) {
          drawingMap.get(d.id)!.zone_count++
        } else {
          drawingMap.set(d.id, {
            id: d.id, title: d.title,
            number: d.number || '—', revision: d.revision || 'A',
            file_url: d.file_url, zone_count: 1,
            selected: false, captured: false, capturing: false,
            capturedBlob: null, previewUrl: null,
          })
        }
      })
      setDrawings(Array.from(drawingMap.values()))
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

  const projectName = pageData.project?.name ?? ''
  const reportNo    = pageData.inspection?.report_no ?? ''
  const selPhotoCount   = selectedPhotos.filter(p => p.selected).length
  const selDrawingCount = drawings.filter(d => d.selected && d.captured).length

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant:wght@400;500;600&family=Outfit:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
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
              disabled={!docReady}
              style={{
                background: '#ffffff', color: '#2c5282',
                border: '1px solid #e4e0d9', borderRadius: 7,
                padding: '7px 14px', fontSize: 13, fontWeight: 500,
                cursor: docReady ? 'pointer' : 'not-allowed', fontFamily: "'Outfit',sans-serif",
                opacity: docReady ? 1 : 0.5,
              }}
            >
              ⬇ Download
            </button>
          </div>
        </header>

        {/* ── BODY ─────────────────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* LEFT PANEL */}
          <div style={{
            width: 280, background: '#ffffff',
            borderRight: '1px solid #e4e0d9',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden', flexShrink: 0,
          }}>

            {/* AI Generate */}
            <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid #e4e0d9' }}>
              <button
                onClick={generateAIReport}
                disabled={generatingAI || !docReady}
                style={{
                  width: '100%',
                  background: generatingAI ? '#f0ede8' : '#5b3da8',
                  color: generatingAI ? '#9b968d' : 'white',
                  border: 'none', borderRadius: 8,
                  padding: '10px 14px', fontSize: 13, fontWeight: 600,
                  cursor: generatingAI || !docReady ? 'not-allowed' : 'pointer',
                  fontFamily: "'Outfit',sans-serif",
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  transition: 'all .15s',
                }}
              >
                {generatingAI
                  ? <><span style={{ width: 12, height: 12, border: '2px solid #9b968d', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .8s linear infinite', display: 'inline-block' }} /> Generating…</>
                  : '✦ Generate AI Report'
                }
              </button>
              {!docReady && (
                <div style={{ fontSize: 11, color: '#9b968d', textAlign: 'center', marginTop: 7, fontFamily: "'JetBrains Mono',monospace" }}>
                  Preparing document…
                </div>
              )}
            </div>

            {/* Scrollable attach panel */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 0' }}>

              {/* DRAWINGS */}
              <div style={{ marginBottom: 20 }}>
                <div style={{
                  fontFamily: "'JetBrains Mono',monospace", fontSize: 10,
                  textTransform: 'uppercase', letterSpacing: '1.5px',
                  color: '#9b968d', fontWeight: 700, marginBottom: 10,
                }}>
                  📐 Structural Drawings
                </div>

                {drawings.length === 0 ? (
                  <div style={{ background: '#f8f7f5', borderRadius: 8, padding: '12px 10px', fontSize: 12, color: '#9b968d', textAlign: 'center' }}>
                    No drawings marked up
                  </div>
                ) : drawings.map(d => (
                  <div key={d.id} style={{
                    border: `1.5px solid ${d.selected && d.captured ? '#2c5282' : '#e4e0d9'}`,
                    borderRadius: 8, marginBottom: 8, overflow: 'hidden',
                    background: d.selected && d.captured ? '#edf2fb' : '#ffffff',
                    transition: 'all .15s',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px' }}>
                      <input
                        type="checkbox"
                        checked={d.selected && d.captured}
                        onChange={() => { if (d.captured) toggleDrawingSelect(d.id) }}
                        disabled={!d.captured}
                        style={{ accentColor: '#2c5282' }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1917' }}>{d.title}</div>
                        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: '#9b968d', marginTop: 2 }}>
                          {d.zone_count} zone{d.zone_count !== 1 ? 's' : ''}
                        </div>
                      </div>
                      <button
                        onClick={() => captureDrawing(d.id)}
                        disabled={d.capturing || d.captured}
                        style={{
                          background: d.captured ? '#e6f4ef' : '#2c5282',
                          color: d.captured ? '#27705a' : '#ffffff',
                          border: 'none', borderRadius: 5,
                          padding: '4px 8px', fontSize: 11, fontWeight: 600,
                          cursor: d.capturing || d.captured ? 'default' : 'pointer',
                          fontFamily: "'Outfit',sans-serif", whiteSpace: 'nowrap',
                        }}
                      >
                        {d.capturing ? '⏳' : d.captured ? '✓' : '📸 Capture'}
                      </button>
                    </div>
                    {d.previewUrl && (
                      <img src={d.previewUrl} alt={d.title} style={{ width: '100%', display: 'block', borderTop: '1px solid #e4e0d9' }} />
                    )}
                  </div>
                ))}
              </div>

              {/* PHOTOS */}
              <div style={{ paddingBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, textTransform: 'uppercase', letterSpacing: '1.5px', color: '#9b968d', fontWeight: 700 }}>
                    📷 Site Photos ({selPhotoCount}/{selectedPhotos.length})
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => setSelectedPhotos(prev => prev.map(p => ({ ...p, selected: true })))}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#2c5282', fontWeight: 600, fontFamily: "'Outfit',sans-serif" }}
                    >All</button>
                    <button
                      onClick={() => setSelectedPhotos(prev => prev.map(p => ({ ...p, selected: false })))}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#9b968d', fontFamily: "'Outfit',sans-serif" }}
                    >None</button>
                  </div>
                </div>

                {selectedPhotos.length === 0 ? (
                  <div style={{ background: '#f8f7f5', borderRadius: 8, padding: '12px 10px', fontSize: 12, color: '#9b968d', textAlign: 'center' }}>
                    No photos taken during inspection
                  </div>
                ) : (
                  Object.entries(
                    selectedPhotos.reduce((acc, p) => {
                      if (!acc[p.zoneLabel]) acc[p.zoneLabel] = []
                      acc[p.zoneLabel].push(p)
                      return acc
                    }, {} as Record<string, SelectedPhoto[]>)
                  ).map(([zone, photos]) => (
                    <div key={zone} style={{ marginBottom: 14 }}>
                      <div
                        onClick={() => toggleAllInZone(zone)}
                        style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 7px', background: '#f8f7f5', borderRadius: 6, cursor: 'pointer', marginBottom: 6 }}
                      >
                        <input
                          type="checkbox"
                          checked={photos.every(p => p.selected)}
                          onChange={() => toggleAllInZone(zone)}
                          style={{ accentColor: '#2c5282' }}
                          onClick={e => e.stopPropagation()}
                        />
                        <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: '#2c2a27' }}>{zone}</span>
                        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: '#9b968d' }}>
                          {photos.filter(p => p.selected).length}/{photos.length}
                        </span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
                        {photos.map(photo => (
                          <div
                            key={photo.url}
                            onClick={() => togglePhoto(photo.url)}
                            style={{
                              aspectRatio: '1', cursor: 'pointer',
                              borderRadius: 5, overflow: 'hidden',
                              border: `2px solid ${photo.selected ? '#2c5282' : 'transparent'}`,
                              opacity: photo.selected ? 1 : 0.4,
                              transition: 'all .15s', position: 'relative',
                            }}
                          >
                            <img src={photo.url} alt={photo.zoneLabel} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>

            </div>

            {/* Insert button */}
            <div style={{ padding: '10px 12px', borderTop: '1px solid #e4e0d9', background: '#f8f7f5', flexShrink: 0 }}>
              <div style={{ fontSize: 11, color: '#9b968d', textAlign: 'center', marginBottom: 7, fontFamily: "'JetBrains Mono',monospace" }}>
                {selPhotoCount} photo{selPhotoCount !== 1 ? 's' : ''} · {selDrawingCount} drawing{selDrawingCount !== 1 ? 's' : ''} selected
              </div>
              <button
                onClick={insertAttachments}
                disabled={!docReady || (selPhotoCount === 0 && selDrawingCount === 0)}
                style={{
                  width: '100%', background: '#2c5282', color: 'white',
                  border: 'none', borderRadius: 8, padding: '9px 14px',
                  fontSize: 13, fontWeight: 600, fontFamily: "'Outfit',sans-serif",
                  cursor: docReady && (selPhotoCount > 0 || selDrawingCount > 0) ? 'pointer' : 'not-allowed',
                  opacity: docReady && (selPhotoCount > 0 || selDrawingCount > 0) ? 1 : 0.5,
                  transition: 'all .15s',
                }}
              >
                Insert into Document
              </button>
            </div>
          </div>

          {/* ONLYOFFICE EDITOR */}
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative', background: '#f0ede8' }}>
            {generating ? (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                height: '100%', flexDirection: 'column', gap: 16,
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
              <OnlyOfficeEditor
                key={editorKey}
                inspectionId={inspectionId}
                fileName={`Report_${reportNo || inspectionId}.docx`}
                editable={reportStatus !== 'finalised'}
                onReady={() => console.log('[OnlyOffice] editor ready')}
              />
            ) : null}
          </div>

        </div>
      </div>
    </>
  )
}
