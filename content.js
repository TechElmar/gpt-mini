// === GPT Mini — in-page panel ===
// Injected on demand into the active tab. Renders a floating, draggable panel
// inside a Shadow DOM and streams the answer from the on-device model (relayed
// by the service worker from the offscreen WebLLM engine).

(() => {
  if (window.__gptminiLoaded) return;
  window.__gptminiLoaded = true;

  const ROLE_PRESETS = {
    Default: "You are a helpful assistant. Be clear and concise.",
    Tutor: "You are a patient tutor. Explain step by step in plain language.",
    Technical: "You are a concise technical assistant. Be precise and skip the fluff."
  };

  const PANEL_HTML = `
    <div class="gm-panel" id="gm-panel">
      <div class="gm-header" id="gm-header">
        <span class="gm-dot"></span>
        <span class="gm-title">GPT Mini</span>
        <span class="gm-model" id="gm-model" title="On-device model"></span>
        <span class="gm-spacer"></span>
        <button class="gm-icon" id="gm-settings" title="Settings">&#9881;</button>
        <button class="gm-icon" id="gm-close" title="Close (Esc)">&#10005;</button>
      </div>
      <div class="gm-body">
        <details class="gm-sel" id="gm-sel-wrap">
          <summary>Selected text</summary>
          <textarea id="gm-selection" rows="3" placeholder="(nothing selected — type a question below)"></textarea>
        </details>
        <div class="gm-row">
          <select id="gm-role" title="Assistant style">
            <option value="Default">Default</option>
            <option value="Tutor">Tutor</option>
            <option value="Technical">Technical</option>
          </select>
        </div>
        <textarea id="gm-prompt" rows="2" placeholder="Ask anything about this…  (Enter to send, Shift+Enter for a new line)"></textarea>
        <div class="gm-actions">
          <button id="gm-send" class="gm-send">Send</button>
          <button id="gm-copy" class="gm-ghost" hidden>Copy</button>
          <span id="gm-status" class="gm-status"></span>
        </div>
        <div id="gm-answer" class="gm-answer" hidden></div>
        <div class="gm-foot">Runs on your device — free, private. First use downloads the model once.</div>
      </div>
    </div>`;

  const PANEL_CSS = `
    :host {
      all: initial;
      position: fixed;
      top: 16px;
      right: 16px;
      width: 384px;
      max-width: calc(100vw - 32px);
      z-index: 2147483647;
      --bg: #14161c;
      --surface: #1b1e26;
      --surface-2: #11131a;
      --text: #e8eaf0;
      --muted: #99a1b3;
      --border: #2a2f3a;
      --accent: #5b8cff;
      --accent-text: #ffffff;
      --danger: #ff6b6b;
    }
    @media (prefers-color-scheme: light) {
      :host {
        --bg: #ffffff;
        --surface: #ffffff;
        --surface-2: #f5f7fb;
        --text: #14161c;
        --muted: #6b7280;
        --border: #e3e7ee;
        --accent: #3b6fff;
        --accent-text: #ffffff;
        --danger: #d23b3b;
      }
    }
    * { box-sizing: border-box; }
    .gm-panel {
      font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: var(--text);
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 14px;
      box-shadow: 0 12px 40px rgba(0,0,0,.35), 0 2px 8px rgba(0,0,0,.2);
      overflow: hidden;
    }
    .gm-header {
      display: flex; align-items: center; gap: 8px;
      padding: 9px 10px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      cursor: move;
      user-select: none;
    }
    .gm-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 8px var(--accent); flex: 0 0 auto; }
    .gm-title { font-weight: 700; letter-spacing: .2px; flex: 0 0 auto; }
    .gm-model { font-size: 11px; color: var(--muted); background: var(--surface-2); border: 1px solid var(--border); padding: 1px 7px; border-radius: 999px; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .gm-spacer { flex: 1; }
    .gm-icon {
      all: unset; cursor: pointer; color: var(--muted);
      width: 24px; height: 24px; border-radius: 7px;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 13px; flex: 0 0 auto;
    }
    .gm-icon:hover { background: var(--surface-2); color: var(--text); }
    .gm-body { padding: 10px; display: flex; flex-direction: column; gap: 9px; }
    .gm-sel summary { cursor: pointer; color: var(--muted); font-size: 12px; padding: 2px 0; outline: none; }
    .gm-sel[open] summary { margin-bottom: 6px; }
    textarea, select {
      width: 100%; font: inherit; color: var(--text);
      background: var(--surface-2); border: 1px solid var(--border);
      border-radius: 9px; padding: 9px 10px; resize: vertical;
    }
    select { cursor: pointer; padding: 7px 10px; }
    textarea:focus, select:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(91,140,255,.22); }
    #gm-prompt { min-height: 44px; }
    .gm-row { display: flex; gap: 8px; }
    .gm-actions { display: flex; align-items: center; gap: 8px; }
    .gm-send {
      all: unset; cursor: pointer; font-weight: 600;
      background: var(--accent); color: var(--accent-text);
      padding: 8px 16px; border-radius: 9px;
    }
    .gm-send:hover { filter: brightness(1.07); }
    .gm-send[disabled] { opacity: .55; cursor: default; filter: none; }
    .gm-ghost {
      all: unset; cursor: pointer; font-size: 12px; color: var(--muted);
      border: 1px solid var(--border); padding: 7px 12px; border-radius: 9px;
    }
    .gm-ghost:hover { color: var(--text); background: var(--surface-2); }
    .gm-status { font-size: 12px; color: var(--muted); margin-left: auto; text-align: right; }
    .gm-status.gm-err { color: var(--danger); }
    .gm-answer {
      white-space: pre-wrap; word-wrap: break-word;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 9px; padding: 10px;
      max-height: 320px; overflow-y: auto;
    }
    .gm-answer.gm-streaming::after {
      content: "▍"; color: var(--accent);
      animation: gm-blink 1s steps(1) infinite;
    }
    @keyframes gm-blink { 50% { opacity: 0; } }
    .gm-foot { font-size: 11px; color: var(--muted); opacity: .8; }`;

  let host, shadow, els = {}, port = null, streaming = false;

  function build() {
    host = document.createElement("div");
    host.id = "gpt-mini-host";
    shadow = host.attachShadow({ mode: "open" });

    // Constructable stylesheet: not subject to the page's CSP style-src.
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(PANEL_CSS);
    shadow.adoptedStyleSheets = [sheet];

    const wrap = document.createElement("div");
    wrap.innerHTML = PANEL_HTML;
    shadow.appendChild(wrap);
    document.documentElement.appendChild(host);

    const $ = (id) => shadow.getElementById(id);
    els = {
      panel: $("gm-panel"), header: $("gm-header"),
      model: $("gm-model"), settings: $("gm-settings"), close: $("gm-close"),
      selWrap: $("gm-sel-wrap"), selection: $("gm-selection"),
      role: $("gm-role"), prompt: $("gm-prompt"),
      send: $("gm-send"), copy: $("gm-copy"), status: $("gm-status"),
      answer: $("gm-answer")
    };

    els.close.addEventListener("click", hide);
    els.settings.addEventListener("click", openSettings);
    els.send.addEventListener("click", send);
    els.copy.addEventListener("click", copyAnswer);
    els.prompt.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });
    host.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });

    makeDraggable(els.header);
    refreshModelLabel();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.model) els.model.textContent = shortModel(changes.model.newValue);
    });
  }

  function shortModel(id) {
    if (!id) return "";
    return id.replace(/-q\d.*$/, "").replace(/-MLC$/, "").replace(/-Instruct$/, "");
  }
  function refreshModelLabel() {
    chrome.storage.local.get({ model: "Llama-3.2-1B-Instruct-q4f16_1-MLC" }, ({ model }) => {
      els.model.textContent = shortModel(model);
    });
  }

  function show(selection) {
    if (!host) build();
    host.style.display = "";
    if (typeof selection === "string" && selection.trim()) {
      els.selection.value = selection;
      els.selWrap.open = true;
    }
    els.prompt.focus();
  }

  function hide() {
    cleanupPort();
    if (host) host.style.display = "none";
  }

  function openSettings() {
    chrome.runtime.sendMessage({ type: "GPTMINI_OPEN_OPTIONS" });
  }

  function setStatus(text, isError = false) {
    els.status.textContent = text || "";
    els.status.classList.toggle("gm-err", !!isError);
  }

  function setStreaming(on) {
    streaming = on;
    els.send.disabled = on;
    els.send.textContent = on ? "…" : "Send";
    els.answer.classList.toggle("gm-streaming", on);
  }

  function cleanupPort() {
    if (port) { try { port.disconnect(); } catch {} port = null; }
    if (streaming) setStreaming(false);
  }

  function buildMessages() {
    const system = ROLE_PRESETS[els.role.value] || ROLE_PRESETS.Default;
    const sel = els.selection.value.trim();
    const ask = els.prompt.value.trim();
    const parts = [];
    if (sel) parts.push(`Selected text:\n"""\n${sel}\n"""`);
    if (ask) parts.push(ask);
    else if (sel) parts.push("Explain or comment on the selected text.");
    return [
      { role: "system", content: system },
      { role: "user", content: parts.join("\n\n") }
    ];
  }

  function send() {
    if (streaming) return;
    const hasSel = els.selection.value.trim();
    const hasAsk = els.prompt.value.trim();
    if (!hasSel && !hasAsk) { setStatus("Type a question first.", true); return; }

    els.answer.hidden = false;
    els.answer.textContent = "";
    els.copy.hidden = true;
    setStreaming(true);
    setStatus("Starting…");

    let received = false;
    port = chrome.runtime.connect({ name: "gptmini" });
    port.onMessage.addListener((m) => {
      if (m.type === "progress") {
        if (!received) setStatus(m.text || "Loading…");
      } else if (m.type === "delta") {
        received = true;
        setStatus("");
        els.answer.textContent += m.text;
        els.answer.scrollTop = els.answer.scrollHeight;
      } else if (m.type === "done") {
        setStreaming(false);
        els.copy.hidden = !received;
        if (!received) setStatus("No output returned.", true);
        cleanupPort();
      } else if (m.type === "error") {
        els.answer.hidden = true;
        setStatus(m.error || "Something went wrong.", true);
        setStreaming(false);
        cleanupPort();
      }
    });
    port.onDisconnect.addListener(() => {
      if (streaming) { setStreaming(false); setStatus("Connection dropped.", true); }
    });
    port.postMessage({ type: "ask", messages: buildMessages() });
  }

  function copyAnswer() {
    navigator.clipboard.writeText(els.answer.textContent || "").then(
      () => { els.copy.textContent = "Copied"; setTimeout(() => (els.copy.textContent = "Copy"), 1200); },
      () => setStatus("Copy failed.", true)
    );
  }

  function makeDraggable(handle) {
    let dragging = false, dx = 0, dy = 0;
    handle.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".gm-icon")) return;
      dragging = true;
      const r = host.getBoundingClientRect();
      dx = e.clientX - r.left;
      dy = e.clientY - r.top;
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const w = host.offsetWidth, h = host.offsetHeight;
      const left = Math.max(0, Math.min(window.innerWidth - w, e.clientX - dx));
      const top = Math.max(0, Math.min(window.innerHeight - h, e.clientY - dy));
      host.style.left = left + "px";
      host.style.top = top + "px";
      host.style.right = "auto";
    });
    const stop = (e) => {
      dragging = false;
      try { handle.releasePointerCapture(e.pointerId); } catch {}
    };
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "GPTMINI_PING") { sendResponse({ ok: true }); return; }
    if (msg?.type === "GPTMINI_SHOW") { show(msg.selection || ""); sendResponse({ ok: true }); return; }
  });
})();
