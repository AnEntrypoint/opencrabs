import { getAgentFile, setAgentFile } from "./db.js";

const TOOL_DEFS = [
  { name: "read_file", description: "Read a file from the agent's virtual filesystem", input_schema: { type: "object", properties: { path: { type: "string", description: "File path to read" } }, required: ["path"] } },
  { name: "write_file", description: "Write content to a file in the agent's virtual filesystem", input_schema: { type: "object", properties: { path: { type: "string", description: "File path" }, content: { type: "string", description: "File content" } }, required: ["path", "content"] } },
  { name: "list_files", description: "List files in the agent's virtual filesystem", input_schema: { type: "object", properties: {} } },
  { name: "execute_js", description: "Execute JavaScript code in a sandboxed environment and return the result", input_schema: { type: "object", properties: { code: { type: "string", description: "JavaScript code to execute" } }, required: ["code"] } },
  { name: "fetch_url", description: "Fetch content from a URL", input_schema: { type: "object", properties: { url: { type: "string", description: "URL to fetch" }, method: { type: "string", description: "HTTP method" } }, required: ["url"] } },
  { name: "search_files", description: "Search for text in agent's files", input_schema: { type: "object", properties: { query: { type: "string", description: "Search query" } }, required: ["query"] } },
];

function getToolDefs(enabledTools) {
  if (!enabledTools || enabledTools.length === 0) return TOOL_DEFS;
  return TOOL_DEFS.filter(t => enabledTools.includes(t.name));
}

async function executeTool(agentId, name, input) {
  try {
    switch (name) {
      case "read_file": {
        const content = await getAgentFile(agentId, input.path);
        return content || "File not found: " + input.path;
      }
      case "write_file": {
        await setAgentFile(agentId, input.path, input.content);
        return "Written " + input.content.length + " chars to " + input.path;
      }
      case "list_files": {
        const db = await (await import("./db.js")).default;
        return "Virtual filesystem - use read_file/write_file to manage files.";
      }
      case "execute_js": {
        return await executeInWorker(input.code);
      }
      case "fetch_url": {
        const resp = await fetch(input.url, { method: input.method || "GET" });
        const text = await resp.text();
        return text.slice(0, 4000);
      }
      case "search_files": {
        return "Search not yet implemented for virtual filesystem.";
      }
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
