'use client'
import { useEffect, useRef, useState } from 'react'
import { REWORD_PLUGIN_GUID, rewordPluginConfigUrl } from '@/lib/rewordPlugin'

interface OnlyOfficeEditorProps {
  inspectionId: string
  fileName: string
  editable: boolean
  sessionKey: number
  onReady?: () => void
  onError?: () => void
}

export default function OnlyOfficeEditor({
  inspectionId,
  fileName,
  editable,
  sessionKey,
  onReady,
  onError,
}: OnlyOfficeEditorProps) {
  const containerRef  = useRef<HTMLDivElement>(null)
  const editorRef     = useRef<any>(null)
  const scriptLoaded  = useRef(false)
  const [loading,        setLoading]        = useState(true)
  const [error,          setError]          = useState('')
  const [loadingMessage, setLoadingMessage] = useState('Loading document editor...')
  const [retryTrigger,   setRetryTrigger]   = useState(0)

  const ooUrl = process.env.NEXT_PUBLIC_ONLYOFFICE_SERVER_URL ?? 'http://localhost'

  useEffect(() => {
    if (!containerRef.current) return
    if (scriptLoaded.current) return
    scriptLoaded.current = true

    const appUrl = typeof window !== 'undefined'
      ? window.location.origin
      : (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000')

    const initEditor = async () => {
      try {
        // Add timestamp to docUrl so OO always re-fetches fresh content
        const docUrl      = `${appUrl}/api/docs/${inspectionId}?t=${Date.now()}`
        const callbackUrl = `${appUrl}/api/docs/${inspectionId}`

        const config: Record<string, any> = {
          document: {
            fileType: 'docx',
            key: `doc-${inspectionId}-${sessionKey}`,
            title: fileName,
            url: docUrl,
            permissions: {
              edit: editable,
              download: true,
              print: true,
              review: false,
              comment: false,
            },
          },
          documentType: 'word',
          editorConfig: {
            callbackUrl,
            mode: editable ? 'edit' : 'view',
            user: {
              id: 'siteiq-user',
              name: 'SiteIQ Engineer',
            },
            customization: {
              autosave: true,
              forcesave: false,
              logo: { visible: false },
              toolbarNoTabs: true,
              compactToolbar: true,
              statusBar: false,
              hideRightMenu: true,
              uiTheme: 'theme-light',
              compactHeader: true,
              customer: {
                name: 'SiteIQ',
                www: '',
                logo: '',
              },
              plugins: false,
              macros: false,
            },
            // Loads the "siteiq-reword" system plugin (public/oo-plugins/
            // siteiq-reword/) invisibly — it has no UI (isVisual:false) and
            // exists only to bridge selection-read/replace commands from
            // the outer SiteIQ page via postMessage. See
            // src/lib/rewordPlugin.ts.
            plugins: {
              autostart: [REWORD_PLUGIN_GUID],
              pluginsData: [rewordPluginConfigUrl(appUrl)],
            },
          },
        }

        console.log('[editor] config built, requesting token...')

        const tokenRes = await fetch('/api/docs/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        })

        if (!tokenRes.ok) {
          const errData = await tokenRes.json()
          throw new Error('Token request failed: ' + JSON.stringify(errData))
        }

        const tokenData = await tokenRes.json()

        if (!tokenData.token) {
          throw new Error('No token in response: ' + JSON.stringify(tokenData))
        }

        console.log('[editor] token received, length:', tokenData.token.length)

        config.token = tokenData.token

        // Load script with auto-retry
        const MAX_RETRIES = 3
        const RETRY_DELAY = 3000
        let retryCount = 0

        await new Promise<void>((resolve, reject) => {
          const attempt = () => {
            if ((window as any).DocsAPI) { resolve(); return }

            const script   = document.createElement('script')
            script.src     = `${ooUrl}/web-apps/apps/api/documents/api.js`
            script.onload  = () => resolve()
            script.onerror = () => {
              script.remove()
              if (retryCount < MAX_RETRIES) {
                retryCount++
                setLoadingMessage(
                  `OnlyOffice not ready, retrying (${retryCount}/${MAX_RETRIES})…`
                )
                setTimeout(attempt, RETRY_DELAY)
              } else {
                reject(new Error('OnlyOffice Document Server is not running.'))
              }
            }
            document.head.appendChild(script)
          }
          attempt()
        })

        if (!containerRef.current) return

        console.log('[editor] initializing DocEditor...')
        console.log('[editor] container id:', containerRef.current?.id)

        if (!(window as any).DocsAPI) {
          throw new Error('DocsAPI not available — OnlyOffice script not loaded')
        }

        const editor = new (window as any).DocsAPI.DocEditor(
          containerRef.current?.id ?? 'onlyoffice-editor',
          config
        )

        console.log('[editor] DocEditor created:', !!editor)

        editorRef.current = editor
        setLoading(false)
        onReady?.()
      } catch (err: any) {
        console.error('[OnlyOfficeEditor] init error:', err)
        setError(err?.message ?? 'Failed to initialize editor')
        setLoading(false)
        onError?.()
      }
    }

    initEditor()

    return () => {
      try { editorRef.current?.destroyEditor() } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectionId, retryTrigger])

  const handleRetry = () => {
    setError('')
    setLoading(true)
    setLoadingMessage('Loading document editor...')
    scriptLoaded.current = false
    setRetryTrigger(prev => prev + 1)
  }

  if (error) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', background: '#e8e4de',
      }}>
        <div style={{
          background: '#ffffff', border: '1px solid #e4e0d9',
          borderRadius: 14, padding: '32px 36px',
          maxWidth: 480, width: '90%', textAlign: 'center',
          boxShadow: '0 4px 12px rgba(0,0,0,.08)',
        }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
          <div style={{
            fontFamily: "'Cormorant',serif", fontSize: 22,
            fontWeight: 600, color: '#1a1917', marginBottom: 10,
          }}>
            Document Editor Unavailable
          </div>
          <div style={{ fontSize: 13, color: '#9b968d', lineHeight: 1.6 }}>
            The OnlyOffice Document Server is not running. Please start it and refresh.
          </div>

          <div style={{
            background: '#f0ede8', borderRadius: 10,
            padding: '16px 20px', marginTop: 16,
            fontSize: 13, color: '#9b968d', lineHeight: 1.6,
          }}>
            OnlyOffice Document Server is temporarily unavailable.
            Please contact your administrator or try again in a few minutes.
          </div>

          <button
            onClick={handleRetry}
            style={{
              marginTop: 20,
              background: '#2c5282', color: '#ffffff',
              border: 'none', borderRadius: 10,
              padding: '10px 24px', fontSize: 14, fontWeight: 600,
              cursor: 'pointer', fontFamily: "'Outfit',sans-serif",
            }}
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    // Stable wrapper — OnlyOffice's DocsAPI.DocEditor replaces the
    // #onlyoffice-editor placeholder div below with its iframe entirely
    // (target.parentNode.replaceChild(iframe, target)), so that id stops
    // existing in the DOM once the editor loads. This outer div is never
    // touched by that swap, so it's the stable anchor for finding the
    // iframe afterward (see report page's sendToRewordPlugin).
    <div id="onlyoffice-editor-wrapper" style={{ position: 'relative', height: '100%', width: '100%' }}>
      {loading && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 12,
          background: '#e8e4de', zIndex: 10,
        }}>
          <div style={{
            width: 36, height: 36,
            border: '3px solid #e4e0d9', borderTopColor: '#2c5282',
            borderRadius: '50%', animation: 'spin 0.8s linear infinite',
          }} />
          <div style={{
            fontSize: 14, color: '#9b968d',
            fontFamily: "'JetBrains Mono', monospace",
            textTransform: 'uppercase', letterSpacing: '1px',
          }}>
            {loadingMessage}
          </div>
        </div>
      )}
      <div
        id="onlyoffice-editor"
        ref={containerRef}
        style={{ height: '100%', width: '100%' }}
      />
    </div>
  )
}
