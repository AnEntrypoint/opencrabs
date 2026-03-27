#!/usr/bin/env node
const { WebSocketServer } = require("ws");
const { exec, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const acp = require("./acp");

const PORT = parseInt(process.env.PORT || "9377", 10);
const CWD = process.env.CWD || process.cwd();

const wss = new WebSocketServer({ port: PORT });
let connections = 0;

wss.on("connection", (ws) => {
  connections++;
  console.log("[companion] client connected (" + connections + " active)");
  const acpUnsubs = new Map();

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { ws.send(JSON.stringify({ id: null, error: "invalid json" })); return; }
    const { id, method, params } = msg;
    try {
      const result = await handleMethod(method, params || {}, ws, acpUnsubs);
      ws.send(JSON.stringify({ id, result }));
    } catch (e) {
      ws.send(JSON.stringify({ id, error: e.message }));
    }
  });

  ws.on("close", () => {
    connections--;
    acpUnsubs.forEach((unsub) => unsub());
    acpUnsubs.clear();
    console.log("[companion] client disconnected (" + connections + " active)");
  });
});

async function handleMethod(method, params, ws, acpUnsubs) {
  switch (method) {
    case "ping": return { ok: true, cwd: CWD, version: "1.1.0", acp: true, agents: Object.keys(acp.AGENTS) };
    case "shell.exec": {
      if (!params.command) throw new Error("command required");
      return new Promise((resolve) => {
        exec(params.command, { cwd: params.cwd || CWD, timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
          resolve({ exitCode: err ? err.code || 1 : 0, stdout, stderr });
        });
      });
    }
    case "fs.read": { const p = resolvePath(params.path); return { content: fs.readFileSync(p, "utf-8") }; }
    case "fs.write": { const p = resolvePath(params.path); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, params.content, "utf-8"); return { written: params.content.length }; }
    case "fs.list": { const p = resolvePath(params.path || "."); return fs.readdirSync(p, { withFileTypes: true }).map(e => ({ name: e.name, type: e.isDirectory() ? "dir" : "file" })); }
    case "fs.exists": return { exists: fs.existsSync(resolvePath(params.path)) };
    case "fs.delete": { fs.rmSync(resolvePath(params.path), { recursive: true, force: true }); return { deleted: true }; }
    case "fs.stat": { const s = fs.statSync(resolvePath(params.path)); return { size: s.size, isDir: s.isDirectory(), modified: s.mtime.toISOString() }; }
    case "git.status": return shellSync("git status --porcelain", params.cwd);
    case "git.log": return shellSync("git log --oneline -20", params.cwd);
    case "git.diff": return shellSync("git diff", params.cwd);
    case "git.branch": return shellSync("git branch", params.cwd);
    case "process.spawn": {
      if (!params.command) throw new Error("command required");
      const child = spawn(params.command, { shell: true, cwd: params.cwd || CWD });
      let output = "";
      return new Promise((resolve) => {
        child.stdout.on("data", (d) => { output += d; });
        child.stderr.on("data", (d) => { output += d; });
        child.on("close", (code) => resolve({ exitCode: code, output }));
        setTimeout(() => { child.kill(); resolve({ exitCode: -1, output: output + "\n[killed after 30s]" }); }, 30000);
      });
    }
    case "acp.agents": return { agents: Object.keys(acp.AGENTS) };
    case "acp.sessions.new": {
      const info = acp.createSession(params.agent || "claude", params.cwd || CWD, params.name);
      const unsub = acp.subscribe(info.id, (evt) => {
        try { ws.send(JSON.stringify({ stream: true, sessionId: info.id, event: evt })); } catch {}
      });
      acpUnsubs.set(info.id, unsub);
      return info;
    }
    case "acp.sessions.list": return acp.listSessions();
    case "acp.sessions.close": return acp.closeSession(params.sessionId);
    case "acp.prompt": {
      if (!params.sessionId || !params.text) throw new Error("sessionId and text required");
      return acp.prompt(params.sessionId, params.text);
    }
    case "acp.cancel": return acp.cancel(params.sessionId);
    case "acp.exec": {
      const result = await acp.exec(params.agent || "claude", params.cwd || CWD, params.text || params.prompt);
      return result;
    }
    case "acp.status": {
      const session = acp.getSession(params.sessionId);
      if (!session) return { status: "not_found" };
      return { id: session.id, status: session.status, pid: session.pid, agent: session.agent, historyLength: session.history.length };
    }
    case "acp.history": {
      const session = acp.getSession(params.sessionId);
      if (!session) throw new Error("session not found");
      return session.history.slice(-(params.limit || 50));
    }
    default: throw new Error("unknown method: " + method);
  }
}

function resolvePath(p) { return path.isAbsolute(p) ? p : path.resolve(CWD, p); }

function shellSync(cmd, cwd) {
  return new Promise((resolve) => {
    exec(cmd, { cwd: cwd || CWD, timeout: 10000 }, (err, stdout, stderr) => {
      resolve({ exitCode: err ? 1 : 0, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

console.log("[companion] OpenCrabs companion v1.1.0 on ws://localhost:" + PORT);
console.log("[companion] CWD: " + CWD);
console.log("[companion] ACP agents: " + Object.keys(acp.AGENTS).join(", "));
