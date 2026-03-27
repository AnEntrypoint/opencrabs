const { spawn } = require("child_process");
const path = require("path");

let ClientSideConnection, Stream;
try {
  const sdk = require("@agentclientprotocol/sdk");
  ClientSideConnection = sdk.ClientSideConnection;
  Stream = sdk.Stream;
} catch {
  ClientSideConnection = null;
  Stream = null;
}

const AGENTS = {
  claude: "npx -y @anthropic-ai/claude-code --dangerously-skip-permissions",
  codex: "npx -y @openai/codex",
  openclaw: "openclaw acp",
  opencode: "npx -y opencode-ai acp",
  kilocode: "npx -y @kilocode/cli acp",
};

const sessions = new Map();
let idCounter = 0;

function resolveCommand(agent) { return AGENTS[agent] || agent; }

async function createSession(agent, cwd, name) {
  const id = "acp-" + (++idCounter) + "-" + Date.now().toString(36);
  const cmd = resolveCommand(agent);
  const parts = cmd.split(" ");
  const proc = spawn(parts[0], parts.slice(1), {
    cwd: cwd || process.cwd(), shell: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });

  const session = {
    id, agent, cwd, name: name || "default", pid: proc.pid,
    proc, conn: null, acpSessionId: null,
    status: "starting", createdAt: Date.now(),
    listeners: new Set(), history: [],
    rpcId: 0, pending: new Map(), buffer: "",
  };

  proc.stderr.on("data", (chunk) => {
    const text = chunk.toString().trim();
    if (text) broadcast(session, { type: "stderr", text });
  });

  proc.on("close", (code) => {
    session.status = "closed";
    broadcast(session, { type: "session_closed", code });
  });

  proc.on("error", (err) => {
    session.status = "error";
    broadcast(session, { type: "error", message: err.message });
  });

  if (ClientSideConnection && Stream) {
    try {
      const stream = Stream.fromReadableWritable(proc.stdout, proc.stdin);
      const conn = new ClientSideConnection((agentApi) => ({
        sessionUpdate(params) { session.history.push(params); broadcast(session, { type: "acp_event", data: { method: "session/update", params } }); },
        permissionRequest(params) { broadcast(session, { type: "permission_request", data: params }); return { decision: "allow" }; },
      }), stream);
      session.conn = conn;
      await conn.initialize({ clientInfo: { name: "opencrabs", version: "1.2.0" } });
      const ns = await conn.newSession({});
      session.acpSessionId = ns.sessionId;
      session.status = "running";
    } catch (e) {
      session.status = "running";
      broadcast(session, { type: "stderr", text: "SDK init failed, using raw mode: " + e.message });
      setupRawMode(session);
    }
  } else {
    setupRawMode(session);
    session.status = "running";
  }

  sessions.set(id, session);
  return { id, pid: proc.pid, agent, cwd, name: session.name, acpSessionId: session.acpSessionId };
}

function setupRawMode(session) {
  session.proc.stdout.on("data", (chunk) => {
    session.buffer += chunk.toString();
    const lines = session.buffer.split("\n");
    session.buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { const msg = JSON.parse(trimmed); handleRawMessage(session, msg); }
      catch { broadcast(session, { type: "stderr", text: trimmed }); }
    }
  });
}

function handleRawMessage(session, msg) {
  if (msg.id && session.pending.has(msg.id)) {
    const { resolve } = session.pending.get(msg.id);
    session.pending.delete(msg.id);
    resolve(msg.result || msg);
    return;
  }
  session.history.push(msg);
  broadcast(session, { type: "acp_event", data: msg });
}

function broadcast(session, event) { session.listeners.forEach((fn) => fn(event)); }

async function prompt(sessionId, text) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("session not found: " + sessionId);
  if (session.conn && session.acpSessionId) {
    return session.conn.prompt({ sessionId: session.acpSessionId, prompt: text });
  }
  return sendRawRpc(session, "session/prompt", { sessionId: session.acpSessionId || "default", prompt: text });
}

function sendRawRpc(session, method, params) {
  return new Promise((resolve, reject) => {
    if (!session.proc || session.status !== "running") return reject(new Error("not running"));
    const id = "req-" + (++session.rpcId);
    session.pending.set(id, { resolve, reject });
    session.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => { if (session.pending.has(id)) { session.pending.delete(id); reject(new Error("timeout")); } }, 120000);
  });
}

async function cancel(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("session not found");
  if (session.conn && session.acpSessionId) {
    await session.conn.cancel({ sessionId: session.acpSessionId, reason: "user_cancelled" });
    return { cancelled: true };
  }
  return sendRawRpc(session, "session/cancel", { sessionId: session.acpSessionId || "default" });
}

async function closeSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("session not found");
  if (session.conn) { try { await session.conn.unstable_closeSession({ sessionId: session.acpSessionId }); } catch {} }
  if (session.proc && session.status === "running") session.proc.kill();
  sessions.delete(sessionId);
  return { closed: true };
}

function listSessions() {
  const result = [];
  sessions.forEach((s) => result.push({
    id: s.id, agent: s.agent, cwd: s.cwd, name: s.name, status: s.status,
    pid: s.pid, createdAt: s.createdAt, acpSessionId: s.acpSessionId, historyLength: s.history.length,
  }));
  return result;
}

function getSession(sessionId) { return sessions.get(sessionId) || null; }

function subscribe(sessionId, fn) {
  const session = sessions.get(sessionId);
  if (!session) return () => {};
  session.listeners.add(fn);
  return () => session.listeners.delete(fn);
}

async function exec(agent, cwd, promptText) {
  const info = await createSession(agent, cwd, "exec-" + Date.now().toString(36));
  const collected = [];
  const unsub = subscribe(info.id, (evt) => collected.push(evt));
  try {
    const result = await prompt(info.id, promptText);
    unsub(); await closeSession(info.id);
    return { result, events: collected };
  } catch (e) {
    unsub(); try { await closeSession(info.id); } catch {}
    return { error: e.message, events: collected };
  }
}

function hasSDK() { return !!ClientSideConnection; }

module.exports = { createSession, prompt, cancel, closeSession, listSessions, getSession, subscribe, exec, AGENTS, hasSDK };
