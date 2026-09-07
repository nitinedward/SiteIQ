/**
 * Preview dialog for the right-click "Reword with AI" flow.
 *
 * Runs as an Asc.PluginWindow opened by ../scripts/code.js. Talks back to
 * that plugin with sendToPlugin(); receives the passage pair through an
 * event the plugin sends with SendToWindow (delivered here as
 * Asc.plugin.event_<name>). The document is only modified after the user
 * presses Accept — this page never touches it directly.
 */
(function (window, undefined) {
  function bind() {
    var accept = document.getElementById('btnAccept')
    var discard = document.getElementById('btnDiscard')
    if (accept) accept.onclick = function () { window.Asc.plugin.sendToPlugin('siteiq_accept') }
    if (discard) discard.onclick = function () { window.Asc.plugin.sendToPlugin('siteiq_discard') }
  }

  window.Asc.plugin.init = function () {
    bind()
    // Tell the parent plugin we're up so it can send the text over.
    window.Asc.plugin.sendToPlugin('siteiq_ready')
  }

  window.Asc.plugin.event_siteiq_data = function (data) {
    if (!data) return
    var original = document.getElementById('original')
    var rewrite = document.getElementById('rewrite')
    if (original) original.textContent = data.original || ''
    if (rewrite) rewrite.textContent = data.rewrite || ''
  }

  window.Asc.plugin.button = function () {
    window.Asc.plugin.sendToPlugin('siteiq_discard')
  }
})(window, undefined)
