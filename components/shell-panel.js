import { runCli as wcRunCli, wcStatus, onWcStatus, spawnShell } from '../wc.js'
import { renderBrowserPanel } from '../browser.js'

const SW_PATH = './bridge-sw.js'
const RPC_URL = 'ws://127.0.0.1:9377'
const GEMINI_MODEL = 'gemini-2.0-flash'
const ANTHROPIC_MODEL = 'claude-opus-4-6'
const stor = { get: k => localStorage.getItem(k)||'', set: (k,v) => localStorage.setItem(k,v) }

function stripAnsi(s) { return s.replace(/\x1B\[[0-9;]*[mGKHF]/g,'').replace(/\x1B\][^\x07]*\x07/g,'') }

function loadKeys() { return { anthropicApiKey: stor.get('anthropicKey'), openaiApiKey: stor.get('openaiKey'), openrouterApiKey: stor.get('openrouterKey'), geminiApiKey: stor.get('geminiKey') } }

async function registerSW() {
  if (!navigator.serviceWorker) return
  try { await navigator.serviceWorker.register(SW_PATH, { scope: './' }); navigator.serviceWorker.controller?.postMessage({ type: 'BRIDGE_CONFIG', config: loadKeys() }) } catch {}
}

let _companion = null
function getCompanion() {
  if (_companion) return _companion
  let ws=null,id=0,pending=new Map(),subs=new Map(),status='disconnected'
  const onStatus=new Set()
  function setStatus(s){status=s;onStatus.forEach(fn=>fn(s))}
  function connect(){if(ws)return;ws=new WebSocket(RPC_URL);setStatus('connecting');ws.onopen=()=>setStatus('connected');ws.onmessage=e=>{try{const msg=JSON.parse(e.data);if(msg.stream&&subs.has(msg.sessionId)){subs.get(msg.sessionId)(msg.event);return}if(msg.id!=null&&pending.has(msg.id)){const{resolve,reject}=pending.get(msg.id);pending.delete(msg.id);msg.error?reject(new Error(msg.error)):resolve(msg.result)}}catch{}};ws.onclose=()=>{ws=null;setStatus('disconnected')};ws.onerror=()=>{}}
  function call(method,params){return new Promise((resolve,reject)=>{if(status!=='connected')return reject(new Error('companion offline'));const rid=++id;pending.set(rid,{resolve,reject});ws.send(JSON.stringify({id:rid,method,params}));setTimeout(()=>{if(pending.has(rid)){pending.delete(rid);reject(new Error('timeout'))}},30000)})}
  _companion={connect,call,subscribe:(sid,fn)=>subs.set(sid,fn),unsubscribe:sid=>subs.delete(sid),onStatus:fn=>{onStatus.add(fn);fn(status);return()=>onStatus.delete(fn)},get status(){return status}}
  return _companion
}

export function mount(el, actor) {
  el.innerHTML = `
<style>
.sh-wrap{display:flex;flex-direction:column;height:100%;width:100%}
.sh-tabs{display:flex;gap:2px;padding:0 16px;background:var(--card);border-bottom:1px solid var(--border);flex-shrink:0}
.sh-tab{padding:8px 14px;font-size:12px;font-weight:500;background:none;border:none;border-bottom:2px solid transparent;color:var(--muted-foreground);cursor:pointer}
.sh-tab:hover{color:var(--foreground)}.sh-tab.active{color:var(--primary);border-bottom-color:var(--primary)}
.sh-panel{display:none;flex:1;min-height:0;overflow:hidden;flex-direction:column}.sh-panel.active{display:flex}
#sh-output{flex:1;overflow-y:auto;padding:12px 16px;font-family:var(--font-mono);font-size:13px;line-height:1.6}
#sh-terminal{flex:1;min-height:0;width:100%;background:#0d0f14;position:relative}
#sh-terminal .xterm{height:100%;display:flex;flex-direction:column}
#sh-terminal .xterm-viewport{overflow-y:scroll!important;background:transparent!important}
#sh-terminal .xterm-screen{flex:1}
.sh-line{white-space:pre-wrap;word-break:break-word;padding:1px 0}
.sh-line-user{color:var(--primary)}.sh-line-assistant{color:var(--foreground)}.sh-line-err{color:var(--destructive)}
.sh-line-info{color:var(--muted-foreground)}.sh-line-tool{color:oklch(0.7 0.15 80)}.sh-line-raw{color:var(--muted-foreground);font-size:11px}
.sh-input-bar{display:flex;gap:8px;padding:10px 16px;background:var(--card);border-top:1px solid var(--border);flex-shrink:0}
.sh-input-bar select,.sh-input-bar input{background:var(--input);border:1px solid var(--border);color:var(--foreground);border-radius:6px;padding:6px 10px;font-size:13px}
#sh-prompt{flex:1}.sh-input-bar button{background:var(--primary);border:none;color:var(--primary-foreground);border-radius:6px;padding:6px 14px;font-size:13px;cursor:pointer}
.sh-ghost{background:var(--muted)!important;color:var(--muted-foreground)!important}
.sh-browser-bar{display:flex;gap:8px;padding:8px 16px;background:var(--card);border-bottom:1px solid var(--border);flex-shrink:0}
.sh-browser-bar input{flex:1;background:var(--input);border:1px solid var(--border);color:var(--foreground);border-radius:6px;padding:6px 10px;font-size:13px}
#sh-frame{flex:1;min-height:0;border:none;width:100%;background:#fff}
</style>
<div class="sh-wrap">
  <div class="sh-tabs">
    <button class="sh-tab active" data-tab="sh-shell">Shell</button>
    <button class="sh-tab" data-tab="sh-term">Terminal</button>
    <button class="sh-tab" data-tab="sh-browser">Browser</button>
  </div>
  <div id="sh-shell" class="sh-panel active" style="flex-direction:column">
    <div id="sh-output"></div>
    <div class="sh-input-bar">
      <select id="sh-agent">
        <optgroup label="API (in-browser)">
          <option value="gemini">Gemini 2.0 Flash</option>
          <option value="anthropic">Claude (Anthropic)</option>
        </optgroup>
        <optgroup label="Linux VM (in-browser)">
          <option value="claude">claude CLI</option>
          <option value="kilo">Kilo Code</option>
        </optgroup>
      </select>
      <input id="sh-prompt" type="text" placeholder="Enter prompt…" autocomplete="off">
      <button id="sh-send">Send</button>
      <button id="sh-clear" class="sh-ghost">Clear</button>
    </div>
  </div>
  <div id="sh-term" class="sh-panel"><div id="sh-terminal"></div></div>
  <div id="sh-browser" class="sh-panel">
    <div class="sh-browser-bar">
      <input id="sh-url" type="text" placeholder="https://…">
      <button id="sh-go">Go</button>
      <button id="sh-snap" class="sh-ghost">Snapshot</button>
    </div>
    <iframe id="sh-frame" sandbox="allow-scripts allow-forms allow-popups allow-modals"></iframe>
  </div>
</div>`

  const $ = id => el.querySelector('#'+id)
  const appendLine = (text, kind='raw') => { const o=$('sh-output'); if(!o)return; const d=document.createElement('div'); d.className='sh-line sh-line-'+(kind||'raw'); d.textContent=stripAnsi(text); o.appendChild(d); o.scrollTop=o.scrollHeight }
  const clearOutput = () => { $('sh-output').innerHTML='' }

  let _term = null
  let _termQueue = []
  const appendTerm = (text) => { if (_term) _term.write(text); else _termQueue.push(text) }

  let _xtermInited = false
  async function initXterm() {
    if (_xtermInited) return
    _xtermInited = true
    const termEl = $('sh-terminal')
    const [{ Terminal }, { FitAddon }, { CanvasAddon }] = await Promise.all([
      import('https://esm.sh/@xterm/xterm@5.5.0'),
      import('https://esm.sh/@xterm/addon-fit@0.10.0'),
      import('https://esm.sh/@xterm/addon-canvas@0.7.0'),
    ])
    await new Promise(resolve => {
      const link = document.createElement('link')
      link.rel = 'stylesheet'; link.href = 'https://esm.sh/@xterm/xterm@5.5.0/css/xterm.css'
      link.onload = resolve; link.onerror = resolve
      document.head.appendChild(link)
    })
    const cs = getComputedStyle(document.documentElement)
    const bg = cs.getPropertyValue('--background').trim() || '#0d0f14'
    const fg = cs.getPropertyValue('--foreground').trim() || '#e8e8e8'
    const term = new Terminal({ cursorBlink: true, fontSize: 13, fontFamily: 'monospace', theme: { background: bg, foreground: fg } })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(termEl)
    term.loadAddon(new CanvasAddon())
    let shell = null
    requestAnimationFrame(() => { fit.fit(); _term = term; _termQueue.forEach(t => term.write(t)); _termQueue = [] })
    new ResizeObserver(() => { fit.fit(); if (shell) shell.resize(term.cols, term.rows) }).observe(termEl)
    if (wcStatus() !== 'ready') {
      term.writeln('\x1b[33mWaiting for Linux VM (container2wasm)...\x1b[0m')
      const ok = await new Promise(resolve => { let unsub; unsub = onWcStatus(s => { if (s === 'ready') { unsub?.(); resolve(true) } else if (s === 'unavailable') { unsub?.(); resolve(false) } }) })
      if (!ok) { term.writeln('\x1b[31mLinux VM unavailable (requires cross-origin isolation)\x1b[0m'); return }
    }
    shell = await spawnShell(payload => {
      if (payload?.xtermAddon) {
        term.loadAddon(payload.xtermAddon)
      }
    })
    if (!shell) { term.writeln('\x1b[31mFailed to spawn shell\x1b[0m'); return }
    actor?.send({ type: 'SET_TERMINAL_READY', ready: true })
  }

  function switchTab(tabId) {
    el.querySelectorAll('.sh-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId))
    el.querySelectorAll('.sh-panel').forEach(p => p.classList.toggle('active', p.id === tabId))
    if (tabId === 'sh-term') initXterm()
    actor?.send({ type: 'SET_SHELL_TAB', tab: tabId.replace('sh-', '') })
  }

  el.querySelectorAll('.sh-tab').forEach(btn => { btn.onclick = () => switchTab(btn.dataset.tab) })
  const initialTab = 'sh-' + (actor?.getSnapshot().context.shellTab || 'shell')
  switchTab(initialTab)

  registerSW()
  const companion = getCompanion()
  companion.onStatus(s => { const dot = document.getElementById('sh-companion-dot'); if(dot){dot.textContent=s;dot.className='ui-chip ui-badge-status-'+(s==='connected'?'connected':'disconnected')} })
  const extDot=document.getElementById('sh-ext-dot'); if(extDot&&typeof chrome!=='undefined'&&chrome.runtime?.id){extDot.textContent='ext ok';extDot.className='ui-chip ui-badge-status-running'}
  renderBrowserPanel($('sh-url'),$('sh-go'),$('sh-snap'),$('sh-frame'))

  async function runGemini(prompt) {
    const key=stor.get('geminiKey'); if(!key){appendLine('Gemini API key required','err');return}
    appendLine('you: '+prompt,'user')
    const { GoogleGenAI } = await import('https://esm.sh/@google/genai@1.46.0').catch(()=>{appendLine('Failed to load Gemini SDK','err');return {}})
    if(!GoogleGenAI){return}
    const ai=new GoogleGenAI({apiKey:key}); const stream=await ai.models.generateContentStream({model:GEMINI_MODEL,contents:prompt})
    let buf=''; const div=document.createElement('div'); div.className='sh-line sh-line-assistant'; $('sh-output').appendChild(div)
    for await(const chunk of stream){buf+=chunk.text||'';div.textContent=buf;$('sh-output').scrollTop=$('sh-output').scrollHeight}
  }

  async function runAnthropic(prompt) {
    appendLine('you: '+prompt,'user')
    const key=stor.get('anthropicKey')
    const body={model:ANTHROPIC_MODEL,max_tokens:4096,stream:true,messages:[{role:'user',content:prompt}]}
    const headers={'Content-Type':'application/json'}; if(key)headers['x-api-key']=key
    const resp=await fetch('/v1/messages',{method:'POST',headers,body:JSON.stringify(body)})
    if(!resp.ok){appendLine('Anthropic error: '+resp.status,'err');return}
    const div=document.createElement('div');div.className='sh-line sh-line-assistant';$('sh-output').appendChild(div)
    const reader=resp.body.getReader();const dec=new TextDecoder();let buf='',text=''
    while(true){const{done,value}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});const lines=buf.split('\n');buf=lines.pop();for(const line of lines){if(!line.startsWith('data: '))continue;try{const evt=JSON.parse(line.slice(6));if(evt.delta?.type==='text_delta'){text+=evt.delta.text;div.textContent=text;$('sh-output').scrollTop=$('sh-output').scrollHeight}}catch{}}}
  }

  async function runCli(agent, prompt) {
    appendLine('you: '+prompt,'user')
    companion.connect()
    if(wcStatus()==='ready'){appendLine('[running '+agent+' — see Terminal tab]','info');appendTerm('--- '+agent+' ---');await wcRunCli(agent,prompt,evt=>{appendTerm(evt.text);const t=evt.text.replace(/[\r\n]/g,'').trim();if(t&&!/^[\\|/\-]+$/.test(t))appendLine(evt.text,'assistant')});return}
    if(companion.status!=='connected'){appendLine('Linux VM unavailable and companion offline — run: node bin/serve.js','err');return}
    appendLine('[spawning '+agent+' via companion…]','info')
    const info=await companion.call('acp.sessions.new',{agent})
    companion.subscribe(info.id,evt=>{if(evt.type==='stderr')appendLine(evt.text,'err');else if(evt.type==='session_closed'){appendLine('['+agent+' exited '+evt.code+']','info');companion.unsubscribe(info.id)}else if(evt.type==='acp_event'){const d=evt.data;if(d?.method==='session/update'&&d.params?.message?.content)d.params.message.content.filter(b=>b.type==='text').forEach(b=>appendLine(b.text,'assistant'));else if(d?.method==='tools/call')appendLine('[tool: '+(d.params?.name||'?')+']','tool')}})
    try{await companion.call('acp.prompt',{sessionId:info.id,text:prompt})}catch(e){appendLine(e.message,'err')}
  }

  async function handleSubmit() {
    const input=$('sh-prompt'); const prompt=input.value.trim(); if(!prompt)return
    input.value=''; clearOutput()
    try { const agent=$('sh-agent').value; if(agent==='gemini')await runGemini(prompt);else if(agent==='anthropic')await runAnthropic(prompt);else await runCli(agent,prompt) }
    catch(e){appendLine('Error: '+e.message,'err')}
  }

  $('sh-send').onclick=handleSubmit
  $('sh-clear').onclick=clearOutput
  $('sh-prompt').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSubmit()}})
  appendLine('OpenCrabs shell ready. Select an agent and type a prompt.','info')
}
