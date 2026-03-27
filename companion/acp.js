const { spawn } = require("child_process");
const path = require("path");

const AGENTS = {
  claude: "npx -y @anthropic-ai/claude-code --dangerously-skip-permissions",
  codex: "npx -y @openai/codex",
  openclaw: "openclaw acp",
};

const sessions = new Map();
let idCounter = 0;

function resolveCommand(agent) {
  return AGENTS[agent] || agent;
}

function createSession(agent, cwd, name) {
  const id = "acp-" + (++idCounter) + "-" + Date.now().toString(36);
  const cmd = resolveCommand(agent);
  const parts = cmd.split(" ");
  const proc = spawn(parts[0], parts.slice(1), {
    cwd: cwd || process.cwd(),
    shell: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });

  const session = {
    id, agent, cwd, name: name || "default", pid: proc.pid,
    proc, status: "starting", createdAt: Date.now(),
    rpcId: 0, pending: new Map(), listeners: new Set(),
    buffer: "", history: [],
  };

  proc.stdout.on("data", (chunk) => {
    session.buffer += chunk.toString();
    const lines = session.buffer.split("\n");
    session.buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        handleMessage(session, msg);
      } catch {
        broadcast(session, { type: "stderr", text: trimmed });
      }
    }
  });

  proc.stderr.on("data", (chunk) => {
    const text = chunk.toString().trim();
    if (text) broadcast(session, { type: "stderr", text });
  });

  proc.on("close", (code) => {
    session.status = "closed";
    broadcast(session, { type: "session_closed", code });
    session.pending.forEach((cb) => cb.reject(new Error("process exited")));
    session.pending.clear();
  });

  proc.on("error", (err) => {
    session.status = "error";
    broadcast(session, { type: "error", message: err.message });
  });

  session.status = "running";
  sessions.set(id, session);
  return { id, pid: proc.pid, agent, cwd, name: session.name };
}

function handleMessage(session, msg) {
  if (msg.id && session.pending.has(msg.id)) {
    const { resolve } = session.pending.get(msg.id);
    session.pending.delete(msg.id);
    resolve(msg.result || msg);
    return;
  }
  if (msg.method === "session/update" || msg.params) {
    session.history.push(msg);
    broadcast(session, { type: "acp_event", data: msg });
    return;
  }
  broadcast(session, { type: "acp_message", data: msg });
}

function broadcast(session, event) {
  session.listeners.forEach((fn) => fn(event));
}

function sendRpc(session, method, params) {
  return new Promise((resolve, reject) => {
    if (!session.proc || session.status !== "running") return reject(new Error("session not running"));
    const id = "req-" + (++session.rpcId);
    const msg = { jsonrpc: "2.0", id, method, params: params || {} };
    session.pending.set(id, { resolve, reject });
    session.proc.stdin.write(JSON.stringify(msg) + "\n");
    setTimeout(() => {
      if (session.pending.has(id)) {
        session.pending.delete(id);
        reject(new Error("rpc timeout"));
      }
    }, 120000);
  });
}

async function prompt(sessionId, text) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("session not found: " + sessionId);
  return sendRpc(session, "session/prompt", { prompt: text });
}

async function cancel(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("session not found");
  return sendRpc(session, "session/cancel", {});
}

async function closeSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("session not found");
  if (session.proc && session.status === "running") session.proc.kill();
  sessions.delete(sessionId);
  return { closed: true };
}

function listSessions() {
  const result = [];
  sessions.forEach((s) => result.push({
    id: s.id, agent: s.agent, cwd: s.cwd, name: s.name,
    status: s.status, pid: s.pid, createdAt: s.createdAt, historyLength: s.history.length,
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
  const info = createSession(agent, cwd, "exec-" + Date.now().toString(36));
  const collected = [];
  const unsub = subscribe(info.id, (evt) => collected.push(evt));
  try {
    const result = await prompt(info.id, promptText);
    unsub();
    await closeSession(info.id);
    return { result, events: collected };
  } catch (e) {
    unsub();
    try { await closeSession(info.id); } catch {}
    return { error: e.message, events: collected };
  }
}

module.exports = { createSession, prompt, cancel, closeSession, listSessions, getSession, subscribe, exec, sendRpc, AGENTS };
