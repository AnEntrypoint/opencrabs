let _scriptsLoaded = false
async function loadScripts() {
  if (_scriptsLoaded) return
  _scriptsLoaded = true
  for (const src of ['./vendor/xterm.js', './vendor/addon-fit.js', './vendor/addon-canvas.js']) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = src
      s.onload = resolve
      s.onerror = reject
      document.head.appendChild(s)
    })
  }
}

export async function mount(el, sys) {
  await loadScripts()
  const cs = getComputedStyle(document.documentElement)
  const bg = cs.getPropertyValue('--background').trim() || '#0d0f14'
  const fg = cs.getPropertyValue('--foreground').trim() || '#e8e8e8'
  const term = new window.Terminal({ cursorBlink: true, fontSize: 13, fontFamily: 'monospace', theme: { background: bg, foreground: fg } })
  const fit = new window.FitAddon()
  term.loadAddon(fit)
  term.open(el)
  term.loadAddon(new window.CanvasAddon())
  const ro = new ResizeObserver(() => fit.fit())
  ro.observe(el)
  requestAnimationFrame(() => fit.fit())
  let disposed = false
  if (sys.status !== 'ready') {
    term.writeln('\x1b[33mWaiting for system to boot...\x1b[0m')
    await new Promise((resolve, reject) => {
      const unsub = sys.onStatus(s => {
        if (s === 'ready') { unsub(); resolve() }
        else if (s === 'unavailable') { unsub(); reject(new Error('system unavailable — check console for details')) }
      })
    })
  }
  if (disposed) return { dispose: () => {} }
  const shell = await sys.spawnShell(payload => {
    if (payload?.xtermAddon) term.loadAddon(payload.xtermAddon)
  })
  if (!shell) throw new Error('spawnShell returned null')
  return {
    dispose() {
      disposed = true
      ro.disconnect()
      term.dispose()
    }
  }
}
