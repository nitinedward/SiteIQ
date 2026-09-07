/**
 * SiteIQ "Reword with AI" — right-click flow with a caret-anchored card.
 *
 * Invisible system plugin (isVisual:false, isSystem:true). Two jobs:
 *   1. Put "Reword with AI" in the editor's right-click menu on every
 *      document, with nothing for the user to open first.
 *   2. Show the rewrite UI as a small card floating next to the caret.
 *
 * Why a system plugin rather than `autostart`: registration is deferred and
 * replayed on document-ready —
 *   asc_pluginsRegister = function(r,t){ this.Ema ? this.Ema.register(r,t)
 *                                                 : this.FRc = {path:r,plugins:t} }
 * — and register() launches isSystem plugins itself. `autostart` instead
 * goes through asc_pluginRun, which has no deferral and shift()s the guid
 * off its list, discarding the plugin for good when it lands early.
 *
 * Why the card is this plugin's own iframe rather than a plugin window:
 * Common.Views.PluginDlg (what ShowWindow builds) is always centred — it
 * takes width/height but no position. A non-visual plugin still gets a real
 * iframe (id "iframe_<guid>", parked offscreen), and ShowInputHelper
 * repositions exactly that iframe next to the caret, which is what makes
 * the Copilot-style anchored placement possible. So the card below IS this
 * plugin's document body.
 *
 * config.json must declare BOTH onContextMenuShow and onContextMenuClick:
 * the editor dispatches clicks via xPd("onContextMenuClick", ...), and xPd
 * only delivers events a plugin declared, so omitting the second one makes
 * every click silently vanish.
 */
(function (window, undefined) {
  var ITEM_ID = 'siteiq_rwm_open'
  var LOG = '[reword-menu]'
  var CARD_WIDTH = 392

  // One-click presets. The label is what the user sees; the instruction is
  // what Claude is told, so it can be more explicit than the chip allows.
  var PRESETS = [
    { label: 'More formal',   tone: 'more formal and professional' },
    { label: 'More casual',   tone: 'more casual and conversational, while staying professional' },
    { label: 'More concise',  tone: 'more concise — same meaning, fewer words' },
    { label: 'More detailed', tone: 'more detailed and specific, without inventing any new facts' },
    { label: 'Fix grammar',   tone: 'corrected for grammar, spelling and punctuation only — keep the wording and tone as close to the original as possible' },
    { label: 'Plainer',       tone: 'in plainer language, easier for a non-engineer to read' },
  ]

  var els = {}
  var state = {
    open: false,
    original: '',
    lastTone: null,
    rewrite: null,
    busy: false,
  }

  function api() { return window.Asc.plugin }
  function $(id) { return document.getElementById(id) }

  // ── CARD VISIBILITY ───────────────────────────────────────────────────
  // ShowInputHelper(guid, width, height, takeKeyboard) parks this plugin's
  // iframe beside the caret and sizes it. Keyboard is taken so the custom
  // tone field is typeable.
  function showCard(focusInput) {
    state.open = true
    // Measure after the DOM has settled so the card is sized to its content.
    window.setTimeout(function () {
      var card = $('card')
      var h = card ? Math.min(card.offsetHeight + 4, 460) : 240
      api().executeMethod('ShowInputHelper', [api().guid, CARD_WIDTH, h, true])
      if (focusInput && els.tone) {
        window.setTimeout(function () { try { els.tone.focus() } catch (e) {} }, 60)
      }
    }, 0)
  }

  function hideCard() {
    state.open = false
    api().executeMethod('UnShowInputHelper', [api().guid, true])
  }

  function closeAll() {
    state.rewrite = null
    state.busy = false
    hideCard()
  }

  // ── RENDER ────────────────────────────────────────────────────────────
  function showError(msg) {
    if (!msg) { els.err.className = 'err hidden'; els.err.textContent = ''; return }
    els.err.className = 'err'
    els.err.textContent = msg
  }

  function render() {
    els.orig.textContent = state.original

    if (state.rewrite !== null) {
      els.out.className = ''
      els.ask.className = 'hidden'
      els.result.textContent = state.rewrite
    } else {
      els.out.className = 'hidden'
      els.ask.className = ''
    }

    els.btnGo.disabled = state.busy
    els.btnGo.innerHTML = state.busy ? '<span class="spin"></span>Rewriting…' : 'Rewrite'
    els.btnAccept.disabled = state.busy
  }

  function buildChips() {
    els.chips.innerHTML = ''
    PRESETS.forEach(function (preset) {
      var b = document.createElement('button')
      b.className = 'chip'
      b.textContent = preset.label
      // A preset is a complete instruction on its own — one click runs it,
      // rather than making the user click a chip and then Rewrite.
      b.onclick = function () { runRewrite(preset.tone) }
      els.chips.appendChild(b)
    })
  }

  // ── REWRITE ───────────────────────────────────────────────────────────
  /** `tone` from a preset chip; otherwise whatever is typed in the box. */
  function runRewrite(tone) {
    if (state.busy || !state.original) return
    state.busy = true
    state.lastTone = tone || (els.tone.value || '').trim() || null
    showError('')
    render()

    fetch('/api/docs/rewrite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selectedText: state.original,
        tone: state.lastTone || undefined,
      }),
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
        showCard()
      })
      .catch(function (err) {
        state.busy = false
        console.error(LOG, 'rewrite failed', err)
        showError(err && err.message ? err.message : 'Rewrite failed')
        render()
        showCard()
      })
  }

  function acceptRewrite() {
    if (state.rewrite === null || state.busy) return
    var text = state.rewrite
    hideCard()
    // PasteText replaces the current selection, the same path a normal
    // paste takes. Nothing is written until this point.
    api().executeMethod('PasteText', [text], function () {
      state.rewrite = null
      state.busy = false
    })
  }

  /** Entry point from the right-click menu: open the card with the tone box
   *  focused and wait for the user to say how they want it read. */
  function startFlow() {
    if (state.busy) return
    api().executeMethod('GetSelectedText', [], function (text) {
      var selected = (text || '').trim()
      console.log(LOG, 'selection length', selected.length)
      if (!selected) {
        window.alert('Select some text in the document first.')
        return
      }
      state.original = selected
      state.rewrite = null
      state.busy = false
      if (els.tone) els.tone.value = ''
      showError('')
      render()
      showCard(true)
    })
  }

  // ── INIT ──────────────────────────────────────────────────────────────
  window.Asc.plugin.init = function () {
    console.log(LOG, 'init fired — menu plugin running')

    els.card = $('card')
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
    els.btnClose = $('btnClose')
    els.err = $('err')

    // Wrapped: a bare handler would pass the click event in as `tone`.
    els.btnGo.onclick = function () { runRewrite() }
    els.btnAccept.onclick = acceptRewrite
    els.btnDiscard.onclick = closeAll
    els.btnClose.onclick = closeAll
    // "Try again" returns to the tone box with what they typed still there,
    // so it can be tweaked rather than retyped.
    els.btnRetry.onclick = function () {
      state.rewrite = null
      render()
      showCard(true)
    }
    els.tone.onkeydown = function (e) {
      if (e.keyCode === 13) { e.preventDefault(); runRewrite() }
    }
    document.onkeydown = function (e) {
      if (e.keyCode === 27) closeAll()
    }

    buildChips()
    render()
  }

  window.Asc.plugin.button = function () { closeAll() }

  // ── RIGHT-CLICK MENU ──────────────────────────────────────────────────
  // A single flat row, no submenu: picking it opens the card and the user
  // says how they want it read there.
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
