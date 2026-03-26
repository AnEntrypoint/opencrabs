import { createElement, applyDiff } from "webjsx";
import { getRoute, navigate, onRouteChange, init as initRouter } from "./router.js";
import { STORE } from "./store.js";

const pages = {};
const NAV = [
  { id: "agents", label: "Agents", icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v-2h4m14 0a6 6 0 01-6 6" },
  { id: "chat", label: "Chat", icon: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" },
  { id: "jobs", label: "Jobs", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
  { id: "settings", label: "Settings", icon: "M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" }
];

function svgIcon(d) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", d);
  svg.appendChild(path);
  return svg;
}

async function loadPage(id) {
  if (!pages[id]) {
    const mod = await import("./pages/" + id + ".js");
    pages[id] = mod;
  }
  return pages[id];
}

function renderShell(route) {
  const app = document.getElementById("app");
  const vdom = createElement("div", { class: "app-layout" },
    createElement("aside", { class: "sidebar" },
      createElement("div", { class: "sidebar-brand" }, "\u2756 OpenClaw"),
      createElement("nav", { class: "sidebar-nav" },
        ...NAV.map(n => createElement("a", {
          class: "sidebar-link" + (route === n.id ? " active" : ""),
          href: "#" + n.id,
          onclick: (e) => { e.preventDefault(); navigate(n.id); }
        }, n.label)))),
    createElement("div", { class: "main-content" },
      createElement("div", { class: "topbar" },
        createElement("span", { class: "text-sm text-gray-400" }, "OpenClaw Studio"),
        createElement("div", { class: "flex items-center gap-2" },
          createElement("span", { class: "status-dot " + (STORE.connected ? "online" : "offline") }),
          createElement("span", { class: "text-sm" }, STORE.connected ? "Connected" : "Disconnected"))),
      createElement("div", { class: "page-area", id: "page-content" })));
  applyDiff(app, vdom);

  NAV.forEach(n => {
    const link = app.querySelector('a[href="#' + n.id + '"]');
    if (link && !link.querySelector("svg")) {
      link.prepend(svgIcon(n.icon));
    }
  });
}

async function renderPage(route) {
  renderShell(route);
  const container = document.getElementById("page-content");
  const page = await loadPage(route);
  page.render(container);
}

initRouter();
onRouteChange(renderPage);
renderPage(getRoute());
