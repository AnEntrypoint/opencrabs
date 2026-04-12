async function extractBinaryFromTgz(url, binaryName) {
  const r = await fetch(url)
  if (!r.ok) throw new Error('fetch failed: ' + url + ' ' + r.status)
  const ds = new DecompressionStream('gzip')
  const reader = r.body.pipeThrough(ds).getReader()
  let pending = new Uint8Array(0)
  function concat(a, b) { const c = new Uint8Array(a.length + b.length); c.set(a); c.set(b, a.length); return c }
  while (true) {
    const { done, value } = await reader.read()
    if (value) pending = concat(pending, value)
    let off = 0
    while (pending.length - off >= 512) {
      const hdr = pending.slice(off, off + 512)
      const name = new TextDecoder().decode(hdr.slice(0, 100)).replace(/\0/g, '').trim()
      if (!name) { off += 512; continue }
      const szOct = new TextDecoder().decode(hdr.slice(124, 136)).replace(/\0/g, '').trim()
      const sz = parseInt(szOct, 8) || 0
      const blocks = Math.ceil(sz / 512) * 512
      if (pending.length - off < 512 + blocks) break
      const baseName = name.split('/').pop()
      if (baseName === binaryName && sz > 0) return pending.slice(off + 512, off + 512 + sz)
      off += 512 + blocks
    }
    if (off > 0) pending = pending.slice(off)
    if (done) break
  }
  throw new Error('binary not found in tgz: ' + binaryName)
}

export async function installLayerBinaries(layerIds) {
  if (!layerIds || !layerIds.length) return { mounts: [], extraPaths: [] }
  const r = await fetch('./containers/layers.json')
  if (!r.ok) throw new Error('layers.json fetch failed: ' + r.status)
  const all = await r.json()
  const mounts = [], extraPaths = []
  for (const id of layerIds) {
    const layer = all.find(l => l.id === id)
    if (!layer || !layer.binaryUrl) continue
    const root = await navigator.storage.getDirectory()
    const toolsDir = await root.getDirectoryHandle('tools', {create:true})
    const layerDir = await toolsDir.getDirectoryHandle(id, {create:true})
    let exists = false
    try { await layerDir.getFileHandle(layer.binaryName); exists = true } catch(e) {}
    if (!exists) {
      const bytes = await extractBinaryFromTgz(layer.binaryUrl, layer.binaryName)
      const fh = await layerDir.getFileHandle(layer.binaryName, {create:true})
      const w = await fh.createWritable()
      await w.write(bytes)
      await w.close()
    }
    mounts.push({ vmPath: layer.binaryVmPath, opfsPath: 'tools/' + id })
    extraPaths.push(layer.binaryVmPath)
  }
  return { mounts, extraPaths }
}
