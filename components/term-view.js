const XTERM = 'https://esm.sh/@xterm/xterm@5.5.0'
const XTERM_FIT = 'https://esm.sh/@xterm/addon-fit@0.10.0'
const XTERM_CANVAS = 'https://esm.sh/@xterm/addon-canvas@0.7.0'
const XTERM_CSS = 'https://esm.sh/@xterm/xterm@5.5.0/css/xterm.css'

let _cssLoaded = false
async function loadCss() {
  if (_cssLoaded) return
  _cssLoaded = true
  await new Promise(resolve => {
    const l = document.createElement('link')
    l.rel = 'stylesheet'; l.href = XTERM_CSS
    l.onload = resolve; l.onerror = resolve
    document.head.appendChild(l)
  })
}

export async function mount(el, sys) {
  await loadCss()
  const [{ Terminal }, { FitAddon }, { CanvasAddon }] = await Promise.all([
    import(XTERM), import(XTERM_FIT), import(XTERM_CANVAS)
  ])
  const cs = getComputedStyle(document.documentElement)
  const bg = cs.getPropertyValue('--background').trim() || '#0d0f14'
  const fg = cs.getPropertyValue('--foreground').trim() || '#e8e8e8'
  const term = new Terminal({ cursorBlink: true, fontSize: 13, fontFamily: 'monospace', theme: { background: bg, foreground: fg } })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(el)
  term.loadAddon(new CanvasAddon())
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
