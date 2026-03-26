import { createElement, applyDiff } from "webjsx";

let menuOpen = false;

function render(actor, el) {
  const ctx = actor.getSnapshot().context;
  const hasKey = !!ctx.settings.anthropicKey;
  const h = createElement;
  const vdom = h("div", { class: "ui-topbar", style: "position:relative;z-index:180" },
    h("div", { style: "display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;height:40px;padding:0 16px" },
      h("div", null),
      h("p", { style: "font-size:14px;font-weight:600;color:var(--foreground);letter-spacing:0.01em" }, "\u{1F980} OpenClaw Studio"),
      h("div", { style: "display:flex;align-items:center;justify-content:flex-end;gap:6px" },
        h("span", { class: "ui-chip " + (hasKey ? "ui-badge-status-connected" : "ui-badge-status-disconnected"), style: "font-size:9px" }, hasKey ? "API Ready" : "No API Key"),
        h("button", { class: "ui-btn-icon", onclick: () => {
          actor.send({ type: "SET_THEME", theme: ctx.theme === "dark" ? "light" : "dark" });
          document.documentElement.classList.toggle("dark", ctx.theme !== "dark");
        }}, ctx.theme === "dark" ? "\u2600" : "\u263E"),
        h("div", { style: "position:relative;z-index:210" },
          h("button", { class: "ui-btn-icon", onclick: () => { menuOpen = !menuOpen; render(actor, el); } }, "\u2699"),
          menuOpen ? h("div", { class: "ui-card ui-menu-popover", style: "position:absolute;right:0;top:32px;min-width:176px;padding:4px;z-index:260" },
            h("button", { class: "ui-btn-ghost", style: "width:100%;justify-content:flex-start;padding:8px 12px;font-size:12px;font-weight:500",
              onclick: () => { menuOpen = false; actor.send({ type: "SHOW_API_SETUP", show: true }); }
            }, "\u{1F511} API Settings"),
            h("button", { class: "ui-btn-ghost", style: "width:100%;justify-content:flex-start;padding:8px 12px;font-size:12px;font-weight:500",
              onclick: async () => { menuOpen = false; const { exportAll } = await import("../db.js"); const data = await exportAll(); const b = new Blob([data], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "openclaw-export.json"; a.click(); }
            }, "\u{1F4E6} Export Data")
          ) : null
        )
      )
    )
  );
  applyDiff(el, vdom);
}

export { render };
