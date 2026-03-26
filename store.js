const STORE = {
  agents: [
    { id: "a1", name: "research-bot", status: "active", tools: ["web-search", "summarize", "file-read"], model: "claude-3" },
    { id: "a2", name: "deploy-agent", status: "idle", tools: ["ssh", "docker", "git"], model: "gpt-4" },
    { id: "a3", name: "data-pipeline", status: "error", tools: ["sql", "transform", "s3"], model: "claude-3" }
  ],
  jobs: [
    { id: "j1", name: "Daily Report", cron: "0 9 * * *", enabled: true, lastRun: "2026-03-26T09:00:00Z", status: "success" },
    { id: "j2", name: "DB Backup", cron: "0 2 * * *", enabled: true, lastRun: "2026-03-26T02:00:00Z", status: "success" },
    { id: "j3", name: "Log Cleanup", cron: "0 0 * * 0", enabled: false, lastRun: "2026-03-23T00:00:00Z", status: "skipped" }
  ],
  messages: [],
  settings: JSON.parse(localStorage.getItem("oc-settings") || '{"gatewayUrl":"http://localhost:9090","token":""}'),
  connected: false
};

function uid() { return Math.random().toString(36).slice(2, 9); }

function saveSettings() { localStorage.setItem("oc-settings", JSON.stringify(STORE.settings)); }

export { STORE, uid, saveSettings };
