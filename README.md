# 1v1 Round-Based Slingshot Strategy MVP

This repository contains a production-ready baseline for a deterministic round-based slingshot strategy game. The monorepo hosts a static web client, a thin WebSocket server, shared constants, and example data for units, maps, and localization.

## Repository Layout

```
client/   – Vite-powered static front-end (TypeScript + Canvas)
server/   – Node.js WebSocket service with Express health/metrics endpoints
shared/   – Shared TypeScript schemas, constants, and helpers
maps/     – Sample map JSON definitions
units/    – Sample unit JSON definitions
i18n/     – Localized UI strings (en-US, zh-TW)
```

## Features

- Deterministic Mode B round loop backed by a shared physics/simulation engine (`shared/src/simulation.ts`).
- Drag-to-aim Canvas client with commit, reveal, and result hashing plus local playback of server diffs.
- In-browser queue that supports PvP matchmaking, PvE bot fallback (via “Play vs Bot”), and reconnect/resync snapshots.
- Countdown timer, power indicator, permanent graves, and language toggle (English / Traditional Chinese) persisted locally.
- Thin WebSocket server handling matchmaking, commit/reveal windows, hash validation, authoritative fallbacks, and reconnects.
- Optional in-memory analytics (`ANALYTICS=minimal`) exposed at `/admin/metrics` alongside `/healthz` for Render probes.
- Shared schemas/constants that keep client and server in lockstep (maps, units, physics constants, message envelopes).

## Prerequisites & Environment Setup

- Node.js 20 LTS (the repo includes an `.nvmrc` targeting 20)
- npm 10 (install the latest npm 10.x before bootstrapping workspaces)

```bash
nvm use 20 || nvm install 20
npm i -g npm@10
```

## Installing Dependencies

> **Note:** The repository ships with a root `.npmrc` that pins the public npm registry and disables funding/audit prompts so `npm ci --workspaces` behaves consistently across CI and Render.

```bash
npm run bootstrap
```

## Local Development

### Shared Package

Build the shared TypeScript package:

```bash
npm run build --workspace=shared
```

### Server

```bash
# From repository root
npm run build --workspace=server
npm run dev --workspace=server  # hot execution via ts-node
```

Environment variables:

| Name           | Default              | Description                                             |
| -------------- | -------------------- | ------------------------------------------------------- |
| `PORT`         | `3001`               | HTTP/WebSocket port                                     |
| `SECRET_SALT`  | `development-secret` | Salt used for commit hash validation (must match client `VITE_COMMIT_SALT`) |
| `PLANNING_MS`  | `7000`               | Commit window in milliseconds                           |
| `REVEAL_MS`    | `4000`               | Reveal window in milliseconds                           |
| `ALLOW_ORIGINS`| *(empty)*            | Comma-delimited origin allow-list                       |
| `ANALYTICS`    | `off`                | `off` or `minimal` for in-memory counters               |

### Client

```bash
# Build shared package first
npm run build --workspace=shared

npm run dev --workspace=client
```

Key environment variables for the client (set via Vite `VITE_*` prefix or `.env` file in `client/`):

| Name                  | Default                     | Description                                       |
| --------------------- | --------------------------- | ------------------------------------------------- |
| `WS_URL` / `VITE_WS_URL` | `ws://localhost:3001`    | WebSocket endpoint (append `?mode=pve` to force bot) |
| `VITE_LANGUAGE_DEFAULT` | *(browser locale)*        | Preferred language (`en-US` or `zh-TW`)           |
| `VITE_COMMIT_SALT`    | `client-salt`               | Salt applied to commit hashes (must match server `SECRET_SALT`) |

The dev server runs on <http://localhost:5173>. Use the canvas to drag and aim shots; the first living unit will be used each turn.

## Building for Production

```bash
npm run build
```

This command builds shared types, server, and client artifacts.

- Client output: `client/dist/` (static site suitable for CDN/Render Static Site)
- Server output: `server/dist/` (Node.js bundle)

## Local Verification Checklist

Use the following sequence to ensure the workspace installs, builds, and boots locally (mirrors Render expectations):

```bash
nvm use 20 || nvm install 20
npm i -g npm@10
npm run bootstrap
npm run build
npm run start:server
```

With the server running, open two browser tabs pointed at the client build (or dev server) and confirm:

- Matchmaking proceeds through commit → reveal → client result hash submission → `ROUND_RESULT` playback.
- Cursor rollover never skips turns after unit deaths.
- Language toggle persists between reloads.
- Graves remain unobtrusive and stack as `×N` when overlapping.

## Render Deployment

### Server (Web Service)

1. Create a **Web Service** on Render.
2. Set the build command:

   ```bash
   node -v && npm -v && \
   npm ci --registry=https://registry.npmjs.org/ --no-audit --no-fund || \
   npm install --registry=https://registry.npmjs.org/ --no-audit --no-fund && \
   npm run build
   ```
3. Set the start command: `npm run start:server`.
4. Required environment variables:
   - `SECRET_SALT=<secure-random-string>`.
   - `PLANNING_MS=10000`.
   - `REVEAL_MS=1500`.
   - `ALLOW_ORIGINS=https://<your-client>.onrender.com`.
   - `ANALYTICS=off`.
   - `PORT` is provided automatically by Render.

### Client (Static Site)

1. Create a new **Static Site** on Render.
2. Set the build command:

   ```bash
   npm ci --registry=https://registry.npmjs.org/ --no-audit --no-fund || \
   npm install --registry=https://registry.npmjs.org/ --no-audit --no-fund && \
   npm run build --workspace client
   ```
3. Set the publish directory: `client/dist`.
4. Environment variables:
   - `WS_URL=wss://<your-server>.onrender.com`.
   - `VITE_LANGUAGE_DEFAULT=zh-TW` (switch to `en-US` if you prefer English by default).

## GitHub Actions

A workflow (`.github/workflows/deploy.yml`) is included to lint/build both client and server on pushes to `main`. Customize the deploy steps to integrate with Render deploy hooks or other CI/CD tooling.

## Testing & Extensibility

- Extend `maps/maps.json` and `units/units.json` with additional definitions; both client and server consume the same schema.
- Add new localization keys to `i18n/*.json` and reference them via `I18n#t`.
- The shared deterministic engine lives in `shared/src/simulation.ts`. Extend the physics, collision, and status systems there so both server and client stay in sync.

## Analytics Endpoint

When `ANALYTICS=minimal`, the server tracks in-memory counters (matches, rounds, first-move win rate, unit/map usage, out-of-bounds deaths) and exposes them at `GET /admin/metrics`.

## License

MIT
