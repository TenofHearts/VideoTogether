# VideoShare

Private two-person movie sharing app scaffold for the plan in `Plan.md`.

## Current status

The repository now includes the completed foundations for Phase 0, Phase 1, and Phase 2:

- npm workspace monorepo structure
- Tauri v2 desktop host shell
- React + Vite + Tailwind web app
- Fastify server with SQLite-backed room persistence
- room creation, lookup, and close APIs
- Socket.IO realtime bootstrap and client handshake check
- media import endpoint with binary upload support
- ffprobe metadata extraction and FFmpeg HLS processing pipeline
- HLS asset serving for generated manifests and segments
- desktop host flow for selecting and uploading a local movie
- browser preview page for monitoring processing state and playing generated HLS media
- bundled `hls.js` playback path for offline/private Chrome and Firefox usage
- subpath-safe player and manifest URL generation for reverse-proxy deployments
- shared packages for types, schemas, and utilities
- Dockerfile and Docker Compose for the server
- storage directories for media, HLS, subtitles, DB, and temp files

## Verified so far

- `npm run build --workspace @videoshare/server`
- `npm run lint --workspace @videoshare/server`
- `npm run lint --workspace @videoshare/web`
- `npm run lint --workspace @videoshare/desktop`
- `npm run typecheck --workspace @videoshare/web`
- `npm run typecheck --workspace @videoshare/desktop`
- local room API flow and SQLite persistence
- real Socket.IO client connection handshake
- desktop host can upload a local movie file to the server
- host-side ffprobe / FFmpeg processing can drive media into `ready` state
- browser preview can detect processed media and attempt HLS playback
- browser playback no longer depends on a runtime CDN fetch for `hls.js`
- generated player and manifest URLs preserve configured subpaths behind reverse proxies
- Docker Compose build and container startup for `app-server`

## Before first run

You need to install project dependencies yourself:

- `npm install`
  - this now includes the bundled `hls.js` dependency used by the web player
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
3. Start the desktop shell with `npm run dev:desktop`
4. In the desktop app, pick a local movie and upload it to the server
5. Wait for processing to finish and copy the generated player URL if needed
6. Open the web app to monitor processing or play the generated HLS stream

## Current endpoints

- `GET /health`
- `GET /api/system/status`
- `POST /api/rooms`
- `GET /api/rooms/:token`
- `POST /api/rooms/:token/close`
- `GET /api/media`
- `POST /api/media/import`
- `GET /api/media/:id`
- `POST /api/media/:id/process`
- `GET /api/media/:id/subtitles`
- `GET /media/:mediaId/*`
- `GET /subtitles/:subtitleId.vtt`

## Notes

- SQLite currently uses Node 22 built-in `node:sqlite`, so you may see an experimental warning at runtime.
- The web player now uses a bundled `hls.js` dependency instead of loading it from a public CDN at runtime.
- `PUBLIC_BASE_URL` and `WEB_ORIGIN` can include a subpath such as `/videoshare/`; generated playback URLs now preserve that prefix.
- On this machine, the desktop Vite dev server works more reliably with `vite --configLoader native`.
- If the desktop or web Vite page behaves strangely after config changes, clearing `apps/desktop/node_modules/.vite` or `apps/web/node_modules/.vite` can help.
