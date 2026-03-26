import { createElement, applyDiff } from "webjsx";
import { getFilteredAgents } from "../machines.js";
import { avatarDataUrl } from "../avatar.js";
import { show as showCtx } from "./context-menu.js";

const FILTERS = [{ value: "all", label: "All" }, { value: "running", label: "Running" }, { value: "approvals", label: "Approvals" }];
const STATUS_BADGE = { idle: "ui-badge-status-idle", running: "ui-badge-status-running", error: "ui-badge-status-error" };
const STATUS_LABEL = { idle: "Idle", running: "Running", error: "Error" };

let onCreateCb = null;

function agentContextMenu(e, agent, actor) {
  showCtx(e, [
    { icon: "\u270F", label: "Rename", action: () => {
      const name = prompt("Rename agent:", agent.name);
      if (name?.trim()) actor.send({ type: "UPDATE_AGENT", agentId: agent.agentId, patch: { name: name.trim() } });
    }},
    { icon: "\u{1F504}", label: "Reset session", action: () => {
      actor.send({ type: "UPDATE_AGENT", agentId: agent.agentId, patch: { outputLines: [], streamText: null, thinkingTrace: null, lastResult: null, draft: "", status: "idle" } });
      import("../db.js").then(db => db.saveHistory(agent.agentId, []));
    }},
    { icon: "\u{1F4CB}", label: "Copy ID", action: () => navigator.clipboard.writeText(agent.agentId).catch(() => {}) },
    { sep: true },
    { icon: "\u{1F5D1}", label: "Delete agent", danger: true, action: () => {
      actor.send({ type: "REMOVE_AGENT", agentId: agent.agentId });
      import("../db.js").then(db => db.deleteAgent(agent.agentId));
    }},
  ], document.getElementById("oc-ctx"));
}

function renderAgent(agent, actor) {
  const ctx = actor.getSnapshot().context;
  const selected = ctx.selectedAgentId === agent.agentId;
  const avatarSrc = avatarDataUrl(agent.avatarSeed || agent.agentId, 42);
  return createElement("button", {
    class: "ui-card" + (selected ? " ui-card-selected" : ""),
    style: "position:relative;display:flex;width:100%;align-items:center;gap:10px;overflow:hidden;padding:10px 12px;text-align:left;transition:background 150ms,box-shadow 150ms" + (!selected ? ";cursor:pointer" : ""),
    onclick: () => actor.send({ type: "SELECT_AGENT", agentId: agent.agentId }),
    oncontextmenu: (e) => agentContextMenu(e, agent, actor)
  },
    selected ? createElement("span", { class: "ui-card-select-indicator", style: "opacity:1" }) : null,
    createElement("img", { src: avatarSrc, width: "42", height: "42", style: "border-radius:var(--radius-small);flex-shrink:0" + (selected ? ";box-shadow:0 0 0 2px color-mix(in oklch,var(--primary) 36%,transparent)" : "") }),
    createElement("div", { style: "min-width:0;flex:1" },
      createElement("p", { style: "font-size:13px;font-weight:600;color:var(--foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, agent.name),
      createElement("div", { style: "margin-top:5px;display:flex;flex-wrap:wrap;gap:4px;align-items:center" },
        createElement("span", { class: "ui-badge " + (STATUS_BADGE[agent.status] || "ui-badge-status-idle") }, STATUS_LABEL[agent.status] || agent.status),
        agent.awaitingUserInput ? createElement("span", { class: "ui-badge ui-badge-approval" }, "Needs approval") : null
      )
    ),
    agent.hasUnseenActivity && !selected ? createElement("span", { style: "position:absolute;top:8px;right:8px;width:7px;height:7px;border-radius:50%;background:var(--primary)" }) : null
  );
}

function render(actor, el, onCreate) {
  if (onCreate) onCreateCb = onCreate;
  const ctx = actor.getSnapshot().context;
  const agents = getFilteredAgents(ctx);
  const h = createElement;
  const vdom = h("aside", { class: "glass-panel fade-up-delay", style: "display:flex;height:100%;width:100%;flex-direction:column;gap:10px;background:var(--sidebar);padding:12px" },
    h("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 4px" },
      h("p", { style: "font-family:var(--font-mono);font-size:13px;font-weight:700;color:var(--foreground)" }, "Agents (" + ctx.agents.length + ")"),
      h("button", { class: "ui-btn-primary", style: "padding:6px 12px;font-size:11px", onclick: () => onCreateCb && onCreateCb() }, "New agent")
    ),
    h("div", { class: "ui-segment", style: "grid-template-columns:repeat(3,1fr)" },
      ...FILTERS.map(f => h("button", {
        class: "ui-segment-item", "data-active": ctx.focusFilter === f.value ? "true" : "false",
        onclick: () => actor.send({ type: "SET_FILTER", filter: f.value })
      }, f.label))
    ),
    h("div", { class: "ui-scroll", style: "flex:1;min-height:0;overflow-y:auto" },
      agents.length === 0
        ? h("div", { style: "padding:12px;color:var(--muted-foreground);font-size:12px;text-align:center" }, "No agents available.")
        : h("div", { style: "display:flex;flex-direction:column;gap:8px" }, ...agents.map(a => renderAgent(a, actor)))
    )
  );
  applyDiff(el, vdom);
}

export { render };
