/** Loads the Document Server's api.js (which defines window.DocsAPI) once per
 *  page, shared by everyone who needs it.
 *
 *  The report page starts this as soon as it mounts, so the script downloads
 *  while the page is still fetching the inspection, checking the document and
 *  signing the editor config — instead of only after all of that, which is
 *  when the editor component used to request it. The editor then just awaits
 *  the same promise.
 *
 *  A failed load clears the cached promise so a later call (the editor's
 *  Retry button) starts a fresh attempt rather than re-reading the failure. */

export const ONLYOFFICE_URL =
  process.env.NEXT_PUBLIC_ONLYOFFICE_SERVER_URL ?? 'http://localhost'

export const DOCS_API_SCRIPT_URL = `${ONLYOFFICE_URL}/web-apps/apps/api/documents/api.js`

const MAX_RETRIES = 3
const RETRY_DELAY = 3000

let pending: Promise<void> | null = null

export function loadDocsApi(onRetry?: (attempt: number, max: number) => void): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if ((window as any).DocsAPI) return Promise.resolve()
  if (pending) return pending

  pending = new Promise<void>((resolve, reject) => {
    let retryCount = 0
    const attempt = () => {
      if ((window as any).DocsAPI) { resolve(); return }

      const script   = document.createElement('script')
      script.src     = DOCS_API_SCRIPT_URL
      script.onload  = () => resolve()
      script.onerror = () => {
        script.remove()
        if (retryCount < MAX_RETRIES) {
          retryCount++
          onRetry?.(retryCount, MAX_RETRIES)
          setTimeout(attempt, RETRY_DELAY)
        } else {
          reject(new Error('OnlyOffice Document Server is not running.'))
        }
      }
      document.head.appendChild(script)
    }
    attempt()
  })

  pending.catch(() => { pending = null })
  return pending
}
