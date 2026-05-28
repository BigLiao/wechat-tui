# AGENTS.md

## Project Overview

`wechat-tui` is a Node.js terminal client for WeChat. The CLI entry is `src/index.ts`, which parses config, runs startup environment checks, opens the SQLite store, creates a protocol adapter, and starts the runtime with a terminal renderer.

## Architecture

- `src/runtime.ts` is the application coordinator. It owns view state, account scoping, message persistence, contact search, commands, file sending, media downloads, and update checks.
- `src/protocol/wechat4u-adapter.ts` wraps `wechat4u` and normalizes raw Web WeChat contacts/messages into local types. `src/protocol/mock-protocol.ts` is used for mock/dev flows.
- `src/store/sqlite-store.ts` is the local persistence layer. Data is account-scoped and stored in SQLite under `~/.wechat-tui` by default.
- `src/ui/workbench-renderer.ts` bridges terminal input/output with the TUI app. `src/tui/*` contains pure-ish render components and screen layout.
- `src/types.ts` defines shared protocol, store, runtime, UI, and renderer contracts.
- `src/util/*` contains small helpers for ids, text, paths, media cache, file hashes, opening files, SQLite loading, and time formatting.
- `src/logging.ts` creates debug logs when `--debug` or `WECHAT_TUI_DEBUG=1` is enabled.

## Data And Runtime

- Default data directory: `~/.wechat-tui`
- Default database: `~/.wechat-tui/wechat-tui.sqlite`
- Media cache: `~/.wechat-tui/cache/<conversationId>/`
- Debug logs: `~/.wechat-tui/logs/`
- Node.js `>=22.19.0` is required because the project uses built-in `node:sqlite`.

## Development Commands

```bash
npm run typecheck
npm test
npm run build
npm run dev -- --mock
```

Run these before committing behavior changes:

```bash
npm run typecheck
npm test
npm run build
```

## Conventions

- Keep protocol normalization in `wechat4u-adapter.ts`; keep UI rendering in `src/tui/*`; keep orchestration in `runtime.ts`.
- Preserve account isolation when storing contacts, conversations, and messages.
- Do not log raw protocol/session objects unless they are summarized and redacted.
- Prefer focused tests under `test/*` for runtime behavior, store migrations, protocol parsing, and terminal input handling.
