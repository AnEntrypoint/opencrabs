import { createElement, applyDiff } from "webjsx";
import { STORE, saveSettings } from "../store.js";

let rootEl = null;
let testStatus = "";

function testConnection() {
  testStatus = "testing";
  render(rootEl);
  setTimeout(() => {
    testStatus = STORE.settings.gatewayUrl ? "success" : "error";
    STORE.connected = testStatus === "success";
    render(rootEl);
    setTimeout(() => { testStatus = ""; render(rootEl); }, 3000);
  }, 1000);
}

function render(el) {
  rootEl = el;
  const statusEl = testStatus === "testing"
    ? createElement("span", { class: "text-yellow-400" }, "Testing connection...")
    : testStatus === "success"
      ? createElement("span", { class: "text-green-400" }, "Connected successfully!")
      : testStatus === "error"
        ? createElement("span", { class: "text-red-400" }, "Connection failed")
        : null;

  const vdom = createElement("div", { class: "max-w-lg" },
    createElement("h1", { class: "text-2xl font-bold mb-6" }, "Settings"),
    createElement("div", { class: "card bg-[#16213e] border border-[#2a2a4a] p-6" },
      createElement("h2", { class: "font-semibold text-lg mb-4" }, "Gateway Connection"),
      createElement("label", { class: "text-sm text-gray-400 mb-1 block" }, "Gateway URL"),
      createElement("input", { class: "input input-bordered w-full mb-4", value: STORE.settings.gatewayUrl,
        oninput: (e) => { STORE.settings.gatewayUrl = e.target.value; } }),
      createElement("label", { class: "text-sm text-gray-400 mb-1 block" }, "Auth Token"),
      createElement("input", { class: "input input-bordered w-full mb-4", type: "password", value: STORE.settings.token, placeholder: "Enter token...",
        oninput: (e) => { STORE.settings.token = e.target.value; } }),
      createElement("div", { class: "flex gap-2 items-center" },
        createElement("button", { class: "btn btn-primary", onclick: () => { saveSettings(); testConnection(); } }, "Save & Test"),
        createElement("button", { class: "btn btn-ghost", onclick: () => { saveSettings(); render(el); } }, "Save"),
        statusEl)));
  applyDiff(el, vdom);
}

export { render };
