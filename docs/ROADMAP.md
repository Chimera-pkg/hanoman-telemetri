# Hanoman Telemetri roadmap

## Release 0.1 — Developer Preview (included source)
Tauri v2 desktop shell, two preconfigured custom gateways, local provider/key registry, discovery, manual probes, status/latency, chat streaming, conversation storage, telemetry dashboard, light browser preview.

## Release 0.2 — Hardening
Automated CI on Windows 11, macOS and Linux, signed installers, secret-store failure recovery, database migrations, upstream endpoint regression tests, SSE disconnect handling and non-stream fallback, startup checks, offline static fonts. Optional automatic background discovery every 12–24 h (not completion probes).

## Release 0.3 — Model Intelligence
Inference of capabilities from metadata and carefully chosen opt-in probes (vision/tool use, embeddings, speech); per-route throughput and TTFT; rate limits/cooldown from HTTP headers; user-defined pricing and transparent cost estimates. Never label guessed values as authoritative.

## Release 0.4 — Router & Compare Mode
Single prompt -> two or three routes, cancellation and token-budget limits; route selection: manual, lowest observed latency, reliability, budget, fallback only before output streaming begins. No transparent switch after tokens have streamed; require user opt-in to avoid duplicate spend.

## Release 0.5 — Multi-modal & workflows
Image/audio-capable endpoints, attachment management, local vector search, conversations export/import, user-selectable encrypted backup, agent/tool permission model, and scoped code execution.

## Release 1.0 — Reliable local workstation
Documented plugin/adapter SDK, signed builds, provider schema validation, explicit privacy UX, crash-safe database management, release automation, accessibility audit, and integration tests.
