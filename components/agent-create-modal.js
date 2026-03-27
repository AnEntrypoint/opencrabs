import { createAgentConfig, uid } from "../machines.js";
import { iconHtml } from "../icons.js";
import { avatarDataUrl } from "../avatar.js";
import { saveAgent } from "../db.js";

let modalEl = null;
let modalActor = null;
let name = "New Agent";
let seed = "";
let busy = false;

function open(actor, el) {
  modalEl = el;
  modalActor = actor;
  name = "New Agent";
  seed = uid();
  busy = false;
  renderDOM();
}

function close() {
  if (modalEl) modalEl.innerHTML = "";
}

async function submit(actor) {
  if (!name.trim() || busy) return;
  busy = true;
  const agent = createAgentConfig({ name: name.trim(), avatarSeed: seed, model: actor.getSnapshot().context.settings.defaultModel });
  await saveAgent(agent);
  close();
  actor.send({ type: "ADD_AGENT", agent });
}

function renderDOM() {
  if (!modalEl) return;
  modalEl.innerHTML = "";
  const avatarSrc = avatarDataUrl(seed, 64);

  const backdrop = document.createElement("div");
  backdrop.style.cssText = "position:fixed;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);padding:16px";
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop && !busy) close(); });

  const panel = document.createElement("div");
  panel.className = "ui-panel";
  panel.style.cssText = "width:100%;max-width:520px";
  panel.addEventListener("click", (e) => e.stopPropagation());

  panel.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;box-shadow:0 1px 0 color-mix(in oklch,var(--surface-3) 40%,transparent);padding:20px 24px">'
    + '<div><div style="font-family:var(--font-mono);font-size:11px;font-weight:600;letter-spacing:0.06em;color:var(--muted-foreground)">New agent</div>'
    + '<div style="margin-top:4px;font-size:16px;font-weight:600;color:var(--foreground)">Launch agent</div>'
    + '<div style="margin-top:4px;font-size:12px;color:var(--muted-foreground)">Name it and activate immediately.</div></div>'
    + '<button class="ui-btn-ghost" style="font-family:var(--font-mono);font-size:11px;font-weight:600" id="modal-close">Close</button></div>'
    + '<div style="display:grid;gap:14px;padding:20px 24px">'
    + '<label style="font-family:var(--font-mono);font-size:11px;font-weight:600;letter-spacing:0.05em;color:var(--muted-foreground)">Name<input class="ui-input" id="modal-name" style="display:block;width:100%;margin-top:4px" value="' + name.replace(/"/g, '&quot;') + '"></label>'
    + '<div style="display:grid;justify-items:center;gap:8px;padding-top:12px">'
    + '<div style="font-family:var(--font-mono);font-size:11px;font-weight:600;color:var(--muted-foreground)">Choose avatar</div>'
    + '<img src="' + avatarSrc + '" width="64" height="64" style="border-radius:var(--radius-small)">'
    + '<button class="ui-btn-secondary" style="font-size:12px;display:inline-flex;align-items:center;gap:6px" id="modal-shuffle">' + iconHtml("shuffle", 14) + ' Shuffle</button></div></div>'
    + '<div style="display:flex;align-items:center;justify-content:space-between;box-shadow:0 -1px 0 color-mix(in oklch,var(--surface-3) 45%,transparent);padding:16px 24px">'
    + '<div style="font-size:11px;color:var(--muted-foreground)">Authority can be configured after launch.</div>'
    + '<button class="ui-btn-primary" style="font-size:11px" id="modal-launch">Launch agent</button></div>';

  backdrop.appendChild(panel);
  modalEl.appendChild(backdrop);

  panel.querySelector("#modal-close").addEventListener("click", close);
  panel.querySelector("#modal-name").addEventListener("input", (e) => { name = e.target.value; });
  panel.querySelector("#modal-shuffle").addEventListener("click", () => { seed = uid(); renderDOM(); });
  panel.querySelector("#modal-launch").addEventListener("click", () => { if (modalActor) submit(modalActor); });
}

function render(actor, el) {
  modalEl = el;
  if (el) {
    const launchBtn = el.querySelector("#modal-launch");
    if (launchBtn && !launchBtn._wired) {
      launchBtn._wired = true;
      launchBtn.addEventListener("click", () => submit(actor));
    }
  }
}

export { render, open, close };
