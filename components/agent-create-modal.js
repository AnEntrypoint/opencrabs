import { createElement, applyDiff } from "webjsx";
import { createAgentConfig, uid } from "../machines.js";
import { avatarDataUrl } from "../avatar.js";
import { saveAgent } from "../db.js";

let modalState = { open: false, name: "New Agent", avatarSeed: "", busy: false };

function open(el) {
  modalState = { open: true, name: "New Agent", avatarSeed: uid(), busy: false };
  render(null, el);
}

function close(el) { modalState.open = false; render(null, el); }

async function submit(actor, el) {
  if (!modalState.name.trim() || modalState.busy) return;
  modalState.busy = true; render(actor, el);
  const agent = createAgentConfig({ name: modalState.name.trim(), avatarSeed: modalState.avatarSeed, model: actor.getSnapshot().context.settings.defaultModel });
  await saveAgent(agent);
  modalState.open = false; modalState.busy = false;
  actor.send({ type: "ADD_AGENT", agent });
}

function render(actor, el) {
  if (!el) return;
  if (!modalState.open) { applyDiff(el, createElement("div", null)); return; }
  const avatarSrc = avatarDataUrl(modalState.avatarSeed, 64);
  const h = createElement;
  const vdom = h("div", {
    style: "position:fixed;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);padding:16px",
    onclick: (e) => { if (e.target === e.currentTarget && !modalState.busy) close(el); }
  },
    h("div", { class: "ui-panel", style: "width:100%;max-width:520px", onclick: (e) => e.stopPropagation() },
      h("div", { style: "display:flex;align-items:center;justify-content:space-between;box-shadow:0 1px 0 color-mix(in oklch,var(--surface-3) 40%,transparent);padding:20px 24px" },
        h("div", null,
          h("div", { style: "font-family:var(--font-mono);font-size:11px;font-weight:600;letter-spacing:0.06em;color:var(--muted-foreground)" }, "New agent"),
          h("div", { style: "margin-top:4px;font-size:16px;font-weight:600;color:var(--foreground)" }, "Launch agent"),
          h("div", { style: "margin-top:4px;font-size:12px;color:var(--muted-foreground)" }, "Name it and activate immediately.")),
        h("button", { class: "ui-btn-ghost", style: "font-family:var(--font-mono);font-size:11px;font-weight:600", onclick: () => close(el), disabled: modalState.busy }, "Close")),
      h("div", { style: "display:grid;gap:14px;padding:20px 24px" },
        h("label", { style: "font-family:var(--font-mono);font-size:11px;font-weight:600;letter-spacing:0.05em;color:var(--muted-foreground)" }, "Name",
          h("input", { class: "ui-input", style: "display:block;width:100%;margin-top:4px", value: modalState.name, oninput: (e) => { modalState.name = e.target.value; } })),
        h("div", { style: "display:grid;justify-items:center;gap:8px;padding-top:12px" },
          h("div", { style: "font-family:var(--font-mono);font-size:11px;font-weight:600;color:var(--muted-foreground)" }, "Choose avatar"),
          h("img", { src: avatarSrc, width: "64", height: "64", style: "border-radius:var(--radius-small)" }),
          h("button", { class: "ui-btn-secondary", style: "font-size:12px;gap:6px;display:inline-flex;align-items:center", onclick: () => { modalState.avatarSeed = uid(); render(actor, el); }, disabled: modalState.busy }, "\u21BB Shuffle"))),
      h("div", { style: "display:flex;align-items:center;justify-content:space-between;box-shadow:0 -1px 0 color-mix(in oklch,var(--surface-3) 45%,transparent);padding:16px 24px" },
        h("div", { style: "font-size:11px;color:var(--muted-foreground)" }, "Authority can be configured after launch."),
        h("button", { class: "ui-btn-primary", style: "font-size:11px", onclick: () => submit(actor, el), disabled: !modalState.name.trim() || modalState.busy }, modalState.busy ? "Launching..." : "Launch agent")))
  );
  applyDiff(el, vdom);
}

export { render, open, close };
