# VideoShare

Private two-person movie sharing app scaffold for the plan in `Plan.md`.

## Phase 1 status

This repository now includes:

- npm workspace monorepo structure
- Tauri v2 desktop shell
- React + Vite + Tailwind web app
- Fastify server with SQLite-backed room persistence
- room creation, lookup, and close APIs
- Socket.IO realtime bootstrap and client handshake check
- shared packages for types, schemas, and utilities
- Dockerfile and Docker Compose for the server
- storage directories for media, HLS, subtitles, DB, and temp files

## Verified in Phase 1

- `npm run build --workspace @videoshare/server`
- `npm run lint --workspace @videoshare/server`
- `npm run build --workspace @videoshare/web`
- `npm run lint --workspace @videoshare/web`
- local room API flow and SQLite persistence
- real Socket.IO client connection handshake
- Docker Compose build and container startup for `app-server`

## Before first run

You need to install project dependencies yourself:

- `npm install`
- `ffmpeg` and `ffprobe`
- Tauri system prerequisites for Windows if not already installed

## Common commands

```bash
npm run dev:server
npm run dev:web
npm run dev:desktop
npm run docker:up
```

## Local dev flow

1. Start the server on `http://localhost:3000`
2. Start the web app on `http://localhost:5173`
3. Open the desktop shell if you want the host UI shell
4. The web home page checks `/health`, `/api/system/status`, and the Socket.IO connection state

## Current Phase 1 endpoints

- `GET /health`
- `GET /api/system/status`
- `POST /api/rooms`
- `GET /api/rooms/:token`
- `POST /api/rooms/:token/close`
- `GET /api/media/:id`
- `GET /api/media/:id/subtitles`
- `GET /media/:mediaId/*`
- `GET /subtitles/:subtitleId.vtt`

## Notes

- SQLite currently uses Node 22 built-in `node:sqlite`, so you may see an experimental warning at runtime.
