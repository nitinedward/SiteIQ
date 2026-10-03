import { ONLYOFFICE_URL, DOCS_API_SCRIPT_URL } from '@/lib/docsApi'

/** Gets the Document Server connection and its api.js under way from the
 *  server-rendered HTML, before the page's JavaScript has even run. The
 *  preload's URL must stay identical to the one loadDocsApi() injects, or the
 *  browser downloads the script twice. */
export default function ReportLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link rel="preconnect" href={ONLYOFFICE_URL} />
      <link rel="preload" as="script" href={DOCS_API_SCRIPT_URL} />
      {children}
    </>
  )
}
