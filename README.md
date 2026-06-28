# GPT Mini

> Highlight text on any page, right-click, and get answers from an AI that runs **entirely on your own device** — no API key, no account, no cloud.

GPT Mini is a Chrome extension (Manifest V3) that puts a private AI assistant one right-click away. The model runs locally in the browser via **WebGPU** ([WebLLM](https://github.com/mlc-ai/web-llm)), so your text never leaves your computer and there's nothing to pay for or sign up to.

**[⬇️ Install from the Chrome Web Store](https://chromewebstore.google.com/detail/ejlpjombpcmojjjedjiebolgapeekenj)**

---

## Demo

<!-- Add a screenshot or GIF here, e.g. docs/demo.png -->
<!-- ![GPT Mini in action](docs/demo.png) -->

*Highlight → right-click "Send to GPT Mini" → ask in the in-page panel → the answer streams in.*

---

## Features

- **Right-click any selection** to ask about it instantly, or click the toolbar icon and type a question.
- **In-page panel** rendered in a Shadow DOM — a clean, draggable card that works on any site without clashing with the page's styles.
- **Streaming answers** that appear token-by-token as they're generated.
- **Pick your model** — from a fast 0.5B up to a stronger 3B, depending on your hardware.
- **Assistant styles** — Default, Tutor (step-by-step), and Technical (concise/precise).
- **100% on-device** — private by design, free forever, and works offline after the first model download.

## Why on-device?

Cloud AI inference always costs *someone* money and means sending your text to a server. GPT Mini's hard requirement was **free, private, and no sign-up**, which only on-device inference can deliver. Each open-source model downloads once from Hugging Face, is cached locally, and then runs fully in the browser with WebGPU.

## How it works

Manifest V3 service workers can't use WebGPU, so the heavy lifting happens in an **offscreen document**. Messages are relayed by request ID between four pieces:

```
 ┌─────────────┐   selection    ┌──────────────┐   Port "gptmini"   ┌─────────────────┐
 │ background   │──────────────▶│  content.js  │───────────────────▶│  background.js  │
 │  context     │  "GPTMINI_SHOW"│ (Shadow-DOM  │   {type:"ask"}     │ (service worker │
 │   menu       │                │   panel UI)  │◀───────────────────│   = relay)      │
 └─────────────┘                └──────────────┘  progress / delta   └────────┬────────┘
                                                                              │ relay by reqId
                                                                              ▼
                                                                     ┌─────────────────┐
                                                                     │  offscreen.js   │
                                                                     │  WebLLM engine  │
                                                                     │  (WebGPU)       │
                                                                     └─────────────────┘
```

| File | Role |
|------|------|
| [`content.js`](content.js) | Injected on demand. Renders the draggable Shadow-DOM panel and streams the answer. Uses a constructable stylesheet so it's immune to the host page's CSP. |
| [`background.js`](background.js) | Service worker. Owns the context menu and the offscreen document, and relays `Port` messages by request ID. |
| [`offscreen.js`](offscreen.js) | Hosts the WebLLM engine where WebGPU inference actually runs. |
| [`options.js`](options.js) / [`options.html`](options.html) | Pick a model, preload it with a progress bar, or clear the local cache. |
| [`manifest.json`](manifest.json) | MV3 config, permissions, and a CSP tuned for `wasm-unsafe-eval`. |

### No remotely-hosted code

To comply with the Chrome Web Store's "no remote code" policy, the per-model WebAssembly compute libraries are **bundled in the package** ([`vendor/wasm/`](vendor/wasm)). `offscreen.js` builds a curated WebLLM `appConfig` that points each model's `model_lib` at a local `chrome.runtime.getURL(...)` path. The only thing fetched over the network is the model *weights* (data), which download once from Hugging Face and are cached.

## Tech stack

- **Chrome Extension Manifest V3** — service worker, offscreen documents, context menus, `activeTab` + `scripting`.
- **[WebLLM](https://github.com/mlc-ai/web-llm)** (`@mlc-ai/web-llm`) — OpenAI-compatible in-browser LLM inference over **WebGPU**.
- **Shadow DOM** with constructable `adoptedStyleSheets` for a CSP-safe, style-isolated UI.
- Vanilla JS, no build step.

## Running it locally

1. Clone this repo.
2. Open `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked** and select the project folder.
4. Highlight some text on any page, right-click → **Send to GPT Mini**.

> Requires a WebGPU-capable browser (recent Chrome on a reasonably modern computer) and a one-time model download (~0.4–2 GB depending on the model you choose).

## Privacy

GPT Mini collects nothing. Your selected text, your questions, and the model's answers never leave your device. The only network request is the one-time download of open-source model files from Hugging Face. There are no servers and no analytics.

## License

[MIT](LICENSE) © Elmar Rasho
