# Slingshot Strategy Game

A multiplayer strategy playground built with a Node.js/TypeScript monorepo. The project hosts a realtime game server and a Vite-powered web client that share common logic through a shared workspace package.

- **Live demo:** https://game-server-w4xj.onrender.com/
- **Workspaces:** `client`, `server`, and `shared`

## Prerequisites

- Node.js 20+
- npm 9+

## Getting Started

1. Install dependencies for all workspaces:

   ```bash
   npm run bootstrap
   ```

2. Build the shared types and bundles:

   ```bash
   npm run build
   ```

3. Start the server (after building):

   ```bash
   npm run start
   ```

4. Run development servers individually when iterating:

   ```bash
   # API server (Express + WebSocket)
   npm run dev --workspace server

   # Web client (Vite dev server)
   npm run dev --workspace client
   ```

## Project Structure

```
.
├── client   # Vite + React front-end
├── server   # Express/WebSocket backend
├── shared   # Shared TypeScript utilities and types
└── scripts  # Helper scripts for project maintenance
```

## Additional Scripts

- `npm run lint` – Lint the client and server workspaces.
- `npm run format` – Format client and server source files.

Feel free to explore the individual workspace READMEs or source files for deeper implementation details.
