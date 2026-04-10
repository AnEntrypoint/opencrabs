export function makeWorkerBlob(chunks, env, scripts, imagePrefix) {
  const chunkUrls = Array.from({ length: chunks }, (_, i) =>
    imagePrefix + String(i).padStart(2, '0') + '.wasm'
  )
  const preamble = scripts.join('\n')
  const src = preamble + `
var ERRNO_INVAL = 28;
var ERRNO_AGAIN = 6;
onmessage = function(msg) {
  if (serveIfInitMsg(msg)) return;
  var ttyClient = new TtyClient(msg.data);
  recvCert().then(function(cert) {
    var certDir = getCertDir(cert);
    var fds = [undefined, undefined, undefined, certDir, undefined, undefined];
    var args = ['arg0', '--net=socket=listenfd=4', '--mac', genmac(), '-entrypoint', '/bin/sh'];
    var env = ${JSON.stringify(env)};
    var urls = ${JSON.stringify(chunkUrls)};
    Promise.all(urls.map(function(u) {
      return fetch(u).then(function(r) {
        if (!r.ok) throw new Error(u + ' ' + r.status);
        return r.arrayBuffer();
      });
    })).then(function(bufs) {
      var total = bufs.reduce(function(n, b) { return n + b.byteLength; }, 0);
      var merged = new Uint8Array(total); var off = 0;
      for (var b of bufs) { merged.set(new Uint8Array(b), off); off += b.byteLength; }
      var wasi = new WASI(args, env, fds);
      wasiHack(wasi, ttyClient, 5);
      wasiHackSocket(wasi, 4, 5);
      WebAssembly.instantiate(merged, { 'wasi_snapshot_preview1': wasi.wasiImport })
        .then(function(inst) { wasi.start(inst.instance); });
    });
  });
};
function genmac() {
  return '02:XX:XX:XX:XX:XX'.replace(/X/g, function() {
    return '0123456789ABCDEF'.charAt(Math.floor(Math.random() * 16));
  });
}
function wasiHack(wasi, ttyClient, connfd) {
  var _fd_read = wasi.wasiImport.fd_read;
  wasi.wasiImport.fd_read = function(fd, iovs_ptr, iovs_len, nread_ptr) {
    if (fd == 0) {
      var buffer = new DataView(wasi.inst.exports.memory.buffer);
      var buffer8 = new Uint8Array(wasi.inst.exports.memory.buffer);
      var iovecs = Iovec.read_bytes_array(buffer, iovs_ptr, iovs_len);
      var nread = 0;
      for (var i = 0; i < iovecs.length; i++) {
        var iovec = iovecs[i];
        if (iovec.buf_len == 0) continue;
        var data = ttyClient.onRead(iovec.buf_len);
        buffer8.set(data, iovec.buf);
        nread += data.length;
      }
      buffer.setUint32(nread_ptr, nread, true);
      return 0;
    }
    return _fd_read.apply(wasi.wasiImport, [fd, iovs_ptr, iovs_len, nread_ptr]);
  };
  var _fd_write = wasi.wasiImport.fd_write;
  wasi.wasiImport.fd_write = function(fd, iovs_ptr, iovs_len, nwritten_ptr) {
    if (fd == 1 || fd == 2) {
      var buffer = new DataView(wasi.inst.exports.memory.buffer);
      var buffer8 = new Uint8Array(wasi.inst.exports.memory.buffer);
      var iovecs = Ciovec.read_bytes_array(buffer, iovs_ptr, iovs_len);
      var wtotal = 0;
      for (var i = 0; i < iovecs.length; i++) {
        var iovec = iovecs[i];
        var buf = buffer8.slice(iovec.buf, iovec.buf + iovec.buf_len);
        if (buf.length == 0) continue;
        ttyClient.onWrite(Array.from(buf));
        wtotal += buf.length;
      }
      buffer.setUint32(nwritten_ptr, wtotal, true);
      return 0;
    }
    return _fd_write.apply(wasi.wasiImport, [fd, iovs_ptr, iovs_len, nwritten_ptr]);
  };
  wasi.wasiImport.poll_oneoff = function(in_ptr, out_ptr, nsubscriptions, nevents_ptr) {
    if (nsubscriptions == 0) return ERRNO_INVAL;
    var buffer = new DataView(wasi.inst.exports.memory.buffer);
    var in_ = Subscription.read_bytes_array(buffer, in_ptr, nsubscriptions);
    var isReadPollStdin = false, isReadPollConn = false, isClockPoll = false;
    var pollSubStdin, pollSubConn, clockSub;
    var timeout = Number.MAX_VALUE;
    for (var sub of in_) {
      if (sub.u.tag.variant == 'fd_read') {
        if (sub.u.data.fd == 0) { isReadPollStdin = true; pollSubStdin = sub; }
        else if (sub.u.data.fd == connfd) { isReadPollConn = true; pollSubConn = sub; }
        else return ERRNO_INVAL;
      } else if (sub.u.tag.variant == 'clock') {
        if (sub.u.data.timeout < timeout) { timeout = sub.u.data.timeout; isClockPoll = true; clockSub = sub; }
      } else return ERRNO_INVAL;
    }
    var events = [];
    if (isReadPollStdin || isReadPollConn || isClockPoll) {
      var readable = false;
      if (isReadPollStdin || (isClockPoll && timeout > 0)) {
        readable = ttyClient.onWaitForReadable(timeout / 1000000000);
      }
      if (readable && isReadPollStdin) {
        var ev = new Event(); ev.userdata = pollSubStdin.userdata; ev.error = 0; ev.type = new EventType('fd_read'); events.push(ev);
      }
      if (isReadPollConn) {
        var sockreadable = sockWaitForReadable();
        if (sockreadable === errStatus) return ERRNO_INVAL;
        if (sockreadable === true) {
          var ev = new Event(); ev.userdata = pollSubConn.userdata; ev.error = 0; ev.type = new EventType('fd_read'); events.push(ev);
        }
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
`
  return URL.createObjectURL(new Blob([src], { type: 'application/javascript' }))
}

export function makeStackWorkerBlob(stackSrc, sharedScripts) {
  const preamble = sharedScripts.join('\n')
  return URL.createObjectURL(new Blob([preamble + '\n' + stackSrc], { type: 'application/javascript' }))
}
