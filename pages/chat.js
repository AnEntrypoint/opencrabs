import { createElement, applyDiff } from "webjsx";
import { STORE } from "../store.js";

let rootEl = null;
let inputVal = "";

const MOCK_RESPONSES = [
  { type: "tool", name: "web-search", input: '{"query": "latest AI news"}', output: "Found 12 results..." },
  { type: "text", content: "Based on my research, here are the key findings:\n\n1. Large language models continue to improve\n2. Agent frameworks are becoming mainstream\n3. Tool use is the primary differentiator" }
];

async function sendMessage() {
  if (!inputVal.trim()) return;
  STORE.messages.push({ role: "user", content: inputVal });
  inputVal = "";
  render(rootEl);

  await new Promise(r => setTimeout(r, 500));
  STORE.messages.push({ role: "tool", name: MOCK_RESPONSES[0].name, input: MOCK_RESPONSES[0].input, output: MOCK_RESPONSES[0].output });
  render(rootEl);

  const full = MOCK_RESPONSES[1].content;
  STORE.messages.push({ role: "assistant", content: "" });
  for (let i = 0; i < full.length; i += 3) {
    STORE.messages[STORE.messages.length - 1].content = full.slice(0, i + 3);
    render(rootEl);
    await new Promise(r => setTimeout(r, 20));
  }
  STORE.messages[STORE.messages.length - 1].content = full;
  render(rootEl);
}

function renderMessage(msg) {
  if (msg.role === "tool") {
    return createElement("div", { class: "tool-trace" },
      createElement("div", { class: "font-bold text-xs mb-1" }, "Tool: " + msg.name),
      createElement("div", { class: "text-xs opacity-70" }, msg.input),
      createElement("div", { class: "text-xs mt-1 text-green-400" }, msg.output));
  }
  return createElement("div", { class: "chat-bubble " + msg.role }, msg.content);
}

function render(el) {
  rootEl = el;
  const vdom = createElement("div", { class: "flex flex-col h-full", style: "height:calc(100vh - 56px)" },
    createElement("div", { class: "flex items-center justify-between px-4 py-3 border-b border-[#2a2a4a]" },
      createElement("h1", { class: "text-xl font-bold" }, "Chat"),
      createElement("button", { class: "btn btn-sm btn-ghost", onclick: () => { STORE.messages = []; render(el); } }, "Clear")),
    createElement("div", { class: "chat-messages flex-1" },
      STORE.messages.length === 0
        ? createElement("div", { class: "text-center text-gray-500 py-16" }, "Send a message to start a conversation.")
        : createElement("div", { class: "flex flex-col gap-3" }, ...STORE.messages.map(renderMessage))),
    createElement("div", { class: "chat-input-bar" },
      createElement("input", { class: "input input-bordered flex-1", placeholder: "Type a message...", value: inputVal,
        oninput: (e) => { inputVal = e.target.value; },
        onkeydown: (e) => { if (e.key === "Enter") sendMessage(); } }),
      createElement("button", { class: "btn btn-primary", onclick: sendMessage }, "Send")));
  applyDiff(el, vdom);
}

export { render };
