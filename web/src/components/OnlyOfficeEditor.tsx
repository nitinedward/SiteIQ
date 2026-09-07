'use client'
import { useEffect, useRef, useState } from 'react'
import { rewordPanelConfigUrl, rewordMenuConfigUrl } from '@/lib/rewordPlugin'

interface OnlyOfficeEditorProps {
  inspectionId: string
  fileName: string
  editable: boolean
  sessionKey: number
  onReady?: () => void
  onError?: () => void
  /** Enables renaming from the editor's own title in the top bar. Receives
   *  the new name (no extension). Omit to leave the title read-only. */
  onRename?: (newName: string) => void
}

export default function OnlyOfficeEditor({
  inspectionId,
  fileName,
  editable,
  sessionKey,
  onReady,
  onError,
  onRename,
}: OnlyOfficeEditorProps) {
  // Kept in a ref so the value used by the editor callback is always the
  // current one — the editor is constructed once and never re-created when
  // this prop changes identity.
  const onRenameRef = useRef(onRename)
  onRenameRef.current = onRename
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
            // Makes the title in the editor's top bar click-to-rename.
            // DocsAPI.DocEditor derives this from events.onRequestRename,
            // which can't be in the signed payload (functions don't
            // serialise) — so it is set here too, before signing, or the
            // constructor would add a field the token doesn't cover and the
            // config would no longer match it.
            canRename: !!onRename && editable,
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
              // Quieten the editor chrome so it reads as part of the page.
              // These four are read straight from customization — unlike
              // leftMenu/toolbar/layout, which this build gates behind
              // canBrandingExt (a licensed feature) and would ignore.
              hideRulers: true,
              comments: false,
              chat: false,
              spellcheck: false,
              customer: {
                name: 'SiteIQ',
                www: '',
                logo: '',
              },
              // customization.plugins must NOT be false — reading the
              // Document Server's own controller source
              // (setApi: this.appOptions.customization.plugins===false ||
              // (this.api.asc_registerCallback("asc_onPluginsInit", ...), ...))
              // shows `false` here short-circuits registration of the
              // ENTIRE plugin subsystem, not just the toolbar tab, which
              // silently no-ops editorConfig.plugins.pluginsData below.
              plugins: true,
              macros: false,
            },
            // Two plugins, neither autostarted — see src/lib/rewordPlugin.ts
            // for why autostart is unreliable here and registration isn't:
            //  - the panel, opened from the Plugins tab
            //  - the menu plugin, an invisible system plugin that register()
            //    starts on its own, giving the right-click item on every
            //    document without the user opening anything first
            plugins: {
              pluginsData: [
                rewordPanelConfigUrl(appUrl),
                rewordMenuConfigUrl(appUrl),
              ],
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

        // Attached after signing: callbacks are client-side only and never
        // reach the Document Server, so they are not part of the token.
        if (onRename && editable) {
          config.events = {
            onRequestRename: (event: any) => {
              const name = String(event?.data ?? '').trim()
              if (name) onRenameRef.current?.(name)
            },
          }
        }

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
        height: '100%', background: 'var(--paper)',
      }}>
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border-line)',
          borderRadius: 14, padding: '32px 36px',
          maxWidth: 480, width: '90%', textAlign: 'center',
          boxShadow: '0 4px 12px rgba(0,0,0,.08)',
        }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
          <div style={{
            fontFamily: 'var(--f-heading)', fontSize: 18,
            fontWeight: 800, color: 'var(--indigo-deep)', marginBottom: 10,
          }}>
            Document Editor Unavailable
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-mid)', lineHeight: 1.6 }}>
            The OnlyOffice Document Server is not running. Please start it and refresh.
          </div>

          <div style={{
            background: 'var(--paper)', borderRadius: 14,
            padding: '16px 20px', marginTop: 16,
            fontSize: 13, color: 'var(--text-mid)', lineHeight: 1.6,
          }}>
            OnlyOffice Document Server is temporarily unavailable.
            Please contact your administrator or try again in a few minutes.
          </div>

          <button
            onClick={handleRetry}
            style={{
              marginTop: 20,
              background: 'var(--indigo)', color: 'white',
              border: 'none', borderRadius: 10,
              padding: '10px 24px', fontSize: 14, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'var(--f-heading)',
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
          background: 'var(--paper)', zIndex: 10,
        }}>
          <div style={{
            width: 36, height: 36,
            border: '3px solid var(--border-line)', borderTopColor: 'var(--indigo)',
            borderRadius: '50%', animation: 'spin 0.8s linear infinite',
          }} />
          <div style={{
            fontSize: 14, color: 'var(--text-mid)',
            fontFamily: 'var(--f-text)',
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
