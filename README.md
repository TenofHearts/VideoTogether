# VideoShare

Private two-person movie sharing app scaffold for the plan in `Plan.md`.

## Phase 0 status

This repository now includes:

- npm workspace monorepo structure
- Tauri v2 desktop shell
- React + Vite + Tailwind web app
- Fastify server with `/health`
- shared packages for types, schemas, and utilities
- Dockerfile and Docker Compose for the server
- storage directories for media, HLS, subtitles, DB, and temp files

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
4. The web home page polls `/health` and shows backend status
