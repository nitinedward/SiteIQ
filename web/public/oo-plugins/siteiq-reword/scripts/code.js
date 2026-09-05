/**
 * SiteIQ Reword bridge plugin.
 *
 * This is a "system" plugin (isVisual:false, isSystem:true) — it has no UI
 * of its own. It exists purely so the outer SiteIQ page (which cannot read
 * or replace the current selection directly — this Document Server build
 * exposes no createConnector()/selection API on the DocEditor JS instance)
 * can reach into the document via postMessage:
 *
 *   editorIframe.contentWindow.postMessage(JSON.stringify({
 *     frameEditorId: editorIframe.id,
 *     guid: "asc.{7A2E9C41-6B8A-4F0D-9E43-2B7B6C9D41F0}",
 *     type: "onExternalPluginMessage",
 *     data: { type: "getSelection" | "replaceSelection", requestId, text? }
 *   }), "*")
 *
 * The result is posted back with window.top.postMessage(...) (window.top
 * because this script runs two iframes deep: SiteIQ page -> OnlyOffice
 * editor iframe -> this plugin's iframe).
 */
(function (window, undefined) {
  var RESULT_SOURCE = 'siteiq-reword-plugin'

  function respond(requestId, payload) {
    try {
      window.top.postMessage(
        JSON.stringify(Object.assign({ source: RESULT_SOURCE, requestId: requestId }, payload)),
        '*'
      )
    } catch (err) {
      // Nothing more we can do if even the postMessage itself throws.
    }
  }

  window.Asc.plugin.init = function () {}
  window.Asc.plugin.button = function () {}

  window.Asc.plugin.onExternalPluginMessage = function (data) {
    if (!data || !data.type) return
    var requestId = data.requestId

    if (data.type === 'ping') {
      respond(requestId, { type: 'pong' })
      return
    }

    if (data.type === 'getSelection') {
      window.Asc.plugin.onCommandCallback = function () {
        if (Asc.scope.error) {
          respond(requestId, { type: 'selectionResult', error: Asc.scope.error })
        } else {
          respond(requestId, { type: 'selectionResult', text: Asc.scope.result || '' })
        }
      }
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
        if (Asc.scope.error) {
          respond(requestId, { type: 'replaceResult', error: Asc.scope.error })
        } else {
          respond(requestId, { type: 'replaceResult', ok: true })
        }
      }
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
})(window, undefined)
