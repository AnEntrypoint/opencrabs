import { createElement, applyDiff } from "webjsx";
import { getSelectedAgent } from "../machines.js";
import { avatarDataUrl } from "../avatar.js";
import { runAgent, abortAgent } from "../agent-runner.js";
import { show as showCtx } from "./context-menu.js";

const INTROS = ["How can I help you today?", "What should we accomplish today?", "Ready when you are.", "What are we working on?", "I'm here and ready. What's the plan?"];
function introMsg(id) { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return INTROS[h % INTROS.length]; }

function msgCtx(e, text, agentId, isUser, actor) {
  const items = [{ icon: "\u{1F4CB}", label: "Copy text", action: () => navigator.clipboard.writeText(text).catch(() => {}) }];
  if (isUser) items.push({ icon: "\u{1F504}", label: "Retry message", action: () => runAgent(actor, agentId, text) });
  showCtx(e, items, document.getElementById("oc-ctx"));
}

function renderApproval(ap, actor) {
  return createElement("div", { class: "ui-card", style: "padding:12px 16px;box-shadow:inset 3px 0 0 var(--status-approval-bg),var(--shadow-xs)" },
    createElement("div", { style: "font-family:var(--font-mono);font-size:10px;font-weight:600;color:var(--status-approval-fg);letter-spacing:0.06em;margin-bottom:6px" }, "EXEC APPROVAL REQUIRED"),
    createElement("div", { class: "ui-command-surface", style: "padding:8px 12px;font-family:var(--font-mono);font-size:12px;margin-bottom:8px;overflow-x:auto;white-space:pre" }, ap.command),
    createElement("div", { style: "display:flex;gap:6px" },
      createElement("button", { class: "ui-btn-primary", style: "font-size:11px;padding:4px 10px;min-height:28px", onclick: () => actor.send({ type: "RESOLVE_APPROVAL", id: ap.id, decision: "allow-once" }) }, "Allow once"),
      createElement("button", { class: "ui-btn-secondary", style: "font-size:11px;padding:4px 10px;min-height:28px", onclick: () => actor.send({ type: "RESOLVE_APPROVAL", id: ap.id, decision: "allow-always" }) }, "Allow always"),
      createElement("button", { class: "ui-btn-ghost", style: "font-size:11px;padding:4px 10px;min-height:28px;color:var(--danger-soft-fg)", onclick: () => actor.send({ type: "RESOLVE_APPROVAL", id: ap.id, decision: "deny" }) }, "Deny")
    )
  );
}

function renderMsg(line, agentId, actor) {
  if (line.startsWith("user: ")) {
    const t = line.slice(6);
    return createElement("div", { style: "align-self:flex-end;max-width:65%;padding:10px 14px;border-radius:16px 16px 4px 16px;background:var(--chat-user-bg);font-size:13px;line-height:1.55;box-shadow:var(--shadow-2xs)", oncontextmenu: (e) => msgCtx(e, t, agentId, true, actor) }, t);
  }
  if (line.startsWith("assistant: ")) {
    const t = line.slice(11);
    return createElement("div", { style: "max-width:68ch;padding:12px 16px;border-radius:4px 16px 16px 16px;background:var(--chat-assistant-bg);font-size:13px;line-height:1.6;white-space:pre-wrap;box-shadow:var(--shadow-2xs)", oncontextmenu: (e) => msgCtx(e, t, agentId, false, actor) }, t);
  }
  if (line.startsWith("tool: ")) return createElement("div", { class: "ui-command-surface", style: "padding:8px 12px;font-family:var(--font-mono);font-size:12px" }, "\u{1F527} " + line.slice(6));
  return createElement("div", { style: "font-size:12px;color:var(--muted-foreground);font-family:var(--font-mono)" }, line);
}

function render(actor, el) {
  const ctx = actor.getSnapshot().context;
  const agent = getSelectedAgent(ctx);
  if (!agent) { applyDiff(el, createElement("div", { style: "display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted-foreground)" }, "Select an agent to begin.")); return; }
  const approvals = ctx.pendingApprovals.filter(a => a.agentId === agent.agentId);
  const avatarSrc = avatarDataUrl(agent.avatarSeed || agent.agentId, 32);
  const hasOutput = agent.outputLines.length > 0 || agent.streamText || agent.thinkingTrace;
  const h = createElement;

  const header = h("div", { style: "display:flex;align-items:center;gap:10px;padding:12px 16px;background:color-mix(in oklch,var(--surface-1) 92%,var(--surface-0));box-shadow:var(--shadow-2xs)" },
    h("img", { src: avatarSrc, width: "32", height: "32", style: "border-radius:var(--radius-small)" }),
    h("div", { style: "flex:1;min-width:0" }, h("p", { style: "font-size:14px;font-weight:600;color:var(--foreground)" }, agent.name), h("p", { style: "font-size:11px;color:var(--muted-foreground)" }, agent.model)),
    h("div", { style: "display:flex;gap:4px" },
      h("button", { class: "ui-btn-icon", style: "font-size:12px", onclick: () => actor.send({ type: "SHOW_PANEL", panel: "settings" }) }, "\u2699"),
      h("button", { class: "ui-btn-icon", style: "font-size:12px", onclick: () => actor.send({ type: "SHOW_PANEL", panel: "brain" }) }, "\u{1F9E0}"))
  );

  const msgs = h("div", { id: "oc-chat-scroll", style: "flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px" },
    !hasOutput ? h("div", { style: "display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;gap:12px" },
      h("img", { src: avatarSrc, width: "48", height: "48", style: "border-radius:var(--radius-small);opacity:0.7" }),
      h("p", { style: "font-size:14px;color:var(--muted-foreground)" }, introMsg(agent.agentId))
    ) : null,
    ...agent.outputLines.map(l => renderMsg(l, agent.agentId, actor)),
    ...approvals.map(ap => renderApproval(ap, actor)),
    agent.thinkingTrace ? h("div", { style: "max-width:68ch;padding:10px 14px;border-radius:12px;background:color-mix(in oklch,var(--primary) 8%,transparent);font-size:12px;font-style:italic;color:var(--muted-foreground);box-shadow:var(--shadow-2xs)" }, "\u{1F4AD} " + agent.thinkingTrace) : null,
    agent.streamText ? h("div", { style: "max-width:68ch;padding:12px 16px;border-radius:4px 16px 16px 16px;background:var(--chat-assistant-bg);font-size:13px;line-height:1.6;white-space:pre-wrap;box-shadow:var(--shadow-2xs)" }, agent.streamText + "\u258C") : null
  );

  const doSend = () => {
    const msg = agent.draft?.trim();
    if (!msg) return;
    actor.send({ type: "UPDATE_AGENT", agentId: agent.agentId, patch: { draft: "" } });
    runAgent(actor, agent.agentId, msg);
  };

  const input = h("div", { style: "display:flex;gap:8px;padding:12px 16px;background:color-mix(in oklch,var(--surface-1) 94%,var(--surface-0));box-shadow:0 -2px 8px rgba(0,0,0,.04)" },
    h("input", { class: "ui-input", style: "flex:1", placeholder: "Message " + agent.name + "...", value: agent.draft || "",
      oninput: (e) => actor.send({ type: "UPDATE_AGENT", agentId: agent.agentId, patch: { draft: e.target.value } }),
      onkeydown: (e) => { if (e.key === "Enter") doSend(); }
    }),
    agent.status === "running"
      ? h("button", { class: "ui-btn-ghost", style: "color:var(--danger-soft-fg);font-size:12px", onclick: () => { abortAgent(agent.agentId); actor.send({ type: "UPDATE_AGENT", agentId: agent.agentId, patch: { status: "idle", streamText: null, thinkingTrace: null } }); } }, "\u25A0 Stop")
      : h("button", { class: "ui-btn-primary", style: "font-size:12px", onclick: doSend }, "Send")
  );

  applyDiff(el, h("div", { style: "display:flex;flex-direction:column;height:100%" }, header, msgs, input));
  const scroll = document.getElementById("oc-chat-scroll");
  if (scroll) scroll.scrollTop = scroll.scrollHeight;
}

export { render };
