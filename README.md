# VideoShare

Private two-person movie sharing app scaffold for the plan in `Plan.md`.

## Current status

The repository now includes the completed foundations for Phase 0, Phase 1, Phase 2, Phase 3, Phase 4, and Phase 5:

- npm workspace monorepo structure
- Tauri v2 desktop host shell
- React + Vite + Tailwind web app
- Fastify server with SQLite-backed room persistence
- room creation, lookup, join, and close APIs
- Socket.IO realtime bootstrap, room presence, and playback synchronization
- media import endpoint with binary upload support
- ffprobe metadata extraction and FFmpeg HLS processing pipeline
- HLS asset serving for generated manifests and segments
- desktop host flow for selecting and uploading a local movie
- browser preview page for monitoring processing state and playing generated HLS media
- bundled `hls.js` playback path for offline/private Chrome and Firefox usage
- subtitle upload pipeline for `.srt`, `.vtt`, and `.ass`
- server-side subtitle conversion to served WebVTT output
- browser subtitle track loading and room-backed subtitle selection
- dedicated `/room/:token` secret room join flow with invalid/expired room handling
- SQLite-backed participant tracking with realtime host/guest presence
- server-authoritative room playback state with synchronized play, pause, and seek
- periodic playback heartbeat reporting with drift detection and soft/hard resync handling
- reconnect flow that restores canonical room playback state after the socket rejoins
- desktop controls for subtitle upload, room subtitle updates, room expiration, and secret room creation
- desktop reuse flow for previously uploaded media from earlier sessions
- desktop host can delete uploaded media and clean up generated playback artifacts
- local and LAN playback URLs for host-machine and same-network access during development
- shared packages for types, schemas, and utilities
- Dockerfile and Docker Compose for the server
- storage directories for media, HLS, subtitles, DB, and temp files

## Verified so far

- `npm run typecheck --workspace @videoshare/server`
- `npm run lint --workspace @videoshare/server`
- `npm run build --workspace @videoshare/server`
- `npm run typecheck --workspace @videoshare/web`
- `npm run lint --workspace @videoshare/web`
- `npm run build --workspace @videoshare/web`
- `npm run lint --workspace @videoshare/desktop`
- `npm run typecheck --workspace @videoshare/desktop`
- local room API flow and SQLite persistence
- real Socket.IO client connection handshake
- desktop host can upload a local movie file to the server
- host-side ffprobe / FFmpeg processing can drive media into `ready` state
- browser preview can detect processed media and attempt HLS playback
- browser playback no longer depends on a runtime CDN fetch for `hls.js`
- subtitle upload, conversion, and playback flow works locally
- room subtitle updates propagate through room-backed browser playback
- room playback play/pause/seek synchronization now flows through the authoritative server state
- playback drift reporting can trigger client resync updates during shared playback
- desktop host can select previously uploaded media and continue adding subtitles
- Docker Compose build and container startup for `app-server`

## Before first run

You need to install project dependencies yourself:

- `npm install`
- `ffmpeg` and `ffprobe`
- Tauri system prerequisites for Windows if not already installed
- set `WEB_URL` consistently for `web`, `desktop`, and `server` if you do not want to use the default `http://localhost:5173`

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
4. In the desktop app, either pick a local movie to upload or select a previously uploaded movie from the recent media list
5. Wait for processing to finish if needed, then optionally upload subtitle files and create a room
6. Share the generated secret room URL with the second viewer, or open it yourself to test the join flow
7. Join the room from two browser sessions and use either player to test synchronized play, pause, seek, subtitle selection, and reconnect recovery

## Current endpoints

- `GET /health`
- `GET /api/system/status`
- `POST /api/rooms`
- `GET /api/rooms/:token`
- `POST /api/rooms/:token/join`
- `POST /api/rooms/:token/subtitle`
- `POST /api/rooms/:token/close`
- `GET /api/media`
- `POST /api/media/import`
- `GET /api/media/:id`
- `DELETE /api/media/:id`
- `POST /api/media/:id/process`
- `POST /api/media/:id/subtitles`
- `GET /api/media/:id/subtitles`
- `GET /media/:mediaId/*`
- `GET /subtitles/:subtitleId.vtt`

## Socket events

Client to server:

- `room:join`
- `room:leave`
- `participant:heartbeat`
- `playback:play`
- `playback:pause`
- `playback:seek`
- `playback:state-report`

Server to client:

- `system:hello`
- `system:error`
- `room:joined`
- `room:state`
- `room:participant-joined`
- `room:participant-left`
- `playback:update`
- `playback:resync`

## Notes

- SQLite currently uses Node 22 built-in `node:sqlite`, so you may see an experimental warning at runtime.
- The web player uses a bundled `hls.js` dependency instead of loading it from a public CDN at runtime.
- `PUBLIC_BASE_URL` and `WEB_URL` can include a subpath such as `/videoshare/`; generated playback URLs preserve that prefix.
- During development, the desktop app shows both local and LAN URLs; LAN URLs are intended for devices on the same network, while `PUBLIC_BASE_URL` remains the path for future ngrok/public sharing.
- On this machine, the desktop Vite dev server works more reliably with `vite --configLoader native`.
- The current web production build succeeds, but Vite warns that the main chunk is larger than `500 kB`; route or feature-level splitting is a reasonable follow-up before later phases add more UI.
- If the desktop or web Vite page behaves strangely after config changes, clearing `apps/desktop/node_modules/.vite` or `apps/web/node_modules/.vite` can help.
