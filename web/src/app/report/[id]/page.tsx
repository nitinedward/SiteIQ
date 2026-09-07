'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
import { captureDrawingWithMarkup } from '@/lib/captureDrawing'
import { reportFileName, reportDisplayName } from '@/lib/reportFileName'
import { buildMarkupPdf, type MarkupDrawing } from '@/lib/markupPdf'
import dynamic from 'next/dynamic'

const OnlyOfficeEditor = dynamic(() => import('@/components/OnlyOfficeEditor'), { ssr: false })

// ── TYPES ──────────────────────────────────────────────────────────────────────
type Inspection = {
  id: string; date: string; report_no: string; weather: string
  site_contact: string; contact_phone: string; purpose: string
  // Optional: only present once the report_file_name column exists.
  report_file_name?: string | null
}
type PageData = {
  inspection: Inspection
  project: { name: string; project_number: string } | null
  engineerName: string
}
type SelectedPhoto = {
  url: string; observationId: string; zoneLabel: string; selected: boolean
  // Which markup pin this photo was taken at, when it still has one.
  zoneId: string | null
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
  const [notesCount,         setNotesCount]          = useState(0)
  const [downloading,        setDownloading]         = useState(false)
  const [showDownloadMenu,   setShowDownloadMenu]     = useState(false)
  const [customFileName,     setCustomFileName]       = useState<string | null>(null)
  const [fileNameDraft,      setFileNameDraft]        = useState('')
  const [savingFileName,     setSavingFileName]       = useState(false)
  const [zipProgress,        setZipProgress]          = useState<{ done: number; total: number } | null>(null)
  const [editorError,        setEditorError]         = useState(false)
  const [inserting,          setInserting]           = useState(false)
  const [reloadingEditor,    setReloadingEditor]     = useState(false)
  const [mobileTab,          setMobileTab]            = useState<'document' | 'attachments'>('document')
  const [showFinaliseConfirm, setShowFinaliseConfirm] = useState(false)
  const [frozenPdfUrl,       setFrozenPdfUrl]         = useState<string | null>(null)
  const [loadingFrozenPdf,   setLoadingFrozenPdf]     = useState(false)
  // Reported by the editor so one indicator can span preparation and startup.
  const [editorLoading,      setEditorLoading]        = useState(true)
  const [editorMessage,      setEditorMessage]        = useState('Opening editor')

  // AI reword now lives entirely inside the OnlyOffice side panel — see
  // public/oo-plugins/siteiq-reword/. It's opened from the editor's own
  // Plugins tab and reads/writes the selection through the editor's
  // built-in plugin methods, so this page holds no reword state at all.

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
      const status = (inspRes.data as any)?.report_status ?? 'pending'
      setReportStatus(status)
      // undefined until the report_file_name column exists; null/'' means
      // "use the derived name".
      setCustomFileName((inspRes.data as any)?.report_file_name ?? null)
      setLoading(false)

      loadAttachments(id)
      generateDoc()
      if (status === 'finalised') loadFrozenPdf(id)

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

  // ── FROZEN PDF (finalised reports) ────────────────────────────────────────────
  // A report finalised before this feature existed has no stored PDF — in
  // that case frozenPdfUrl stays null and the page falls back to the
  // read-only editor view instead of erroring.
  const loadFrozenPdf = useCallback(async (inspId: string) => {
    setLoadingFrozenPdf(true)
    try {
      // pdf-url only tells us whether a frozen PDF exists; the viewer is
      // pointed at our own route rather than the signed storage URL, whose
      // object is named after the inspection UUID and would show that as
      // the file name in the PDF viewer.
      const res = await fetch(`/api/docs/pdf-url?inspectionId=${inspId}`, { cache: 'no-store' })
      if (res.ok) {
        setFrozenPdfUrl(`/api/docs/frozen-pdf?inspectionId=${inspId}&t=${Date.now()}`)
      } else {
        setFrozenPdfUrl(null)
      }
    } catch (err) {
      console.error('[loadFrozenPdf] error:', err)
      setFrozenPdfUrl(null)
    } finally {
      setLoadingFrozenPdf(false)
    }
  }, [])


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
  const saveBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a   = document.createElement('a')
    a.href     = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const derivedFileName = () =>
    reportFileName(pageData?.project?.name, reportNo, inspectionId)

  /** The custom name if one has been saved, otherwise the derived one. */
  const baseFileName = () => (customFileName?.trim() || derivedFileName())

  /** Persists a name typed into the editor's own title bar. OnlyOffice
   *  sends the bare name, but a user may still type an extension — strip it
   *  so it isn't doubled up when we append .docx/.pdf. */
  /** Tells the open editing session about a new title. onRequestRename only
   *  reports what the user typed — it doesn't change the open document — so
   *  without this the title snaps back to whatever the editor was opened
   *  with. Best-effort: the name is already saved, so a failure here just
   *  means the tab keeps the old label until the page is reloaded. */
  const pushTitleToEditor = useCallback(async (name: string) => {
    try {
      await fetch('/api/docs/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docKey: `doc-${inspectionId}-${editorKey}`,
          title: `${name}.docx`,
        }),
      })
    } catch (err) {
      console.warn('[rename] could not refresh the editor title:', err)
    }
  }, [inspectionId, editorKey])

  const renameFromEditor = useCallback(async (newName: string) => {
    const clean = newName.replace(/\.(docx|pdf)$/i, '').trim()
    if (!clean) return
    const { error } = await supabase
      .from('inspections')
      .update({ report_file_name: clean })
      .eq('id', inspectionId)
    if (error) {
      console.error('[rename] save failed:', error)
      alert('Could not save the new file name: ' + error.message)
      return
    }
    setCustomFileName(clean)
    await pushTitleToEditor(clean)
  }, [inspectionId, pushTitleToEditor])

  const saveFileName = async () => {
    const next = fileNameDraft.trim()
    setSavingFileName(true)
    try {
      const { error } = await supabase
        .from('inspections')
        // Blank clears it, so the report falls back to the derived name.
        .update({ report_file_name: next || null })
        .eq('id', inspectionId)
      if (error) throw error
      setCustomFileName(next || null)
      setShowDownloadMenu(false)
      await pushTitleToEditor(next || derivedFileName())
    } catch (err: any) {
      console.error('[fileName] save failed:', err)
      const missingColumn = /report_file_name/i.test(err?.message ?? '')
      alert(
        missingColumn
          ? 'Renaming needs a one-off database change. Run this in the Supabase SQL editor:\n\n' +
            'ALTER TABLE inspections ADD COLUMN report_file_name text;'
          : 'Could not save the file name: ' + (err?.message || 'unknown error')
      )
    } finally {
      setSavingFileName(false)
    }
  }

  /** Rebuilds the managed attachments section from the current selection,
   *  then force-saves the live editing session — so whichever format is
   *  downloaded reflects what's actually on screen rather than the last
   *  autosave. Skipped for finalised reports, which are frozen. */
  const prepareForDownload = async () => {
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

    // Best-effort: a report with no open editing session has nothing to
    // force-save, which isn't a failure worth blocking the download on.
    try {
      await fetch('/api/docs/forcesave', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ inspectionId, key: `doc-${inspectionId}-${editorKey}` }),
      })
    } catch (err) {
      console.warn('[download] force-save skipped:', err)
    }
  }

  /** Zips every photo captured for this inspection — not just the ones
   *  selected for the document — one folder per zone.
   *
   *  Done in the browser rather than server-side on purpose: a hundred
   *  photos at a few MB each would blow a serverless function's time and
   *  memory budget, and the photos are public Supabase URLs the browser can
   *  fetch directly, so nothing has to be proxied. Stored rather than
   *  deflated because JPEGs don't compress — it only costs CPU. */
  const downloadAllPhotos = async () => {
    const photos = selectedPhotos
    if (photos.length === 0) {
      alert('There are no photos on this inspection yet.')
      return
    }

    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    const used = new Set<string>()
    const failed: string[] = []

    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i]
      setZipProgress({ done: i, total: photos.length })
      try {
        const res = await fetch(photo.url, { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()

        const zoneFolder = (photo.zoneLabel || 'General').replace(/[\/\\:*?"<>|]/g, '')
        const rawName = decodeURIComponent(photo.url.split('/').pop() ?? `photo-${i + 1}.jpg`)
          .split('?')[0]
        // Storage names can repeat across zones — keep them distinct so the
        // zip doesn't silently drop one.
        let name = `${zoneFolder}/${rawName}`
        let n = 2
        while (used.has(name)) {
          name = `${zoneFolder}/${rawName.replace(/(\.[^.]+)?$/, `-${n}$1`)}`
          n++
        }
        used.add(name)

        zip.file(name, blob)
      } catch (err) {
        console.error('[photos] could not fetch', photo.url, err)
        failed.push(photo.url)
      }
    }

    setZipProgress({ done: photos.length, total: photos.length })
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
    saveBlob(blob, `${baseFileName()} - Photos.zip`)
    setZipProgress(null)

    if (failed.length) {
      alert(
        `${photos.length - failed.length} of ${photos.length} photos were included.\n\n` +
        `${failed.length} could not be downloaded and were skipped.`
      )
    }
  }

  /** Builds the marked-up drawing PDF for this inspection, or null when
   *  there are no pins to show. Built in the browser because rendering the
   *  drawing and downscaling the photos both need a canvas. */
  const buildMarkup = async (): Promise<Blob | null> => {
    const { data: zonesData, error } = await supabase
      .from('zones')
      .select('id, label, x_percent, y_percent, markup_type, shape_data, drawings (id, title, number, revision, file_url)')
      .eq('inspection_id', inspectionId)
    if (error) throw error
    if (!zonesData?.length) return null

    // Group pins under the drawing they belong to.
    const byDrawing = new Map<string, MarkupDrawing>()
    for (const z of zonesData as any[]) {
      const d = z.drawings
      if (!d?.file_url) continue
      if (!byDrawing.has(d.id)) {
        byDrawing.set(d.id, {
          id: d.id, title: d.title || 'Untitled Drawing',
          number: d.number, revision: d.revision, file_url: d.file_url,
          zones: [],
        })
      }
      byDrawing.get(d.id)!.zones.push({
        id: z.id, label: z.label,
        x_percent: z.x_percent, y_percent: z.y_percent,
        markup_type: z.markup_type, shape_data: z.shape_data,
      })
    }

    return buildMarkupPdf({
      drawings: [...byDrawing.values()],
      photos: selectedPhotos.map(p => ({ url: p.url, zoneId: p.zoneId, zoneLabel: p.zoneLabel })),
      reportTitle: baseFileName(),
      onProgress: (d, t) => setZipProgress({ done: d, total: t }),
    })
  }

  /** Best-effort: a report with no pins simply has no markup PDF, and a
   *  failure here must never block finalising. */
  const generateAndStoreMarkup = async () => {
    try {
      const blob = await buildMarkup()
      if (!blob) { console.log('[markup] no pins — nothing to generate'); return }
      await fetch(`/api/docs/markup-pdf?inspectionId=${inspectionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf' },
        body: blob,
      })
      console.log('[markup] stored, size:', blob.size)
    } catch (err) {
      console.error('[markup] could not generate:', err)
    } finally {
      setZipProgress(null)
    }
  }

  const downloadMarkup = async () => {
    // Prefer the copy stored at finalise; otherwise build it now so the
    // option still works on a report that hasn't been finalised yet.
    const stored = await fetch(`/api/docs/markup-pdf?inspectionId=${inspectionId}`, { cache: 'no-store' })
    if (stored.ok) {
      saveBlob(await stored.blob(), `${baseFileName()} - Markup.pdf`)
      return
    }

    const blob = await buildMarkup()
    if (!blob) {
      alert(
        'This report has no drawing markups yet.\n\n' +
        'Mark up a drawing on mobile and attach photos to a pin, then this will contain the drawing with each pin linked to its photos.'
      )
      return
    }
    saveBlob(blob, `${baseFileName()} - Markup.pdf`)
    // Keep it for next time.
    fetch(`/api/docs/markup-pdf?inspectionId=${inspectionId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: blob,
    }).catch(() => { /* caching only */ })
  }

  const downloadWord = async () => {
    const res = await fetch(
      `/api/docs/${inspectionId}?download=true&t=${Date.now()}`,
      { cache: 'no-store' }
    )
    if (!res.ok) throw new Error('Document not ready. Generate the report first.')
    saveBlob(await res.blob(), `${baseFileName()}.docx`)
  }

  const downloadPdf = async () => {
    // A finalised report already has its frozen PDF stored — serve that
    // rather than re-converting, so the download matches what was signed off.
    if (reportStatus === 'finalised' && frozenPdfUrl) {
      const res = await fetch(frozenPdfUrl, { cache: 'no-store' })
      if (!res.ok) throw new Error('Could not download the finalised PDF')
      saveBlob(await res.blob(), `${baseFileName()}.pdf`)
      return
    }

    const res = await fetch('/api/docs/export-pdf', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        inspectionId,
        docKey: `doc-${inspectionId}-${editorKey}`,
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || 'Could not convert the report to PDF')
    }
    saveBlob(await res.blob(), `${baseFileName()}.pdf`)
  }

  const downloadDoc = async (format: 'docx' | 'pdf' | 'both' | 'photos' | 'markup') => {
    setShowDownloadMenu(false)
    try {
      setDownloading(true)

      // Photos come straight from storage — no document involved, so none
      // of the rebuild/force-save preparation applies.
      if (format === 'photos') {
        await downloadAllPhotos()
        return
      }
      if (format === 'markup') {
        await downloadMarkup()
        return
      }

      const finalised = reportStatus === 'finalised'

      // Finalised reports are frozen — nothing to rebuild or re-save. The
      // .docx is still downloadable, it just isn't touched.
      if (!finalised) await prepareForDownload()

      if (format === 'docx' || format === 'both') await downloadWord()
      if (format === 'pdf'  || format === 'both') await downloadPdf()
    } catch (err: any) {
      console.error('Download error:', err)
      alert('Download failed: ' + err.message)
    } finally {
      setDownloading(false)
      setZipProgress(null)
    }
  }

  useEffect(() => {
    if (!showDownloadMenu) return
    const close = () => setShowDownloadMenu(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [showDownloadMenu])

  /** Shared menu body for the two Download buttons (header and sidebar).
   *  `align` decides which edge it hangs from so it stays on screen. */
  const renderDownloadMenu = (align: 'left' | 'right') => {
    if (!showDownloadMenu) return null
    const options: { format: 'docx' | 'pdf' | 'both' | 'photos' | 'markup'; label: string; hint: string }[] = [
      { format: 'docx', label: 'Word',     hint: '.docx — editable' },
      { format: 'pdf',  label: 'PDF',      hint: '.pdf — final layout' },
      { format: 'both', label: 'Both',     hint: 'Word and PDF' },
      {
        format: 'photos',
        label: 'All site photos',
        hint: selectedPhotos.length
          ? `.zip — all ${selectedPhotos.length}, not just selected`
          : '.zip — no photos on this inspection',
      },
      {
        format: 'markup',
        label: 'Marked-up drawing',
        hint: '.pdf — click a pin to see its photos',
      },
    ]
    return (
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'absolute', top: 'calc(100% + 6px)',
          [align]: 0,
          zIndex: 40, minWidth: 208,
          background: 'var(--surface)',
          border: '1px solid var(--border-line)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-card-v3)',
          padding: 6,
        } as React.CSSProperties}
      >
        {/* File name — editable here, where you're about to use it. */}
        <div style={{ padding: '8px 9px 10px', borderBottom: '1px solid var(--border-line)', marginBottom: 4 }}>
          <div style={{
            fontFamily: 'var(--f-heading)', fontSize: 10.5, fontWeight: 700,
            letterSpacing: '.5px', textTransform: 'uppercase',
            color: 'var(--text-mid)', marginBottom: 6,
          }}>
            File name
          </div>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            <input
              type="text"
              value={fileNameDraft}
              placeholder={derivedFileName()}
              onChange={e => setFileNameDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveFileName() } }}
              style={{
                flex: 1, minWidth: 0, padding: '7px 9px',
                border: '1px solid var(--border-line)', borderRadius: 'var(--radius-sm)',
                fontFamily: 'var(--f-text)', fontSize: 12, color: 'var(--text-ink)',
                outline: 'none', background: 'var(--surface)',
              }}
            />
            <button
              onClick={saveFileName}
              disabled={savingFileName}
              style={{
                background: 'var(--indigo)', color: 'white', border: 'none',
                borderRadius: 'var(--radius-pill)', padding: '7px 12px',
                fontFamily: 'var(--f-heading)', fontSize: 11.5, fontWeight: 700,
                cursor: savingFileName ? 'default' : 'pointer', flexShrink: 0,
              }}
            >
              {savingFileName ? '…' : 'Save'}
            </button>
          </div>
          <div style={{ fontFamily: 'var(--f-text)', fontSize: 10.5, color: 'var(--text-mid)', marginTop: 5 }}>
            Saves as <span style={{ fontWeight: 600 }}>{(fileNameDraft.trim() || baseFileName())}.docx / .pdf</span>
          </div>
        </div>

        {options.map(opt => (
          <button
            key={opt.format}
            onClick={() => downloadDoc(opt.format)}
            style={{
              width: '100%', textAlign: 'left',
              background: 'none', border: 'none',
              borderRadius: 'var(--radius-sm)',
              padding: '9px 11px', cursor: 'pointer',
              display: 'block',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--paper)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
          >
            <div style={{ fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700, color: 'var(--text-ink)' }}>
              {opt.label}
            </div>
            <div style={{ fontFamily: 'var(--f-text)', fontSize: 11.5, color: 'var(--text-mid)', marginTop: 1 }}>
              {opt.hint}
            </div>
          </button>
        ))}
      </div>
    )
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

    // Nothing selected — this call still runs (it replaces the whole
    // inserted section, so an empty selection means "remove everything
    // I've inserted"), but confirm first so a stray click doesn't silently
    // wipe it out.
    if (photos.length === 0 && drawingsList.length === 0) {
      if (!confirm('No photos or drawings are selected. This will remove any previously inserted attachments from the document. Continue?')) return
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
  // Order matters: the PDF must exist BEFORE the report is marked
  // 'finalised' — if force-save/conversion fails, report_status is never
  // touched, so a report can never end up "finalised" without a valid
  // frozen PDF.
  const finaliseReport = async () => {
    setShowFinaliseConfirm(false)
    setFinalisingReport(true)
    try {
      const docKey = `doc-${inspectionId}-${editorKey}`
      console.log('[finalise] Force-saving and converting to PDF, key:', docKey)
      const res = await fetch('/api/docs/finalise-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inspectionId, docKey }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not generate the frozen PDF')
      console.log('[finalise] PDF stored, size:', data.pdfSize)

      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('inspections')
        .update({ report_status: 'finalised', finalised_at: new Date().toISOString(), finalised_by: user?.id })
        .eq('id', id)
      if (error) throw error

      setReportStatus('finalised')
      await loadFrozenPdf(inspectionId)

      // Marked-up drawing with each pin linked to its photos. Runs after the
      // report is already finalised and never throws, so a drawing that
      // fails to render can't undo a finalise that has otherwise succeeded.
      await generateAndStoreMarkup()

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
    // The frozen PDF is now stale relative to future edits — stop showing
    // it. The stored file itself is left alone; it'll be overwritten the
    // next time this report is finalised again.
    setFrozenPdfUrl(null)
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

      // Voice notes: an observation's transcript is the dictated note, so
      // the count is observations that actually carry one.
      setNotesCount(
        (obsData ?? []).filter((ob: any) => typeof ob.transcript === 'string' && ob.transcript.trim()).length
      )

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
              zoneId: ob.zone_id ?? null,
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
      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '1.5px', color: 'var(--text-mid)' }}>Loading report</div>
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
          {/* Brand — doubles as a link home, which is what people try first */}
          <div
            onClick={() => router.push('/dashboard')}
            role="link"
            tabIndex={0}
            title="Go to dashboard"
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push('/dashboard') } }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, cursor: 'pointer' }}
          >
            <div style={{ width: 24, height: 24, background: 'var(--marigold)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="12" height="12" fill="none" stroke="#fff" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            </div>
            <span style={{ fontFamily: 'var(--f-heading)', fontSize: 16, fontWeight: 800, color: 'var(--text-ink)' }}>
              SiteIQ
            </span>
          </div>

          <div className="report-breadcrumb" style={{ width: 1, height: 18, background: 'var(--border-line)' }} />

          <button
            onClick={() => router.push('/dashboard')}
            style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-mid)', fontSize: 12, fontWeight: 700, fontFamily: 'var(--f-heading)' }}
          >
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
            Dashboard
          </button>

          <div className="report-breadcrumb" style={{ width: 1, height: 18, background: 'var(--border-line)' }} />

          {/* Title */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              title={customFileName ? `${projectName} · renamed to "${customFileName}"` : projectName}
              style={{ fontFamily: 'var(--f-heading)', fontSize: 15, fontWeight: 700, color: 'var(--text-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {reportDisplayName(customFileName, projectName)}
            </span>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: '2px 8px', borderRadius: 99, fontFamily: 'var(--f-heading)', fontSize: 10, fontWeight: 700,
              background: reportStatus === 'finalised' ? 'var(--sage-soft)' : 'var(--marigold-soft)',
              color: reportStatus === 'finalised' ? 'var(--sage-ink)' : 'var(--marigold-ink)',
            }}>
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
              {reportStatus === 'finalised' ? 'Finalised' : 'Pending review'}
            </span>
          </div>

          {/* Action buttons */}
          <div className="report-topbar-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {editorError && (
              <button
                onClick={() => { setEditorError(false); setEditorKey(prev => prev + 1) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'var(--marigold-soft)', color: 'var(--marigold-ink)',
                  border: '1px solid rgba(224,141,11,0.3)',
                  borderRadius: 'var(--radius-pill)', padding: '7px 14px',
                  fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                }}
              >
                <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                Editor Offline — Retry
              </button>
            )}
            {reportStatus === 'pending' ? (
              <button
                onClick={() => setShowFinaliseConfirm(true)}
                disabled={finalisingReport}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'var(--sage)', color: 'white', border: 'none', borderRadius: 'var(--radius-pill)',
                  padding: '7px 18px', fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  opacity: finalisingReport ? 0.6 : 1,
                }}
              >
                {finalisingReport ? (
                  <>
                    <div style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
                    <span className="report-btn-text">Finalising & generating PDF…</span>
                  </>
                ) : (
                  <>
                    <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                    <span className="report-btn-text">Finalise</span>
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={reopenReport}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'var(--surface)', color: 'var(--text-ink)',
                  border: '1px solid var(--border-line)', borderRadius: 'var(--radius-pill)',
                  padding: '7px 18px', fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                <span className="report-btn-text">Edit Report</span>
              </button>
            )}
            <div style={{ position: 'relative' }}>
            <button
              onClick={e => {
                e.stopPropagation()
                setShowDownloadMenu(v => {
                  if (!v) setFileNameDraft(customFileName ?? '')
                  return !v
                })
              }}
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
                  <span className="report-btn-text">
                    {zipProgress
                      ? `Photos ${zipProgress.done}/${zipProgress.total}`
                      : 'Preparing...'}
                  </span>
                </>
              ) : totalAttachments > 0 ? (
                <>
                  <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  <span className="report-btn-text">Download</span>
                  <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.4" viewBox="0 0 24 24" style={{ marginLeft: -1 }}><polyline points="6 9 12 15 18 9"/></svg>
                </>
              ) : (
                <>
                  <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  <span className="report-btn-text">Download</span>
                  <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.4" viewBox="0 0 24 24" style={{ marginLeft: -1 }}><polyline points="6 9 12 15 18 9"/></svg>
                </>
              )}
            </button>
            {renderDownloadMenu('right')}
            </div>
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

            {/* ── HEADER ────────────────────────────────────────────────── */}
            <div style={{
              padding: '18px 16px 14px',
              borderBottom: '1px solid var(--border-line)',
              flexShrink: 0,
            }}>
              <div style={{ fontFamily: 'var(--f-heading)', fontSize: 16, fontWeight: 800, color: 'var(--indigo-deep)', lineHeight: 1 }}>
                Attachments
              </div>
              <div style={{ fontFamily: 'var(--f-text)', fontSize: 12, color: 'var(--text-mid)', marginTop: 4 }}>
                {pageData?.inspection?.date
                  ? `Captured on site, ${new Date(pageData.inspection.date).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })}`
                  : 'Included when you download'}
              </div>

              {/* 3 stat boxes */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 14 }}>
                {([
                  {
                    label: 'Photos',
                    value: selPhotoCount,
                    total: selectedPhotos.length,
                    icon: <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>,
                    icon2: <circle cx="12" cy="13" r="4"/>,
                  },
                  {
                    label: 'Drawings',
                    value: selDrawingCount,
                    total: drawings.length,
                    icon: <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>,
                    icon2: <polyline points="14,2 14,8 20,8"/>,
                  },
                  {
                    label: 'Notes',
                    value: notesCount,
                    total: null as number | null,
                    icon: <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>,
                    icon2: <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>,
                  },
                ] as const).map(stat => (
                  <div
                    key={stat.label}
                    style={{
                      border: '1px solid var(--border-line)',
                      borderRadius: 14,
                      padding: '9px 8px',
                    }}
                  >
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      fontSize: 10, color: 'var(--text-mid)',
                    }}>
                      <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                        {stat.icon}{stat.icon2}
                      </svg>
                      {stat.label}
                    </div>
                    <div style={{
                      marginTop: 4,
                      fontSize: 18,
                      fontWeight: 800,
                      color: 'var(--indigo-deep)',
                      lineHeight: 1,
                      fontFamily: 'var(--f-heading)',
                    }}>
                      {stat.value}
                      {stat.total !== null && (
                        <span style={{ fontSize: 11, color: 'var(--text-mid)', fontWeight: 400 }}>
                          /{stat.total}
                        </span>
                      )}
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
                disabled={generatingAI || !docReady || reportStatus === 'finalised'}
                style={{
                  width: '100%',
                  background: generatingAI ? 'var(--paper)' : 'var(--indigo)',
                  color: generatingAI ? 'var(--text-mid)' : 'white',
                  border: 'none',
                  borderRadius: 'var(--radius-pill)',
                  padding: '10px 14px',
                  fontFamily: 'var(--f-heading)',
                  fontSize: 13,
                  fontWeight: 800,
                  cursor: generatingAI || !docReady || reportStatus === 'finalised' ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 7,
                  transition: 'all 0.15s',
                  opacity: !docReady || reportStatus === 'finalised' ? 0.5 : 1,
                }}
              >
                {generatingAI ? (
                  <>
                    <div style={{
                      width: 13, height: 13,
                      border: '2px solid rgba(255,255,255,0.4)',
                      borderTopColor: 'white',
                      borderRadius: '50%',
                      animation: 'spin 0.7s linear infinite',
                    }} />
                    Generating...
                  </>
                ) : (
                  <>
                    <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/></svg>
                    Generate AI Report
                  </>
                )}
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
                        fontFamily: 'var(--f-heading)', fontSize: 13,
                        fontWeight: 700, color: 'var(--indigo-deep)',
                      }}>
                        Drawings
                      </div>
                    </div>

                    {drawings.length === 0 ? (
                      <div style={{
                        border: '1px solid var(--border-line)', borderRadius: 'var(--radius-md)',
                        padding: '26px 16px', textAlign: 'center',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                      }}>
                        <svg width="22" height="22" fill="none" stroke="var(--text-mid)" strokeWidth="1.6" viewBox="0 0 24 24">
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                          <polyline points="14,2 14,8 20,8"/>
                        </svg>
                        <div style={{ fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700, color: 'var(--text-ink)' }}>
                          No drawings marked up
                        </div>
                        <div style={{ fontFamily: 'var(--f-text)', fontSize: 12, color: 'var(--text-mid)', lineHeight: 1.5 }}>
                          Markups made on mobile will show here.
                        </div>
                      </div>
                    ) : drawings.map(d => (
                      <div
                        key={d.id}
                        style={{
                          border: `1.5px solid ${d.selected && d.captured ? 'var(--sage)' : 'var(--border-line)'}`,
                          borderRadius: 'var(--radius-md)', marginBottom: 8,
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
                        fontFamily: 'var(--f-heading)', fontSize: 13,
                        fontWeight: 700, color: 'var(--indigo-deep)',
                      }}>
                        Photos
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <button
                          onClick={() => setSelectedPhotos(prev => prev.map(p => ({ ...p, selected: true })))}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            fontSize: 11, color: 'var(--indigo)', fontWeight: 700,
                            fontFamily: 'var(--f-heading)', padding: '4px 8px', borderRadius: 99,
                          }}
                        >Select all</button>
                        <button
                          onClick={() => setSelectedPhotos(prev => prev.map(p => ({ ...p, selected: false })))}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            fontSize: 11, color: 'var(--text-mid)',
                            fontFamily: 'var(--f-heading)', fontWeight: 700, padding: '4px 8px', borderRadius: 99,
                          }}
                        >None</button>
                      </div>
                    </div>

                    {selectedPhotos.length === 0 ? (
                      <div style={{
                        border: '1px solid var(--border-line)', borderRadius: 'var(--radius-md)',
                        padding: '26px 16px', textAlign: 'center',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                      }}>
                        <svg width="22" height="22" fill="none" stroke="var(--text-mid)" strokeWidth="1.6" viewBox="0 0 24 24">
                          <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                          <circle cx="12" cy="13" r="4"/>
                        </svg>
                        <div style={{ fontFamily: 'var(--f-heading)', fontSize: 13, fontWeight: 700, color: 'var(--text-ink)' }}>
                          No photos taken
                        </div>
                        <div style={{ fontFamily: 'var(--f-text)', fontSize: 12, color: 'var(--text-mid)', lineHeight: 1.5 }}>
                          Photos taken on mobile will show here.
                        </div>
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
                                  borderRadius: 'var(--radius-md)',
                                  overflow: 'hidden',
                                  border: `2px solid ${photo.selected ? 'var(--sage)' : 'var(--border-line)'}`,
                                  transition: 'border-color 0.15s',
                                }}
                                onMouseEnter={e => { if (!photo.selected) e.currentTarget.style.borderColor = 'var(--indigo)' }}
                                onMouseLeave={e => { if (!photo.selected) e.currentTarget.style.borderColor = 'var(--border-line)' }}
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
              {/* Selection summary, per the mock. Drawings are appended only
                  when some are selected, so the common photo-only case reads
                  exactly as designed without hiding that drawings are going
                  in too. */}
              <div style={{
                fontSize: 12, textAlign: 'center', marginBottom: 10,
                fontFamily: 'var(--f-text)', fontWeight: 600,
                color: 'var(--sage-ink)', lineHeight: 1.5,
              }}>
                {selPhotoCount} of {selectedPhotos.length} photo{selectedPhotos.length !== 1 ? 's' : ''} selected
                {selDrawingCount > 0 && (
                  <> · {selDrawingCount} drawing{selDrawingCount !== 1 ? 's' : ''}</>
                )}
              </div>

              {/* Update Document button — replaces the whole inserted
                  drawings+photos section with the current selection each
                  time, so deselecting something and clicking again removes
                  it from the document instead of only ever adding more. */}
              <button
                onClick={insertAttachments}
                disabled={inserting || !docReady || reportStatus === 'finalised'}
                title={reportStatus === 'finalised'
                  ? 'This report is finalised and frozen — reopen it to make changes'
                  : "Adds newly-selected photos/drawings and removes any you've deselected"}
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
                  cursor: reportStatus === 'finalised' ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 7,
                  marginBottom: 8,
                  opacity: !docReady || reportStatus === 'finalised' ? 0.5 : 1,
                }}
              >
                {inserting ? (
                  <>
                    <div style={{ width: 12, height: 12, border: '2px solid var(--border-line)', borderTopColor: 'var(--text-mid)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
                    Updating...
                  </>
                ) : (
                  <>
                    <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
                    Insert into Document
                  </>
                )}
              </button>

            </div>
          </div>

          {/* ── ONLYOFFICE EDITOR / FROZEN PDF ──────────────────────────────── */}
          <div className="report-editor-area" style={{ flex: 1, overflow: 'hidden', position: 'relative', background: 'var(--paper)' }}>
            {reportStatus === 'finalised' && loadingFrozenPdf ? (
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
                <div style={{ fontSize: 14, color: 'var(--text-mid)', fontFamily: 'var(--f-text)' }}>
                  Loading finalised report…
                </div>
              </div>
            ) : reportStatus === 'finalised' && frozenPdfUrl ? (
              <div style={{
                height: '100%', padding: '16px 20px',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
              }}>
                <div style={{
                  flex: 1, overflow: 'hidden',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-card-v3)',
                  border: '1px solid var(--border-line)',
                }}>
                  <iframe
                    src={frozenPdfUrl}
                    title="Finalised report"
                    style={{ width: '100%', height: '100%', border: 'none', background: 'white' }}
                  />
                </div>
              </div>
            ) : generating || docReady ? (
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
                  position: 'relative',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-card-v3)',
                  border: '1px solid var(--border-line)',
                }}>
                  {docReady && (
                    <OnlyOfficeEditor
                      key={editorKey}
                      sessionKey={editorKey}
                      inspectionId={inspectionId}
                      fileName={`${baseFileName()}.docx`}
                      onRename={renameFromEditor}
                      editable={reportStatus !== 'finalised'}
                      onReady={() => { console.log('[OnlyOffice] editor ready'); setEditorError(false) }}
                      onError={() => setEditorError(true)}
                      onLoadingChange={(isLoading, message) => {
                        setEditorLoading(isLoading)
                        if (message) setEditorMessage(message)
                      }}
                    />
                  )}

                  {/* One indicator for the whole startup: it stays put while
                      the label moves from preparation to editor startup,
                      rather than each stage mounting its own spinner. */}
                  {(generating || editorLoading) && (
                    <div style={{
                      position: 'absolute', inset: 0, zIndex: 5,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexDirection: 'column', gap: 14,
                      background: 'var(--paper)',
                    }}>
                      <div style={{
                        width: 28, height: 28, border: '2px solid var(--indigo)',
                        borderTopColor: 'transparent', borderRadius: '50%',
                        animation: 'spin .8s linear infinite',
                      }} />
                      <div style={{
                        fontFamily: 'var(--f-mono)', fontSize: 10,
                        textTransform: 'uppercase', letterSpacing: '1.5px',
                        color: 'var(--text-mid)',
                      }}>
                        {generating ? 'Preparing document' : editorMessage}
                      </div>
                    </div>
                  )}
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

      {/* Finalise confirmation */}
      {showFinaliseConfirm && (
        <div
          onClick={() => setShowFinaliseConfirm(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 440,
              background: 'var(--surface)', border: '1px solid var(--border-line)',
              borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card-v3)',
              padding: 24,
            }}
          >
            <div style={{ fontFamily: 'var(--f-heading)', fontSize: 18, fontWeight: 800, color: 'var(--indigo-deep)' }}>
              Finalise report #{reportNo}?
            </div>
            <div style={{ fontFamily: 'var(--f-text)', fontSize: 14, color: 'var(--text-mid)', lineHeight: 1.5, marginTop: 10 }}>
              Finalising locks this report as a PDF — you won't be able to edit it after. The report moves to Completed and becomes the client copy. You can still reopen it later if you need to make changes.
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button
                onClick={() => setShowFinaliseConfirm(false)}
                style={{
                  flex: 1, background: 'var(--surface)', color: 'var(--text-ink)',
                  border: '1px solid var(--border-line)', borderRadius: 'var(--radius-pill)',
                  padding: '10px 16px', fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Keep editing
              </button>
              <button
                onClick={finaliseReport}
                style={{
                  flex: 1, background: 'var(--sage)', color: 'white',
                  border: 'none', borderRadius: 'var(--radius-pill)',
                  padding: '10px 16px', fontFamily: 'var(--f-heading)', fontSize: 14, fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Finalise report
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  )
}
