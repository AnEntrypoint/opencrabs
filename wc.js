const CHEERPX_CDN = 'https://cxrtnc.leaningtech.com/1.2.9/cx.esm.js'
const DISK_URL = 'wss://disks.webvm.io/debian_large_20230522_5044875331_2.ext2'
const DISK_CACHE = 'cx-disk-cache-v5'
const NPM_PROXY = '/npm-proxy'
const SHELL_ENV = ['HOME=/root','TERM=xterm-256color','USER=root','SHELL=/bin/bash','LANG=en_US.UTF-8','LC_ALL=C','PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin']
const AGENTS = {
  claude: ['npx', ['-y','@anthropic-ai/claude-code','--dangerously-skip-permissions']],
  kilo:   ['npx', ['-y','@kilocode/cli','kilo']],
}

let cx = null
let _dataDevice = null
let _status = 'unavailable'
let _cxReadFunc = null
const cbs = new Set()

function setStatus(s) { _status = s; cbs.forEach(fn => fn(s)) }

export function wcStatus() { return _status }
export function onWcStatus(fn) { cbs.add(fn); fn(_status); return () => cbs.delete(fn) }
export function wcReady() { return _status === 'ready' }

export async function boot() {
  if (!globalThis.crossOriginIsolated) { setStatus('unavailable'); return }
  if (cx) return
  setStatus('booting')

  try {
    const { Linux, CloudDevice, HttpBytesDevice, IDBDevice, OverlayDevice, WebDevice, DataDevice } = await import(CHEERPX_CDN)
    let blockDevice
    try { blockDevice = await CloudDevice.create(DISK_URL) }
    catch { blockDevice = await HttpBytesDevice.create(DISK_URL.replace('wss://', 'https://')) }
    const blockCache = await IDBDevice.create(DISK_CACHE)
    const overlayDevice = await OverlayDevice.create(blockDevice, blockCache)
    const webDevice = await WebDevice.create('')
    _dataDevice = await DataDevice.create()
    cx = await Linux.create({ mounts: [
      { type: 'ext2', dev: overlayDevice, path: '/' },
      { type: 'dir', dev: webDevice, path: '/web' },
      { type: 'dir', dev: _dataDevice, path: '/data' },
      { type: 'devs', path: '/dev' },
      { type: 'devpts', path: '/dev/pts' },
      { type: 'proc', path: '/proc' },
      { type: 'sys', path: '/sys' },
    ]})
    await setupNode()
  } catch(e) { setStatus('unavailable') }
}

async function setupNode() {
  try {
    const checkNpm = await cx.run('/usr/bin/test', ['-x', '/usr/local/bin/npm'], { env: SHELL_ENV, uid: 0, gid: 0, cwd: '/root' })
    if (checkNpm === 0) { setStatus('ready'); return }
    setStatus('installing-node')
    const resp = await fetch(NPM_PROXY).catch(() => null)
    if (!resp || !resp.ok) { setStatus('ready'); return }
    const buf = await resp.arrayBuffer()
    await _dataDevice.writeFile('/npm.tgz', new Uint8Array(buf))
    await cx.run('/bin/mkdir', ['-p', '/usr/local/lib/npm'], { env: SHELL_ENV, uid: 0, gid: 0, cwd: '/root' })
    await cx.run('/bin/tar', ['-xz', '-C', '/usr/local/lib/npm', '--strip-components=1', '-f', '/data/npm.tgz'], { env: SHELL_ENV, uid: 0, gid: 0, cwd: '/root' })
    await cx.run('/bin/ln', ['-sf', '/usr/local/lib/npm/bin/npm', '/usr/local/bin/npm'], { env: SHELL_ENV, uid: 0, gid: 0, cwd: '/root' })
    await cx.run('/bin/ln', ['-sf', '/usr/local/lib/npm/bin/npx', '/usr/local/bin/npx'], { env: SHELL_ENV, uid: 0, gid: 0, cwd: '/root' })
    await cx.run('/bin/chmod', ['+x', '/usr/local/lib/npm/bin/npm', '/usr/local/lib/npm/bin/npx'], { env: SHELL_ENV, uid: 0, gid: 0, cwd: '/root' })
  } catch(e) {}
  setStatus('ready')
}

export async function spawnShell(onData) {
  if (!cx) return null
  try {
    const dec = new TextDecoder()
    let _onData = onData
    _cxReadFunc = cx.setCustomConsole(buf => _onData(dec.decode(buf).replace(/\r?\n/g, '\r\n')), 80, 24)
    const input = new WritableStream({ write(data) { for (const ch of data) _cxReadFunc(ch.charCodeAt(0)) } })
    const resize = (cols, rows) => { _cxReadFunc = cx.setCustomConsole(buf => _onData(dec.decode(buf).replace(/\r?\n/g, '\r\n')), cols, rows) }
    cx.run('/bin/bash', ['--login'], { env: SHELL_ENV, cwd: '/root', uid: 0, gid: 0 }).catch(() => {})
    return { input, exit: new Promise(() => {}), resize }
  } catch(e) { return null }
}

export async function runCli(agent, prompt, onLine) {
  if (!cx || !_cxReadFunc) { onLine({ type: 'err', text: 'Linux VM not ready' }); return }
  const cfg = AGENTS[agent]
  if (!cfg) { onLine({ type: 'err', text: 'unknown agent: ' + agent }); return }
  const cmd = cfg[0] + ' ' + cfg[1].join(' ') + ' ' + JSON.stringify(prompt) + '\n'
  for (const ch of cmd) _cxReadFunc(ch.charCodeAt(0))
  onLine({ type: 'info', text: '[command sent to terminal]' })
}

export async function wcExec() { return null }
export async function wcFsRead() { return null }
export async function wcFsWrite() { return null }
export async function wcFsList() { return null }
export async function wcGit() { return null }
