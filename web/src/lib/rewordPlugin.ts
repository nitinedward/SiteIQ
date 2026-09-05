// Identifies the "siteiq-reword" OnlyOffice system plugin (see
// public/oo-plugins/siteiq-reword/) — must exactly match the "guid" in
// that plugin's config.json. This build of the Document Server exposes no
// createConnector()/selection API on the DocEditor JS instance itself (
// confirmed by enumerating its full prototype chain against a live editor),
// so reading/replacing the current selection has to go through a real
// OnlyOffice plugin running inside the editor iframe instead, reached via
// postMessage.
export const REWORD_PLUGIN_GUID = 'asc.{7A2E9C41-6B8A-4F0D-9E43-2B7B6C9D41F0}'

export const rewordPluginConfigUrl = (appUrl: string) =>
  `${appUrl}/oo-plugins/siteiq-reword/config.json`
