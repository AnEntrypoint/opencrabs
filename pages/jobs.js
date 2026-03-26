import { createElement, applyDiff } from "webjsx";
import { STORE, uid } from "../store.js";

let rootEl = null;
let editingJob = null;

function openEdit(job) {
  editingJob = job ? { ...job } : { id: uid(), name: "", cron: "0 * * * *", enabled: true, lastRun: "-", status: "pending" };
  render(rootEl);
}

function closeModal() { editingJob = null; render(rootEl); }

function saveJob() {
  const idx = STORE.jobs.findIndex(j => j.id === editingJob.id);
  if (idx >= 0) STORE.jobs[idx] = editingJob; else STORE.jobs.push(editingJob);
  closeModal();
}

function deleteJob(id) { STORE.jobs = STORE.jobs.filter(j => j.id !== id); render(rootEl); }

function toggleJob(id) {
  const j = STORE.jobs.find(j => j.id === id);
  if (j) j.enabled = !j.enabled;
  render(rootEl);
}

function statusBadge(s) {
  return s === "success" ? "badge-success" : s === "error" ? "badge-error" : "badge-ghost";
}

function render(el) {
  rootEl = el;
  const modal = editingJob ? createElement("div", { class: "fixed inset-0 bg-black/50 flex items-center justify-center z-50", onclick: (e) => { if (e.target === e.currentTarget) closeModal(); } },
    createElement("div", { class: "bg-[#16213e] p-6 rounded-xl w-96 border border-[#2a2a4a]" },
      createElement("h3", { class: "font-bold text-lg mb-4" }, STORE.jobs.find(j => j.id === editingJob.id) ? "Edit Job" : "New Job"),
      createElement("input", { class: "input input-bordered w-full mb-3", placeholder: "Job name", value: editingJob.name, oninput: (e) => { editingJob.name = e.target.value; } }),
      createElement("input", { class: "input input-bordered w-full mb-3", placeholder: "Cron (e.g. 0 9 * * *)", value: editingJob.cron, oninput: (e) => { editingJob.cron = e.target.value; } }),
      createElement("div", { class: "flex gap-2 justify-end" },
        createElement("button", { class: "btn btn-ghost", onclick: closeModal }, "Cancel"),
        createElement("button", { class: "btn btn-primary", onclick: saveJob }, "Save")))
  ) : null;

  const rows = STORE.jobs.map(j => createElement("tr", null,
    createElement("td", null, j.name),
    createElement("td", { class: "font-mono text-sm" }, j.cron),
    createElement("td", null, createElement("input", { type: "checkbox", class: "switch switch-primary", checked: j.enabled, onchange: () => toggleJob(j.id) })),
    createElement("td", null, typeof j.lastRun === "string" && j.lastRun.includes("T") ? new Date(j.lastRun).toLocaleString() : j.lastRun),
    createElement("td", null, createElement("span", { class: "badge " + statusBadge(j.status) }, j.status)),
    createElement("td", null,
      createElement("div", { class: "flex gap-1" },
        createElement("button", { class: "btn btn-xs btn-primary", onclick: () => openEdit(j) }, "Edit"),
        createElement("button", { class: "btn btn-xs btn-error btn-outline", onclick: () => deleteJob(j.id) }, "Del")))));

  const vdom = createElement("div", null,
    createElement("div", { class: "flex justify-between items-center mb-6" },
      createElement("h1", { class: "text-2xl font-bold" }, "Jobs"),
      createElement("button", { class: "btn btn-primary", onclick: () => openEdit(null) }, "+ New Job")),
    STORE.jobs.length === 0
      ? createElement("div", { class: "text-center text-gray-500 py-16" }, "No jobs configured.")
      : createElement("div", { class: "overflow-x-auto" },
          createElement("table", { class: "table table-zebra" },
            createElement("thead", null, createElement("tr", null,
              createElement("th", null, "Name"), createElement("th", null, "Schedule"), createElement("th", null, "Enabled"),
              createElement("th", null, "Last Run"), createElement("th", null, "Status"), createElement("th", null, "Actions"))),
            createElement("tbody", null, ...rows))),
    modal);
  applyDiff(el, vdom);
}

export { render };
