import { WebContainer } from 'https://esm.sh/@webcontainer/api'

const AGENTS = {
  claude:   ['npx', ['-y','@anthropic-ai/claude-code','--dangerously-skip-permissions']],
  kilo:     ['npx', ['-y','@kilocode/cli','kilo']],
  opencode: ['npx', ['-y','opencode-ai']],
}

let wc = null
let _status = 'unavailable'
const cbs = new Set()

function setStatus(s) { _status = s; cbs.forEach(fn => fn(s)) }

export function wcStatus() { return _status }
export function onWcStatus(fn) { cbs.add(fn); fn(_status); return () => cbs.delete(fn) }

export async function boot() {
  if (!(typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated)) { setStatus('unavailable'); return }
  if (wc) return
  setStatus('booting')
  try { wc = await WebContainer.boot(); registerCdpRelay(wc); setStatus('ready') }
  catch(e) { setStatus('unavailable') }
}

export async function runCli(agent, prompt, onLine) {
  const cfg = AGENTS[agent]
  if (!cfg) { onLine({ type: 'err', text: 'unknown agent: ' + agent }); return }
  if (_status !== 'ready') { onLine({ type: 'err', text: 'WebContainer ' + _status }); return }
  try {
    const proc = await wc.spawn(cfg[0], [...cfg[1], prompt], {
      env: { HOME: '/root', PATH: '/usr/local/bin:/usr/bin:/bin' }
    })
    proc.output.pipeTo(new WritableStream({ write(data) { onLine({ type: 'out', text: data }) } }))
    const code = await proc.exit
    onLine({ type: 'info', text: '[exited ' + code + ']' })
  } catch(e) { onLine({ type: 'err', text: e.message }) }
}

const CDP_RELAY_SRC = "import http from 'node:http'\nconst replies = new Map()\nconst server = http.createServer(async (req, res) => {\n  if (req.method !== 'POST') { res.writeHead(405); res.end(); return }\n  const chunks = []\n  for await (const c of req) chunks.push(c)\n  try {\n    const { id, method, params } = JSON.parse(Buffer.concat(chunks).toString())\n    process.stdout.write(JSON.stringify({ __cdp: true, id, method, params }) + '\\n')\n    const timer = setTimeout(() => { replies.delete(id); res.writeHead(504); res.end('{}') }, 10000)\n    replies.set(id, result => { clearTimeout(timer); res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(result)) })\n  } catch(e) { res.writeHead(400); res.end(e.message) }\n})\nprocess.stdin.on('data', d => {\n  d.toString().split('\\n').filter(Boolean).forEach(line => {\n    try { const { id, result } = JSON.parse(line); const fn = replies.get(id); if (fn) { replies.delete(id); fn(result) } } catch {}\n  })\n})\nserver.listen(3001)\n"
const _cdpReplies = new Map()
let _cdpRelayUrl = null
const _cdpReadyCbs = new Set()

export function onCdpReady(fn) { if (_cdpRelayUrl) fn(_cdpRelayUrl); else _cdpReadyCbs.add(fn); return () => _cdpReadyCbs.delete(fn) }
export function routeCdpReply(id, result) { const fn = _cdpReplies.get(id); if (fn) { _cdpReplies.delete(id); fn(result) } }

export async function mountCdpRelay() {
  if (!wc) return
  await wc.fs.writeFile('/cdp-relay.mjs', CDP_RELAY_SRC)
}

function registerCdpRelay(wcInstance) {
  wcInstance.on('server-ready', (port, url) => {
    if (port === 3001) { _cdpRelayUrl = url; _cdpReadyCbs.forEach(fn => fn(url)); _cdpReadyCbs.clear() }
  })
  wcInstance.on('port', (port, type) => { if (port === 3001 && type === 'close') _cdpRelayUrl = null })
}

export async function wcExec(command, cwd) {
  if (!wc) return null
  try {
    let out = '', err = ''
    const proc = await wc.spawn('sh', ['-c', command], { cwd: cwd || '/', env: { HOME: '/root', PATH: '/usr/local/bin:/usr/bin:/bin' } })
    proc.output.pipeTo(new WritableStream({ write(d) { out += d } }))
    const code = await proc.exit
    return out + (err ? '\nSTDERR: ' + err : '') + '\n[exit ' + code + ']'
  } catch(e) { return 'Error: ' + e.message }
}

export async function wcFsRead(path) {
  if (!wc) return null
  try { return await wc.fs.readFile(path, 'utf8') } catch(e) { return null }
}

export async function wcFsWrite(path, content) {
  if (!wc) return null
  try { await wc.fs.writeFile(path, content); return true } catch(e) { return null }
}

export async function wcFsList(path) {
  if (!wc) return null
  try {
    const entries = await wc.fs.readdir(path || '/', { withFileTypes: true })
    return entries.map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }))
  } catch(e) { return null }
}

export async function wcGit(args, cwd) {
  return wcExec('git ' + args, cwd)
}

export function wcReady() { return _status === 'ready' }

export async function spawnShell(onData) {
  if (!wc) return null
  try {
    const proc = await wc.spawn('sh', [], {
      terminal: { cols: 80, rows: 24 },
      env: { HOME: '/root', PATH: '/usr/local/bin:/usr/bin:/bin', TERM: 'xterm-color' }
    })
    proc.output.pipeTo(new WritableStream({ write(data) { onData(data) } }))
    return { input: proc.input, exit: proc.exit }
  } catch(e) { return null }
}
