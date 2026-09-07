// The two OnlyOffice plugins behind "Reword with AI". Both are static files
// under public/oo-plugins/ and are handed to the editor via
// editorConfig.plugins.pluginsData, so they deploy with the app.
//
// Neither is autostarted. `autostart` goes through asc_pluginRun, which has
// no deferral and shift()s the guid off its list, so a call that lands
// before the editor is ready discards the plugin for good — which made it
// hinge on whether config.json was a CDN cache hit. Plugin *registration*,
// by contrast, is deferred and replayed on document-ready
// (asc_pluginsRegister stashes into FRc when the manager isn't up yet), and
// register() launches isSystem plugins itself — so the menu plugin below
// starts reliably by being a system plugin, not by being autostarted.

/** Side panel with the full UI, opened from the editor's Plugins tab. */
export const rewordPanelConfigUrl = (appUrl: string) =>
  `${appUrl}/oo-plugins/siteiq-reword/config.json`

/** Invisible system plugin that puts "Reword with AI" in the right-click
 *  menu on every document, with its own preview dialog. */
export const rewordMenuConfigUrl = (appUrl: string) =>
  `${appUrl}/oo-plugins/siteiq-reword-menu/config.json`
