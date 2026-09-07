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
  var TONES = ['More formal', 'More concise', 'Plainer language', 'More detailed', 'Neutral/technical']
  var ITEM_PREFIX = 'siteiq_rwm_'
  var LOG = '[reword-menu]'
  var CARD_WIDTH = 380

  var els = {}
  var state = {
    open: false,
    original: '',
    tone: null,
    rewrite: null,
    busy: false,
  }

  function api() { return window.Asc.plugin }
  function $(id) { return document.getElementById(id) }

  // ── CARD VISIBILITY ───────────────────────────────────────────────────
  // ShowInputHelper(guid, width, height, takeKeyboard) parks this plugin's
  // iframe beside the caret and sizes it. Keyboard is taken so the custom
  // tone field is typeable.
  function showCard() {
    state.open = true
    // Measure after the DOM has settled so the card is sized to its content.
    window.setTimeout(function () {
      var card = $('card')
      var h = card ? Math.min(card.offsetHeight + 4, 460) : 260
      api().executeMethod('ShowInputHelper', [api().guid, CARD_WIDTH, h, true])
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
    TONES.forEach(function (tone) {
      var b = document.createElement('button')
      b.className = state.tone === tone ? 'chip active' : 'chip'
      b.textContent = tone
      b.onclick = function () {
        state.tone = (state.tone === tone) ? null : tone
        buildChips()
      }
      els.chips.appendChild(b)
    })
  }

  // ── REWRITE ───────────────────────────────────────────────────────────
  function runRewrite() {
    if (state.busy || !state.original) return
    state.busy = true
    showError('')
    render()

    var custom = (els.tone.value || '').trim()

    fetch('/api/docs/rewrite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selectedText: state.original,
        tone: state.tone || undefined,
        instruction: custom || undefined,
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

  /** Entry point from the right-click menu. */
  function startFlow(tone) {
    if (state.busy) return
    api().executeMethod('GetSelectedText', [], function (text) {
      var selected = (text || '').trim()
      console.log(LOG, 'selection length', selected.length)
      if (!selected) {
        window.alert('Select some text in the document first.')
        return
      }
      state.original = selected
      state.tone = tone || null
      state.rewrite = null
      state.busy = false
      if (els.tone) els.tone.value = ''
      showError('')
      buildChips()
      render()
      showCard()
      // A tone picked straight from the menu means the user already said
      // what they want — go, rather than making them click Rewrite too.
      if (tone) runRewrite()
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

    els.btnGo.onclick = runRewrite
    els.btnAccept.onclick = acceptRewrite
    els.btnDiscard.onclick = closeAll
    els.btnClose.onclick = closeAll
    els.btnRetry.onclick = function () {
      state.rewrite = null
      render()
      showCard()
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
  window.Asc.plugin.event_onContextMenuShow = function (options) {
    if (!options || options.type !== 'Selection') return

    var items = [{ id: ITEM_PREFIX + 'default', text: 'Rewrite…' }]
    TONES.forEach(function (tone) {
      items.push({ id: ITEM_PREFIX + tone, text: tone })
    })

    this.executeMethod('AddContextMenuItem', [{
      guid: this.guid,
      items: [{ id: ITEM_PREFIX + 'root', text: 'Reword with AI', items: items }],
    }])
  }

  // The root row is wired too: on some builds a parent row with children is
  // click-through rather than submenu-only.
  window.Asc.plugin.attachContextMenuClickEvent(ITEM_PREFIX + 'root', function () {
    startFlow(null)
  })
  window.Asc.plugin.attachContextMenuClickEvent(ITEM_PREFIX + 'default', function () {
    startFlow(null)
  })
  TONES.forEach(function (tone) {
    window.Asc.plugin.attachContextMenuClickEvent(ITEM_PREFIX + tone, function () {
      startFlow(tone)
    })
  })
})(window, undefined)
