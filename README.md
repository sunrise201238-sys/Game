# [Slingshot Skirmish](https://game-server-w4xj.onrender.com/)

**Slingshot Skirmish** is a turn-based, physics-driven tactics game where teams of elite minions trade slingshot launches across hazardous arenas.  
The project ships as a **Vite + TypeScript** canvas client, an **Express + WebSocket** relay for online matchmaking, and a **shared package** that synchronizes gameplay types across the stack.

---

## 🧠 Core Gameplay

### 🎯 Turn Flow & Simulation
Each match alternates between Team One and Team Two, advancing through a fixed queue so living units act in order while fallen units are skipped without breaking turn cadence.  
When a unit fires, the engine simulates trajectories frame-by-frame, resolves projectile hits, applies area zones, tallies knockback, and records deaths before the next team takes control.

---

### ⚔️ Modes
- **VS Bot:** Duel an AI that samples dozens of launch vectors, scoring outcomes to finish targets or shove them into hazards before committing to a play.
- **Hotseat:** Share a device as Team One and Team Two rotate turns, keeping the same round structure without automation.
- **Online Matchmaking:** Queue for peer-to-peer bouts, receive match assignments, and exchange drag actions over WebSockets with automatic reconnection and queue persistence.

---

### 🧍 Units & Roles
The default loadout fields three Soldiers, two Archers, and a Mage, each with bespoke stats, projectiles, and area denial tools.  
Special rosters introduce the Perfect Soldier solo challenge and immovable VIP objectives that immediately decide a round if defeated.

---

### 🌋 Battlefields
Seven mirrored arenas range from the open Training Grounds to lava-guarded choke points, twin-bridge islands, VIP forts, and the expansive Perfect Soldier proving ground, each specifying spawn points, lakes, walls, and optional objective units.

---

### ☠️ Hazards & Objectives
Maps mark lethal lakes and structural walls, while the engine checks for out-of-bounds positions or hazard overlaps to knock out units instantly, layering persistent graves and status effects for damage-over-time zones.

---

## 🕹️ Controls & Interface

- **Drag-to-Aim:** Click/tap the highlighted unit, pull opposite the desired direction, and release to fire; the engine scales power based on drag distance and camera zoom.  
- **Camera Mastery:** Middle-click/spacebar-drag to pan, use the mouse wheel or buttons for smooth zoom, and reset the camera with a single tap.  
- **Touch & Fullscreen:** Two-finger pinch zoom, one-finger pan, and pseudo-fullscreen fallbacks keep play immersive on mobile while preserving board aspect ratios across devices.  
- **HUD Feedback:** Squad panels surface HP bars, active highlights, match status messaging, and per-map descriptions so players can pivot modes, maps, or rematch instantly.

---

## ⚙️ Tech Stack

| **Layer** | **Details** |
| ---------- | ------------ |
| **Client** | Vite-powered TypeScript SPA with canvas rendering and custom input handling. |
| **Server** | Express static host plus WebSocket matchmaking loop with heartbeat pings and action relays. |
| **Shared** | TypeScript types for drag actions, matchmaking messages, and online status codes consumed by both sides. |

---

## 🚀 Getting Started

### 🧩 Prerequisites
- Node.js 20+ and npm 9+ (the repo pins npm 10 for reproducible installs).  
- The workspace uses npm workspaces; no global installs beyond the Node/npm requirement are necessary.

---

### 🛠️ Install & Build

```bash
npm run bootstrap   # install dependencies across client, server, and shared packages
npm run build       # compile shared types, server, then client bundles

**Local Play**
npm start                       # serve the production bundle at http://localhost:3001
npm run dev --workspace client  # launch the Vite dev server with hot reload

**Online Service & Deployment**
The server exposes /healthz, serves client/dist, and manages /match WebSocket connections for player pairing, queue cancellation, and relaying drag actions in real time. Render-friendly scripts bootstrap a local Node 20 toolchain, install workspaces with audits disabled, build all packages, and start the compiled server with environment-safe checks.
