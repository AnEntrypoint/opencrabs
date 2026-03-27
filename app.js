import { createElement, applyDiff } from "webjsx";
import { createActor } from "xstate";
import { appMachine, createAgentConfig, uid } from "./machines.js";
import { loadSettings, loadAgents, saveSettings } from "./db.js";
import { fetchModels } from "./llm.js";
import { render as renderHeader } from "./components/header-bar.js";
import { render as renderSidebar } from "./components/fleet-sidebar.js";
import { render as renderChat } from "./components/agent-chat-panel.js";
import { render as renderInspect } from "./components/agent-inspect-panels.js";
import { render as renderApiSetup, init as initApiSetup } from "./components/api-setup.js";
import { render as renderModal, open as openModal } from "./components/agent-create-modal.js";
import { init as initCtx } from "./components/context-menu.js";
import { mount as mountShell } from "./components/shell-panel.js";

const actor = createActor(appMachine);
let els = {};

function mount() {
  const app = document.getElementById("app");
  const h = createElement;
  applyDiff(app, h("div", null,
    h("div", { id: "oc-header" }),
    h("div", { class: "app-layout", style: "height:calc(100vh - 41px)" },
      h("div", { class: "sidebar-area", id: "oc-sidebar" }),
      h("div", { class: "main-area", id: "oc-main" },
        h("div", { class: "chat-area", id: "oc-chat", style: "display:none" }),
        h("div", { id: "oc-shell", style: "display:none;flex:1;overflow:hidden" }),
        h("div", { id: "oc-api-setup", style: "display:none;flex:1;overflow-y:auto" })),
      h("div", { class: "inspect-area", id: "oc-inspect", style: "display:none" })),
    h("div", { id: "oc-modal" }),
    h("div", { id: "oc-ctx" })
  ));
  els = {
    header: document.getElementById("oc-header"),
    sidebar: document.getElementById("oc-sidebar"),
    chat: document.getElementById("oc-chat"),
    apiSetup: document.getElementById("oc-api-setup"),
    inspect: document.getElementById("oc-inspect"),
    modal: document.getElementById("oc-modal"),
    shell: document.getElementById("oc-shell"),
  };
}

function renderAll() {
  const ctx = actor.getSnapshot().context;
  renderHeader(actor, els.header);
  renderSidebar(actor, els.sidebar, () => openModal(actor, els.modal));
  if (ctx.showShell) {
    els.chat.style.display = "none";
    els.apiSetup.style.display = "none";
    els.shell.style.display = "flex";
    if (!els.shell._mounted) { mountShell(els.shell, actor); els.shell._mounted = true; }
  } else if (ctx.showApiSetup) {
    els.chat.style.display = "none";
    els.apiSetup.style.display = "flex";
    els.shell.style.display = "none";
    renderApiSetup(actor, els.apiSetup);
  } else {
    els.chat.style.display = "flex";
    els.apiSetup.style.display = "none";
    els.shell.style.display = "none";
    renderChat(actor, els.chat);
  }
  if (ctx.panel) {
    els.inspect.style.display = "block";
    renderInspect(actor, els.inspect);
  } else {
    els.inspect.style.display = "none";
  }
  renderModal(actor, els.modal);
}

async function boot() {
  const settings = await loadSettings();
  const agents = await loadAgents();
  actor.send({ type: "SET_SETTINGS", settings });
  document.documentElement.classList.toggle("dark", settings.theme !== "light");

  if (agents.length > 0) {
    actor.send({ type: "HYDRATE_AGENTS", agents });
    if (settings.anthropicKey) actor.send({ type: "SHOW_API_SETUP", show: false });
  } else {
    const defaults = [
      createAgentConfig({ name: "research-bot", avatarSeed: "research-bot", model: settings.defaultModel }),
      createAgentConfig({ name: "deploy-agent", avatarSeed: "deploy-agent", model: settings.defaultModel }),
      createAgentConfig({ name: "data-pipeline", avatarSeed: "data-pipeline", model: settings.defaultModel }),
    ];
    actor.send({ type: "HYDRATE_AGENTS", agents: defaults });
  }

  if (settings.anthropicKey || settings.openaiKey) {
    actor.send({ type: "SET_MODELS_LOADING" });
    const models = await fetchModels(settings.anthropicKey, settings.openaiKey);
    actor.send({ type: "SET_MODELS", models });
  }
}

mount();
initCtx(document.getElementById("oc-ctx"));
actor.subscribe(renderAll);
actor.start();
initApiSetup(actor);
boot().then(renderAll);
