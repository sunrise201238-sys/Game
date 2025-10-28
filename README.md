# 1v1 Round-Based Slingshot Strategy (Skeleton)

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

- Deterministic Mode B commit-reveal handshake.
- Drag-to-aim UI with power indicator and countdown timer.
- Local playback placeholder for unit movement with unobtrusive grave markers.
- Language toggle (English / Traditional Chinese) with locale persistence.
- Thin WebSocket server that seeds PvE matches, validates commits, and broadcasts round results.
- Optional in-memory analytics exposed via `/admin/metrics` when `ANALYTICS=minimal`.
- Health endpoint (`/healthz`) for Render monitoring.
- Shared constants/messages/types consumed by both client and server.

## Prerequisites

- Node.js 18+
- npm 9+

## Installing Dependencies

```bash
npm install
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
| `VITE_WS_URL`         | `ws://localhost:3001`       | WebSocket endpoint                                |
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

## Render Deployment

### Client (Static Site)

1. Create a new **Static Site** on Render.
2. Set the build command: `npm install && npm run build --workspace=shared && npm run build --workspace=client`.
3. Set the publish directory: `client/dist`.
4. Environment variables:
   - `VITE_WS_URL=https://<your-server-host>` (Render automatically upgrades to `wss://` for static sites).
   - `VITE_LANGUAGE_DEFAULT=en-US` (optional).
   - `VITE_COMMIT_SALT=<random-string>`.

### Server (Web Service)

1. Create a **Web Service** on Render.
2. Set the build command: `npm install && npm run build --workspace=shared && npm run build --workspace=server`.
3. Set the start command: `node server/dist/index.js`.
4. Required environment variables:
   - `SECRET_SALT=<secure-random-string>`
   - `ALLOW_ORIGINS=https://<your-client-host>`
   - `ANALYTICS=minimal` (optional; enables `/admin/metrics`).
   - `PLANNING_MS`, `REVEAL_MS` as needed.

Render automatically injects `PORT`; the server listens on that value.

## GitHub Actions

A workflow (`.github/workflows/deploy.yml`) is included to lint/build both client and server on pushes to `main`. Customize the deploy steps to integrate with Render deploy hooks or other CI/CD tooling.

## Testing & Extensibility

- Extend `maps/maps.json` and `units/units.json` with additional definitions; both client and server consume the same schema.
- Add new localization keys to `i18n/*.json` and reference them via `I18n#t`.
- Enhance `server/src/simulation.ts` with real physics/resolve logic. The deterministic seed, commit-reveal flow, and analytics wiring are already in place.

## Analytics Endpoint

When `ANALYTICS=minimal`, the server tracks in-memory counters and exposes them at `GET /admin/metrics`.

```json
{
  "matchesStarted": 0,
  "matchesCompleted": 0,
  "totalRounds": 3,
  "firstMoverWins": 0,
  "unitSelections": 0,
  "unitWins": 0,
  "outOfBoundsDeaths": 0,
  "mapSelections": 0
}
```

## License

MIT
