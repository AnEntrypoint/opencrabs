const DB_NAME = "openclaw";
const DB_VERSION = 2;
let dbInstance = null;

function open() {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings");
      if (!db.objectStoreNames.contains("agents")) db.createObjectStore("agents", { keyPath: "agentId" });
      if (!db.objectStoreNames.contains("files")) db.createObjectStore("files");
      if (!db.objectStoreNames.contains("history")) db.createObjectStore("history");
    };
    req.onsuccess = () => { dbInstance = req.result; resolve(dbInstance); };
    req.onerror = () => reject(req.error);
  });
}

async function get(store, key) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function put(store, key, value) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const s = tx.objectStore(store);
    const req = key !== undefined && !s.keyPath ? s.put(value, key) : s.put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function del(store, key) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAll(store) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function loadSettings() {
  try {
    const s = await get("settings", "main");
    return s || { anthropicKey: "", openaiKey: "", theme: "dark", defaultModel: "claude-sonnet-4-20250514" };
  } catch { return { anthropicKey: "", openaiKey: "", theme: "dark", defaultModel: "claude-sonnet-4-20250514" }; }
}

async function saveSettings(s) { return put("settings", "main", s); }

async function loadAgents() { return getAll("agents"); }

async function saveAgent(agent) { return put("agents", undefined, agent); }

async function deleteAgent(agentId) { return del("agents", agentId); }

async function getAgentFile(agentId, filename) {
  return (await get("files", agentId + ":" + filename)) || "";
}

async function setAgentFile(agentId, filename, content) {
  return put("files", agentId + ":" + filename, content);
}

async function getHistory(agentId) {
  return (await get("history", agentId)) || [];
}

async function saveHistory(agentId, messages) {
  return put("history", agentId, messages);
}

async function exportAll() {
  const [settings, agents, files, history] = await Promise.all([
    get("settings", "main"), getAll("agents"), getAll("files"), getAll("history")
  ]);
  return JSON.stringify({ settings, agents, files, history }, null, 2);
}

export { open, loadSettings, saveSettings, loadAgents, saveAgent, deleteAgent, getAgentFile, setAgentFile, getHistory, saveHistory, exportAll };
