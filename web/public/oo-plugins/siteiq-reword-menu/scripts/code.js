/**
 * SiteIQ "Reword with AI" — right-click entry point.
 *
 * Invisible system plugin (isVisual:false, isSystem:true). Two jobs:
 *   1. Put "Reword with AI" in the editor's right-click menu on every
 *      document, with nothing for the user to open first.
 *   2. Own the document side of the flow — read the selection, and paste
 *      the rewrite once the user accepts it.
 *
 * The UI lives in window.html, shown as an Asc.PluginWindow. That builds a
 * Common.Views.PluginDlg, which the user can drag and resize, and which
 * stays open — so right-clicking another passage updates the open panel
 * rather than replacing it. (ShowInputHelper, used previously, anchors the
 * plugin's own iframe to the caret but takes no position, so a card shown
 * that way can be neither moved nor resized.)
 *
 * Notes that cost time to find, kept so they aren't rediscovered:
 *  - config.json must declare BOTH onContextMenuShow and onContextMenuClick.
 *    Clicks are dispatched via xPd("onContextMenuClick", ...), and xPd only
 *    delivers events a plugin declared, so omitting the second makes every
 *    click vanish silently.
 *  - The object passed to show() must carry isVisual:true and an
 *    EditorsSupport containing this editor, and must not be flagged system:
 *    onPluginWindowShow gates on `e.isVisual`, `_.contains(e.EditorsSupport,
 *    this.editor)` and `!isSystem` before it will build the dialog at all.
 *  - System plugin rather than autostart: registration is deferred and
 *    replayed on document-ready (asc_pluginsRegister stashes into FRc when
 *    the manager isn't up yet) and register() launches isSystem plugins
 *    itself, whereas autostart goes through asc_pluginRun, which has no
 *    deferral and shift()s the guid off its list — discarding the plugin
 *    for good when it lands early.
 */
(function (window, undefined) {
  var ITEM_ID = 'siteiq_rwm_open'
  var LOG = '[reword-menu]'

  var WIDTH = 460
  var MIN_H = 200
  var MAX_H = 860
  var SIZE = [WIDTH, 430]
  var MIN_SIZE = [360, MIN_H]
  var MAX_SIZE = [1000, MAX_H]

  // Must be absolute. A variation's `url` in config.json is resolved
  // against the plugin's baseUrl, but ShowWindow's is not: PluginWindow
  // .show() only appends the windowID, and onPluginWindowShow hands the
  // string straight to the dialog's iframe — so a relative "window.html"
  // resolves against the editor's own origin
  // (onlyoffice.../web-apps/apps/documenteditor/main/) and 404s.
  var WINDOW_URL = window.location.origin +
    window.location.pathname.replace(/[^/]*$/, '') + 'window.html'

  var win = null
  var selection = ''
  var lastHeight = 0

  function api() { return window.Asc.plugin }

  function closeWindow() {
    if (!win) return
    try { win.close() } catch (e) { /* already gone */ }
    win = null
    lastHeight = 0
  }

  function openWindow() {
    win = new window.Asc.PluginWindow()

    win.attachEvent('siteiq_ready', function () {
      if (win) win.command('siteiq_data', { original: selection })
    })
    win.attachEvent('siteiq_accept', function (data) {
      var text = data && data.text
      closeWindow()
      if (!text) return
      // PasteText replaces the current selection, the same path a normal
      // paste takes. Nothing is written to the document before this.
      api().executeMethod('PasteText', [text])
    })
    win.attachEvent('siteiq_close', function () {
      closeWindow()
    })
    // The panel measures its own content and asks to be fitted to it, so
    // the window stays compact instead of leaving a strip of empty space
    // under the buttons or forcing the user to scroll.
    win.attachEvent('siteiq_resize', function (data) {
      if (!win || !data || !data.height) return
      var h = Math.max(MIN_H, Math.min(MAX_H, Math.ceil(data.height)))
      if (h === lastHeight) return
      lastHeight = h
      try {
        api().executeMethod('ResizeWindow', [win.id, [WIDTH, h], MIN_SIZE, MAX_SIZE])
      } catch (e) {
        console.log(LOG, 'ResizeWindow failed', e)
      }
    })

    console.log(LOG, 'opening window at', WINDOW_URL)
    win.show({
      url: WINDOW_URL,
      description: 'Reword with AI',
      isVisual: true,
      EditorsSupport: ['word'],
      isModal: false,
      size: SIZE,
      buttons: [],
    })
    // No initial ResizeWindow here — the panel fits itself as soon as it
    // renders, and that call passes a max larger than the min, which is
    // also what flips PluginDlg into a user-resizable window
    // (onPluginWindowResize -> setResizable).
  }

  function startFlow() {
    api().executeMethod('GetSelectedText', [], function (text) {
      var selected = (text || '').trim()
      console.log(LOG, 'selection length', selected.length)
      if (!selected) {
        window.alert('Select some text in the document first.')
        return
      }
      selection = selected
      if (win) {
        // Already open — refresh it in place rather than opening another.
        win.command('siteiq_data', { original: selection })
      } else {
        openWindow()
      }
    })
  }

  window.Asc.plugin.init = function () {
    console.log(LOG, 'init fired — menu plugin running')
  }

  window.Asc.plugin.button = function () { closeWindow() }

  // ── RIGHT-CLICK MENU ──────────────────────────────────────────────────
  window.Asc.plugin.event_onContextMenuShow = function (options) {
    if (!options || options.type !== 'Selection') return
    this.executeMethod('AddContextMenuItem', [{
      guid: this.guid,
      items: [{ id: ITEM_ID, text: 'Reword with AI' }],
    }])
  }

  window.Asc.plugin.attachContextMenuClickEvent(ITEM_ID, function () {
    console.log(LOG, 'context click')
    startFlow()
  })
})(window, undefined)
