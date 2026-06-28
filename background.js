// === GPT Mini — service worker ===
// Wires the context menu / toolbar icon to the in-page panel, owns the
// offscreen document that runs the model, and relays streamed tokens between
// the two. The SW itself can't use WebGPU, so all inference lives in offscreen.

const MENU_ID = "gpt-mini-send";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Send to GPT Mini",
    contexts: ["selection", "page"]
  });
});

// ---- Offscreen document lifecycle ----
let creating = null;
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  if (creating) { await creating; return; }
  creating = chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["WORKERS"],
    justification: "Run the on-device AI model (WebGPU) for GPT Mini."
  });
  try { await creating; } finally { creating = null; }
}

// ---- Panel injection ----
async function showPanel(tab, selection) {
  const tabId = tab?.id;
  if (typeof tabId !== "number") return;

  let alive = false;
  try { await chrome.tabs.sendMessage(tabId, { type: "GPTMINI_PING" }); alive = true; } catch {}

  if (!alive) {
    try { await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }); }
    catch { return; } // restricted page (chrome://, Web Store, etc.)
  }
  try { await chrome.tabs.sendMessage(tabId, { type: "GPTMINI_SHOW", selection: selection || "" }); } catch {}
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  showPanel(tab, info.selectionText || "");
});
chrome.action.onClicked.addListener((tab) => showPanel(tab, ""));

// ---- Client ports (panel + options page) <-> offscreen engine ----
const pending = new Map(); // reqId -> Port
let seq = 0;

function stripRouting(m) { const { to, reqId, ...rest } = m; return rest; }

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "GPTMINI_OPEN_OPTIONS") { chrome.runtime.openOptionsPage(); return; }

  // Engine -> originating client
  if (msg?.to === "sw" && msg.reqId != null) {
    const port = pending.get(msg.reqId);
    if (port) {
      try { port.postMessage(stripRouting(msg)); } catch {}
      if (msg.type === "done" || msg.type === "error") pending.delete(msg.reqId);
    }
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "gptmini") return;
  const mine = new Set();

  port.onMessage.addListener(async (msg) => {
    if (msg?.type !== "ask" && msg?.type !== "preload") return;
    const reqId = ++seq;
    mine.add(reqId);
    pending.set(reqId, port);
    try {
      await ensureOffscreen();
      chrome.runtime.sendMessage({
        to: "offscreen",
        type: msg.type === "ask" ? "generate" : "preload",
        reqId,
        messages: msg.messages || []
      }).catch(() => {});
    } catch (e) {
      try { port.postMessage({ type: "error", error: e?.message || String(e) }); } catch {}
      pending.delete(reqId);
    }
  });

  port.onDisconnect.addListener(() => {
    for (const reqId of mine) {
      pending.delete(reqId);
      chrome.runtime.sendMessage({ to: "offscreen", type: "interrupt", reqId }).catch(() => {});
    }
  });
});
