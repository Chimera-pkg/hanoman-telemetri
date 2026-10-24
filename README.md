# HANOMAN / TELEMETRI

**One workspace. Every model. Full visibility.**

## NEW — v0.2.0: Document & Subject Studio

This archive is the **full merged source**, suitable for extraction over the previous `hanoman-telemetri` source directory. Two new sidebar pages are included:

- **Laporan Informasi**: fill the original Word report sections, fixed official formatting and signatory name, and stamp the bundled scanned signature above the signer name, then export DOCX.
- **Subject Studio**: shared subject identity/profile/portrait editor, generate the five-slide PPTX from the supplied master, reuse report Analysis and Recommendations.

Read [docs/DOCUMENT_STUDIO.md](docs/DOCUMENT_STUDIO.md) for field mapping, the overwrite procedure, storage caveats and limitations. **Generated office files are drafts until independently reviewed and authorized.**



A local-first Windows-first AI model hub built with **Rust + Tauri v2 + React/Vite + SQLite**. Bring any OpenAI-compatible API gateway; discover available model IDs; validate routes without confusing discovery with real availability; chat with streaming; inspect local telemetry.

> **Security notice:** No API keys are included. The keys previously shared in chat should be **rotated**. Re-enter replacement credentials in **Providers & keys** after launching the app. Do **not** put keys in React/Vite environment variables, commit them, or share screenshots showing secrets.

## Model hub functionality retained from v0.2.0

| Feature | Implementation |
| --- | --- |
| Overview | Provider/key/model totals, request graph, readiness and recent events |
| Provider registry | Three initial custom base URLs, add/delete other OpenAI-compatible providers |
| Secret storage | API key values in native OS credential manager (via Rust `keyring`); only masked suffix in SQLite |
| Discovery | Authenticated `GET {base_url}/models` for **each key**, limit 500 model routes per key |
| Model explorer | Provider, masked key label, model ID, status, latency, last probe, search/filter |
| Availability verification | Opt-in `POST {base_url}/chat/completions` probe; may use tokens |
| Chat workspace | OpenAI-style streaming SSE, conversation history, Markdown tables/code, stop button, model switch |
| Telemetry | Per-scan/probe/chat event in SQLite, latency and token usage **when reported by provider** |
| App settings | Local table density and default system prompt |
| Offline browser preview | Distinct sample data, no live API requests |

### Not yet implemented

Image generation, audio, attachments, PDF RAG, model-to-model Compare Mode, automatic retry/fallback, multi-gateway routing policies, per-model pricing, exact cost accounting, account sync and export/import. These are **roadmap** features, not existing buttons. The chat feature currently uses the OpenAI-compatible **Chat Completions** endpoint, not Responses API.

## Run on Windows 10/11

**Prerequisites:** Node.js LTS (20+), Rust stable with `cargo`, Microsoft C++ Build Tools (Desktop development with C++), WebView2, and the Windows SDK. Official guide: https://v2.tauri.app/start/prerequisites/

Extract the source ZIP, open PowerShell inside `hanoman-telemetri`:

```powershell
npm install
npm run desktop:dev
```

The first `desktop:dev` compiles Rust and may download crates. For a production installer:

```powershell
npm run desktop:build
```

Windows installers will be produced by Tauri under `src-tauri/target/release/bundle/` after a successful build. For a **UI-only demonstration** (fictional data; does not connect to the providers):

```powershell
npm run dev
```

or directly open **`preview.html`** for the *legacy v0.1 AI dashboard mock*. This standalone HTML is not the new Document Studio; run the React app to use the new Word/PPT editor. Do not mistake demo models or metrics for real results.

## First-use workflow

1. Launch the **native desktop application** (`npm run desktop:dev`).
2. Open **Providers & keys**. CarteThyia, 9Router and RDHX Bansos endpoints will be preconfigured **without secrets**.
3. Paste a freshly rotated credential into **Add key**, and give it a recognizable label.
4. Click **Discover models** to list model IDs from `GET /models`.
5. Open **Model explorer**, choose a discovered route and click **Validate availability** (this sends a small billable test request).
6. Select a working route under **Chat workspace** and start sending messages.
7. Inspect latency, events and token counts in **Telemetry**. Some gateways do not report usage in SSE chunks; Hanoman shows `—` in that case.

## Providers and API compatibility

Known user-supplied endpoints, configured as starting providers:

- CarteThyia — `https://cartethyia-production-682d.up.railway.app/v1`
- 9Router — `https://9router-production-fc96.up.railway.app/v1`
- RDHX Bansos — `https://api.rdhx.tech/v1`

Compatibility **has not been remotely validated** in this project package. The native application tests it after the user adds a credential.

Assumptions: authenticated Bearer key, `GET /models` returns `{data:[{id,owned_by?},...]}`, and text models accept `POST /chat/completions` with `model`, `messages`, `stream:true`, supporting SSE `data: {...}` and `[DONE]`. Provider-specific response formats, tool calling, multimodality, regional routing and custom headers are outside this MVP.

## Architecture

```text
React / Vite UI (Tauri WebView)
      |  IPC invoke() + event listener
      v
Rust Core (src-tauri/src/lib.rs)
      |                 \
      |                  +-- OS credential store (keyring)
      |                  +-- SQLite (conversation + route + telemetry metadata)
      |
      +-- HTTPS / reqwest --> Custom API Provider
                                     | GET /models
                                     | POST /chat/completions
                                     + SSE streaming
```

There is no separate Node.js server in the desktop build. Node/npm are build-time tools. No proxy or telemetry collector is run by Hanoman.

## Security notes

- API keys never enter SQLite. They are passed once through a Tauri command when the user adds a key, stored in the native credential manager, and retrieved directly in Rust for requests.
- React receives only masked credentials and status data. It does not request or retrieve full keys after saving.
- Only HTTPS endpoint URLs are accepted except HTTP localhost, and credential/query URL fragments are rejected.
- Remote gateways necessarily receive prompts, model IDs, and key authentication; do **not** send sensitive files without trusting the provider.
- Chat and telemetry SQLite are **not encrypted at rest**; protect the local OS user profile. The system prompt is stored in localStorage, so **never** place secrets there.
- Prompt and response *content* are stored in SQLite as conversation history; no message bodies are included in telemetry records.
- Probe requests can consume billable quota. Never run blindly across thousands of models; validation is per route.
- The app has not had a full dependency/security audit or native installer smoke test in this environment. See `docs/TEST_PLAN.md`.

## Workspace layout

```text
hanoman-telemetri/
├── src/App.tsx                   # All views, forms, chat, data binding
├── src/styles.css                # Dark graphite design system
├── src/lib/api.ts                # Tauri IPC / browser demo bridge
├── src/lib/demo.ts               # EXPLICIT fictional demo dataset
├── src/types.ts                  # Shared frontend types
├── src-tauri/src/lib.rs          # Rust core, vault, provider probes, SSE
├── src-tauri/src/db.rs           # SQLite migrations and queries
├── src-tauri/src/types.rs        # Rust serialized domain models
├── src-tauri/capabilities/       # Tauri v2 permissions
├── preview.html                  # Offline UI preview
└── docs/                         # Architecture, roadmap, and manual test plan
```

**License:** See `LICENSE`. No credentials or third-party design assets are embedded.
