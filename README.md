https://game-server-w4xj.onrender.com/

# Slingshot Skirmish

Slingshot Skirmish is a turn-based, physics-driven tactics game where teams of elite minions trade slingshot launches across hazardous arenas. The project ships as a Vite + TypeScript canvas client, an Express + WebSocket relay for online matchmaking, and a shared package that synchronizes gameplay types across the stack.​:codex-file-citation[codex-file-citation]{line_range_start=6 line_range_end=23 path=client/package.json git_url="https://github.com/sunrise201238-sys/Game/blob/Mobile_Test/client/package.json#L6-L23"}​​:codex-file-citation[codex-file-citation]{line_range_start=6 line_range_end=17 path=server/package.json git_url="https://github.com/sunrise201238-sys/Game/blob/Mobile_Test/server/package.json#L6-L17"}​​:codex-file-citation[codex-file-citation]{line_range_start=5 line_range_end=21 path=shared/package.json git_url="https://github.com/sunrise201238-sys/Game/blob/Mobile_Test/shared/package.json#L5-L21"}​

---

## Core Gameplay

### Turn Flow & Simulation
Each match alternates between Team One and Team Two, advancing through a fixed queue so living units act in order while fallen units are skipped without breaking turn cadence.​:codex-file-citation[codex-file-citation]{line_range_start=948 line_range_end=1056 path=client/src/main.ts git_url="https://github.com/sunrise201238-sys/Game/blob/Mobile_Test/client/src/main.ts#L948-L1056"}​ When a unit fires, the engine simulates trajectories frame-by-frame, resolves projectile hits, applies area zones, tallies knockback, and records deaths before the next team takes control.​:codex-file-citation[codex-file-citation]{line_range_start=204 line_range_end=299 path=client/src/engine.ts git_url="https://github.com/sunrise201238-sys/Game/blob/Mobile_Test/client/src/engine.ts#L204-L299"}​​:codex-file-citation[codex-file-citation]{line_range_start=353 line_range_end=457 path=client/src/engine.ts git_url="https://github.com/sunrise201238-sys/Game/blob/Mobile_Test/client/src/engine.ts#L353-L457"}​

### Modes
- **VS Bot:** Duel an AI that samples dozens of launch vectors, scoring outcomes to finish targets or shove them into hazards before committing to a play.​:codex-file-citation[codex-file-citation]{line_range_start=847 line_range_end=1096 path=client/src/engine.ts git_url="https://github.com/sunrise201238-sys/Game/blob/Mobile_Test/client/src/engine.ts#L847-L1096"}​
- **Hotseat:** Share a device as Team One and Team Two rotate turns, keeping the same round structure without automation.​:codex-file-citation[codex-file-citation]{line_range_start=922 line_range_end=1005 path=client/src/main.ts git_url="https://github.com/sunrise201238-sys/Game/blob/Mobile_Test/client/src/main.ts#L922-L1005"}​
- **Online Matchmaking:** Queue for peer-to-peer bouts, receive match assignments, and exchange drag actions over WebSockets with automatic reconnection and queue persistence.​:codex-file-citation[codex-file-citation]{line_range_start=358 line_range_end=399 path=client/src/main.ts git_url="https://github.com/sunrise201238-sys/Game/blob/Mobile_Test/client/src/main.ts#L358-L399"}​​:codex-file-citation[codex-file-citation]{line_range_start=14 line_range_end=35 path=shared/src/index.ts git_url="https://github.com/sunrise201238-sys/Game/blob/Mobile_Test/shared/src/index.ts#L14-L35"}​​:codex-file-citation[codex-file-citation]{line_range_start=183 line_range_end=247 path=server/src/index.ts git_url="https://github.com/sunrise201238-sys/Game/blob/Mobile_Test/server/src/index.ts#L183-L247"}​

### Units & Roles
The default loadout fields three Soldiers, two Archers, and a Mage, each with bespoke stats, projectiles, and area denial tools. Special rosters introduce the Perfect Soldier solo challenge and immovable VIP objectives that immediately decide a round if defeated.​:codex-file-citation[codex-file-citation]{line_range_start=3 line_range_end=118 path=client/src/config.ts git_url="https://github.com/sunrise201238-sys/Game/blob/Mobile_Test/client/src/config.ts#L3-L118"}​​:codex-file-citation[codex-file-citation]{line_range_start=352 line_range_end=409 path=client/src/config.ts git_url="https://github.com/sunrise201238-sys/Game/blob/Mobile_Test/client/src/config.ts#L352-L409"}​

### Battlefields
Seven mirrored arenas range from the open Training Grounds to lava-guarded choke points, twin-bridge islands, VIP forts, and the expansive Perfect Soldier proving ground, each specifying spawn points, lakes, walls, and optional objective units.​:codex-file-citation[codex-file-citation]{line_range_start=120 line_range_end=409 path=client/src/config.ts git_url="https://github.com/sunrise201238-sys/Game/blob/Mobile_Test/client/src/config.ts#L120-L409"}​

### Hazards & Objectives
Maps mark lethal lakes and structural walls, while the engine checks for out-of-bounds positions or hazard overlaps to knock out units instantly, layering persistent graves and status effects for damage-over-time zones.​:codex-file-citation[codex-file-citation]{line_range_start=120 line_range_end=409 path=client/src/config.ts git_url="https://github.com/sunrise201238-sys/Game/blob/Mobile_Test/client/src/config.ts#L120-L409"}​​:codex-file-citation[codex-file-citation]{line_range_start=377 line_range_end=461 path=client/src/engine.ts git_url="https://github.com/sunrise201238-sys/Game/blob/Mobile_Test/client/src/engine.ts#L377-L461"}​

---

## Controls & Interface

- **Drag-to-Aim:** Click/tap the highlighted unit, pull opposite the desired direction, and release to fire; the engine scales power based on drag distance and camera zoom.​:codex-file-citation[codex-file-citation]{line_range_start=600 line_range_end=790 path=client/src/main.ts git_url="https://github.com/sunrise201238-sys/Game/blob/Mobile_Test/client/src/main.ts#L600-L790"}​
- **Camera Mastery:** Middle-click/spacebar-drag to pan, use the mouse wheel or buttons for smooth zoom, and reset the camera with a single tap.​:codex-file-citation[codex-file-citation]{line_range_start=620 line_range_end=851 path=client/src/main.ts git_url="https://github.com/sunrise201238-sys/Game/blob/Mobile_Test/client/src/main.ts#L620-L851"}​
- **Touch & Fullscreen:** Two-finger pinch zoom, one-finger pan, and pseudo-fullscreen fallbacks keep play immersive on mobile while preserving board aspect ratios across devices.​:codex-file-citation[codex-file-citation]{line_range_start=47 line_range_end=205 path=client/src/main.ts git_url="https://github.com/sunrise201238-sys/Game/blob/Mobile_Test/client/src/main.ts#L47-L205"}​​:codex-file-citation[codex-file-citation]{line_range_start=207 line_range_end=356 path=client/src/main.ts git_url="https://github.com/sunrise201238-sys/Game/blob/Mobile_Test/client/src/main.ts#L207-L356"}​​:codex-file-citation[codex-file-citation]{line_range_start=508 line_range_end=590 path=client/src/main.ts git_url="https://github.com/sunrise201238-sys/Game/blob/Mobile_Test/client/src/main.ts#L508-L590"}​
- **HUD Feedback:** Squad panels surface HP bars, active highlights, match status messaging, and per-map descriptions so players can pivot modes, maps, or rematch instantly.​:codex-file-citation[codex-file-citation]{line_range_start=873 line_range_end=1014 path=client/src/main.ts git_url="https://github.com/sunrise201238-sys/Game/blob/Mobile_Test/client/src/main.ts#L873-L1014"}​

---

## Tech Stack

| Layer   | Details |
| ------- | ------- |
| Client  | Vite-powered TypeScript SPA with canvas rendering and custom input handling.​:codex-file-citation[codex-file-citation]{line_range_start=6 line_range_end=23 path=client/package.json git_url="https://github.com/sunrise201238-sys/Game/blob/Mobile_Test/client/package.json#L6-L23"}​​:codex-file-citation[codex-file-citation]{line_range_start=1 line_range_end=107 path=client/src/renderer.ts git_url="https://github.com/sunrise201238-sys/Game/blob/Mobile_Test/client/src/renderer.ts#L1-L107"}​ |
| Server  | Express static host plus WebSocket matchmaking loop with heartbeat pings and action relays.​:codex-file-citation[codex-file-citation]{line_range_start=13 line_range_end=247 path=server/src/index.ts git_url="https://github.com/sunrise201238-sys/Game/blob/Mobile_Test/server/src/index.ts#L13-L247"}​ |
| Shared  | TypeScript types for drag actions, matchmaking messages, and online status codes consumed by both sides.​:codex-file-citation[codex-file-citation]{line_range_start=8 line_range_end=35 path=shared/src/index.ts git_url="https://github.com/sunrise201238-sys/Game/blob/Mobile_Test/shared/src/index.ts#L8-L35"}​ |

---

## Getting Started

### Prerequisites
- Node.js 20+ and npm 9+ (the repo pins npm 10 for reproducible installs).​:codex-file-citation[codex-file-citation]{line_range_start=17 line_range_end=21 path=package.json git_url="https://github.com/sunrise201238-sys/Game/blob/Mobile_Test/package.json#L17-L21"}​
- The workspace uses npm workspaces; no global installs beyond the Node/npm requirement are necessary.​:codex-file-citation[codex-file-citation]{line_range_start=4 line_range_end=15 path=package.json git_url="https://github.com/sunrise201238-sys/Game/blob/Mobile_Test/package.json#L4-L15"}​

### Install & Build

```bash
npm run bootstrap   # install dependencies across client, server, and shared packages
npm run build       # compile shared types, server, then client bundles

Local Play
npm start                       # serve the production bundle at http://localhost:3001
npm run dev --workspace client  # launch the Vite dev server with hot reload

Online Service & Deployment
The server exposes /healthz, serves client/dist, and manages /match WebSocket connections for player pairing, queue cancellation, and relaying drag actions in real time. Render-friendly scripts bootstrap a local Node 20 toolchain, install workspaces with audits disabled, build all packages, and start the compiled server with environment-safe checks.

Repository Layout
client/   - Canvas tactics client with renderer, engine host, and input/UI loops
server/   - Express + ws relay for static hosting and matchmaking
shared/   - TypeScript definitions shared by client and server
scripts/  - Render deployment helpers (install, build, start)

License
MIT
