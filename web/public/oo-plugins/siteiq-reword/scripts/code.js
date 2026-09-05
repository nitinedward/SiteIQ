/**
 * SiteIQ Reword bridge plugin.
 *
 * This is a "system" plugin (isVisual:false, isSystem:true) — it has no UI
 * of its own. It exists purely so the outer SiteIQ page (which cannot read
 * or replace the current selection directly — this Document Server build
 * exposes no createConnector()/selection API on the DocEditor JS instance)
 * can reach into the document.
 *
 * IMPORTANT: this does NOT use OnlyOffice's "onExternalPluginMessage"
 * relay (posting {type:"onExternalPluginMessage", guid, data} into the
 * main editor iframe). That was the original design, but reading this
 * Document Server's own sdk-all.js directly showed its top-level message
 * dispatcher (the "h" function handling messages arriving at the main
 * editor iframe) has no case for that message type at all — it's simply
 * dropped, silently, for this build/version. Instead, this plugin
 * announces itself directly to the top page via window.top.postMessage on
 * load; the top page captures the live window reference from
 * MessageEvent.source (which works across cross-origin nested iframes by
 * design) and talks to this plugin directly from then on — no OnlyOffice
 * relay involved at all, only Asc.plugin.callCommand/Asc.scope (the
 * genuine, stable bridge into the document API) once a request arrives.
 */
(function (window, undefined) {
  var RESULT_SOURCE = 'siteiq-reword-plugin'
  var HOST_SOURCE = 'siteiq-reword-host'
  var LOG = '[siteiq-reword-plugin]'

  console.log(LOG, 'code.js loaded, typeof Asc.plugin.callCommand =', typeof (window.Asc && window.Asc.plugin && window.Asc.plugin.callCommand))

  function respond(requestId, payload) {
    console.log(LOG, 'responding', requestId, payload)
    try {
      window.top.postMessage(
        JSON.stringify(Object.assign({ source: RESULT_SOURCE, requestId: requestId }, payload)),
        '*'
      )
    } catch (err) {
      console.error(LOG, 'respond() postMessage threw', err)
    }
  }

  window.Asc.plugin.init = function () {
    console.log(LOG, 'Asc.plugin.init fired, typeof callCommand =', typeof window.Asc.plugin.callCommand)
    // Announce readiness so the top page can capture event.source and
    // reach this window directly for every future request.
    respond(null, { type: 'plugin-ready' })
  }
  window.Asc.plugin.button = function () {
    console.log(LOG, 'button clicked, closing')
    this.executeCommand('close', '')
  }

  function handleRequest(data) {
    console.log(LOG, 'handleRequest', data)
    var requestId = data.requestId

    if (data.type === 'ping') {
      respond(requestId, { type: 'pong' })
      return
    }

    if (data.type === 'getSelection') {
      window.Asc.plugin.onCommandCallback = function (result) {
        console.log(LOG, 'onCommandCallback fired for getSelection, result=', result, 'Asc.scope=', Asc.scope)
        if (Asc.scope.error) {
          respond(requestId, { type: 'selectionResult', error: Asc.scope.error })
        } else {
          respond(requestId, { type: 'selectionResult', text: Asc.scope.result || '' })
        }
      }
      console.log(LOG, 'calling callCommand for getSelection')
      window.Asc.plugin.callCommand(function () {
        try {
          var oDocument = Api.GetDocument()
          var oRange = oDocument.GetRangeBySelect()
          if (!oRange) {
            Asc.scope.error = 'No active selection'
            Asc.scope.result = null
            return
          }
          Asc.scope.result = oRange.GetText()
          Asc.scope.error = null
        } catch (e) {
          Asc.scope.error = 'Document API error: ' + (e && e.message ? e.message : String(e))
          Asc.scope.result = null
        }
      }, true)
      return
    }

    if (data.type === 'replaceSelection') {
      Asc.scope.newText = data.text || ''
      window.Asc.plugin.onCommandCallback = function () {
        console.log(LOG, 'onCommandCallback fired for replaceSelection, Asc.scope=', Asc.scope)
        if (Asc.scope.error) {
          respond(requestId, { type: 'replaceResult', error: Asc.scope.error })
        } else {
          respond(requestId, { type: 'replaceResult', ok: true })
        }
      }
      console.log(LOG, 'calling callCommand for replaceSelection')
      window.Asc.plugin.callCommand(function () {
        try {
          var oDocument = Api.GetDocument()
          var oRange = oDocument.GetRangeBySelect()
          if (!oRange) {
            Asc.scope.error = 'No active selection'
            return
          }
          oRange.Delete()
          oRange.AddText(Asc.scope.newText)
          Asc.scope.error = null
        } catch (e) {
          Asc.scope.error = 'Document API error: ' + (e && e.message ? e.message : String(e))
        }
      }, true)
      return
    }
  }

  // Direct channel from our own top page — bypasses OnlyOffice's plugin
  // message relay entirely, since it doesn't support what we need on this
  // build. The host page replies to exactly the event.source window it
  // captured from our "plugin-ready" announcement above, so this listener
  // only needs to trust messages carrying our own host marker.
  window.addEventListener('message', function (event) {
    var msg
    try {
      msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
    } catch (err) {
      return
    }
    if (msg && typeof msg === 'object') {
      console.log(LOG, 'raw message event, origin=', event.origin, 'data=', msg)
    }
    if (!msg || msg.source !== HOST_SOURCE || !msg.type) return
    handleRequest(msg)
  })
})(window, undefined)
