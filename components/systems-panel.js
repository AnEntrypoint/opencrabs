import { createSystem } from '../wc.js'
import { mount as mountTerm } from './term-view.js'

const uid = () => Math.random().toString(36).slice(2, 10)
const CMDS = ['sh -i', 'opencode-ai', 'claude', 'kilo', 'codex']

let _layers = []
async function fetchLayers() {
  try { const r = await fetch('./containers/layers.json'); if (r.ok) _layers = await r.json() } catch {}
}

const _termSystems = new Map()
const _termDispose = new Map()

function statusDot(s) {
  const c = s === 'ready' ? '#22c55e' : s === 'booting' ? '#f59e0b' : '#ef4444'
  return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c};flex-shrink:0"></span>`
}

function renderSidebar(el, ctx, actor) {
  const sys = ctx.systems || []
  el.innerHTML = `<style>
.sp-side{display:flex;flex-direction:column;height:100%;border-right:1px solid var(--border);background:var(--card);width:200px;flex-shrink:0}
.sp-sys{display:flex;align-items:center;gap:6px;padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border)}
.sp-sys:hover,.sp-sys.sel{background:var(--muted)}.sp-sys-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sp-badge{font-size:10px;padding:1px 5px;border-radius:3px;background:var(--muted);color:var(--muted-foreground)}
.sp-add{margin-top:auto;padding:10px 12px;border-top:1px solid var(--border)}
.sp-btn{width:100%;padding:6px;font-size:12px;background:var(--primary);color:var(--primary-foreground);border:none;border-radius:6px;cursor:pointer}
</style><div class="sp-side">
${sys.map(s => `<div class="sp-sys${s.id===ctx.selectedSystemId?' sel':''}" data-sid="${s.id}">
  ${statusDot(s.status)}<span class="sp-sys-name">${s.name}</span>
  <span class="sp-badge">${s.mode[0]}</span>
  <span style="font-size:11px;color:var(--muted-foreground)">${(s.terminals||[]).length}</span>
</div>`).join('')}
<div class="sp-add"><button class="sp-btn" id="btn-new-sys">+ New System</button></div>
</div>`
  el.querySelectorAll('[data-sid]').forEach(b => b.onclick = () => actor.send({ type: 'SELECT_SYSTEM', id: b.dataset.sid }))
  el.querySelector('#btn-new-sys').onclick = () => openNewSysDialog(el, actor)
}

function openNewSysDialog(root, actor) {
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center'
  overlay.innerHTML = `<div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:20px;min-width:320px;display:flex;flex-direction:column;gap:12px">
<div style="font-size:14px;font-weight:600">New System</div>
<input id="dlg-name" placeholder="System name" style="padding:6px 10px;background:var(--input);border:1px solid var(--border);color:var(--foreground);border-radius:6px;font-size:13px">
<div style="font-size:12px;color:var(--muted-foreground)">Mode</div>
${['ephemeral','persistent','resumable'].map(m=>`<label style="display:flex;gap:8px;font-size:13px;cursor:pointer"><input type="radio" name="dlg-mode" value="${m}"${m==='ephemeral'?' checked':''}>${m}</label>`).join('')}
${_layers.length?`<div style="font-size:12px;color:var(--muted-foreground)">Layers</div>${_layers.map(l=>`<label style="display:flex;gap:8px;font-size:13px;cursor:pointer"><input type="checkbox" name="dlg-layer" value="${l.id}">${l.label||l.id}</label>`).join('')}`:''}
<div style="display:flex;gap:8px;justify-content:flex-end">
<button id="dlg-cancel" style="padding:6px 14px;font-size:13px;background:var(--muted);color:var(--foreground);border:none;border-radius:6px;cursor:pointer">Cancel</button>
<button id="dlg-ok" style="padding:6px 14px;font-size:13px;background:var(--primary);color:var(--primary-foreground);border:none;border-radius:6px;cursor:pointer">Create</button>
</div></div>`
  document.body.appendChild(overlay)
  overlay.querySelector('#dlg-cancel').onclick = () => overlay.remove()
  overlay.querySelector('#dlg-ok').onclick = async () => {
    const name = overlay.querySelector('#dlg-name').value.trim() || 'system-' + uid()
    const mode = overlay.querySelector('[name=dlg-mode]:checked')?.value || 'ephemeral'
    const layers = [...overlay.querySelectorAll('[name=dlg-layer]:checked')].map(c => c.value)
    overlay.remove()
    const id = uid()
    actor.send({ type: 'ADD_SYSTEM', system: { id, name, mode, status: 'booting', layers, terminals: [], selectedTerminalId: null } })
    const sys = createSystem(id, { mode })
    sys.onStatus(s => actor.send({ type: 'UPDATE_SYSTEM', id, patch: { status: s } }))
    try { await sys.boot() } catch (e) { actor.send({ type: 'UPDATE_SYSTEM', id, patch: { status: 'unavailable' } }) }
  }
}

function openNewTermDialog(sysRecord, actor) {
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center'
  overlay.innerHTML = `<div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:20px;min-width:280px;display:flex;flex-direction:column;gap:12px">
<div style="font-size:14px;font-weight:600">New Terminal</div>
<input id="tl" placeholder="Label" style="padding:6px 10px;background:var(--input);border:1px solid var(--border);color:var(--foreground);border-radius:6px;font-size:13px">
<select id="tc" style="padding:6px 10px;background:var(--input);border:1px solid var(--border);color:var(--foreground);border-radius:6px;font-size:13px">${CMDS.map(c=>`<option>${c}</option>`).join('')}</select>
<div style="display:flex;gap:8px;justify-content:flex-end">
<button id="tc-cancel" style="padding:6px 14px;font-size:13px;background:var(--muted);color:var(--foreground);border:none;border-radius:6px;cursor:pointer">Cancel</button>
<button id="tc-ok" style="padding:6px 14px;font-size:13px;background:var(--primary);color:var(--primary-foreground);border:none;border-radius:6px;cursor:pointer">Open</button>
</div></div>`
  document.body.appendChild(overlay)
  overlay.querySelector('#tc-cancel').onclick = () => overlay.remove()
  overlay.querySelector('#tc-ok').onclick = () => {
    const label = overlay.querySelector('#tl').value.trim() || 'shell'
    const cmd = overlay.querySelector('#tc').value
    overlay.remove()
    const tid = uid()
    const wcId = uid()
    actor.send({ type: 'ADD_TERMINAL', systemId: sysRecord.id, terminal: { id: tid, label, cmd, wcId } })
    actor.send({ type: 'SELECT_TERMINAL', systemId: sysRecord.id, terminalId: tid })
  }
}

async function mountTerminal(el, sysRecord, tid, actor) {
  const term = sysRecord.terminals.find(t => t.id === tid)
  if (!term) return
  el.innerHTML = ''
  const termEl = document.createElement('div')
  termEl.style.cssText = 'width:100%;height:100%'
  el.appendChild(termEl)
  let wcId = term.wcId
  if (!wcId) { wcId = uid(); actor.send({ type: 'UPDATE_TERMINAL', systemId: sysRecord.id, terminalId: tid, patch: { wcId } }) }
  const sys = createSystem(wcId, { mode: sysRecord.mode })
  _termSystems.set(tid, sys)
  try {
    if (sys.status !== 'ready') await sys.boot()
    const handle = await mountTerm(termEl, sys)
    _termDispose.set(tid, handle.dispose)
  } catch (e) {
    termEl.textContent = 'Error: ' + e.message
    termEl.style.color = 'var(--destructive)'
  }
}

function renderMain(el, ctx, actor) {
  const sys = (ctx.systems || []).find(s => s.id === ctx.selectedSystemId)
  if (!sys) { el.innerHTML = '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--muted-foreground);font-size:13px">No system selected</div>'; return }
  const tabs = sys.terminals || []
  const selTid = sys.selectedTerminalId
  if (!el._spInit) {
    el._spInit = true
    el.innerHTML = `<style>
.sp-main{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden}
.sp-tabbar{display:flex;align-items:center;gap:2px;padding:0 8px;background:var(--card);border-bottom:1px solid var(--border);flex-shrink:0;height:36px}
.sp-tab{display:flex;align-items:center;gap:4px;padding:4px 10px;font-size:12px;font-weight:500;background:none;border:none;border-bottom:2px solid transparent;color:var(--muted-foreground);cursor:pointer}
.sp-tab:hover{color:var(--foreground)}.sp-tab.active{color:var(--primary);border-bottom-color:var(--primary)}
.sp-tab-x{font-size:14px;line-height:1;color:var(--muted-foreground);border:none;background:none;cursor:pointer;padding:0 2px}
.sp-tab-x:hover{color:var(--destructive)}.sp-tab-add{margin-left:4px}
.sp-term-wrap{flex:1;min-height:0;position:relative}
</style><div class="sp-main"><div class="sp-tabbar" id="sp-tabbar"></div><div class="sp-term-wrap" id="sp-termwrap"></div></div>`
  }
  const tabbar = el.querySelector('#sp-tabbar')
  const termwrap = el.querySelector('#sp-termwrap')
  if (!tabbar || !termwrap) return
  tabbar.innerHTML = tabs.map(t => `<button class="sp-tab${t.id===selTid?' active':''}" data-tid="${t.id}">
    ${t.label}<button class="sp-tab-x" data-close="${t.id}">×</button></button>`).join('') +
    `<button class="sp-tab sp-tab-add" id="btn-new-term"${sys.status!=='ready'?' disabled':''}>+ Terminal</button>`
  tabbar.querySelectorAll('[data-tid]').forEach(b => {
    b.onclick = (e) => { if (!e.target.dataset.close) actor.send({ type: 'SELECT_TERMINAL', systemId: sys.id, terminalId: b.dataset.tid }) }
  })
  tabbar.querySelectorAll('[data-close]').forEach(b => b.onclick = (e) => {
    e.stopPropagation()
    const tid = b.dataset.close
    const disp = _termDispose.get(tid)
    if (disp) { disp(); _termDispose.delete(tid) }
    const wcSys = _termSystems.get(tid)
    if (wcSys && sys.mode === 'ephemeral') {
      const remaining = tabs.filter(t => t.id !== tid)
      if (remaining.length === 0) wcSys.destroy()
    }
    _termSystems.delete(tid)
    actor.send({ type: 'REMOVE_TERMINAL', systemId: sys.id, terminalId: tid })
  })
  const addBtn = tabbar.querySelector('#btn-new-term')
  if (addBtn) addBtn.onclick = () => openNewTermDialog(sys, actor)
  if (!selTid) { termwrap.innerHTML = '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--muted-foreground);font-size:13px">Open a terminal to begin</div>'; return }
  if (termwrap._tid !== selTid) {
    termwrap._tid = selTid
    mountTerminal(termwrap, sys, selTid, actor)
  }
}

export function mount(el, actor) {
  el.style.cssText = 'display:flex;height:100%;width:100%;overflow:hidden'
  const side = document.createElement('div')
  const main = document.createElement('div')
  main.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden'
  el.appendChild(side)
  el.appendChild(main)
  fetchLayers()
  actor.subscribe(() => {
    const ctx = actor.getSnapshot().context
    renderSidebar(side, ctx, actor)
    renderMain(main, ctx, actor)
  })
  const ctx = actor.getSnapshot().context
  renderSidebar(side, ctx, actor)
  renderMain(main, ctx, actor)
  window.__debug = window.__debug || {}
  window.__debug.systems = { termSystems: _termSystems, termDispose: _termDispose }
}
