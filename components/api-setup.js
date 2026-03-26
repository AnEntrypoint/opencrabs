import { createElement, applyDiff } from "webjsx";
import { saveSettings } from "../db.js";
import { fetchModels } from "../llm.js";

let draftKey = "", draftOpenai = "", testing = false, testResult = null;

function init(actor) {
  const s = actor.getSnapshot().context.settings;
  draftKey = s.anthropicKey || "";
  draftOpenai = s.openaiKey || "";
}

async function doTest(actor, el) {
  testing = true; testResult = null; render(actor, el);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": draftKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({ model: "claude-haiku-4-20250506", max_tokens: 8, messages: [{ role: "user", content: "hi" }] })
    });
    testResult = r.ok ? { kind: "success", message: "Connected! API key is valid." } : { kind: "error", message: "Error " + r.status + ": " + (await r.text()).slice(0, 100) };
  } catch (e) { testResult = { kind: "error", message: e.message }; }
  testing = false; render(actor, el);
  setTimeout(() => { testResult = null; render(actor, el); }, 5000);
}

async function doSave(actor, el) {
  const settings = { ...actor.getSnapshot().context.settings, anthropicKey: draftKey.trim(), openaiKey: draftOpenai.trim() };
  actor.send({ type: "SET_SETTINGS", settings });
  await saveSettings(settings);
  actor.send({ type: "SET_MODELS_LOADING" });
  const models = await fetchModels(settings.anthropicKey, settings.openaiKey);
  actor.send({ type: "SET_MODELS", models });
  render(actor, el);
}

function render(actor, el) {
  const ctx = actor.getSnapshot().context;
  const h = createElement;
  const vdom = h("div", { style: "max-width:640px;margin:0 auto;display:flex;flex-direction:column;gap:16px;padding:32px 16px;overflow-y:auto;flex:1" },
    h("div", { style: "text-align:center;margin-bottom:8px" },
      h("div", { style: "font-size:20px;font-weight:700;color:var(--foreground)" }, "\u{1F980} OpenClaw Studio"),
      h("p", { style: "font-size:13px;color:var(--muted-foreground);margin-top:6px" }, "Browser-native AI agent platform. Bring your own API key.")
    ),
    h("div", { class: "ui-card", style: "padding:20px" },
      h("div", { style: "font-family:var(--font-mono);font-size:10px;font-weight:600;letter-spacing:0.06em;color:var(--muted-foreground);margin-bottom:12px" }, "API KEYS"),
      h("label", { style: "display:block;font-size:12px;font-weight:500;color:var(--foreground);margin-bottom:4px" }, "Anthropic API Key"),
      h("input", { class: "ui-input", type: "password", style: "width:100%;margin-bottom:12px", value: draftKey, placeholder: "sk-ant-...", oninput: (e) => { draftKey = e.target.value; } }),
      h("label", { style: "display:block;font-size:12px;font-weight:500;color:var(--foreground);margin-bottom:4px" }, "OpenAI API Key (optional)"),
      h("input", { class: "ui-input", type: "password", style: "width:100%;margin-bottom:16px", value: draftOpenai, placeholder: "sk-...", oninput: (e) => { draftOpenai = e.target.value; } }),
      h("div", { style: "display:flex;gap:8px;flex-wrap:wrap" },
        h("button", { class: "ui-btn-primary", style: "font-size:12px", disabled: !draftKey.trim(), onclick: () => doSave(actor, el) }, "Save & Load Models"),
        h("button", { class: "ui-btn-secondary", style: "font-size:12px", disabled: testing || !draftKey.trim(), onclick: () => doTest(actor, el) }, testing ? "Testing..." : "Test Connection")
      )
    ),
    testResult ? h("div", { class: testResult.kind === "error" ? "ui-alert-danger" : "ui-card", style: "padding:10px 16px;font-size:13px" }, testResult.message) : null,
    ctx.models.length > 0 ? h("div", { class: "ui-card", style: "padding:16px" },
      h("div", { style: "font-family:var(--font-mono);font-size:10px;font-weight:600;letter-spacing:0.06em;color:var(--muted-foreground);margin-bottom:8px" }, "AVAILABLE MODELS (" + ctx.models.length + ")"),
      h("div", { style: "display:flex;flex-wrap:wrap;gap:6px" },
        ...ctx.models.map(m => h("span", { class: "ui-badge", style: "background:var(--surface-2);color:var(--foreground);font-size:10px" }, (m.provider === "anthropic" ? "\u{1F980} " : "\u{1F916} ") + m.name))
      )
    ) : null,
    ctx.modelsLoading ? h("div", { style: "text-align:center;color:var(--muted-foreground);font-size:13px" }, "Loading models...") : null,
    h("p", { style: "font-size:11px;color:var(--muted-foreground);text-align:center" }, "Keys are stored locally in IndexedDB. Never sent anywhere except the API provider.")
  );
  applyDiff(el, vdom);
}

export { render, init };
