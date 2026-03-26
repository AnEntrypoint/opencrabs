const PROXY_URL = "https://api.allorigins.win/raw?url=";
let iframeEl = null;
let currentUrl = "";
let proxyMode = false;

function setIframe(el) { iframeEl = el; }
function getIframe() { return iframeEl; }
function getCurrentUrl() { return currentUrl; }

async function navigate(url) {
  if (!iframeEl) return "No iframe available";
  currentUrl = url;
  proxyMode = false;
  return new Promise((resolve) => {
    iframeEl.onload = () => {
      try { const _ = iframeEl.contentDocument; resolve("Navigated to " + url); }
      catch { proxyMode = true; resolve("Navigated to " + url + " (cross-origin — using proxy for DOM access)"); }
    };
    iframeEl.onerror = () => resolve("Failed to load " + url);
    iframeEl.src = url;
    setTimeout(() => resolve("Navigation timeout — page may still be loading"), 15000);
  });
}

async function navigateProxy(url) {
  if (!iframeEl) return "No iframe available";
  currentUrl = url;
  proxyMode = true;
  try {
    const resp = await fetch(PROXY_URL + encodeURIComponent(url));
    if (!resp.ok) return "Proxy fetch failed: " + resp.status;
    let html = await resp.text();
    const base = new URL(url);
    html = html.replace(/<head>/i, '<head><base href="' + base.origin + '/">');
    const blob = new Blob([html], { type: "text/html" });
    iframeEl.src = URL.createObjectURL(blob);
    return new Promise(resolve => {
      iframeEl.onload = () => resolve("Navigated via proxy to " + url);
      setTimeout(() => resolve("Proxy navigation timeout"), 10000);
    });
  } catch (e) { return "Proxy error: " + e.message; }
}

function getDoc() {
  if (!iframeEl) return null;
  try { return iframeEl.contentDocument; } catch { return null; }
}

function snapshot() {
  const doc = getDoc();
  if (!doc) return "Cannot access iframe DOM (cross-origin). Use navigate_proxy to load via CORS proxy.";
  const els = doc.querySelectorAll("a, button, input, select, textarea, [role='button'], [onclick]");
  const items = [];
  let idx = 0;
  els.forEach(el => {
    if (el.offsetParent === null && el.tagName !== "INPUT") return;
    idx++;
    const tag = el.tagName.toLowerCase();
    const type = el.type ? ' type="' + el.type + '"' : "";
    const text = (el.textContent || "").trim().slice(0, 60);
    const val = el.value ? ' value="' + el.value.slice(0, 30) + '"' : "";
    const href = el.href ? ' href="' + el.href.slice(0, 80) + '"' : "";
    const name = el.name ? ' name="' + el.name + '"' : "";
    const id = el.id ? ' id="' + el.id + '"' : "";
    const placeholder = el.placeholder ? ' placeholder="' + el.placeholder + '"' : "";
    items.push("@e" + idx + " [" + tag + type + id + name + href + val + placeholder + "]" + (text ? ' "' + text + '"' : ""));
    el.dataset.ocRef = "e" + idx;
  });
  return items.length ? items.join("\n") : "No interactive elements found.";
}

function getRefEl(ref) {
  const doc = getDoc();
  if (!doc) return null;
  const id = ref.replace("@", "");
  return doc.querySelector('[data-oc-ref="' + id + '"]');
}

function click(selector) {
  const doc = getDoc();
  if (!doc) return "Cannot access iframe DOM.";
  const el = selector.startsWith("@") ? getRefEl(selector) : doc.querySelector(selector);
  if (!el) return "Element not found: " + selector;
  el.click();
  return "Clicked: " + (el.textContent || el.tagName).trim().slice(0, 60);
}

function fill(selector, text) {
  const doc = getDoc();
  if (!doc) return "Cannot access iframe DOM.";
  const el = selector.startsWith("@") ? getRefEl(selector) : doc.querySelector(selector);
  if (!el) return "Element not found: " + selector;
  el.value = text;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return "Filled " + (el.name || el.id || el.tagName) + " with: " + text.slice(0, 50);
}

function evalJs(code) {
  const doc = getDoc();
  if (!doc) return "Cannot access iframe DOM.";
  try {
    const win = iframeEl.contentWindow;
    const result = win.eval(code);
    return String(result).slice(0, 4000);
  } catch (e) { return "Eval error: " + e.message; }
}

function getText(selector) {
  const doc = getDoc();
  if (!doc) return "Cannot access iframe DOM.";
  const el = selector ? doc.querySelector(selector) : doc.body;
  if (!el) return "Element not found: " + selector;
  return (el.innerText || el.textContent || "").slice(0, 4000);
}

function getUrl() {
  if (proxyMode) return currentUrl;
  try { return iframeEl?.contentWindow?.location?.href || currentUrl; }
  catch { return currentUrl; }
}

function getPageTitle() {
  const doc = getDoc();
  if (!doc) return currentUrl;
  return doc.title || currentUrl;
}

export { setIframe, getIframe, getCurrentUrl, navigate, navigateProxy, snapshot, click, fill, evalJs, getText, getUrl, getPageTitle, getDoc };
