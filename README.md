# Slingshot Skirmish (Offline Bot Edition)

This repository now delivers a focused, offline-only build of the round-based slingshot prototype. The entire experience lives in the browser: you drag, the bot answers, and every turn animates immediately with clear, sequential playback. All multiplayer, networking, and anti-cheat code has been removed to keep the project lightweight and easy to reason about.

## Repository Layout

```
client/   – Vite + TypeScript canvas client (single-player vs. bot)
server/   – Minimal Express wrapper that serves the compiled client (optional for hosting on Render)
shared/   – Stub package retained for workspace builds (no gameplay logic)
```

## Prerequisites

- Node.js 20 (the repo includes `.nvmrc` and `.node-version` targeting 20)
- npm 10 (`npm i -g npm@10`)

A project-scoped `.npmrc` pins the public npm registry and disables audit/fund prompts so installs behave consistently on Render and in local containers.

## Install & Build

```bash
nvm use 20 || nvm install 20
npm i -g npm@10
npm run bootstrap        # npm install --workspaces
npm run build            # builds shared (stub), server, and client bundles
```

### Local Playtest

After building, launch the static server (optional) and open the client in your browser:

```bash
npm start                # serves client/dist on http://localhost:3001
```

Alternatively you can run the Vite dev server directly from the client workspace:

```bash
npm run dev --workspace client
```

## Gameplay Overview

- **Turn order:** You act first. Teams alternate strictly (You → Bot → You → Bot …). Each team cycles through its fixed queue of minions; dead minions simply get skipped.
- **Controls:** Click/touch your highlighted minion, drag away from the direction you want it to travel, then release. The shot fires immediately and animates until all motion resolves.
- **Physics:** Units travel in a top-down arena with friction, walls, and a central lake. Colliding with enemies inflicts damage and knockback; allies only nudge. Ending a move in the lake (or outside bounds) destroys the unit and leaves a grave marker.
- **Bot:** The bot waits for your turn to finish, then selects the closest target and launches one of its remaining minions. There are no turn timers in this mode.
- **Restart:** The “Start New Game” button is always visible so you can instantly reset the board.

## Render Deployment

Render can continue to host the project using the helper scripts already referenced in the repo:

- **Build command:** `./scripts/render-build.sh`
- **Start command:** `./scripts/render-start.sh`
- **Environment variables:** Only `PORT` is required (provided automatically by Render). No other server-side configuration is needed now that the experience is offline.

The server simply serves the static bundle from `client/dist` and exposes `/healthz` for Render health checks.

## Workspace Notes

The shared workspace remains as a stub so the npm workspace layout does not need to change. It produces a trivial module during the build step and has no runtime impact on the client.

## License

MIT
