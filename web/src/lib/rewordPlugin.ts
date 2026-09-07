// Points the editor at the "Reword with AI" plugin (see
// public/oo-plugins/siteiq-reword/), which the user opens as a side panel
// from the editor's own Plugins tab. The plugin owns its UI and reads and
// writes the selection through the editor's built-in plugin methods
// (GetSelectedText / PasteText) — the SiteIQ page itself is not involved.
export const rewordPluginConfigUrl = (appUrl: string) =>
  `${appUrl}/oo-plugins/siteiq-reword/config.json`
