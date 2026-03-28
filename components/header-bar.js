import { createElement, applyDiff } from "webjsx";
import { isConnected as companionConnected } from "../companion-client.js";
import { iconHtml } from "../icons.js";

let menuOpen = false;

function render(actor, el) {
  const ctx = actor.getSnapshot().context;
  const hasKey = !!ctx.settings.anthropicKey;
  const h = createElement;
  const I = (name, sz) => h("span", { innerHTML: iconHtml(name, sz || 14), style: "display:inline-flex;align-items:center" });
  const vdom = h("div", { class: "ui-topbar", style: "position:relative;z-index:180" },
    h("div", { style: "display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;height:40px;padding:0 16px" },
      h("div", null),
      h("p", { style: "font-size:14px;font-weight:600;color:var(--foreground);letter-spacing:0.01em" }, "\u{1F980} OpenCrabs"),
      h("div", { style: "display:flex;align-items:center;justify-content:flex-end;gap:6px" },
        h("span", { class: "ui-chip " + (hasKey ? "ui-badge-status-connected" : "ui-badge-status-disconnected"), style: "font-size:9px" }, hasKey ? "API Ready" : "No API Key"),
        h("span", { id: "sh-companion-dot", class: "ui-chip ui-badge-status-disconnected", style: "font-size:9px" }, "companion"),
        h("span", { id: "sh-wc-dot", class: "ui-chip ui-badge-status-" + (ctx.wcStatus === 'ready' ? 'running' : (ctx.wcStatus === 'booting' || ctx.wcStatus === 'installing-node') ? 'connecting' : 'disconnected'), style: "font-size:9px" }, ctx.wcStatus === 'installing-node' ? 'installing' : ctx.wcStatus),
        h("span", { id: "sh-ext-dot", class: "ui-chip ui-badge-status-disconnected", style: "font-size:9px" }, "ext"),
        h("button", { class: "ui-btn-icon", style: "font-size:11px;padding:4px 8px", onclick: () => { actor.send({ type: "SHOW_SHELL", show: !ctx.showShell }) } }, ctx.showShell ? "Chat" : "Shell"),
        companionConnected() ? h("span", { class: "ui-chip ui-badge-status-running", style: "font-size:9px;display:inline-flex;align-items:center;gap:4px" }, I("terminal", 10), "CLI") : null,
        h("button", { class: "ui-btn-icon", onclick: () => {
          actor.send({ type: "SET_THEME", theme: ctx.theme === "dark" ? "light" : "dark" });
          document.documentElement.classList.toggle("dark", ctx.theme !== "dark");
        }}, I(ctx.theme === "dark" ? "sun" : "moon")),
        h("div", { style: "position:relative;z-index:210" },
          h("button", { class: "ui-btn-icon", onclick: (e) => { e.stopPropagation(); menuOpen = !menuOpen; if (menuOpen) { const close = () => { menuOpen = false; render(actor, el); document.removeEventListener('click', close); }; document.addEventListener('click', close); } render(actor, el); } }, I("settings")),
          menuOpen ? h("div", { class: "ui-card ui-menu-popover", style: "position:absolute;right:0;top:32px;min-width:176px;padding:4px;z-index:260" },
            h("button", { class: "ui-btn-ghost", style: "width:100%;justify-content:flex-start;padding:8px 12px;font-size:12px;font-weight:500;gap:8px;display:inline-flex;align-items:center",
              onclick: () => { menuOpen = false; actor.send({ type: "SHOW_API_SETUP", show: true }); }
            }, I("key", 14), "API Settings"),
            h("button", { class: "ui-btn-ghost", style: "width:100%;justify-content:flex-start;padding:8px 12px;font-size:12px;font-weight:500;gap:8px;display:inline-flex;align-items:center",
              onclick: async () => { menuOpen = false; const { exportAll } = await import("../db.js"); const data = await exportAll(); const b = new Blob([data], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "opencrabs-export.json"; a.click(); }
            }, I("package", 14), "Export Data")
          ) : null
        )
      )
    )
  );
  applyDiff(el, vdom);
}

export { render };
