/**
 * Panel contents for the right-click "Reword with AI" flow.
 *
 * Runs inside an Asc.PluginWindow opened by ../scripts/code.js — a
 * Common.Views.PluginDlg, which the user can drag and resize, and which
 * stays open so a second right-click updates it in place instead of
 * replacing it.
 *
 * Window frames may not call executeMethod (plugins.js blocks it with
 * "This method does not allow in window frame"), so anything touching the
 * document — reading the selection, pasting the accepted text — is done by
 * the parent plugin and reaches us through sendToPlugin / event_* messages.
 * The rewrite request itself is a plain fetch, and this page is served from
 * the SiteIQ origin, so /api/docs/rewrite is same-origin.
 */
(function (window, undefined) {
  var PRESETS = [
    { label: 'More formal',   tone: 'more formal and professional' },
    { label: 'More casual',   tone: 'more casual and conversational, while staying professional' },
    { label: 'More concise',  tone: 'more concise — same meaning, fewer words' },
    { label: 'More detailed', tone: 'more detailed and specific, without inventing any new facts' },
    { label: 'Fix grammar',   tone: 'corrected for grammar, spelling and punctuation only — keep the wording and tone as close to the original as possible' },
    { label: 'Plainer',       tone: 'in plainer language, easier for a non-engineer to read' },
  ]

  var els = {}
  var state = { original: '', rewrite: null, busy: false }

  function $(id) { return document.getElementById(id) }

  /** Ask the parent to shrink/grow the window to exactly this content, so
   *  the panel stays compact with no empty strip under the buttons and
   *  nothing to scroll. Measured after layout has settled. */
  function fitToContent() {
    window.setTimeout(function () {
      var h = Math.ceil(document.body.scrollHeight)
      window.Asc.plugin.sendToPlugin('siteiq_resize', { height: h })
    }, 0)
  }

  function showError(msg) {
    if (!msg) { els.err.className = 'err hidden'; els.err.textContent = ''; return }
    els.err.className = 'err'
    els.err.textContent = msg
  }

  function render() {
    els.orig.textContent = state.original || '(no text selected)'

    if (state.rewrite !== null) {
      els.out.className = ''
      els.ask.className = 'hidden'
      els.result.textContent = state.rewrite
    } else {
      els.out.className = 'hidden'
      els.ask.className = ''
    }

    els.btnGo.disabled = state.busy || !state.original
    els.btnGo.innerHTML = state.busy ? '<span class="spin"></span>Rewriting…' : 'Rewrite'
    els.btnAccept.disabled = state.busy
    var chips = els.chips.getElementsByTagName('button')
    for (var i = 0; i < chips.length; i++) chips[i].disabled = state.busy || !state.original

    fitToContent()
  }

  function buildChips() {
    els.chips.innerHTML = ''
    PRESETS.forEach(function (preset) {
      var b = document.createElement('button')
      b.className = 'chip'
      b.textContent = preset.label
      // A preset is a complete instruction on its own — one click runs it.
      b.onclick = function () { runRewrite(preset.tone) }
      els.chips.appendChild(b)
    })
  }

  function runRewrite(tone) {
    if (state.busy || !state.original) return
    state.busy = true
    showError('')
    render()

    var instruction = tone || (els.tone.value || '').trim() || undefined

    fetch('/api/docs/rewrite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedText: state.original, tone: instruction }),
    })
      .then(function (res) {
        return res.json().catch(function () { return {} }).then(function (data) {
          if (!res.ok) throw new Error(data.error || 'Rewrite failed')
          if (!data.rewrite) throw new Error('Empty response from AI')
          return data.rewrite
        })
      })
      .then(function (rewrite) {
        state.rewrite = rewrite
        state.busy = false
        render()
      })
      .catch(function (err) {
        state.busy = false
        showError(err && err.message ? err.message : 'Rewrite failed')
        render()
      })
  }

  window.Asc.plugin.init = function () {
    els.orig = $('orig')
    els.ask = $('ask')
    els.chips = $('chips')
    els.tone = $('tone')
    els.btnGo = $('btnGo')
    els.out = $('out')
    els.result = $('result')
    els.btnRetry = $('btnRetry')
    els.btnDiscard = $('btnDiscard')
    els.btnAccept = $('btnAccept')
    els.err = $('err')

    els.btnGo.onclick = function () { runRewrite() }
    els.btnAccept.onclick = function () {
      if (state.rewrite === null || state.busy) return
      window.Asc.plugin.sendToPlugin('siteiq_accept', { text: state.rewrite })
    }
    els.btnDiscard.onclick = function () {
      window.Asc.plugin.sendToPlugin('siteiq_close')
    }
    // Back to the options with what was typed still there, so it can be
    // tweaked rather than retyped.
    els.btnRetry.onclick = function () {
      state.rewrite = null
      showError('')
      render()
    }
    els.tone.onkeydown = function (e) {
      if (e.keyCode === 13) { e.preventDefault(); runRewrite() }
    }

    buildChips()
    render()

    // Ask the parent for the current selection.
    window.Asc.plugin.sendToPlugin('siteiq_ready')
  }

  /** Sent by the parent plugin on open, and again whenever the user
   *  right-clicks a new passage while this panel is already open. */
  window.Asc.plugin.event_siteiq_data = function (data) {
    if (!data) return
    state.original = data.original || ''
    state.rewrite = null
    state.busy = false
    showError('')
    render()
    if (els.tone) els.tone.focus()
  }

  window.Asc.plugin.button = function () {
    window.Asc.plugin.sendToPlugin('siteiq_close')
  }
})(window, undefined)
