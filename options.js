// === GPT Mini — settings ===

const MODELS = [
  { id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC", label: "Qwen2.5 0.5B — tiny & fastest (~0.4 GB)" },
  { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", label: "Llama 3.2 1B — default, fast (~0.9 GB)" },
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", label: "Llama 3.2 3B — best quality (~1.9 GB)" }
];
const DEFAULT_MODEL = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

const els = {
  model: document.getElementById("model"),
  save: document.getElementById("save"),
  download: document.getElementById("download"),
  status: document.getElementById("status"),
  progressWrap: document.getElementById("progressWrap"),
  progressBar: document.getElementById("progressBar"),
  progressText: document.getElementById("progressText"),
  clear: document.getElementById("clear"),
  modelNote: document.getElementById("modelNote")
};

for (const m of MODELS) {
  const opt = document.createElement("option");
  opt.value = m.id;
  opt.textContent = m.label;
  els.model.appendChild(opt);
}

function setStatus(text, kind = "") {
  els.status.textContent = text || "";
  els.status.className = "status" + (kind ? " " + kind : "");
}

function setProgress(p, text) {
  els.progressWrap.hidden = false;
  if (typeof p === "number" && isFinite(p)) {
    els.progressBar.style.width = Math.max(0, Math.min(100, p * 100)) + "%";
    els.progressBar.classList.remove("indeterminate");
  } else {
    els.progressBar.classList.add("indeterminate");
  }
  els.progressText.textContent = text || "";
}

// Load saved model
chrome.storage.local.get({ model: DEFAULT_MODEL }, ({ model }) => {
  els.model.value = MODELS.some((m) => m.id === model) ? model : DEFAULT_MODEL;
  els.modelNote.textContent = "Selected: " + els.model.value;
});

els.model.addEventListener("change", () => {
  els.modelNote.textContent = "Selected: " + els.model.value;
});

els.save.addEventListener("click", () => {
  chrome.storage.local.set({ model: els.model.value }, () => {
    setStatus("Saved.", "ok");
    setTimeout(() => setStatus(""), 1500);
  });
});

els.download.addEventListener("click", () => {
  // Save the selection first so the engine loads the model the user picked.
  chrome.storage.local.set({ model: els.model.value }, () => {
    els.download.disabled = true;
    setStatus("");
    setProgress(undefined, "Connecting…");

    const port = chrome.runtime.connect({ name: "gptmini" });
    port.onMessage.addListener((m) => {
      if (m.type === "progress") {
        setProgress(m.progress, m.text || "Loading…");
      } else if (m.type === "done") {
        setProgress(1, "Ready ✓ — model cached.");
        setStatus("Model ready.", "ok");
        els.download.disabled = false;
        try { port.disconnect(); } catch {}
      } else if (m.type === "error") {
        setStatus(m.error || "Failed.", "err");
        els.progressWrap.hidden = true;
        els.download.disabled = false;
        try { port.disconnect(); } catch {}
      }
    });
    port.onDisconnect.addListener(() => { els.download.disabled = false; });
    port.postMessage({ type: "preload" });
  });
});

els.clear.addEventListener("click", async () => {
  els.clear.disabled = true;
  setStatus("Clearing…");
  let n = 0;
  try {
    const keys = await caches.keys();
    for (const k of keys) { await caches.delete(k); n++; }
  } catch {}
  try {
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      for (const db of dbs) { if (db.name) { indexedDB.deleteDatabase(db.name); n++; } }
    }
  } catch {}
  els.progressWrap.hidden = true;
  setStatus(`Cleared ${n} cache${n === 1 ? "" : "s"}.`, "ok");
  els.clear.disabled = false;
});
