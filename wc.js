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

let _status = 'unavailable'
let _worker = null
let _stackWorker = null
let _nwStack = null
const cbs = new Set()

function setStatus(s) { _status = s; cbs.forEach(fn => fn(s)) }

export function wcStatus() { return _status }
export function onWcStatus(fn) { cbs.add(fn); fn(_status); return () => cbs.delete(fn) }
export function wcReady() { return _status === 'ready' }

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

export async function boot() {
  if (!globalThis.crossOriginIsolated) { setStatus('unavailable'); return }
  if (_worker) return
  setStatus('booting')
  try {
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
    const sharedScripts = [shim, wasiDefs, workerUtil, wasiUtil]
    const absImagePrefix = new URL(IMAGE_PREFIX, location.href).href
    _worker = new Worker(makeWorkerBlob(chunks, SHELL_ENV, [workerTools, ...sharedScripts], absImagePrefix))
    _stackWorker = new Worker(makeStackWorkerBlob(stackSrc, sharedScripts))
    _nwStack = window.newStack(_worker, IMAGE_PREFIX, chunks, _stackWorker, DEMO_BASE + '/src/c2w-net-proxy.wasm')
    setStatus('ready')
  } catch(e) {
    console.error('boot failed:', e)
    setStatus('unavailable')
  }
}

export async function spawnShell(onData) {
  if (!_worker || _status !== 'ready') return null
  const { master, slave } = window.openpty()
  new window.TtyServer(slave).start(_worker, _nwStack)
  onData({ xtermAddon: master })
  return { input: new WritableStream({ write() {} }), exit: new Promise(() => {}), resize: () => {}, master }
}

export async function runCli(agent, prompt, onLine) {
  onLine({ type: 'info', text: 'Use the Terminal tab to interact with the container.' })
}

export async function wcExec() { return null }
export async function wcFsRead() { return null }
export async function wcFsWrite() { return null }
export async function wcFsList() { return null }
export async function wcGit() { return null }

window.__debug = window.__debug || {}
window.__debug.wc = { get status() { return _status }, get worker() { return _worker } }
