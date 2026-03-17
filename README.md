# VideoShare

VideoShare is a private desktop-first movie sharing app for two people. The host runs the local server and Tauri desktop app, imports a movie from disk, processes it into HLS, creates a secret room URL, and shares that URL with the second viewer.

Current implementation status:

- Phases 0 through 6 are complete.
- Phase 7 (WebRTC video call) is currently deferred.
- Shared browser playback, subtitles, room presence, and synchronized play/pause/seek are implemented.

## What the app does today

- Host imports a local movie file into the local server.
- Server probes the file with `ffprobe` and generates HLS output with `ffmpeg`.
- Host can upload `.srt`, `.vtt`, or `.ass` subtitles.
- Host creates a secret room URL from the Tauri desktop dashboard.
- Guest opens `/room/:token` in a browser.
- Both viewers can watch the same movie and stay synchronized through server-authoritative playback state.
- Subtitle selection is room-backed.
- Room presence and reconnect recovery are implemented.

## Repository layout

```text
apps/
  desktop/   Tauri host dashboard
  server/    Fastify + Socket.IO + SQLite + FFmpeg orchestration
  web/       Browser room UI
packages/
  shared-types/
  shared-schemas/
  shared-utils/
storage/
  media/     uploaded source files
  hls/       generated playlists and segments
  subtitles/ converted and served subtitle files
  db/        SQLite database
  temp/      temporary processing files
```

## Prerequisites

You need these installed on the host machine:

- Node.js 22+
- npm 11+
- `ffmpeg`
- `ffprobe`
- Tauri Windows prerequisites if you want to run the desktop shell in dev mode
- Docker Desktop if you want to use the containerized server flow

## Environment

Start from `.env.example`.

Important variables:

- `PORT`
- `PUBLIC_BASE_URL`
- `WEB_URL`
- `ROOM_TOKEN_BYTES`
- `HLS_OUTPUT_DIR`
- `MEDIA_INPUT_DIR`
- `SUBTITLE_DIR`
- `TEMP_DIR`
- `FFMPEG_PATH`
- `FFPROBE_PATH`

Recommended local development defaults:

- server: `http://localhost:3000`
- web: `http://localhost:5173`
- desktop dev shell: `npm run dev:desktop`

If you want generated secret room links to point to a different frontend origin, set `WEB_URL` consistently for server and desktop.

## Install dependencies

```bash
npm install
```

## Main commands

```bash
npm run dev:server
npm run dev:web
npm run dev:desktop
npm run docker:up
npm run docker:down
npm run typecheck
npm run lint
```

## Recommended local usage

### 1. Start the backend

For the current development flow, start the server directly:

```bash
npm run dev:server
```

You should then have:

- API on `http://localhost:3000`
- health endpoint on `http://localhost:3000/health`

### 2. Start the web app

```bash
npm run dev:web
```

Default local frontend:

- `http://localhost:5173`

### 3. Start the desktop host dashboard

```bash
npm run dev:desktop
```

The Tauri app is the main host control surface in the current implementation.

### 4. Host workflow in the desktop app

Inside the desktop app:

1. Pick a local movie file, or reuse a previously uploaded movie from the media library.
2. Wait for processing to finish if the movie is new.
3. Optionally upload subtitle files.
4. Choose the initial subtitle for the room.
5. Set host display name and room expiry.
6. Create the room.
7. Copy the generated room URL from the share panel.
8. If the host also wants to watch in the browser, use the desktop app's Local host room URL or LAN host room URL.

The desktop host dashboard also lets you:

- review processing progress
- inspect media metadata
- close the active room
- retry failed processing
- delete unused media
- monitor participant presence

### 5. Guest workflow

The guest does not need the desktop app.

Guest flow:

1. Open the secret room URL in a browser.
2. Enter a display name.
3. Join the room.
4. Watch the movie in the browser player.

### 5.1 Host browser playback

If the host wants to open the same room in a browser player:

1. Create the room from the desktop app.
2. Copy Local host room URL for the same machine, or LAN host room URL for another device on the same network.
3. Open that URL in a browser.

The host URL reuses the existing host participant instead of consuming the guest slot.

### 6. Shared playback behavior

Implemented today:

- synchronized play
- synchronized pause
- synchronized seek
- playback drift detection and resync
- room-backed subtitle selection
- reconnect recovery
- participant presence

Not implemented yet:

- WebRTC voice/video call

## Containerized server flow

If you want to run the server in Docker instead of directly through Node:

```bash
npm run docker:up
```

This uses `infra/docker-compose.yml` and mounts:

- `storage/media`
- `storage/hls`
- `storage/subtitles`
- `storage/db`
- `storage/temp`

The desktop app itself is still run locally on the host machine.

## Useful endpoints

### Health and diagnostics

- `GET /health`
- `GET /api/system/status`

### Rooms

- `POST /api/rooms`
- `GET /api/rooms/:token`
- `POST /api/rooms/:token/join`
- `POST /api/rooms/:token/subtitle`
- `POST /api/rooms/:token/close`

### Media

- `GET /api/media`
- `POST /api/media/import`
- `GET /api/media/:id`
- `DELETE /api/media/:id`
- `POST /api/media/:id/process`
- `POST /api/media/:id/subtitles`
- `GET /api/media/:id/subtitles`

### Static playback assets

- `GET /media/:mediaId/*`
- `GET /subtitles/:subtitleId.vtt`

## Useful workspace checks

```bash
npm run typecheck --workspace @videoshare/server
npm run lint --workspace @videoshare/server
npm run build --workspace @videoshare/server
npm run typecheck --workspace @videoshare/web
npm run lint --workspace @videoshare/web
npm run build --workspace @videoshare/web
npm run typecheck --workspace @videoshare/desktop
npm run lint --workspace @videoshare/desktop
npm run build --workspace @videoshare/desktop
```

Note: on this machine, some Vite builds may fail inside the sandbox with `spawn EPERM`; rerunning outside the sandbox succeeds.

## Current limitations

- Phase 7 WebRTC calling is deferred and not implemented.
- Public internet exposure through ngrok is planned but not yet packaged into a one-command host flow.
- The desktop app is currently a host dashboard, not a full remote participant client.
- The local Tauri command surface is still minimal and focused on status discovery.

## Practical notes

- SQLite currently uses Node 22 built-in `node:sqlite`.
- The web player uses bundled `hls.js`; it does not depend on a runtime CDN fetch.
- `PUBLIC_BASE_URL` and `WEB_URL` can include subpaths, and generated URLs preserve those prefixes.
- During local development, the desktop app can show both local and LAN room URLs.
- Media deletion is blocked while the media is still assigned to an active room.
