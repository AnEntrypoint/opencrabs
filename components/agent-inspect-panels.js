import { createElement, applyDiff } from "webjsx";
import { getSelectedAgent } from "../machines.js";
import { iconHtml } from "../icons.js";
import { getAgentFile, setAgentFile, saveAgent } from "../db.js";
import { startJob, stopJob, getJobStatus } from "../cron.js";
import { runAgent } from "../agent-runner.js";
import { isConnected as companionConnected, acpSessionNew, acpSessionsList, acpPrompt, acpSessionClose } from "../companion-client.js";

const SECURITY_LEVELS = ["deny", "allowlist", "full"];
const ASK_MODES = ["off", "on-miss", "always"];
const INTELLIGENCE_MODES = [
  { id: "direct", name: "Direct API" },
  { id: "acp:claude", name: "ACP: Claude Code" },
  { id: "acp:codex", name: "ACP: Codex" },
  { id: "acp:openclaw", name: "ACP: OpenClaw" },
  { id: "acp:opencode", name: "ACP: OpenCode" },
  { id: "acp:kilocode", name: "ACP: Kilo Code" },
];

function renderSwitch(label, value, onChange) {
  return createElement("div", { style: "display:flex;align-items:center;justify-content:space-between;padding:4px 0" },
    createElement("span", { style: "font-size:12px;color:var(--foreground)" }, label),
    createElement("button", { style: "position:relative;display:inline-flex;height:28px;width:48px;align-items:center;border-radius:var(--radius-small);border:0;background:" + (value ? "var(--sidebar-control-on)" : "var(--sidebar-control-off)") + ";cursor:pointer;transition:background 180ms", onclick: onChange },
      createElement("span", { style: "height:22px;width:22px;border-radius:calc(var(--radius-small) - 2px);background:var(--primary-foreground);box-shadow:0 2px 5px rgba(0,0,0,.2);transform:translateX(" + (value ? "23px" : "3px") + ");transition:transform 180ms" })
    )
  );
}

function renderSelect(label, value, options, onChange) {
  return createElement("div", { style: "display:flex;flex-direction:column;gap:4px" },
    createElement("label", { style: "font-family:var(--font-mono);font-size:10px;font-weight:600;letter-spacing:0.05em;color:var(--muted-foreground)" }, label),
    createElement("select", { class: "ui-input", style: "padding:6px 10px", value, onchange: (e) => onChange(e.target.value) },
      ...options.map(o => createElement("option", { value: typeof o === "string" ? o : o.id }, typeof o === "string" ? o : o.name)))
  );
}

async function renderSettings(actor, el) {
  const ctx = actor.getSnapshot().context;
  const agent = getSelectedAgent(ctx);
  if (!agent) return;
  const models = ctx.models.length > 0 ? ctx.models : [{ id: agent.model, name: agent.model }];
  const patch = (p) => { actor.send({ type: "UPDATE_AGENT", agentId: agent.agentId, patch: p }); };
  const h = createElement;
  const vdom = h("div", { style: "padding:16px;display:flex;flex-direction:column;gap:14px" },
    h("div", { style: "display:flex;align-items:center;justify-content:space-between;padding-bottom:8px" },
      h("div", null,
        h("div", { style: "font-family:var(--font-mono);font-size:9px;font-weight:500;color:var(--muted-foreground);opacity:.58" }, "SETTINGS"),
        h("div", { style: "font-size:1.1rem;font-weight:600;color:var(--foreground)" }, agent.name)),
      h("button", { class: "ui-btn-icon", onclick: () => actor.send({ type: "SHOW_PANEL", panel: null }) , innerHTML: iconHtml("x", 14) })),
    renderSelect("Intelligence", (agent.intelligenceMode === "acp" ? "acp:" + agent.acpAgent : "direct"), INTELLIGENCE_MODES, (v) => {
      if (v === "direct") patch({ intelligenceMode: "direct" });
      else { const parts = v.split(":"); patch({ intelligenceMode: "acp", acpAgent: parts[1] || "claude", acpSessionId: null }); }
    }),
    agent.intelligenceMode === "acp"
      ? h("div", { class: "ui-card", style: "padding:8px 12px;font-size:11px;color:" + (companionConnected() ? "var(--status-running-fg)" : "var(--danger-soft-fg)") },
          companionConnected() ? "Companion connected — agent will use " + agent.acpAgent + " via ACP" : "Companion not connected — start companion CLI first")
      : null,
    agent.intelligenceMode !== "acp" ? renderSelect("Model", agent.model, models, (v) => patch({ model: v })) : null,
    renderSelect("Security", agent.sessionExecSecurity, SECURITY_LEVELS, (v) => patch({ sessionExecSecurity: v })),
    renderSelect("Ask mode", agent.sessionExecAsk, ASK_MODES, (v) => patch({ sessionExecAsk: v })),
    renderSwitch("Tool calling", agent.toolCallingEnabled, () => patch({ toolCallingEnabled: !agent.toolCallingEnabled })),
    renderSwitch("Show thinking traces", agent.showThinkingTraces, () => patch({ showThinkingTraces: !agent.showThinkingTraces })),
    h("div", { style: "box-shadow:0 -1px 0 color-mix(in oklch,var(--surface-3) 60%,transparent);padding-top:12px;display:flex;flex-direction:column;gap:8px" },
      h("button", { class: "ui-btn-secondary", style: "width:100%;font-size:12px", onclick: () => {
        actor.send({ type: "UPDATE_AGENT", agentId: agent.agentId, patch: { outputLines: [], streamText: null, thinkingTrace: null, lastResult: null, draft: "", status: "idle" } });
        import("../db.js").then(db => db.saveHistory(agent.agentId, []));
      }}, "Reset session"),
      h("button", { class: "ui-btn-ghost", style: "width:100%;font-size:12px;color:var(--danger-soft-fg)", onclick: () => {
        actor.send({ type: "REMOVE_AGENT", agentId: agent.agentId });
        actor.send({ type: "SHOW_PANEL", panel: null });
        import("../db.js").then(db => db.deleteAgent(agent.agentId));
      }}, "Delete agent"))
  );
  applyDiff(el, vdom);
}

async function renderBrain(actor, el) {
  const ctx = actor.getSnapshot().context;
  const agent = getSelectedAgent(ctx);
  if (!agent) return;
  const claudeMd = await getAgentFile(agent.agentId, "CLAUDE.md");
  const personality = await getAgentFile(agent.agentId, "personality.md");
  const h = createElement;
  const vdom = h("div", { style: "padding:16px;display:flex;flex-direction:column;gap:14px" },
    h("div", { style: "display:flex;align-items:center;justify-content:space-between;padding-bottom:8px" },
      h("div", null,
        h("div", { style: "font-family:var(--font-mono);font-size:9px;font-weight:500;color:var(--muted-foreground);opacity:.58" }, "BRAIN"),
        h("div", { style: "font-size:1.1rem;font-weight:600;color:var(--foreground)" }, agent.name)),
      h("button", { class: "ui-btn-icon", onclick: () => actor.send({ type: "SHOW_PANEL", panel: null }) , innerHTML: iconHtml("x", 14) })),
    h("div", { style: "font-family:var(--font-mono);font-size:11px;font-weight:600;color:var(--muted-foreground);letter-spacing:0.05em" }, "SYSTEM PROMPT (CLAUDE.md)"),
    h("textarea", { class: "ui-input", style: "width:100%;min-height:120px;font-family:var(--font-mono);font-size:12px;resize:vertical", value: claudeMd || "",
      onblur: (e) => setAgentFile(agent.agentId, "CLAUDE.md", e.target.value) }),
    h("div", { style: "font-family:var(--font-mono);font-size:11px;font-weight:600;color:var(--muted-foreground);letter-spacing:0.05em" }, "PERSONALITY"),
    h("textarea", { class: "ui-input", style: "width:100%;min-height:80px;font-family:var(--font-mono);font-size:12px;resize:vertical", value: personality || "",
      onblur: (e) => setAgentFile(agent.agentId, "personality.md", e.target.value) }),
    h("div", { style: "font-family:var(--font-mono);font-size:11px;font-weight:600;color:var(--muted-foreground);letter-spacing:0.05em;margin-top:4px" }, "CRON JOBS"),
    h("div", { class: "ui-card", style: "padding:12px;font-size:12px;color:var(--muted-foreground)" }, "Schedule: e.g. 'every 30 minutes', 'daily at 09:00'"),
    h("div", { style: "display:flex;gap:6px" },
      h("input", { class: "ui-input", style: "flex:1;font-size:12px", id: "cron-input-" + agent.agentId, placeholder: "every 30 minutes" }),
      h("input", { class: "ui-input", style: "flex:1;font-size:12px", id: "cron-msg-" + agent.agentId, placeholder: "Message to send" }),
      h("button", { class: "ui-btn-primary", style: "font-size:11px;white-space:nowrap", onclick: () => {
        const sched = document.getElementById("cron-input-" + agent.agentId)?.value;
        const msg = document.getElementById("cron-msg-" + agent.agentId)?.value;
        if (sched && msg) startJob(agent.agentId + "-cron", sched, () => runAgent(actor, agent.agentId, msg));
      }}, "Add")),
    h("div", { style: "font-family:var(--font-mono);font-size:11px;font-weight:600;color:var(--muted-foreground);letter-spacing:0.05em;margin-top:4px" }, "CLI AGENTS (ACP)"),
    companionConnected()
      ? h("div", { style: "display:flex;flex-direction:column;gap:6px" },
          h("div", { style: "display:flex;gap:6px" },
            h("select", { class: "ui-input", style: "flex:1;font-size:12px;padding:6px 8px", id: "acp-agent-" + agent.agentId },
              h("option", { value: "claude" }, "Claude Code"), h("option", { value: "codex" }, "Codex"), h("option", { value: "openclaw" }, "OpenClaw")),
            h("button", { class: "ui-btn-primary", style: "font-size:11px;white-space:nowrap", onclick: async () => {
              const sel = document.getElementById("acp-agent-" + agent.agentId);
              if (sel) { const r = await acpSessionNew(sel.value, undefined, agent.name); actor.send({ type: "UPDATE_AGENT", agentId: agent.agentId, patch: { acpSessionId: r.id } }); renderBrain(actor, el); }
            }}, "New Session")),
          h("button", { class: "ui-btn-secondary", style: "width:100%;font-size:11px", onclick: async () => { const sessions = await acpSessionsList(); alert(sessions.length ? sessions.map(s => s.id + " [" + s.agent + "] " + s.status).join("\n") : "No active sessions"); }}, "List Sessions"))
      : h("div", { class: "ui-card", style: "padding:12px;font-size:12px;color:var(--muted-foreground)" }, "Start companion CLI to use CLI coding agents: node companion/server.js")
  );
  applyDiff(el, vdom);
}

function render(actor, el) {
  const ctx = actor.getSnapshot().context;
  if (ctx.panel === "settings") renderSettings(actor, el);
  else if (ctx.panel === "brain") renderBrain(actor, el);
  else applyDiff(el, createElement("div", null));
}

export { render };
