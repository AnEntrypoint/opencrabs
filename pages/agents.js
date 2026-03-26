import { createElement, applyDiff } from "webjsx";
import { STORE, uid } from "../store.js";

function statusColor(s) {
  return s === "active" ? "badge-success" : s === "error" ? "badge-error" : "badge-ghost";
}

let editingAgent = null;
let rootEl = null;

function openEdit(agent) {
  editingAgent = agent ? { ...agent, tools: [...agent.tools] } : { id: uid(), name: "", status: "idle", tools: [], model: "claude-3" };
  render(rootEl);
}

function closeModal() { editingAgent = null; render(rootEl); }

function saveAgent() {
  const idx = STORE.agents.findIndex(a => a.id === editingAgent.id);
  if (idx >= 0) STORE.agents[idx] = editingAgent; else STORE.agents.push(editingAgent);
  closeModal();
}

function deleteAgent(id) { STORE.agents = STORE.agents.filter(a => a.id !== id); render(rootEl); }

function render(el) {
  rootEl = el;
  const modal = editingAgent ? createElement("div", { class: "fixed inset-0 bg-black/50 flex items-center justify-center z-50", onclick: (e) => { if (e.target === e.currentTarget) closeModal(); } },
    createElement("div", { class: "bg-[#16213e] p-6 rounded-xl w-96 border border-[#2a2a4a]" },
      createElement("h3", { class: "font-bold text-lg mb-4" }, STORE.agents.find(a => a.id === editingAgent.id) ? "Edit Agent" : "New Agent"),
      createElement("input", { class: "input input-bordered w-full mb-3", placeholder: "Agent name", value: editingAgent.name, oninput: (e) => { editingAgent.name = e.target.value; } }),
      createElement("select", { class: "select select-bordered w-full mb-3", value: editingAgent.model, onchange: (e) => { editingAgent.model = e.target.value; } },
        createElement("option", { value: "claude-3" }, "claude-3"), createElement("option", { value: "gpt-4" }, "gpt-4"), createElement("option", { value: "gemini-pro" }, "gemini-pro")),
      createElement("input", { class: "input input-bordered w-full mb-3", placeholder: "Tools (comma separated)", value: editingAgent.tools.join(", "), oninput: (e) => { editingAgent.tools = e.target.value.split(",").map(s => s.trim()).filter(Boolean); } }),
      createElement("select", { class: "select select-bordered w-full mb-3", value: editingAgent.status, onchange: (e) => { editingAgent.status = e.target.value; } },
        createElement("option", { value: "active" }, "active"), createElement("option", { value: "idle" }, "idle"), createElement("option", { value: "error" }, "error")),
      createElement("div", { class: "flex gap-2 justify-end" },
        createElement("button", { class: "btn btn-ghost", onclick: closeModal }, "Cancel"),
        createElement("button", { class: "btn btn-primary", onclick: saveAgent }, "Save")))
  ) : null;

  const cards = STORE.agents.map(a => createElement("div", { class: "card bg-[#16213e] border border-[#2a2a4a] p-4" },
    createElement("div", { class: "flex justify-between items-start" },
      createElement("h3", { class: "font-semibold text-lg" }, a.name),
      createElement("span", { class: "badge " + statusColor(a.status) }, a.status)),
    createElement("p", { class: "text-sm text-gray-400 mt-1" }, "Model: " + a.model),
    createElement("div", { class: "flex flex-wrap gap-1 mt-3" }, ...a.tools.map(t => createElement("span", { class: "badge badge-sm badge-outline badge-primary" }, t))),
    createElement("div", { class: "flex gap-2 mt-4" },
      createElement("button", { class: "btn btn-sm btn-primary", onclick: () => openEdit(a) }, "Edit"),
      createElement("button", { class: "btn btn-sm btn-error btn-outline", onclick: () => deleteAgent(a.id) }, "Delete"))));

  const vdom = createElement("div", null,
    createElement("div", { class: "flex justify-between items-center mb-6" },
      createElement("h1", { class: "text-2xl font-bold" }, "Agents"),
      createElement("button", { class: "btn btn-primary", onclick: () => openEdit(null) }, "+ New Agent")),
    cards.length ? createElement("div", { class: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" }, ...cards)
      : createElement("div", { class: "text-center text-gray-500 py-16" }, "No agents yet. Create one to get started."),
    modal);
  applyDiff(el, vdom);
}

export { render };
