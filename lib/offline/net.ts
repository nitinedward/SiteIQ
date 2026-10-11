/** Whether the phone has a connection, kept up to date, so screens and the
 *  upload queue know at once — without waiting on a request to time out —
 *  when there's no point trying the server.
 *
 *  "Connected" is only a hint: on a weak signal requests can still crawl or
 *  fail, which is why everything that talks to the server also has a time
 *  limit and falls back to what's on the phone. */

import * as Network from 'expo-network'

let online = true
let wifi = false
let started = false
const listeners = new Set<(online: boolean) => void>()

function apply(s: Network.NetworkState) {
  const was = online
  online = s.isConnected !== false && s.isInternetReachable !== false && s.type !== Network.NetworkStateType.NONE
  wifi = s.type === Network.NetworkStateType.WIFI
  if (online !== was) listeners.forEach(l => l(online))
}

export function startNetworkWatch(): void {
  if (started) return
  started = true
  Network.getNetworkStateAsync().then(apply).catch(() => {})
  Network.addNetworkStateListener(apply)
}

export function isOnline(): boolean { return online }
export function isWifi(): boolean { return online && wifi }

/** Follows the connection; returns the unsubscribe. */
export function onConnectivity(listener: (online: boolean) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Rejects if `promise` takes longer than `ms`. The request itself isn't
 *  cancelled; its answer is just no longer waited for. */
export function withTimeout<T>(promise: PromiseLike<T>, ms: number, message = 'The connection is too slow.'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    Promise.resolve(promise).then(
      v => { clearTimeout(timer); resolve(v) },
      e => { clearTimeout(timer); reject(e) })
  })
}
