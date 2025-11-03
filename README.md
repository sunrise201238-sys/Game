https://game-server-w4xj.onrender.com/

# Slingshot Skirmish

## Game Overview
Slingshot Skirmish is a turn-based arena battler where two teams of units face off on 2D maps. Each combatant acts by dragging to aim a slingshot vector that launches the active unit, turning momentum, collisions, and abilities into tactical tools. Teams alternate turns, advancing the round counter each time control returns to Team 0, and victory is awarded when all opposing controllable units are defeated or a sudden-death VIP objective is accomplished.

Every match begins with mirrored spawn positions that are clamped away from lakes and walls, ensuring fair spacing regardless of the map that was selected. Each team draws from the same default loadout—three Soldiers, two Archers, and a Mage—unless a map overrides the lineup or injects neutral VIP units that must be protected at all costs.

## Core Mechanics
The `GameEngine` encapsulates the offline, hotseat, and online rulesets so every mode shares identical simulation results. Key systems include:

- **Turn order.** Each team maintains a sorted queue of controllable units. Launching a unit advances the queue to the next living member, and the round counter increments whenever control returns to Team 0.
- **Action creation.** Drag input is clamped to the active unit’s `maxPower`, producing a `DragAction` (unit id, power, vector). In online mode the action is only executed after being echoed back from the server so both players stay deterministic.
- **Simulation & animation.** Resolving an action produces a frame-by-frame simulation of projectile travel, unit physics, knockback, and environmental collisions. Frames are streamed to the renderer while the engine tracks live projectiles and temporary zones for damage-over-time effects.
- **Win conditions.** Defeating every controllable unit on a team triggers victory for the opponent; simultaneous losses create a draw. Some maps place fragile VIP units with `loseOnDeath` enabled, so letting yours fall hands the win to your rival even if other fighters remain.
- **Status effects & zones.** Many abilities spawn lingering zones or DoT statuses that tick down at turn start, potentially finishing off weakened enemies or forcing repositioning. Zones fade after their turn limit and are cleared whenever their owner’s units are wiped out.
- **AI turns.** In bot mode, the engine pauses in a `bot-planning` phase, schedules an AI move, and then resolves it using the same physics as a human player. This ensures offline practice mirrors online pacing.

## Connection Mechanics
Online play runs through a dedicated Express/WebSocket service exposed at `/match`.

1. **Session creation.** Opening the client instantiates an `OnlineMatchClient`, which lazily connects to the WebSocket endpoint when you queue for a match or the UI otherwise requires live status updates. The client normalizes any configured origin into `ws://` or `wss://` and automatically appends the `/match` suffix so it works in dev and production deployments alike.
2. **Queueing.** Sending `{ type: 'queue', mapId }` registers you for matchmaking, clears any previous match state, and places the session into a FIFO wait list for the requested map. You can cancel with `{ type: 'cancel-queue' }` to return to idle without closing the socket.
3. **Matchmaking.** The server pairs the oldest two compatible sessions, assigns them a fresh `matchId`, and notifies each side of its team number and map selection via a `match-found` event. Heartbeat pings prune dead sockets so stale queue entries do not block pairing.
4. **In-match messaging.** During a match, the only payloads are `{ type: 'action' }` messages describing the drag vector applied by the acting player. The server validates the `matchId` and team before broadcasting that action to both participants, keeping each client in sync.
5. **Resilience.** The client queues outbound messages until the socket is open, retries with exponential backoff, and auto-requeues you after reconnecting if you opted into auto-queue. Heartbeat responses and manual closes keep the status machine accurate, surfacing `disconnected`, `error`, and `opponent-left` states to the UI.

## Units & Abilities
Each unit definition combines baseline stats with optional projectiles or area effects. Example highlights from the default roster include:

- **Soldier:** durable brawler with high collision damage and knockback, ideal for board control.
- **Archer:** lighter unit that trades survivability for long-range projectile shots guided by a smooth aiming curve.
- **Mage:** specialist that plants delayed AoE zones which pulse DoT damage over multiple turns.
- **Perfect Soldier (map-specific):** heavyweight elite that mixes both projectile and AoE tools, used in advanced scenarios.
- **VIP:** immobile objective unit; losing it immediately ends the match in defeat for that team.

## Maps & Environmental Hazards
Maps define arena bounds, spawn points, static walls, and lakes that absorb movement. The engine nudges spawn positions away from hazards to prevent unfair overlaps, and abilities such as AoE zones inherit team-tinted colors for instant readability.

## Game Modes
You can experience the slingshot combat loop in three distinct modes, all powered by the same simulation core:

- **Bot:** Practice against an AI that mirrors human rules and respects turn timing.
- **Hotseat:** Pass-and-play locally with alternating turns on the same device.
- **Online:** Queue through the WebSocket service for live PvP matches with reconnection support.

Explore the client UI to launch matches, experiment with maps, and master the physics-driven mechanics that define Slingshot Strategy.
