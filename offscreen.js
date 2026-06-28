// === GPT Mini — offscreen engine ===
// Hosts the WebLLM (WebGPU) engine. Loads the model once and answers
// generate/preload requests relayed from the service worker.

import { CreateMLCEngine, prebuiltAppConfig } from "./vendor/web-llm.js";

const DEFAULT_MODEL = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

// Models we ship. Their compute libs (.wasm) are bundled in vendor/wasm so no
// executable code is fetched remotely — only the model weights download (data).
const LOCAL_WASM = {
  "Qwen2.5-0.5B-Instruct-q4f16_1-MLC": "Qwen2-0.5B-Instruct-q4f16_1_cs1k-webgpu.wasm",
  "Llama-3.2-1B-Instruct-q4f16_1-MLC": "Llama-3.2-1B-Instruct-q4f16_1_cs1k-webgpu.wasm",
  "Llama-3.2-3B-Instruct-q4f16_1-MLC": "Llama-3.2-3B-Instruct-q4f16_1_cs1k-webgpu.wasm"
};

// Curated config: only the bundled models, each pointed at its local .wasm.
const appConfig = {
  ...prebuiltAppConfig,
  model_list: prebuiltAppConfig.model_list
    .filter((m) => LOCAL_WASM[m.model_id])
    .map((m) => ({ ...m, model_lib: chrome.runtime.getURL("vendor/wasm/" + LOCAL_WASM[m.model_id]) }))
};

let engine = null;
let loadedModel = null;
let loadingPromise = null;
let busy = false;

function send(msg) {
  chrome.runtime.sendMessage({ to: "sw", ...msg }).catch(() => {});
}

function errStr(e) {
  const m = e?.message || String(e);
  if (/webgpu/i.test(m) && /not|unavailable|undefined|support/i.test(m)) {
    return "WebGPU isn't available here. Update Chrome / enable hardware acceleration, then reload.";
  }
  return m;
}

function isKnownModel(id) {
  try {
    return !!id && appConfig.model_list.some((m) => m.model_id === id);
  } catch {
    return false;
  }
}

async function getModel() {
  let model = DEFAULT_MODEL;
  try {
    const got = await chrome.storage.local.get({ model: DEFAULT_MODEL });
    model = got?.model || DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL; // storage unreadable — proceed with the default
  }
  // Heal stale/invalid selections (e.g. "gpt-4o-mini" left by an older version).
  if (!isKnownModel(model)) {
    model = DEFAULT_MODEL;
    try { await chrome.storage.local.set({ model }); } catch {}
  }
  return model;
}

// Load the model if needed, forwarding download/compile progress under reqId.
async function ensureEngine(reqId) {
  const model = await getModel();
  if (engine && loadedModel === model) return engine;

  if (loadingPromise) {
    await loadingPromise;
    if (engine && loadedModel === model) return engine;
  }

  if (engine && loadedModel !== model) {
    try { await engine.unload(); } catch {}
    engine = null;
    loadedModel = null;
  }

  loadingPromise = (async () => {
    const initProgressCallback = (p) =>
      send({
        type: "progress",
        reqId,
        text: p?.text || "Loading model…",
        progress: typeof p?.progress === "number" ? p.progress : undefined
      });
    engine = await CreateMLCEngine(model, { appConfig, initProgressCallback });
    loadedModel = model;
  })();

  try {
    await loadingPromise;
  } finally {
    loadingPromise = null;
  }
  return engine;
}

async function handlePreload(msg) {
  await ensureEngine(msg.reqId);
  send({ type: "done", reqId: msg.reqId });
}

async function handleGenerate(msg) {
  if (busy) {
    send({ type: "error", reqId: msg.reqId, error: "The model is busy with another request — try again in a moment." });
    return;
  }
  busy = true;
  try {
    const eng = await ensureEngine(msg.reqId);
    send({ type: "progress", reqId: msg.reqId, text: "Generating…" });

    const stream = await eng.chat.completions.create({
      messages: msg.messages,
      stream: true,
      temperature: 0.7
    });

    for await (const chunk of stream) {
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (delta) send({ type: "delta", reqId: msg.reqId, text: delta });
    }
    send({ type: "done", reqId: msg.reqId });
  } finally {
    busy = false;
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.to !== "offscreen") return;

  if (msg.type === "generate") {
    handleGenerate(msg).catch((e) => send({ type: "error", reqId: msg.reqId, error: errStr(e) }));
  } else if (msg.type === "preload") {
    handlePreload(msg).catch((e) => send({ type: "error", reqId: msg.reqId, error: errStr(e) }));
  } else if (msg.type === "interrupt") {
    try { engine?.interruptGenerate(); } catch {}
  }
});

// Tell the service worker we're alive (useful for debugging).
send({ type: "offscreen-ready" });
