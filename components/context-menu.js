import { createElement, applyDiff } from "webjsx";

let menuState = { open: false, x: 0, y: 0, items: [], el: null };

function onKeyDown(e) { if (e.key === "Escape") hide(); }
function onClickOutside() { hide(); }

function show(e, items, el) {
  e.preventDefault();
  e.stopPropagation();
  const vw = window.innerWidth, vh = window.innerHeight;
  let x = e.clientX, y = e.clientY;
  if (x + 200 > vw) x = vw - 210;
  if (y + items.length * 38 + 16 > vh) y = vh - items.length * 38 - 20;
  menuState = { open: true, x, y, items, el };
  render();
  requestAnimationFrame(() => {
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("contextmenu", onClickOutside);
  });
}

function hide() {
  if (!menuState.open) return;
  document.removeEventListener("keydown", onKeyDown);
  document.removeEventListener("mousedown", onClickOutside);
  document.removeEventListener("contextmenu", onClickOutside);
  menuState.open = false;
  render();
}

function render() {
  if (!menuState.el) return;
  if (!menuState.open) { applyDiff(menuState.el, createElement("div", null)); return; }
  const vdom = createElement("div", {
    style: "position:fixed;inset:0;z-index:9998",
    onmousedown: (e) => { if (e.target === e.currentTarget) { e.preventDefault(); hide(); } }
  },
    createElement("div", {
      class: "ui-context-menu",
      style: "left:" + menuState.x + "px;top:" + menuState.y + "px",
      onmousedown: (e) => e.stopPropagation()
    },
      ...menuState.items.map((item) => {
        if (item.sep) return createElement("div", { class: "ui-context-menu-sep" });
        return createElement("button", {
          class: "ui-context-menu-item" + (item.danger ? " danger" : ""),
          onclick: () => { hide(); if (item.action) item.action(); }
        }, item.icon ? createElement("span", { style: "opacity:.7;font-size:14px" }, item.icon) : null, item.label);
      })
    )
  );
  applyDiff(menuState.el, vdom);
}

function init(el) { menuState.el = el; }

export { show, hide, init };
