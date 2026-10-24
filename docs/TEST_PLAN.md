# Manual test matrix

This source project was produced in an environment without Cargo/Rust or npm registry access. The project structure and input assets were statically inspected, but a **native compile and end-to-end integration test have not yet been performed**. Do not confuse the standalone preview screenshot with a completed native smoke test.

## Prerequisites
- Windows with Rust/Cargo stable, Node.js 20+, Microsoft C++ build tools, WebView2.
- Test or freshly rotated provider credentials with a known Chat Completions model.

## A. Build
- `npm install`
- `npm run build` (TypeScript + Vite)
- `npm run desktop:dev` (Rust + Tauri)
- `npm run desktop:build` (installer) — verify exe icon/title and MSI/NSIS outputs.

## B. Key safety
- Add an API key and restart. Verify key remains in OS Credential Manager and remains masked in UI.
- Open SQLite and inspect `api_keys` table; no secret should appear there.
- Confirm key is absent from `dist/`, `src/`, logs, browser localStorage and screenshots.
- Delete key and verify OS credential is deleted.
- Simulate an unavailable OS credential backend and confirm the app fails closed (does not save plaintext).

## C. Discovery and probes
- Working key: discovery lists model ID as `Discovered`.
- Wrong key: expected `Auth failed` at key level with no invented Ready state.
- Probe a working Chat Completions model: expect `Ready` and a measured latency.
- Probe with 429: expect `Rate limited`, no auto retry flood.
- Discover again: previously Ready model reverts to Discovered pending fresh validation.
- Network down: expect user-facing error, no fabricated model readiness.
- Endpoint returning invalid JSON/no data: verify error surfaced and not treated as success.

## D. Chat
- New conversation, select model, send text; check streaming chunks and `[DONE]`.
- Stop while streaming; expect cancellation event and partial content saved if present.
- Switch models and send a follow-up; verify history ordering and correct route.
- Restart desktop app; previous conversations remain.
- Send long code block, GFM table, and Markdown list; check rendering.
- Verify message plaintext is only in local chat DB (not telemetry log).

## E. UI
- Check pages Overview / Model Explorer / Chat / Providers / Telemetry / Settings.
- Verify model and provider filters, responsive layout, dialogs, keyboard shortcuts.
- Open `preview.html` offline: every metric should be identified as fictional.

## Known MVP limitations
- Windows is the primary target. Linux keyring requires a working Secret Service (e.g. GNOME Keyring/KWallet).
- Not all OpenAI-like proxy providers support the same `max_tokens` or SSE delta format.
- Usage tokens are optional; billing information may not be available.
- No streaming cost guard, image model execution, JSON export or automatic fallback.
- No upgrade migration framework yet; keep backups before future versions.
