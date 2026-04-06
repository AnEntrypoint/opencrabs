// container2wasm WASI mode — replaces CheerpX
// WASM image: amd64 Debian (sid-slim + curl) from container2wasm-demo CDN
// Requires crossOriginIsolated (COOP/COEP headers) for SharedArrayBuffer

const DEMO_BASE = 'https://ktock.github.io/container2wasm-demo'
const IMAGE_PREFIX = DEMO_BASE + '/containers/amd64-debian-wasi-container'
const IMAGE_CHUNKS = 5
const XTERM_PTY_CDN = 'https://cdn.jsdelivr.net/npm/xterm-pty@0.9.4'

const SHELL_ENV = [
  'HOME=/root', 'TERM=xterm-256color', 'USER=root', 'SHELL=/bin/bash',
  'LANG=en_US.UTF-8', 'LC_ALL=C',
  'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  'https_proxy=http://192.168.127.253:80',
  'http_proxy=http://192.168.127.253:80',
  'HTTPS_PROXY=http://192.168.127.253:80',
  'HTTP_PROXY=http://192.168.127.253:80',
  'SSL_CERT_FILE=/.wasmenv/proxy.crt',
]

let _status = 'unavailable'
let _slave = null        // xterm-pty slave (PTY side)
let _worker = null
let _stackWorker = null
let _nwStack = null
const cbs = new Set()

function setStatus(s) { _status = s; cbs.forEach(fn => fn(s)) }

export function wcStatus() { return _status }
export function onWcStatus(fn) { cbs.add(fn); fn(_status); return () => cbs.delete(fn) }
export function wcReady() { return _status === 'ready' }

// Build the inline worker script as a blob URL so we avoid same-origin issues
// with importScripts on a CDN-hosted worker.js
function makeWorkerBlob() {
  const src = `
importScripts(${JSON.stringify(XTERM_PTY_CDN + '/workerTools.js')});
importScripts(${JSON.stringify(DEMO_BASE + '/src/browser_wasi_shim/index.js')});
importScripts(${JSON.stringify(DEMO_BASE + '/src/browser_wasi_shim/wasi_defs.js')});
importScripts(${JSON.stringify(DEMO_BASE + '/src/worker-util.js')});
importScripts(${JSON.stringify(DEMO_BASE + '/src/wasi-util.js')});

onmessage = (msg) => {
  if (serveIfInitMsg(msg)) return;
  var ttyClient = new TtyClient(msg.data);
  var args = [], env = [], fds = [];
  var listenfd = 3;
  recvCert().then((cert) => {
    var certDir = getCertDir(cert);
    fds = [undefined, undefined, undefined, certDir, undefined, undefined];
    args = ['arg0', '--net=socket=listenfd=4', '--mac', genmac()];
    env = ${JSON.stringify(SHELL_ENV)};
    listenfd = 4;
    startWasi(ttyClient, args, env, fds, listenfd, 5);
  });
};

function startWasi(ttyClient, args, env, fds, listenfd, connfd) {
  fetchChunks((wasm) => {
    var wasi = new WASI(args, env, fds);
    wasiHack(wasi, ttyClient, connfd);
    wasiHackSocket(wasi, listenfd, connfd);
    WebAssembly.instantiate(wasm, { 'wasi_snapshot_preview1': wasi.wasiImport })
      .then((inst) => wasi.start(inst.instance));
  });
}

function genmac() {
  return '02:XX:XX:XX:XX:XX'.replace(/X/g, () =>
    '0123456789ABCDEF'.charAt(Math.floor(Math.random() * 16)));
}
`
  return URL.createObjectURL(new Blob([src], { type: 'application/javascript' }))
}

function makeStackWorkerBlob() {
  const src = `
importScripts(${JSON.stringify(DEMO_BASE + '/src/browser_wasi_shim/index.js')});
importScripts(${JSON.stringify(DEMO_BASE + '/src/browser_wasi_shim/wasi_defs.js')});
importScripts(${JSON.stringify(DEMO_BASE + '/src/worker-util.js')});
importScripts(${JSON.stringify(DEMO_BASE + '/src/wasi-util.js')});

const ERRNO_INVAL = 28;
const ERRNO_AGAIN = 6;

onmessage = (msg) => {
  serveIfInitMsg(msg);
  var fds = [undefined, undefined, undefined, undefined, undefined, undefined];
  var certfd = 3;
  var listenfd = 4;
  var args = ['arg0', '--certfd=' + certfd, '--net-listenfd=' + listenfd];
  var env = [];
  var wasi = new WASI(args, env, fds);
  wasiHackProxy(wasi, certfd, 5);
  wasiHackSocket(wasi, listenfd, 5);
  fetch(getImagename(), { credentials: 'same-origin' }).then((resp) => {
    resp.arrayBuffer().then((wasm) => {
      WebAssembly.instantiate(wasm, {
        'wasi_snapshot_preview1': wasi.wasiImport,
        'env': envHack(wasi),
      }).then((inst) => wasi.start(inst.instance));
    });
  });
};

function wasiHackProxy(wasi, certfd, connfd) {
  var certbuf = new Uint8Array(0);
  var _fd_close = wasi.wasiImport.fd_close;
  wasi.wasiImport.fd_close = (fd) => {
    if (fd == certfd) { sendCert(certbuf); return 0; }
    return _fd_close.apply(wasi.wasiImport, [fd]);
  };
  var _fd_fdstat_get = wasi.wasiImport.fd_fdstat_get;
  wasi.wasiImport.fd_fdstat_get = (fd, fdstat_ptr) => {
    if (fd == certfd) return 0;
    return _fd_fdstat_get.apply(wasi.wasiImport, [fd, fdstat_ptr]);
  };
  wasi.wasiImport.fd_fdstat_set_flags = (fd, fdflags) => 0;
  var _fd_write = wasi.wasiImport.fd_write;
  wasi.wasiImport.fd_write = (fd, iovs_ptr, iovs_len, nwritten_ptr) => {
    if (fd == 1 || fd == 2 || fd == certfd) {
      var buffer = new DataView(wasi.inst.exports.memory.buffer);
      var buffer8 = new Uint8Array(wasi.inst.exports.memory.buffer);
      var iovecs = Ciovec.read_bytes_array(buffer, iovs_ptr, iovs_len);
      var wtotal = 0;
      for (var i = 0; i < iovecs.length; i++) {
        var iovec = iovecs[i];
        var buf = buffer8.slice(iovec.buf, iovec.buf + iovec.buf_len);
        if (buf.length == 0) continue;
        if (fd == certfd) certbuf = appendData(certbuf, buf);
        wtotal += buf.length;
      }
      buffer.setUint32(nwritten_ptr, wtotal, true);
      return 0;
    }
    return _fd_write.apply(wasi.wasiImport, [fd, iovs_ptr, iovs_len, nwritten_ptr]);
  };
  wasi.wasiImport.poll_oneoff = (in_ptr, out_ptr, nsubscriptions, nevents_ptr) => {
    if (nsubscriptions == 0) return ERRNO_INVAL;
    var buffer = new DataView(wasi.inst.exports.memory.buffer);
    var in_ = Subscription.read_bytes_array(buffer, in_ptr, nsubscriptions);
    var isReadPollConn = false, isClockPoll = false, pollSubConn, clockSub;
    var timeout = Number.MAX_VALUE;
    for (var sub of in_) {
      if (sub.u.tag.variant == 'fd_read') {
        if (sub.u.data.fd == connfd) { isReadPollConn = true; pollSubConn = sub; }
      } else if (sub.u.tag.variant == 'clock') {
        if (sub.u.data.timeout < timeout) { timeout = sub.u.data.timeout; isClockPoll = true; clockSub = sub; }
      }
    }
    var events = [];
    if (isReadPollConn || isClockPoll) {
      var sockreadable = sockWaitForReadable(timeout / 1000000000);
      if (isReadPollConn && sockreadable === true) {
        var ev = new Event(); ev.userdata = pollSubConn.userdata; ev.error = 0; ev.type = new EventType('fd_read'); events.push(ev);
      }
      if (isClockPoll) {
        var ev = new Event(); ev.userdata = clockSub.userdata; ev.error = 0; ev.type = new EventType('clock'); events.push(ev);
      }
    }
    Event.write_bytes_array(buffer, out_ptr, events);
    buffer.setUint32(nevents_ptr, events.length, true);
    return 0;
  };
}

function appendData(a, b) {
  var c = new Uint8Array(a.byteLength + b.byteLength);
  c.set(a, 0); c.set(b, a.byteLength); return c;
}

function envHack(wasi) {
  return {
    http_send: (addressP, addresslen, reqP, reqlen, idP) => {
      var buffer = new DataView(wasi.inst.exports.memory.buffer);
      var address = new Uint8Array(wasi.inst.exports.memory.buffer, addressP, addresslen);
      var req = new Uint8Array(wasi.inst.exports.memory.buffer, reqP, reqlen);
      streamCtrl[0] = 0; postMessage({ type: 'http_send', address, req });
      Atomics.wait(streamCtrl, 0, 0);
      if (streamStatus[0] < 0) return ERRNO_INVAL;
      buffer.setUint32(idP, streamStatus[0], true); return 0;
    },
    http_writebody: (id, bodyP, bodylen, nwrittenP, isEOF) => {
      var buffer = new DataView(wasi.inst.exports.memory.buffer);
      var body = new Uint8Array(wasi.inst.exports.memory.buffer, bodyP, bodylen);
      streamCtrl[0] = 0; postMessage({ type: 'http_writebody', id, body, isEOF });
      Atomics.wait(streamCtrl, 0, 0);
      if (streamStatus[0] < 0) return ERRNO_INVAL;
      buffer.setUint32(nwrittenP, bodylen, true); return 0;
    },
    http_isreadable: (id, isOKP) => {
      var buffer = new DataView(wasi.inst.exports.memory.buffer);
      streamCtrl[0] = 0; postMessage({ type: 'http_isreadable', id });
      Atomics.wait(streamCtrl, 0, 0);
      if (streamStatus[0] < 0) return ERRNO_INVAL;
      buffer.setUint32(isOKP, streamData[0] == 1 ? 1 : 0, true); return 0;
    },
    http_recv: (id, respP, bufsize, respsizeP, isEOFP) => {
      var buffer = new DataView(wasi.inst.exports.memory.buffer);
      var buffer8 = new Uint8Array(wasi.inst.exports.memory.buffer);
      streamCtrl[0] = 0; postMessage({ type: 'http_recv', id, len: bufsize });
      Atomics.wait(streamCtrl, 0, 0);
      if (streamStatus[0] < 0) return ERRNO_INVAL;
      var ddlen = streamLen[0]; buffer8.set(streamData.slice(0, ddlen), respP);
      buffer.setUint32(respsizeP, ddlen, true);
      buffer.setUint32(isEOFP, streamStatus[0] == 1 ? 1 : 0, true); return 0;
    },
    http_readbody: (id, bodyP, bufsize, bodysizeP, isEOFP) => {
      var buffer = new DataView(wasi.inst.exports.memory.buffer);
      var buffer8 = new Uint8Array(wasi.inst.exports.memory.buffer);
      streamCtrl[0] = 0; postMessage({ type: 'http_readbody', id, len: bufsize });
      Atomics.wait(streamCtrl, 0, 0);
      if (streamStatus[0] < 0) return ERRNO_INVAL;
      var ddlen = streamLen[0]; buffer8.set(streamData.slice(0, ddlen), bodyP);
      buffer.setUint32(bodysizeP, ddlen, true);
      buffer.setUint32(isEOFP, streamStatus[0] == 1 ? 1 : 0, true); return 0;
    },
  };
}
`
  return URL.createObjectURL(new Blob([src], { type: 'application/javascript' }))
}

export async function boot() {
  if (!globalThis.crossOriginIsolated) { setStatus('unavailable'); return }
  if (_worker) return
  setStatus('booting')

  try {
    // Dynamically load xterm-pty in the main thread for TtyServer/openpty
    await loadScript(XTERM_PTY_CDN + '/index.js')

    // Load stack.js from the demo for newStack()
    await loadScript(DEMO_BASE + '/src/stack.js')

    const workerUrl = makeWorkerBlob()
    _worker = new Worker(workerUrl)

    const stackWorkerUrl = makeStackWorkerBlob()
    _stackWorker = new Worker(stackWorkerUrl)

    // newStack wires up the networking proxy worker
    const c2wNetProxy = DEMO_BASE + '/src/c2w-net-proxy.wasm'
    _nwStack = newStack(_worker, IMAGE_PREFIX, IMAGE_CHUNKS, _stackWorker, c2wNetProxy)

    setStatus('ready')
  } catch(e) {
    console.error('container2wasm boot failed:', e)
    setStatus('unavailable')
  }
}

async function loadScript(url) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${url}"]`)) { resolve(); return }
    const s = document.createElement('script')
    s.src = url; s.onload = resolve; s.onerror = reject
    document.head.appendChild(s)
  })
}

export async function spawnShell(onData) {
  if (!_worker || _status !== 'ready') return null

  // openpty and TtyServer come from xterm-pty loaded in boot()
  const { master, slave } = openpty()
  _slave = slave

  // Connect PTY to the worker
  new TtyServer(slave).start(_worker, _nwStack)

  // master is an xterm.js addon — we expose it so shell-panel can attach it
  // onData will be called with xterm Terminal instance to loadAddon(master)
  onData({ xtermAddon: master })

  return {
    input: new WritableStream({
      write(data) {
        // input goes through xterm terminal.onData, not here
      }
    }),
    exit: new Promise(() => {}),
    resize: (cols, rows) => {
      if (slave.ioctl) {
        try { slave.ioctl('TIOCSWINSZ', { rows, cols, xpixel: 0, ypixel: 0 }) } catch {}
      }
    },
    master, // expose for xterm loadAddon
  }
}

export async function runCli(agent, prompt, onLine) {
  onLine({ type: 'info', text: 'Use the Terminal tab to interact with the container.' })
}

export async function wcExec() { return null }
export async function wcFsRead() { return null }
export async function wcFsWrite() { return null }
export async function wcFsList() { return null }
export async function wcGit() { return null }
