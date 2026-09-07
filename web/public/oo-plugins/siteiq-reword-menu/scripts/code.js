/**
 * SiteIQ "Reword with AI" — right-click menu plugin.
 *
 * Invisible system plugin (isVisual:false, isSystem:true) whose only job is
 * to put "Reword with AI" in the editor's right-click menu on every
 * document, without the user opening anything first.
 *
 * Why a system plugin rather than `autostart`: reading the Document
 * Server's own SDK shows registration is deferred and replayed once the
 * document is ready —
 *   asc_pluginsRegister = function(r,t){ this.Ema ? this.Ema.register(r,t)
 *                                                 : this.FRc = {path:r, plugins:t} }
 * — and register() launches isSystem plugins itself. `autostart` instead
 * goes through asc_pluginRun, which has NO such deferral and shift()s the
 * guid off its list, so an early call discards the plugin permanently.
 * That is why autostart worked or failed purely on CDN cache timing.
 *
 * The side-panel plugin (../siteiq-reword/) is separate and unchanged; this
 * one owns only the context menu and its preview dialog.
 */
(function (window, undefined) {
  var TONES = ['More formal', 'More concise', 'Plainer language', 'More detailed', 'Neutral/technical']
  var ITEM_PREFIX = 'siteiq_rwm_'
  var WINDOW_READY_TIMEOUT = 3000
  var LOG = '[reword-menu]'

  console.log(LOG, 'code.js loaded')

  var pending = null // { original, rewrite }
  var busy = false
  var win = null
  var winReadyTimer = null

  function api() { return window.Asc.plugin }

  function fetchRewrite(selectedText, tone) {
    return fetch('/api/docs/rewrite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selectedText: selectedText,
        tone: tone || undefined,
      }),
    }).then(function (res) {
      return res.json().catch(function () { return {} }).then(function (data) {
        if (!res.ok) throw new Error(data.error || 'Rewrite failed')
        if (!data.rewrite) throw new Error('Empty response from AI')
        return data.rewrite
      })
    })
  }

  function applyRewrite(text) {
    api().executeMethod('PasteText', [text], function () {
      pending = null
      busy = false
    })
  }

  function closeWindow() {
    if (winReadyTimer) { clearTimeout(winReadyTimer); winReadyTimer = null }
    if (win) {
      try { win.close() } catch (e) { /* already gone */ }
      win = null
    }
  }

  /** Plain-dialog fallback, used if the plugin-window dialog can't be shown
   *  (or never signals ready). Always leaves the user in control — the
   *  document is only touched on an explicit OK. */
  function confirmFallback() {
    if (!pending) return
    var ok = window.confirm(
      'Reword with AI — replace the selected text with:\n\n' +
      pending.rewrite +
      '\n\nClick OK to replace, Cancel to keep the original.'
    )
    if (ok) applyRewrite(pending.rewrite)
    else { pending = null; busy = false }
  }

  function showPreview() {
    if (!pending) return
    console.log(LOG, 'showPreview, Asc.PluginWindow available =', !!window.Asc.PluginWindow)

    if (!window.Asc.PluginWindow) { confirmFallback(); return }

    try {
      win = new window.Asc.PluginWindow()

      win.attachEvent('siteiq_ready', function () {
        if (winReadyTimer) { clearTimeout(winReadyTimer); winReadyTimer = null }
        if (pending) win.command('siteiq_data', pending)
      })
      win.attachEvent('siteiq_accept', function () {
        var text = pending ? pending.rewrite : null
        closeWindow()
        if (text) applyRewrite(text)
      })
      win.attachEvent('siteiq_discard', function () {
        closeWindow()
        pending = null
        busy = false
      })

      win.show({
        url: 'preview.html',
        description: 'Reword with AI',
        isModal: true,
        size: [460, 440],
        buttons: [],
      })

      // If the dialog never comes up (or the window API behaves differently
      // on this build), don't strand the user with nothing on screen.
      winReadyTimer = setTimeout(function () {
        winReadyTimer = null
        closeWindow()
        confirmFallback()
      }, WINDOW_READY_TIMEOUT)
    } catch (err) {
      closeWindow()
      confirmFallback()
    }
  }

  function runRewrite(tone) {
    console.log(LOG, 'runRewrite tone=', tone, 'busy=', busy)
    if (busy) return
    busy = true
    api().executeMethod('GetSelectedText', [], function (text) {
      var selected = (text || '').trim()
      console.log(LOG, 'GetSelectedText ->', JSON.stringify(selected.slice(0, 80)))
      if (!selected) {
        busy = false
        window.alert('Select some text in the document first.')
        return
      }
      fetchRewrite(selected, tone)
        .then(function (rewrite) {
          console.log(LOG, 'rewrite received, length', rewrite.length)
          pending = { original: selected, rewrite: rewrite, tone: tone || '' }
          showPreview()
        })
        .catch(function (err) {
          busy = false
          pending = null
          console.error(LOG, 'rewrite failed', err)
          window.alert('Could not rewrite that passage:\n\n' + (err && err.message ? err.message : 'Unknown error'))
        })
    })
  }

  window.Asc.plugin.init = function () {
    console.log(LOG, 'init fired — menu plugin running')
  }
  window.Asc.plugin.button = function () { this.executeCommand('close', '') }

  window.Asc.plugin.event_onContextMenuShow = function (options) {
    console.log(LOG, 'onContextMenuShow type=', options && options.type)
    if (!options || options.type !== 'Selection') return

    var items = [{ id: ITEM_PREFIX + 'default', text: 'Rewrite' }]
    TONES.forEach(function (tone) {
      items.push({ id: ITEM_PREFIX + tone, text: tone })
    })

    this.executeMethod('AddContextMenuItem', [{
      guid: this.guid,
      items: [{ id: ITEM_PREFIX + 'root', text: 'Reword with AI', items: items }],
    }])
    console.log(LOG, 'context menu item added')
  }

  // The root row is wired up too: on some builds a parent row with children
  // is click-through rather than submenu-only, and picking it should do the
  // sensible default rather than nothing.
  window.Asc.plugin.attachContextMenuClickEvent(ITEM_PREFIX + 'root', function () {
    console.log(LOG, 'context click: root')
    runRewrite(null)
  })
  window.Asc.plugin.attachContextMenuClickEvent(ITEM_PREFIX + 'default', function () {
    console.log(LOG, 'context click: default')
    runRewrite(null)
  })
  TONES.forEach(function (tone) {
    window.Asc.plugin.attachContextMenuClickEvent(ITEM_PREFIX + tone, function () {
      console.log(LOG, 'context click: ' + tone)
      runRewrite(tone)
    })
  })
})(window, undefined)
