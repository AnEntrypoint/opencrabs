#!/usr/bin/env node
import { createServer } from 'node:http'
import https from 'node:https'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname } from 'node:path'
import { createServer as netServer } from 'node:net'
import { spawn } from 'node:child_process'
import os from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const PORT = parseInt(process.env.PORT ?? '7071')

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }

function findFreePort(start) {
  return new Promise((resolve, reject) => {
    const s = netServer()
    s.listen(start, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) })
    s.on('error', () => findFreePort(start + 1).then(resolve, reject))
  })
}

function openUrl(url) {
  const p = os.platform()
  const [cmd, args] = p === 'win32' ? ['cmd', ['/c','start','',url]] : p === 'darwin' ? ['open',[url]] : ['xdg-open',[url]]
  spawn(cmd, args, { detached: true, stdio: 'ignore', shell: false }).unref()
}

const NODE_PROXY_URL = 'https://nodejs.org/dist/v24.0.0/node-v24.0.0-linux-x64.tar.gz'

const port = await findFreePort(PORT)
const server = createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }); res.end(); return }
  if (req.url === '/node-proxy') {
    https.get(NODE_PROXY_URL, (r) => {
      res.writeHead(r.statusCode, { 'Content-Type': 'application/gzip', 'Access-Control-Allow-Origin': '*', 'Content-Length': r.headers['content-length'] || '' })
      r.pipe(res)
    }).on('error', (e) => { res.writeHead(502); res.end(JSON.stringify({ error: e.message })) })
    return
  }
  const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0]
  const filePath = join(ROOT, urlPath)
  const mime = MIME[extname(filePath)] || 'text/plain'
  try {
    const data = readFileSync(filePath)
    res.writeHead(200, { 'Content-Type': mime, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' })
    res.end(data)
  } catch { res.writeHead(404); res.end('not found') }
})

server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}`
  console.log('[opencrabs] serving at', url)
  setTimeout(() => openUrl(url), 800)
})
