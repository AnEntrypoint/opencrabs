import { makeWorkerBlob, makeStackWorkerBlob } from './wc-workers.js'

const DEMO_BASE = 'https://ktock.github.io/container2wasm-demo'
const XTERM_PTY_CDN = 'https://cdn.jsdelivr.net/npm/xterm-pty@0.9.4'
const IMAGE_PREFIX = './containers/nodejs'
const CHUNKS_URL = './containers/nodejs.chunks'
const STACK_WORKER_URL = './wc-stack-worker.js'

const SHELL_ENV = [
  'HOME=/root', 'TERM=xterm-256color', 'USER=root', 'SHELL=/bin/sh',
  'LANG=en_US.UTF-8', 'LC_ALL=C',
  'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  'https_proxy=http://192.168.127.253:80',
  'http_proxy=http://192.168.127.253:80',
  'HTTPS_PROXY=http://192.168.127.253:80',
  'HTTP_PROXY=http://192.168.127.253:80',
  'SSL_CERT_FILE=/.wasmenv/proxy.crt',
]

const _registry = new Map()
let _assetsPromise = null

async function fetchText(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error('fetch failed: ' + url + ' ' + r.status)
  return r.text()
}

async function fetchChunkCount() {
  const r = await fetch(CHUNKS_URL)
  if (!r.ok) throw new Error('chunks file fetch failed: ' + r.status)
  return parseInt((await r.text()).trim(), 10)
}

async function fetchAndExecScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    const blob = new Blob([src], { type: 'application/javascript' })
    s.src = URL.createObjectURL(blob)
    s.onload = () => { URL.revokeObjectURL(s.src); resolve() }
    s.onerror = reject
    document.head.appendChild(s)
  })
}

export function bootAssets() {
  if (!_assetsPromise) _assetsPromise = (async () => {
    const [chunks, stackSrc, workerTools, shim, wasiDefs, workerUtil, wasiUtil, xtermJs, stackJs] = await Promise.all([
      fetchChunkCount(),
      fetchText(STACK_WORKER_URL),
      fetchText(XTERM_PTY_CDN + '/workerTools.js'),
      fetchText(DEMO_BASE + '/src/browser_wasi_shim/index.js'),
      fetchText(DEMO_BASE + '/src/browser_wasi_shim/wasi_defs.js'),
      fetchText(DEMO_BASE + '/src/worker-util.js'),
      fetchText(DEMO_BASE + '/src/wasi-util.js'),
      fetchText(XTERM_PTY_CDN + '/index.js'),
      fetchText(DEMO_BASE + '/src/stack.js'),
    ])
    await fetchAndExecScript(xtermJs)
    await fetchAndExecScript(stackJs)
    return { chunks, stackSrc, sharedScripts: [shim, wasiDefs, workerUtil, wasiUtil], workerTools }
  })()
  return _assetsPromise
}

async function fetchLayerUrls(layers) {
  if (!layers || !layers.length) return []
  const urls = []
  for (const layerId of layers) {
    const r = await fetch('./containers/layer-' + layerId + '.chunks')
    if (!r.ok) throw new Error('layer chunks missing: ' + layerId + ' ' + r.status)
    const n = parseInt((await r.text()).trim(), 10)
    const abs = new URL('./containers/layer-' + layerId, location.href).href
    for (let i = 0; i < n; i++) urls.push(abs + String(i).padStart(2, '0') + '.wasm')
  }
  return urls
}

export function createSystem(id, opts) {
  opts = opts || {}
  if (_registry.has(id)) return _registry.get(id)
  let status = 'unavailable'
  const cbs = new Set()
  let worker = null, stackWorker = null, nwStack = null
  function setStatus(s) { status = s; cbs.forEach(fn => fn(s)) }
  const sys = {
    id,
    get status() { return status },
    boot: async function() {
      if (!globalThis.crossOriginIsolated) { setStatus('unavailable'); throw new Error('crossOriginIsolated required — service worker not active yet, reload the page') }
      if (worker) return
      setStatus('booting')
      try {
        const { chunks, stackSrc, sharedScripts, workerTools } = await bootAssets()
        const absImagePrefix = new URL(IMAGE_PREFIX, location.href).href
        const extraUrls = await fetchLayerUrls(opts.layers)
        worker = new Worker(makeWorkerBlob(chunks, SHELL_ENV, [workerTools, ...sharedScripts], absImagePrefix, opts.cmd || ['-i'], extraUrls))
        stackWorker = new Worker(makeStackWorkerBlob(stackSrc, sharedScripts))
        nwStack = window.newStack(worker, IMAGE_PREFIX, chunks, stackWorker, DEMO_BASE + '/src/c2w-net-proxy.wasm')
        setStatus('ready')
      } catch(e) {
        console.error('boot failed [' + id + ']:', e)
        setStatus('unavailable')
        throw e
      }
    },
    spawnShell: async function(onData) {
      if (!worker || status !== 'ready') return null
      const { master, slave } = window.openpty()
      new window.TtyServer(slave).start(worker, nwStack)
      onData({ xtermAddon: master })
      return { input: new WritableStream({ write() {} }), exit: new Promise(() => {}), resize: () => {}, master }
    },
    destroy: function() {
      if (worker) { worker.terminate(); worker = null }
      if (stackWorker) { stackWorker.terminate(); stackWorker = null }
      nwStack = null
      _registry.delete(id)
      setStatus('unavailable')
    },
    onStatus: function(fn) { cbs.add(fn); fn(status); return () => cbs.delete(fn) }
  }
  _registry.set(id, sys)
  return sys
}

export function getSystem(id) { return _registry.get(id) || null }

const _default = createSystem('default')

export function wcStatus() { return _default.status }
export function onWcStatus(fn) { return _default.onStatus(fn) }
export function wcReady() { return _default.status === 'ready' }
export async function boot() { return _default.boot() }
export async function spawnShell(onData) { return _default.spawnShell(onData) }
export async function runCli(agent, prompt, onLine) { onLine({ type: 'info', text: 'Use the Terminal tab to interact with the container.' }) }
export async function wcExec() { return null }
export async function wcFsRead() { return null }
export async function wcFsWrite() { return null }
export async function wcFsList() { return null }
export async function wcGit() { return null }

window.__debug = window.__debug || {}
window.__debug.wc = { registry: _registry, get default() { return _default } }
