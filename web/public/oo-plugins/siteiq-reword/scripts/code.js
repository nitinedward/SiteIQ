/**
 * SiteIQ "Reword with AI" plugin.
 *
 * Runs as a normal visual side-panel plugin inside the OnlyOffice editor —
 * the same pattern OnlyOffice's own ChatGPT/Translator plugins use. The UI
 * lives here (index.html) rather than in the SiteIQ React page, which
 * removes every fragile piece the earlier designs depended on:
 *
 *  - No autostart. `runAutoStartPlugins` fires exactly once and shift()s the
 *    guid off its list, so if it races ahead of the editor's plugin registry
 *    the plugin is dropped forever (this was the real cause of the plugin
 *    intermittently never starting — it hinged on whether config.json was a
 *    CDN cache hit or miss). Launching from the Plugins tab has no such race.
 *  - No cross-frame postMessage handshake to the host page, so no stale
 *    window references and nothing to relay through the Document Server
 *    (whose message dispatcher has no case for forwarding external plugin
 *    messages by guid on this build anyway).
 *  - No callCommand/Asc.scope. Reading and writing the selection goes
 *    through the editor's own built-in plugin methods instead:
 *    GetSelectedText and PasteText (PasteText replaces the selection).
 *    Asc.scope only ever passes data INTO the document context — command
 *    results come back as the callback argument — and ApiRange has no
 *    SetText at all, so the old approach could not have worked as written.
 *
 * This file is served from the SiteIQ origin, so /api/docs/rewrite is a
 * same-origin fetch.
 */
(function (window, undefined) {
  var els = {}
  var state = {
    selection: '',
    tone: null,
    preview: null,
    busy: false,
  }

  var TONES = ['More formal', 'More concise', 'Plainer language', 'More detailed', 'Neutral/technical']

  function $(id) { return document.getElementById(id) }

  function showError(message) {
    if (!message) {
      els.error.className = 'error hidden'
      els.error.textContent = ''
      return
    }
    els.error.className = 'error'
    els.error.textContent = message
  }

  function render() {
    // Selected passage
    if (state.selection) {
      els.selection.className = 'selection'
      els.selection.textContent = state.selection
    } else {
      els.selection.className = 'selection empty'
      els.selection.textContent = 'Select a passage in the document…'
    }

    // Preview vs. controls
    if (state.preview !== null) {
      els.previewBox.className = ''
      els.preview.textContent = state.preview
      els.controls.className = 'hidden'
    } else {
      els.previewBox.className = 'hidden'
      els.controls.className = ''
    }

    els.btnRewrite.disabled = state.busy || !state.selection
    els.btnRewrite.textContent = state.busy ? 'Rewriting…' : 'Rewrite'
    els.btnAccept.disabled = state.busy
    els.btnAccept.textContent = state.busy ? 'Applying…' : 'Accept'
  }

  function refreshSelection() {
    // Don't clobber a preview the user is still deciding on — selection
    // changes fire this while they read the suggestion.
    if (state.preview !== null || state.busy) return
    window.Asc.plugin.executeMethod('GetSelectedText', [], function (text) {
      state.selection = (text || '').trim()
      render()
    })
  }

  function doRewrite() {
    if (!state.selection || state.busy) return
    state.busy = true
    showError('')
    render()

    fetch('/api/docs/rewrite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selectedText: state.selection,
        tone: state.tone || undefined,
        instruction: els.instruction.value.trim() || undefined,
      }),
    })
      .then(function (res) {
        return res.json().catch(function () { return {} }).then(function (data) {
          if (!res.ok) throw new Error(data.error || 'Rewrite failed')
          return data
        })
      })
      .then(function (data) {
        if (!data.rewrite) throw new Error('Empty response from AI')
        state.preview = data.rewrite
      })
      .catch(function (err) {
        showError(err && err.message ? err.message : 'Rewrite failed')
      })
      .then(function () {
        state.busy = false
        render()
      })
  }

  function acceptRewrite() {
    if (state.preview === null || state.busy) return
    var replacement = state.preview
    state.busy = true
    showError('')
    render()

    // PasteText replaces the current selection — the same path the editor
    // uses for a normal paste.
    window.Asc.plugin.executeMethod('PasteText', [replacement], function () {
      state.busy = false
      state.preview = null
      state.selection = replacement
      render()
    })
  }

  function discardRewrite() {
    state.preview = null
    showError('')
    render()
  }

  function buildToneChips() {
    els.chips.innerHTML = ''
    TONES.forEach(function (tone) {
      var btn = document.createElement('button')
      btn.className = state.tone === tone ? 'chip active' : 'chip'
      btn.textContent = tone
      btn.onclick = function () {
        state.tone = state.tone === tone ? null : tone
        buildToneChips()
      }
      els.chips.appendChild(btn)
    })
  }

  window.Asc.plugin.init = function () {
    els.selection = $('selection')
    els.controls = $('controls')
    els.chips = $('chips')
    els.instruction = $('instruction')
    els.btnRewrite = $('btnRewrite')
    els.previewBox = $('previewBox')
    els.preview = $('preview')
    els.btnDiscard = $('btnDiscard')
    els.btnAccept = $('btnAccept')
    els.error = $('error')

    els.btnRewrite.onclick = doRewrite
    els.btnAccept.onclick = acceptRewrite
    els.btnDiscard.onclick = discardRewrite

    buildToneChips()
    render()
    refreshSelection()
  }

  // config.json sets initOnSelectionChanged, so init() re-fires whenever the
  // selection changes — keeping the "Selected text" box live as the user
  // moves around the document.
  window.Asc.plugin.button = function () {
    this.executeCommand('close', '')
  }
})(window, undefined)
