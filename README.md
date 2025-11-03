https://game-server-w4xj.onrender.com/

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

- **Modes:** Choose between **VS Bot** (default) and **Hotseat**. In hotseat, Team One and Team Two alternate shots on the same device; in bot mode the AI handles Team Two.
- **Turn order:** A coin flip is implicit in the first round—the local player (or Team One) opens. Teams alternate strictly (Team One → Team Two → …) and each team cycles through its fixed queue of seven minions; fallen units are skipped but turns are never lost.
- **Controls & aiming:** Click/touch the highlighted minion, drag away from your intended direction, and release. A colored guide shows travel direction and, for mages, the projected area-of-effect landing zone before you let go.
- **Roster:** Each side fields three Soldiers, three Archers, and a Mage. Soldiers brawl, Archers fire piercing projectiles, and Mages drop softened AOEs with dramatically reduced damage for balance.
- **Maps:** Pick from five arenas—including the new **Twin Bridge** canal map—each with mirrored spawn templates, walls, and optional hazards. A pure Training Grounds layout is available for fundamentals.
- **Physics:** Everything plays out in a top-down space with friction, ricocheting walls, friendly shoves, enemy knockback, and instant defeats for units that finish inside lakes or off the board. Graves mark fallen units without blocking movement.
- **Bot:** The AI samples multiple launch vectors with the shared simulator, scoring each candidate to push enemies into hazards or finish weakened targets. There are no timers; the bot waits for animations to settle before acting.
- **HUD:** Squad panels show per-unit health bars, active-unit highlights, and persistent restart/map/mode controls so you can reset or swap configurations at any time.

### Mobile & Fullscreen Tips

- **Fullscreen play:** Tap the **Fullscreen** button beside the zoom controls to expand the board. On platforms without native fullscreen support (such as mobile Safari), the game switches to an immersive pseudo-fullscreen mode that locks the viewport and centers the board.
- **Aspect ratio safety:** The battlefield keeps its native aspect ratio while fullscreen, introducing letterboxing if the screen shape is taller or wider than the map. This avoids the "stretch" effect and prevents runaway scaling.
- **Touch gestures:** Drag with one finger to pan the camera, and pinch with two fingers to zoom while fullscreen. Single-finger drags never trigger zoom, and double-tap zooming is blocked so the browser won’t unexpectedly magnify the page mid-match.
- **Overscroll protection:** The app contains scrolling and navigation gestures to the canvas during play so that swiping or panning the map doesn’t cause the browser UI to appear or the page to navigate away.

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
