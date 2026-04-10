var ERRNO_INVAL = 28
var ERRNO_AGAIN = 6

onmessage = function(msg) {
  serveIfInitMsg(msg)
  var fds = [undefined, undefined, undefined, undefined, undefined, undefined]
  var certfd = 3
  var listenfd = 4
  var args = ['arg0', '--certfd=' + certfd, '--net-listenfd=' + listenfd]
  var env = []
  var wasi = new WASI(args, env, fds)
  wasiHack(wasi, certfd, 5)
  wasiHackSocket(wasi, listenfd, 5)
  fetch(getImagename(), { credentials: 'same-origin' }).then(function(resp) {
    resp.arrayBuffer().then(function(wasm) {
      WebAssembly.instantiate(wasm, {
        'wasi_snapshot_preview1': wasi.wasiImport,
        'env': envHack(wasi),
      }).then(function(inst) { wasi.start(inst.instance) })
    })
  })
}

function wasiHack(wasi, certfd, connfd) {
  var certbuf = new Uint8Array(0)
  var _fd_close = wasi.wasiImport.fd_close
  wasi.wasiImport.fd_close = function(fd) {
    if (fd == certfd) { sendCert(certbuf); return 0 }
    return _fd_close.apply(wasi.wasiImport, [fd])
  }
  var _fd_fdstat_get = wasi.wasiImport.fd_fdstat_get
  wasi.wasiImport.fd_fdstat_get = function(fd, fdstat_ptr) {
    if (fd == certfd) return 0
    return _fd_fdstat_get.apply(wasi.wasiImport, [fd, fdstat_ptr])
  }
  wasi.wasiImport.fd_fdstat_set_flags = function(fd, fdflags) { return 0 }
  var _fd_write = wasi.wasiImport.fd_write
  wasi.wasiImport.fd_write = function(fd, iovs_ptr, iovs_len, nwritten_ptr) {
    if (fd == 1 || fd == 2 || fd == certfd) {
      var buffer = new DataView(wasi.inst.exports.memory.buffer)
      var buffer8 = new Uint8Array(wasi.inst.exports.memory.buffer)
      var iovecs = Ciovec.read_bytes_array(buffer, iovs_ptr, iovs_len)
      var wtotal = 0
      for (var i = 0; i < iovecs.length; i++) {
        var iovec = iovecs[i]
        var buf = buffer8.slice(iovec.buf, iovec.buf + iovec.buf_len)
        if (buf.length == 0) continue
        if (fd == certfd) certbuf = appendData(certbuf, buf)
        wtotal += buf.length
      }
      buffer.setUint32(nwritten_ptr, wtotal, true)
      return 0
    }
    return _fd_write.apply(wasi.wasiImport, [fd, iovs_ptr, iovs_len, nwritten_ptr])
  }
  wasi.wasiImport.poll_oneoff = function(in_ptr, out_ptr, nsubscriptions, nevents_ptr) {
    if (nsubscriptions == 0) return ERRNO_INVAL
    var buffer = new DataView(wasi.inst.exports.memory.buffer)
    var in_ = Subscription.read_bytes_array(buffer, in_ptr, nsubscriptions)
    var isReadPollConn = false, isClockPoll = false, pollSubConn, clockSub
    var timeout = Number.MAX_VALUE
    for (var sub of in_) {
      if (sub.u.tag.variant == 'fd_read') {
        if (sub.u.data.fd == connfd) { isReadPollConn = true; pollSubConn = sub }
      } else if (sub.u.tag.variant == 'clock') {
        if (sub.u.data.timeout < timeout) { timeout = sub.u.data.timeout; isClockPoll = true; clockSub = sub }
      }
    }
    var events = []
    if (isReadPollConn || isClockPoll) {
      var sockreadable = sockWaitForReadable(timeout / 1000000000)
      if (isReadPollConn && sockreadable === true) {
        var ev = new Event(); ev.userdata = pollSubConn.userdata; ev.error = 0; ev.type = new EventType('fd_read'); events.push(ev)
      }
      if (isClockPoll) {
        var ev = new Event(); ev.userdata = clockSub.userdata; ev.error = 0; ev.type = new EventType('clock'); events.push(ev)
      }
    }
    Event.write_bytes_array(buffer, out_ptr, events)
    buffer.setUint32(nevents_ptr, events.length, true)
    return 0
  }
}

function appendData(a, b) {
  var c = new Uint8Array(a.byteLength + b.byteLength)
  c.set(a, 0); c.set(b, a.byteLength); return c
}

function envHack(wasi) {
  return {
    http_send: function(addressP, addresslen, reqP, reqlen, idP) {
      var buffer = new DataView(wasi.inst.exports.memory.buffer)
      var address = new Uint8Array(wasi.inst.exports.memory.buffer, addressP, addresslen)
      var req = new Uint8Array(wasi.inst.exports.memory.buffer, reqP, reqlen)
      streamCtrl[0] = 0; postMessage({ type: 'http_send', address, req })
      Atomics.wait(streamCtrl, 0, 0)
      if (streamStatus[0] < 0) return ERRNO_INVAL
      buffer.setUint32(idP, streamStatus[0], true); return 0
    },
    http_writebody: function(id, bodyP, bodylen, nwrittenP, isEOF) {
      var buffer = new DataView(wasi.inst.exports.memory.buffer)
      var body = new Uint8Array(wasi.inst.exports.memory.buffer, bodyP, bodylen)
      streamCtrl[0] = 0; postMessage({ type: 'http_writebody', id, body, isEOF })
      Atomics.wait(streamCtrl, 0, 0)
      if (streamStatus[0] < 0) return ERRNO_INVAL
      buffer.setUint32(nwrittenP, bodylen, true); return 0
    },
    http_isreadable: function(id, isOKP) {
      var buffer = new DataView(wasi.inst.exports.memory.buffer)
      streamCtrl[0] = 0; postMessage({ type: 'http_isreadable', id })
      Atomics.wait(streamCtrl, 0, 0)
      if (streamStatus[0] < 0) return ERRNO_INVAL
      buffer.setUint32(isOKP, streamData[0] == 1 ? 1 : 0, true); return 0
    },
    http_recv: function(id, respP, bufsize, respsizeP, isEOFP) {
      var buffer = new DataView(wasi.inst.exports.memory.buffer)
      var buffer8 = new Uint8Array(wasi.inst.exports.memory.buffer)
      streamCtrl[0] = 0; postMessage({ type: 'http_recv', id, len: bufsize })
      Atomics.wait(streamCtrl, 0, 0)
      if (streamStatus[0] < 0) return ERRNO_INVAL
      var ddlen = streamLen[0]; buffer8.set(streamData.slice(0, ddlen), respP)
      buffer.setUint32(respsizeP, ddlen, true)
      buffer.setUint32(isEOFP, streamStatus[0] == 1 ? 1 : 0, true); return 0
    },
    http_readbody: function(id, bodyP, bufsize, bodysizeP, isEOFP) {
      var buffer = new DataView(wasi.inst.exports.memory.buffer)
      var buffer8 = new Uint8Array(wasi.inst.exports.memory.buffer)
      streamCtrl[0] = 0; postMessage({ type: 'http_readbody', id, len: bufsize })
      Atomics.wait(streamCtrl, 0, 0)
      if (streamStatus[0] < 0) return ERRNO_INVAL
      var ddlen = streamLen[0]; buffer8.set(streamData.slice(0, ddlen), bodyP)
      buffer.setUint32(bodysizeP, ddlen, true)
      buffer.setUint32(isEOFP, streamStatus[0] == 1 ? 1 : 0, true); return 0
    },
  }
}
