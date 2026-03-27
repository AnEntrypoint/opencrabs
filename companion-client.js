let ws = null;
let connected = false;
let pendingCalls = new Map();
let reconnectTimer = null;
let acpListeners = new Map();
const COMPANION_URL = "ws://localhost:9377";

function connect() {
  if (ws) return;
  try {
    ws = new WebSocket(COMPANION_URL);
    ws.onopen = () => { connected = true; console.log("[companion] connected"); };
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.stream && msg.sessionId) {
          const fns = acpListeners.get(msg.sessionId);
          if (fns) fns.forEach((fn) => fn(msg.event));
          return;
        }
        const cb = pendingCalls.get(msg.id);
        if (cb) { pendingCalls.delete(msg.id); msg.error ? cb.reject(new Error(msg.error)) : cb.resolve(msg.result); }
      } catch {}
    };
    ws.onclose = () => { ws = null; connected = false; reconnectTimer = setTimeout(connect, 5000); };
    ws.onerror = () => {};
  } catch { ws = null; connected = false; }
}

function disconnect() {
  clearTimeout(reconnectTimer);
  if (ws) { ws.close(); ws = null; }
  connected = false;
}

function isConnected() { return connected; }

function call(method, params) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== 1) return reject(new Error("companion not connected"));
    const id = Math.random().toString(36).slice(2, 10);
    pendingCalls.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pendingCalls.has(id)) { pendingCalls.delete(id); reject(new Error("timeout")); } }, 120000);
  });
}

async function shellExec(command, cwd) { return call("shell.exec", { command, cwd }); }
async function fsRead(path) { return call("fs.read", { path }); }
async function fsWrite(path, content) { return call("fs.write", { path, content }); }
async function fsList(path) { return call("fs.list", { path }); }
async function fsExists(path) { return call("fs.exists", { path }); }
async function fsDelete(path) { return call("fs.delete", { path }); }
async function fsStat(path) { return call("fs.stat", { path }); }
async function gitStatus(cwd) { return call("git.status", { cwd }); }
async function gitLog(cwd) { return call("git.log", { cwd }); }
async function gitDiff(cwd) { return call("git.diff", { cwd }); }
async function processSpawn(command, cwd) { return call("process.spawn", { command, cwd }); }
async function ping() { return call("ping", {}); }

async function acpAgents() { return call("acp.agents", {}); }
async function acpSessionNew(agent, cwd, name) { return call("acp.sessions.new", { agent, cwd, name }); }
async function acpSessionsList() { return call("acp.sessions.list", {}); }
async function acpSessionClose(sessionId) { return call("acp.sessions.close", { sessionId }); }
async function acpPrompt(sessionId, text) { return call("acp.prompt", { sessionId, text }); }
async function acpCancel(sessionId) { return call("acp.cancel", { sessionId }); }
async function acpExec(agent, text, cwd) { return call("acp.exec", { agent, text, cwd }); }
async function acpStatus(sessionId) { return call("acp.status", { sessionId }); }
async function acpHistory(sessionId, limit) { return call("acp.history", { sessionId, limit }); }

function acpSubscribe(sessionId, fn) {
  if (!acpListeners.has(sessionId)) acpListeners.set(sessionId, new Set());
  acpListeners.get(sessionId).add(fn);
  return () => {
    const s = acpListeners.get(sessionId);
    if (s) { s.delete(fn); if (s.size === 0) acpListeners.delete(sessionId); }
  };
}

connect();

export { connect, disconnect, isConnected, call,
  shellExec, fsRead, fsWrite, fsList, fsExists, fsDelete, fsStat,
  gitStatus, gitLog, gitDiff, processSpawn, ping,
  acpAgents, acpSessionNew, acpSessionsList, acpSessionClose,
  acpPrompt, acpCancel, acpExec, acpStatus, acpHistory, acpSubscribe };
