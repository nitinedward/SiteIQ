'use client'
import { useEffect, useRef, useState } from 'react'

interface OnlyOfficeEditorProps {
  inspectionId: string
  fileName: string
  editable: boolean
  onReady?: () => void
}

export default function OnlyOfficeEditor({
  inspectionId,
  fileName,
  editable,
  onReady,
}: OnlyOfficeEditorProps) {
  const containerRef  = useRef<HTMLDivElement>(null)
  const editorRef     = useRef<any>(null)
  const scriptLoaded  = useRef(false)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    if (!containerRef.current) return
    if (scriptLoaded.current) return
    scriptLoaded.current = true

    const initEditor = async () => {
      try {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL              ?? 'http://localhost:3000'
        const ooUrl  = process.env.NEXT_PUBLIC_ONLYOFFICE_SERVER_URL ?? 'http://localhost'

        const docUrl      = `${appUrl}/api/docs/${inspectionId}`
        const callbackUrl = `${appUrl}/api/docs/${inspectionId}`

        const payload = {
          document: {
            fileType: 'docx',
            key:      `${inspectionId}-${Date.now()}`,
            title:    fileName,
            url:      docUrl,
          },
          documentType: 'word',
          editorConfig: {
            callbackUrl,
            mode: editable ? 'edit' : 'view',
            user: { id: 'siteiq-user', name: 'SiteIQ Engineer' },
            customization: {
              autosave:       true,
              forcesave:      false,
              hideRightMenu:  false,
              toolbarNoTabs:  false,
              uiTheme:        'theme-light',
            },
          },
        }

        // Fetch JWT token from our API
        const tokenRes = await fetch('/api/docs/token', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
        })
        const { token } = await tokenRes.json()
        const signedPayload = { ...payload, token }

        const loadScript = () =>
          new Promise<void>((resolve, reject) => {
            // Reuse already-loaded script
            if ((window as any).DocsAPI) { resolve(); return }

            const script    = document.createElement('script')
            script.src      = `${ooUrl}/web-apps/apps/api/documents/api.js`
            script.onload   = () => resolve()
            script.onerror  = () => reject(new Error('Could not load OnlyOffice script'))
            document.head.appendChild(script)
          })

        await loadScript()

        if (!containerRef.current) return

        editorRef.current = new (window as any).DocsAPI.DocEditor(
          containerRef.current.id,
          signedPayload
        )

        setLoading(false)
        onReady?.()
      } catch (err: any) {
        console.error('[OnlyOfficeEditor] init error:', err)
        setError(err?.message ?? 'Failed to initialize editor')
        setLoading(false)
      }
    }

    initEditor()

    return () => {
      try { editorRef.current?.destroyEditor() } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectionId])

  if (error) {
    return (
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        height:         '100%',
        flexDirection:  'column',
        gap:            12,
        color:          '#c0392b',
        background:     '#f8f7f5',
      }}>
        <div style={{ fontSize: 32 }}>⚠️</div>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{error}</div>
        <div style={{ fontSize: 13, color: '#9b968d', textAlign: 'center', maxWidth: 320 }}>
          Make sure OnlyOffice Document Server is running at{' '}
          <code>{process.env.NEXT_PUBLIC_ONLYOFFICE_SERVER_URL ?? 'http://localhost'}</code>
        </div>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      {loading && (
        <div style={{
          position:       'absolute',
          inset:          0,
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          flexDirection:  'column',
          gap:            12,
          background:     '#f8f7f5',
          zIndex:         10,
        }}>
          <div style={{
            width:           36,
            height:          36,
            border:          '3px solid #e4e0d9',
            borderTopColor:  '#2c5282',
            borderRadius:    '50%',
            animation:       'spin 0.8s linear infinite',
          }} />
          <div style={{
            fontSize:     14,
            color:        '#9b968d',
            fontFamily:   "'JetBrains Mono', monospace",
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}>
            Loading document editor…
          </div>
        </div>
      )}
      <div
        id={`onlyoffice-${inspectionId}`}
        ref={containerRef}
        style={{ height: '100%', width: '100%' }}
      />
    </div>
  )
}
