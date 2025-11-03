 (cd "$(git rev-parse --show-toplevel)" && git apply --3way <<'EOF' 
diff --git a/README.md b/README.md
index 8a2c0b93316a44983195b9abc29d72959b59df33..98bbaf4663d1cbd5960e2b69260bccdd611dafa5 100644
--- a/README.md
+++ b/README.md
@@ -1,79 +1,87 @@
-# [Slingshot Skirmish](https://game-server-w4xj.onrender.com/)
+# Slingshot Skirmish
 
-**Slingshot Skirmish** is a turn-based, physics-driven tactics game where teams of elite minions trade slingshot launches across hazardous arenas.  
-The project ships as a **Vite + TypeScript** canvas client, an **Express + WebSocket** relay for online matchmaking, and a **shared package** that synchronizes gameplay types across the stack.
+Slingshot Skirmish is a turn-based, physics-driven tactics game where squads of elite slingshotters duel across hazardous arenas. The project ships as a Vite + TypeScript canvas client, an Express + WebSocket relay for online matchmaking, and a shared TypeScript package that keeps gameplay contracts aligned across the stack.
 
 ---
 
-## 🧠 Core Gameplay
+## Core Gameplay
 
-### 🎯 Turn Flow & Simulation
-Each match alternates between Team One and Team Two, advancing through a fixed queue so living units act in order while fallen units are skipped without breaking turn cadence.  
-When a unit fires, the engine simulates trajectories frame-by-frame, resolves projectile hits, applies area zones, tallies knockback, and records deaths before the next team takes control.
+### Turn Flow & Simulation
+- Matches alternate between Team One and Team Two, advancing through a fixed initiative queue so fallen units are skipped without breaking cadence.
+- Launches simulate frame-by-frame trajectories, resolve projectile collisions, tally knockback, apply area zones, and record deaths before passing control to the other team.
 
----
-
-### ⚔️ Modes
-- **VS Bot:** Duel an AI that samples dozens of launch vectors, scoring outcomes to finish targets or shove them into hazards before committing to a play.
-- **Hotseat:** Share a device as Team One and Team Two rotate turns, keeping the same round structure without automation.
-- **Online Matchmaking:** Queue for peer-to-peer bouts, receive match assignments, and exchange drag actions over WebSockets with automatic reconnection and queue persistence.
-
----
-
-### 🧍 Units & Roles
-The default loadout fields three Soldiers, two Archers, and a Mage, each with bespoke stats, projectiles, and area denial tools.  
-Special rosters introduce the Perfect Soldier solo challenge and immovable VIP objectives that immediately decide a round if defeated.
+### Modes
+- **VS Bot:** Challenge an AI that evaluates dozens of prospective launch vectors, scores outcomes, and chooses the shot most likely to secure eliminations or push foes into hazards.
+- **Hotseat:** Share a device as teams swap turns locally while maintaining the full round structure.
+- **Online Matchmaking:** Queue for live bouts, receive match assignments, and exchange drag actions over resilient WebSocket connections with automatic reconnection support.
 
----
-
-### 🌋 Battlefields
-Seven mirrored arenas range from the open Training Grounds to lava-guarded choke points, twin-bridge islands, VIP forts, and the expansive Perfect Soldier proving ground, each specifying spawn points, lakes, walls, and optional objective units.
+### Units & Rosters
+- Core rosters feature Soldiers, Archers, and a Mage, each with bespoke stats, projectiles, and area denial tools.
+- Specialty scenarios introduce Perfect Soldier solo challenges and immovable VIP objectives that decide rounds immediately if defeated.
 
----
+### Battlefields
+- Seven mirrored arenas range from open training grounds to lava-guarded choke points, twin-bridge islands, fortified VIP keeps, and expansive Perfect Soldier proving grounds.
+- Each map defines spawn points, walls, lakes, and optional objective units to shape tactical priorities.
 
-### ☠️ Hazards & Objectives
-Maps mark lethal lakes and structural walls, while the engine checks for out-of-bounds positions or hazard overlaps to knock out units instantly, layering persistent graves and status effects for damage-over-time zones.
+### Hazards & Objectives
+- Lakes, out-of-bounds zones, and structural walls enforce lethal terrain interactions.
+- Persistent graves and status effects create lingering danger zones that influence positioning.
 
 ---
 
-## 🕹️ Controls & Interface
-
-- **Drag-to-Aim:** Click/tap the highlighted unit, pull opposite the desired direction, and release to fire; the engine scales power based on drag distance and camera zoom.  
-- **Camera Mastery:** Middle-click/spacebar-drag to pan, use the mouse wheel or buttons for smooth zoom, and reset the camera with a single tap.  
-- **Touch & Fullscreen:** Two-finger pinch zoom, one-finger pan, and pseudo-fullscreen fallbacks keep play immersive on mobile while preserving board aspect ratios across devices.  
-- **HUD Feedback:** Squad panels surface HP bars, active highlights, match status messaging, and per-map descriptions so players can pivot modes, maps, or rematch instantly.
+## Controls & Interface
+- **Drag to Aim:** Select the highlighted unit, pull opposite the desired direction, and release to fire with power scaled by drag distance and zoom.
+- **Camera Mastery:** Middle-click or spacebar-drag to pan, scroll to zoom, and reset the view instantly with a tap.
+- **Touch & Fullscreen:** Pinch-zoom and single-finger pan gestures keep mobile sessions intuitive, while pseudo-fullscreen fallbacks preserve the board aspect ratio across devices.
+- **HUD Feedback:** Squad panels display HP bars, active turn highlights, match status messaging, and per-map descriptions for quick context and rematch options.
 
 ---
 
-## ⚙️ Tech Stack
+## Tech Stack
 
-| **Layer** | **Details** |
-| ---------- | ------------ |
-| **Client** | Vite-powered TypeScript SPA with canvas rendering and custom input handling. |
-| **Server** | Express static host plus WebSocket matchmaking loop with heartbeat pings and action relays. |
-| **Shared** | TypeScript types for drag actions, matchmaking messages, and online status codes consumed by both sides. |
+| Layer  | Details |
+| ------ | ------- |
+| Client | Vite-powered TypeScript SPA with custom canvas rendering, input handling, and UI overlays. |
+| Server | Express static host with WebSocket matchmaking loops, heartbeat pings, and action relays. |
+| Shared | TypeScript definitions for drag actions, matchmaking messages, and status codes consumed by both client and server. |
 
 ---
 
-## 🚀 Getting Started
-
-### 🧩 Prerequisites
-- Node.js 20+ and npm 9+ (the repo pins npm 10 for reproducible installs).  
-- The workspace uses npm workspaces; no global installs beyond the Node/npm requirement are necessary.
+## Getting Started
 
----
-
-### 🛠️ Install & Build
+### Prerequisites
+- Node.js 20+ and npm 9+ (the repo pins npm 10 for reproducible installs).
+- The workspace relies on npm workspaces; no global installs beyond Node/npm are required.
 
+### Install & Build
 ```bash
 npm run bootstrap   # install dependencies across client, server, and shared packages
 npm run build       # compile shared types, server, then client bundles
+```
 
-🎮 Local Play
+### Local Play
+```bash
 npm start                       # serve the production bundle at http://localhost:3001
 npm run dev --workspace client  # launch the Vite dev server with hot reload
+```
+
+---
 
-🌐 Online Service & Deployment
+## Online Service & Deployment
+- The server exposes `/healthz`, serves the built `client/dist` bundle, and manages `/match` WebSocket connections for player pairing, queue cancellation, and drag action relays.
+- Render-friendly scripts provision Node 20, install workspace dependencies with audits disabled, build every package, and start the compiled server with safety checks suited for deployment.
+
+---
+
+## Repository Layout
+```
+client/   - Canvas tactics client with renderer, engine host, and input/UI loops
+server/   - Express + ws relay for static hosting and matchmaking
+shared/   - TypeScript definitions shared by client and server
+scripts/  - Render deployment helpers (install, build, start)
+```
+
+---
 
-The server exposes /healthz, serves client/dist, and manages /match WebSocket connections for player pairing, queue cancellation, and relaying drag actions in real time.
-Render-friendly scripts bootstrap a local Node 20 toolchain, install workspaces with audits disabled, build all packages, and start the compiled server with environment-safe checks.
+## License
+MIT
 
EOF
)
