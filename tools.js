import { getAgentFile, setAgentFile } from "./db.js";
import { navigate, navigateProxy, snapshot, click, fill, evalJs, getText, getUrl } from "./browser-tools.js";
import { isConnected, shellExec, fsRead, fsWrite, fsList, gitStatus, gitLog, gitDiff, acpExec, acpPrompt, acpSessionNew, acpSessionsList } from "./companion-client.js";
import { wcReady, wcExec, wcFsRead, wcFsWrite, wcFsList, wcGit } from "./wc.js";

const TOOL_DEFS = [
  { name: "read_file", description: "Read a file from the agent's virtual filesystem", input_schema: { type: "object", properties: { path: { type: "string", description: "File path to read" } }, required: ["path"] } },
  { name: "write_file", description: "Write content to a file in the agent's virtual filesystem", input_schema: { type: "object", properties: { path: { type: "string", description: "File path" }, content: { type: "string", description: "File content" } }, required: ["path", "content"] } },
  { name: "list_files", description: "List files in the agent's virtual filesystem", input_schema: { type: "object", properties: {} } },
  { name: "execute_js", description: "Execute JavaScript code in a sandboxed environment and return the result", input_schema: { type: "object", properties: { code: { type: "string", description: "JavaScript code to execute" } }, required: ["code"] } },
  { name: "fetch_url", description: "Fetch content from a URL", input_schema: { type: "object", properties: { url: { type: "string", description: "URL to fetch" }, method: { type: "string", description: "HTTP method" } }, required: ["url"] } },
  { name: "search_files", description: "Search for text in agent's files", input_schema: { type: "object", properties: { query: { type: "string", description: "Search query" } }, required: ["query"] } },
  { name: "browser_navigate", description: "Navigate the embedded browser iframe to a URL. Use browser_navigate_proxy for cross-origin sites that need DOM access.", input_schema: { type: "object", properties: { url: { type: "string", description: "URL to navigate to" } }, required: ["url"] } },
  { name: "browser_navigate_proxy", description: "Navigate via CORS proxy — allows full DOM access on any site. Use this when browser_navigate reports cross-origin.", input_schema: { type: "object", properties: { url: { type: "string", description: "URL to load via proxy" } }, required: ["url"] } },
  { name: "browser_snapshot", description: "Get a snapshot of all interactive elements in the embedded browser (links, buttons, inputs, etc). Returns @ref identifiers that can be used with browser_click and browser_fill.", input_schema: { type: "object", properties: {} } },
  { name: "browser_click", description: "Click an element in the embedded browser. Use @e1 refs from snapshot or CSS selectors.", input_schema: { type: "object", properties: { selector: { type: "string", description: "@ref from snapshot or CSS selector" } }, required: ["selector"] } },
  { name: "browser_fill", description: "Fill a form field in the embedded browser", input_schema: { type: "object", properties: { selector: { type: "string", description: "@ref from snapshot or CSS selector" }, text: { type: "string", description: "Text to fill" } }, required: ["selector", "text"] } },
  { name: "browser_eval", description: "Execute JavaScript in the embedded browser iframe context and return the result", input_schema: { type: "object", properties: { code: { type: "string", description: "JavaScript code to evaluate" } }, required: ["code"] } },
  { name: "browser_get_text", description: "Get text content of an element in the embedded browser. Omit selector for full page text.", input_schema: { type: "object", properties: { selector: { type: "string", description: "CSS selector (optional, defaults to body)" } } } },
  { name: "browser_get_url", description: "Get the current URL of the embedded browser", input_schema: { type: "object", properties: {} } },
  { name: "shell_exec", description: "Execute a shell command. Runs in WebContainer (in-browser) when available, falls back to companion CLI.", input_schema: { type: "object", properties: { command: { type: "string", description: "Shell command to execute" }, cwd: { type: "string", description: "Working directory (optional)" } }, required: ["command"] } },
  { name: "real_fs_read", description: "Read a file. Uses WebContainer filesystem when available, falls back to companion CLI.", input_schema: { type: "object", properties: { path: { type: "string", description: "Absolute or relative file path" } }, required: ["path"] } },
  { name: "real_fs_write", description: "Write a file. Uses WebContainer filesystem when available, falls back to companion CLI.", input_schema: { type: "object", properties: { path: { type: "string", description: "File path" }, content: { type: "string", description: "Content to write" } }, required: ["path", "content"] } },
  { name: "real_fs_list", description: "List files in a directory. Uses WebContainer filesystem when available, falls back to companion CLI.", input_schema: { type: "object", properties: { path: { type: "string", description: "Directory path (defaults to CWD)" } } } },
  { name: "git_status", description: "Get git status. Runs in WebContainer when available, falls back to companion CLI.", input_schema: { type: "object", properties: {} } },
  { name: "git_log", description: "Get recent git log. Runs in WebContainer when available, falls back to companion CLI.", input_schema: { type: "object", properties: {} } },
  { name: "git_diff", description: "Get git diff. Runs in WebContainer when available, falls back to companion CLI.", input_schema: { type: "object", properties: {} } },
  { name: "acp_exec", description: "Execute a one-shot coding task using a CLI agent (Claude Code, Codex, etc). The agent runs on the companion CLI with full filesystem and shell access. Use for complex coding tasks.", input_schema: { type: "object", properties: { agent: { type: "string", description: "Agent to use: claude, codex, openclaw, or custom command", enum: ["claude", "codex", "openclaw"] }, prompt: { type: "string", description: "The coding task to execute" } }, required: ["prompt"] } },
  { name: "acp_sessions", description: "List active ACP agent sessions on the companion CLI", input_schema: { type: "object", properties: {} } },
];

function getToolDefs(enabledTools) {
  if (!enabledTools || enabledTools.length === 0) return TOOL_DEFS;
  return TOOL_DEFS.filter(t => enabledTools.includes(t.name));
}

async function executeTool(agentId, name, input) {
  try {
    switch (name) {
      case "read_file": { const c = await getAgentFile(agentId, input.path); return c || "File not found: " + input.path; }
      case "write_file": { await setAgentFile(agentId, input.path, input.content); return "Written " + input.content.length + " chars to " + input.path; }
      case "list_files": return "Virtual filesystem - use read_file/write_file to manage files.";
      case "execute_js": return await executeInWorker(input.code);
      case "fetch_url": { const r = await fetch(input.url, { method: input.method || "GET" }); return (await r.text()).slice(0, 4000); }
      case "search_files": return "Search not yet implemented for virtual filesystem.";
      case "browser_navigate": return await navigate(input.url);
      case "browser_navigate_proxy": return await navigateProxy(input.url);
      case "browser_snapshot": return snapshot();
      case "browser_click": return click(input.selector);
      case "browser_fill": return fill(input.selector, input.text);
      case "browser_eval": return evalJs(input.code);
      case "browser_get_text": return getText(input.selector);
      case "browser_get_url": return getUrl();
      case "shell_exec": { if (wcReady()) return await wcExec(input.command, input.cwd); if (!isConnected()) return "No execution environment available. WebContainer unavailable and companion offline."; const r = await shellExec(input.command, input.cwd); return (r.stdout || "") + (r.stderr ? "\nSTDERR: " + r.stderr : "") + "\n[exit " + r.exitCode + "]"; }
      case "real_fs_read": { if (wcReady()) { const c = await wcFsRead(input.path); return c !== null ? c : "File not found: " + input.path; } if (!isConnected()) return "No execution environment available."; const r = await fsRead(input.path); return r.content; }
      case "real_fs_write": { if (wcReady()) { const ok = await wcFsWrite(input.path, input.content); return ok ? "Written " + input.content.length + " chars to " + input.path : "Write failed: " + input.path; } if (!isConnected()) return "No execution environment available."; await fsWrite(input.path, input.content); return "Written " + input.content.length + " chars to " + input.path; }
      case "real_fs_list": { if (wcReady()) { const entries = await wcFsList(input.path); return entries ? entries.map(e => (e.type === "dir" ? "📁 " : "📄 ") + e.name).join("\n") : "Directory not found: " + input.path; } if (!isConnected()) return "No execution environment available."; const r = await fsList(input.path); return r.map(e => (e.type === "dir" ? "📁 " : "📄 ") + e.name).join("\n"); }
      case "git_status": { if (wcReady()) return await wcGit("status", input.cwd); if (!isConnected()) return "No execution environment available."; const r = await gitStatus(); return r.stdout || "(clean)"; }
      case "git_log": { if (wcReady()) return await wcGit("log --oneline -20", input.cwd); if (!isConnected()) return "No execution environment available."; const r = await gitLog(); return r.stdout; }
      case "git_diff": { if (wcReady()) return await wcGit("diff", input.cwd); if (!isConnected()) return "No execution environment available."; const r = await gitDiff(); return r.stdout || "(no changes)"; }
      case "acp_exec": { if (!isConnected()) return "Companion CLI not running. Start with: node companion/server.js"; try { const r = await acpExec(input.agent || "claude", input.prompt); return r.error ? "ACP Error: " + r.error : JSON.stringify(r.result || r.events?.slice(-5), null, 2).slice(0, 4000); } catch (e) { return "ACP Error: " + e.message; } }
      case "acp_sessions": { if (!isConnected()) return "Companion CLI not running."; const r = await acpSessionsList(); return r.length ? r.map(s => s.id + " [" + s.agent + "] " + s.status).join("\n") : "No active ACP sessions."; }
      default: return "Unknown tool: " + name;
    }
  } catch (e) { return "Tool error: " + e.message; }
}

function executeInWorker(code) {
  return new Promise((resolve) => {
    const blob = new Blob([
      "self.onmessage = async (e) => { try { const result = eval(e.data); self.postMessage({ ok: true, result: String(result) }); } catch(err) { self.postMessage({ ok: false, result: err.message }); } };"
    ], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    const timer = setTimeout(() => { worker.terminate(); resolve("Execution timed out (5s)"); }, 5000);
    worker.onmessage = (e) => { clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(url); resolve(e.data.result); };
    worker.onerror = (e) => { clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(url); resolve("Worker error: " + e.message); };
    worker.postMessage(code);
  });
}

function needsApproval(agentConfig, toolName) {
  if (agentConfig.sessionExecAsk === "off") return false;
  if (agentConfig.sessionExecAsk === "always") return true;
  if (agentConfig.sessionExecAsk === "on-miss") return !(agentConfig.toolAllowlist || []).includes(toolName);
  return false;
}

export { TOOL_DEFS, getToolDefs, executeTool, needsApproval };
