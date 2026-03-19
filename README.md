# VideoTogether

> [简体中文](./README_zh.md)

VideoTogether is a private movie sharing project designed for two people in the same LAN.

The host imports a local video file, processes it into HLS with `ffprobe` and `ffmpeg`, creates a private room link, and shares that link with a second viewer. The viewer does not need the desktop app and can join directly from a browser.

The current primary workflow is: run locally, share quickly, and keep playback synchronized for two people.

## Features

Implemented today:

- Local video import
- Media probing with `ffprobe`
- HLS transcoding and segmentation with `ffmpeg`
- Subtitle import and conversion for `.srt`, `.vtt`, and `.ass`
- Private room creation and shareable links
- Browser-based room playback
- Two-person synchronized `play / pause / seek`
- Room-level subtitle selection sync
- Participant presence and reconnect recovery
- Tauri desktop host dashboard
- One-command host startup flow

## Repository Layout

```text
apps/
  desktop/   Tauri desktop host dashboard
  server/    Fastify + Socket.IO + SQLite + FFmpeg backend
  web/       Browser playback and room UI
packages/
  shared-types/
  shared-schemas/
  shared-utils/
storage/
  media/     uploaded source videos
  hls/       generated HLS manifests and segments
  subtitles/ converted subtitle files
  db/        SQLite database
  temp/      temporary processing directory
infra/
  docker-compose.yml
  scripts/   startup, shutdown, and packaging scripts
```

## For Users (Windows)

You can install VideoTogether directly on Windows:
1. Download the latest Windows installer (`.exe`) from the [Releases](https://github.com/TenofHearts/VideoTogether/releases) page.
2. Run the installer and follow the instructions.
3. Configure your ip in `.env.example`
4. Launch VideoTogether from your Start menu.

### IP configuation

Open the terminal of your choice, say, powershell. Input the command: 

```powershell
> ipconfig
```

You'll get your ipv4 address in the result that looks something like this: 

```
Ethernet adapter Ethernet:

   Connection-specific DNS Suffix  . :
   IPv6 Address. . . . . . . . . . . : xxxx:xxxx:xxxx:xxxx::xxxx
   Link-local IPv6 Address . . . . . : fe80::xxxx:xxxx:xxxx:xxxx%xx
   IPv4 Address. . . . . . . . . . . : 10.x.x.x
   Subnet Mask . . . . . . . . . . . : 255.255.240.0
   Default Gateway . . . . . . . . . : fe80::xxxx:xxxx:xxxx:xxxx%xx
                                       10.x.x.x
```

You need to copy the IPv4 address, and paste it into `.env.example`: 

```env
...
LAN_IP=10.x.x.x
...
```

And after that, you're done!

#### Note about Zerotier

As is stated later, zerotier is required to share the movie with someone not in the same physical LAN. In this case, you'll need to : 
1. Download zerotier
2. Join the same virtual LAN with whom you'd like to share the movie with
3. Set the `LAN_IP` in `.env.example` as the ip you assigned yourself in the zerotier panel.

Once you've successfully configured zerotier, you should see something like this after running `ipconfig`: 
```
Ethernet adapter ZeroTier One [xxxxxxxxxxxxxxxx]:

   Connection-specific DNS Suffix  . :
   Link-local IPv6 Address . . . . . : fe80::xxxx:xxxx:xxxx:xxxx%xx
   IPv4 Address. . . . . . . . . . . : 10.x.x.x
   Subnet Mask . . . . . . . . . . . : 255.255.255.0
   Default Gateway . . . . . . . . . : 25.x.x.x
```
The IPv4 in this result should match the ip you assigned yourself in zerotier. 

## For Developers

### Requirements

You need these on the host machine:

- Node.js 22+
- npm 11+
- `ffmpeg`
- `ffprobe`
- Rust / Tauri Windows build prerequisites
  - required for desktop development or packaging
- Docker Desktop
  - only required when `USE_DOCKER=true`

### Environment Variables

Start from `.env.example`.

Important variables:

- `USE_DOCKER`
  - controls whether the host startup script uses Docker for the server
  - default: `false`
- `PORT`
  - local server port used by the production-like host flow
  - default: `3003`
- `PUBLIC_PROTOCOL`
  - protocol used when deriving public share URLs
  - default: `http`
- `PUBLIC_HOST`
  - hostname used when deriving public share URLs
  - default: `localhost`
- `WEB_DEV_PORT`
  - Vite development server port used by `npm run dev`
  - default: `5173`
- `LAN_IP`
  - fixed IPv4 used by the desktop app when generating LAN room URLs
  - set this to the exact IPv4 you want to expose, such as your ZeroTier IPv4
- `FFMPEG_PATH`
  - path to the `ffmpeg` executable
- `FFPROBE_PATH`
  - path to the `ffprobe` executable

Current `.env.example` defaults assume:

- development web URL: `http://localhost:5173`
- production-like local host flow: `http://localhost:3003`
- Docker disabled by default
- LAN URL generation uses only the explicit `LAN_IP` value

### Install Dependencies

From the repository root:

```bash
npm install
```

## Recommended Usage

### 1. Start the host flow

```bash
npm run host:start
```

This command will:

- build the production `web` assets
- build the production `server` assets
- start the local production server
- launch the Tauri desktop host dashboard

Default behavior:

- Docker is not used
- share links point to `http://localhost:3000`
- LAN room URLs are only generated from `LAN_IP`

To stop the host flow:

```bash
npm run host:stop
```

This stops the background local server process tree started by `host:start`.

If you only want the local server and do not want to launch the desktop app:

```bash
npm run host:start -- -SkipDesktop
```

### 2. Use the desktop host dashboard

Recommended host flow inside the desktop app:

1. Select a local video file, or reuse an existing media item from the library.
2. Wait for processing to complete.
3. Optionally upload subtitle files.
4. Choose the room's initial subtitle.
5. Set the host display name and room expiration.
6. Create the room.
7. Copy the share link and send it to the second viewer.

The desktop app also provides:

- processing status
- media metadata
- room status
- participant presence
- subtitle updates
- room closing
- unused media deletion
- local URL and LAN URL copy actions

If you want the desktop app to generate LAN URLs, set `LAN_IP` to the exact IPv4 you want to use, for example your ZeroTier IPv4. The app does not auto-detect LAN IPs.

### 3. Guest usage

The guest does not need the desktop app.

They only need to:

1. Open the room link in a browser.
2. Enter a display name.
3. Join the room.
4. Watch the synchronized stream.

## Docker Is Optional

If you want `host:start` to run the server through Docker, set:

```bash
USE_DOCKER=true
```

Then run the same command:

```bash
npm run host:start
```

In this mode the script will:

- use `infra/docker-compose.yml`
- run the server inside a container
- mount the local `storage/*` directories
- still run the desktop app on the host machine

## Local Development Mode

If you want to work with separate dev processes for web, server, and desktop:

```bash
npm run dev:server
npm run dev:web
npm run dev:desktop
```

Default development endpoints:

- API: `http://localhost:3000`
- Web: `http://localhost:5173`
- Desktop dev shell: `npm run dev:desktop`

## Common Commands

- `npm run host:start`
  - builds the production web and server bundles, starts the local host server, and launches the Tauri desktop dashboard
- `npm run host:stop`
  - stops the background server process tree started by `host:start`
- `npm run host:start -- -SkipDesktop`
  - starts the local host server only, without launching the desktop app
- `npm run desktop:package`
  - builds the Tauri desktop installer bundles
- `npm run dev:server`
  - runs the Fastify server in development watch mode
- `npm run dev:web`
  - runs the Vite web app in development mode
- `npm run dev:desktop`
  - runs the Tauri desktop app in development mode
- `npm run build:host`
  - builds production assets for `apps/web` and `apps/server`
- `npm run lint`
  - runs ESLint across all workspaces that define a lint script
- `npm run typecheck`
  - runs TypeScript type checking across all workspaces without emitting build artifacts

## Routes and Endpoints

Health and diagnostics:

- `GET /health`
- `GET /api/system/status`

Room endpoints:

- `POST /api/rooms`
- `GET /api/rooms/:token`
- `POST /api/rooms/:token/join`
- `POST /api/rooms/:token/subtitle`
- `POST /api/rooms/:token/close`

Media endpoints:

- `GET /api/media`
- `POST /api/media/import`
- `GET /api/media/:id`
- `DELETE /api/media/:id`
- `POST /api/media/:id/process`
- `POST /api/media/:id/subtitles`
- `GET /api/media/:id/subtitles`

Static playback assets:

- `GET /media/:mediaId/*`
- `GET /subtitles/:subtitleId.vtt`
- `GET /`
- `GET /room/:token`

## Pro Tip

To share video with people not within the same physical LAN, you can use projects like [zerotier](https://www.zerotier.com/)

# License

This project is licensed under the Apache License 2.0 - see the `LICENSE` file for details.

This project uses [FFmpeg](https://ffmpeg.org) which is licensed under the GNU Lesser General Public License (LGPL) version 2.1 or later.
