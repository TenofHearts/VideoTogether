# Private Two-Person Movie Sharing App — Build Plan

## 1. Project Goal

Build a private desktop-first application for two users to watch a locally stored movie together over the internet, with:

- HLS-based movie streaming from the host machine
- synchronized play / pause / seek
- subtitles
- peer-to-peer video call
- secret-URL room access
- local-first deployment from the host laptop
- containerized server-side environment using Docker
- desktop client built with Tauri

---

## 2. Final Tech Stack

### 2.1 Desktop App
- **Tauri v2**
- **React**
- **TypeScript**
- **Vite**
- **Tailwind CSS**

### 2.2 Backend / Server
- **Node.js**
- **Fastify**
- **Socket.IO**
- **SQLite**
- **Prisma** or **better-sqlite3** for persistence

### 2.3 Media Pipeline
- **FFmpeg**
- **HLS output**
- **WebVTT subtitles**
- **Range / static file serving for HLS playlists and segments**

### 2.4 Realtime / Communication
- **Socket.IO** for:
  - room lifecycle
  - playback sync
  - presence
  - signaling for WebRTC
- **WebRTC** for:
  - video call
  - audio call

### 2.5 Infrastructure / Runtime
- **Docker**
- **Docker Compose**
- **ngrok** for secure internet exposure from host laptop
- optional **TURN server** later if peer-to-peer call reliability is insufficient

### 2.6 Tooling / Quality
- **ESLint**
- **Prettier**
- **Zod** for schema validation
- **Vitest** for unit tests
- **Playwright** optional for E2E
- **pnpm** or **npm**

---

## 3. Architecture Overview

## 3.1 Main Components

### A. Tauri Desktop Host App
Responsibilities:
- select local movie file
- select subtitle file(s)
- create room
- start / stop local system
- show shareable secret URL
- monitor connection and session state
- optionally embed local web UI

### B. Web Frontend
Responsibilities:
- room join page
- HLS video player UI
- subtitle selection UI
- synchronized playback UI
- WebRTC call UI
- presence and reconnect UI

### C. API + Realtime Server
Responsibilities:
- room creation and lookup
- room token validation
- canonical playback state
- Socket.IO room messaging
- WebRTC signaling relay
- metadata persistence
- subtitle metadata exposure
- HLS asset serving

### D. FFmpeg Worker
Responsibilities:
- inspect source media
- transcode or package local file into HLS
- generate playlist and segment files
- generate output profile metadata
- optionally convert subtitle formats

### E. SQLite Storage
Responsibilities:
- room metadata
- session metadata
- media metadata
- subtitle metadata
- playback snapshots
- app settings

### F. Tunnel Layer
Responsibilities:
- expose local API/frontend to remote user
- provide HTTPS public entrypoint
- optionally protect dashboard separately from room URL

---

## 4. Recommended Repository Structure

```text
project-root/
├─ apps/
│  ├─ desktop/                     # Tauri app
│  │  ├─ src/
│  │  ├─ src-tauri/
│  │  └─ package.json
│  ├─ web/                         # React frontend
│  │  ├─ src/
│  │  └─ package.json
│  └─ server/                      # Fastify + Socket.IO + FFmpeg orchestration
│     ├─ src/
│     │  ├─ api/
│     │  ├─ sockets/
│     │  ├─ services/
│     │  ├─ workers/
│     │  ├─ db/
│     │  ├─ lib/
│     │  └─ types/
│     ├─ prisma/
│     ├─ package.json
│     └─ Dockerfile
├─ packages/
│  ├─ shared-types/
│  ├─ shared-schemas/
│  └─ shared-utils/
├─ infra/
│  ├─ docker-compose.yml
│  ├─ ngrok/
│  └─ scripts/
├─ storage/
│  ├─ media/
│  ├─ hls/
│  ├─ subtitles/
│  ├─ db/
│  └─ temp/
├─ .env.example
├─ package.json
└─ README.md
```

---

## 5. Runtime Topology

### 5.1 Host Machine
Runs:
- Tauri desktop app
- Docker container for server
- FFmpeg inside container
- SQLite database file mounted as volume
- HLS output directory mounted as volume
- ngrok client on host or in dedicated container

### 5.2 Remote User
Uses:
- desktop browser in phase 1
- optional desktop client later

### 5.3 Network Flow
1. Host selects local movie file
2. Host app passes file path / import command to server
3. Server triggers FFmpeg HLS packaging job
4. Server stores metadata and room state
5. Host shares secret URL
6. Remote user opens URL
7. Frontend loads room metadata and HLS player
8. Playback state is synchronized through Socket.IO
9. WebRTC call is negotiated through signaling over Socket.IO
10. Media file is streamed via HLS over HTTPS through ngrok tunnel

---

## 6. Data Model

## 6.1 Entities

### Room
- `id`
- `token`
- `createdAt`
- `expiresAt`
- `status`
- `hostClientId`
- `currentPlaybackTime`
- `playbackState`
- `playbackRate`
- `lastStateUpdatedAt`
- `activeMediaId`
- `activeSubtitleId`

### Media
- `id`
- `originalFileName`
- `sourcePath`
- `durationMs`
- `container`
- `videoCodec`
- `audioCodec`
- `width`
- `height`
- `hlsManifestPath`
- `status`
- `createdAt`

### Subtitle
- `id`
- `mediaId`
- `label`
- `language`
- `format`
- `sourcePath`
- `servedPath`
- `isDefault`

### Participant
- `id`
- `roomId`
- `displayName`
- `role`
- `joinedAt`
- `lastSeenAt`
- `socketId`
- `connectionState`

### PlaybackEvent
- `id`
- `roomId`
- `participantId`
- `type`
- `payload`
- `createdAt`

### AppSetting
- `id`
- `key`
- `value`

---

## 7. API Surface

## 7.1 REST Endpoints

### Room
- `POST /api/rooms`
- `GET /api/rooms/:token`
- `POST /api/rooms/:token/join`
- `POST /api/rooms/:token/close`

### Media
- `POST /api/media/import`
- `GET /api/media/:id`
- `POST /api/media/:id/process`
- `GET /api/media/:id/subtitles`

### HLS / Static
- `GET /media/:mediaId/master.m3u8`
- `GET /media/:mediaId/:segmentName`
- `GET /subtitles/:subtitleId.vtt`

### Health / Diagnostics
- `GET /health`
- `GET /api/system/status`

## 7.2 Socket Events

### Client -> Server
- `room:join`
- `room:leave`
- `playback:play`
- `playback:pause`
- `playback:seek`
- `playback:state-report`
- `subtitle:select`
- `webrtc:offer`
- `webrtc:answer`
- `webrtc:ice-candidate`
- `participant:heartbeat`

### Server -> Client
- `room:joined`
- `room:state`
- `room:participant-joined`
- `room:participant-left`
- `playback:update`
- `playback:resync`
- `subtitle:update`
- `webrtc:offer`
- `webrtc:answer`
- `webrtc:ice-candidate`
- `system:error`

---

## 8. Playback Synchronization Model

## 8.1 Canonical State
Server is authoritative for:
- play / pause state
- current reference timestamp
- update timestamp
- playback rate
- active subtitle track
- active media

## 8.2 Sync Algorithm
- all control actions emit intent to server
- server validates and updates canonical state
- server broadcasts normalized state update
- clients apply state
- clients periodically send local playback reports
- server requests resync when drift exceeds threshold

## 8.3 Drift Policy
- acceptable drift threshold: `500ms-1000ms`
- soft correction under threshold overflow
- hard seek correction for large drift
- debounce rapid seek bursts

---

## 9. Media Pipeline Plan

## 9.1 Input
- host selects local file from desktop app
- file path is registered with server
- server performs media probe using FFmpeg / ffprobe

## 9.2 Output
- generate HLS playlist and segments
- store in mounted persistent volume
- expose manifest and segment files through Fastify static serving

## 9.3 Subtitle Pipeline
- support `.srt` and `.vtt`
- convert `.srt` to `.vtt` when necessary
- store converted subtitle files
- expose subtitle track URLs to frontend player

## 9.4 Processing Modes
### Initial MVP
- single HLS output profile
- prioritize compatibility and simplicity
- pre-process movie before session begins

### Later
- multiple renditions
- adaptive bitrate ladder
- faster seek tuning
- caching and cleanup policies

---

## 10. WebRTC Plan

## 10.1 Phase 1 Scope
- one-to-one video call
- one audio track + one video track per user
- signaling through Socket.IO
- basic ICE candidate exchange
- STUN-enabled connection setup

## 10.2 UI
- local self-preview
- remote video tile
- mute / unmute
- camera on / off
- hang up
- call status indicators

## 10.3 Reliability
- initial deployment without TURN
- add TURN only if direct peer connectivity is unreliable in testing

---

## 11. Docker Plan

## 11.1 Container Responsibilities
Single server container includes:
- Node.js server
- FFmpeg
- SQLite access via mounted volume
- HLS output generation and serving

## 11.2 Volume Mounts
- source media input directory
- generated HLS directory
- subtitles directory
- SQLite database directory
- temporary processing directory

## 11.3 Docker Compose Services
```yaml
services:
  app-server:
    build: ./apps/server
    ports:
      - "3000:3000"
    volumes:
      - ./storage/media:/app/storage/media
      - ./storage/hls:/app/storage/hls
      - ./storage/subtitles:/app/storage/subtitles
      - ./storage/db:/app/storage/db
      - ./storage/temp:/app/storage/temp
    environment:
      - NODE_ENV=development
      - DATABASE_URL=file:/app/storage/db/app.db
      - PUBLIC_BASE_URL=https://your-ngrok-domain
```

## 11.4 Container Networking
- frontend can be served either:
  - separately by Vite during development
  - as static assets from server in production mode
- server exposed on one internal port
- ngrok points to that port

---

## 12. Tauri Desktop Responsibilities

## 12.1 Host Controls
- select movie file
- select subtitle files
- create room
- start processing
- display share URL
- show processing progress
- close room
- stop local services

## 12.2 Local Integration
- manage server lifecycle in development or orchestration mode
- store host-side preferences
- optionally open embedded webview to local frontend
- surface health and logs

## 12.3 Minimal IPC Surface
- `pickMediaFile`
- `pickSubtitleFiles`
- `startSession`
- `stopSession`
- `getLocalStatus`
- `openShareUrl`
- `copyShareUrl`

---

## 13. Frontend Page Plan

## 13.1 Pages
- `/` landing / join entry
- `/host` host control dashboard
- `/room/:token` main watch room
- `/error` error / expired room

## 13.2 Room UI Sections
- video player
- subtitle controls
- participant status
- call panel
- playback controls
- sync status banner
- reconnect banner
- session info

---

## 14. Security Plan

- room access via long random secret token
- do not index or publicly list rooms
- validate room token server-side on every socket join
- room expiration support
- optional single active remote participant limit
- sanitize all metadata
- restrict file exposure only to generated HLS/subtitle outputs
- never expose arbitrary filesystem paths to client
- avoid directory traversal by strict static route handling
- prefer HTTPS public exposure through ngrok
- optionally rotate room token after room closure

---

## 15. Environment Variables

```bash
NODE_ENV=development
PORT=3000
DATABASE_URL=file:/app/storage/db/app.db
PUBLIC_BASE_URL=
ROOM_TOKEN_BYTES=32
HLS_OUTPUT_DIR=/app/storage/hls
MEDIA_INPUT_DIR=/app/storage/media
SUBTITLE_DIR=/app/storage/subtitles
TEMP_DIR=/app/storage/temp
FFMPEG_PATH=/usr/bin/ffmpeg
FFPROBE_PATH=/usr/bin/ffprobe
STUN_SERVERS=stun:stun.l.google.com:19302
```

---

## 16. Implementation Phases

## Phase 0 — Repository and Infrastructure Setup
### Goals
- initialize monorepo
- create Tauri app shell
- create React frontend
- create Fastify server
- create shared packages
- add Docker + Docker Compose
- establish local storage directories
- configure linting / formatting / TS configs

### Deliverables
- bootable repository
- containerized server starts successfully
- Tauri desktop shell launches
- frontend connects to local backend health endpoint

---

## Phase 1 — Core Server Foundation
### Goals
- implement Fastify server
- add SQLite persistence
- define schemas for room/media/subtitle
- implement room creation and lookup
- implement static serving foundations
- add Socket.IO bootstrap
- add health and status endpoints

### Deliverables
- server starts in Docker
- room creation works
- room retrieval works
- socket connection established
- DB persists entities locally

---

## Phase 2 — Media Import and HLS Processing
### Goals
- file selection flow from Tauri
- media registration endpoint
- ffprobe metadata extraction
- FFmpeg HLS generation pipeline
- HLS output storage and serving
- processing status tracking
- error handling for unsupported files

### Deliverables
- host can select local movie
- server processes movie into HLS
- generated `.m3u8` and segments are served
- remote browser can load and play stream

---

## Phase 3 — Subtitle Support
### Goals
- subtitle file import from Tauri
- `.srt` to `.vtt` conversion
- subtitle metadata registration
- subtitle serving endpoint
- player subtitle selection UI

### Deliverables
- subtitles appear in player
- both users see same selected subtitle track
- subtitle switching propagates through room state

---

## Phase 4 — Secret Room Flow
### Goals
- generate secure room token
- create room join page
- enforce token-based room access
- room expiration and invalid token handling
- room participant tracking

### Deliverables
- host gets shareable secret URL
- remote user joins room successfully
- invalid / expired rooms are handled cleanly

---

## Phase 5 — Playback Synchronization
### Goals
- canonical playback state model
- play / pause / seek events
- server broadcast state updates
- client application of canonical updates
- heartbeat and drift detection
- reconnection state recovery

### Deliverables
- both users can control playback
- play / pause / seek stay synchronized
- reconnect restores session state
- drift correction works

---

## Phase 6 — Host Dashboard in Tauri
### Goals
- local dashboard for selected movie
- subtitle selection panel
- room creation panel
- processing progress UI
- participant list / status
- copy secret URL action

### Deliverables
- host controls everything from desktop app
- no manual API calls required
- room status visible from Tauri UI

---

## Phase 7 — WebRTC Video Call
### Goals
- add media device permissions
- implement local/remote video panels
- create signaling events via Socket.IO
- offer / answer / ICE exchange
- call controls
- connection status indicators

### Deliverables
- one-to-one video call works in room
- mute/camera toggles work
- call survives normal room usage

---

## Phase 8 — Stability and UX Polish
### Goals
- loading / buffering states
- sync status indicators
- retry / reconnect handling
- graceful server-side error messages
- room cleanup policy
- HLS artifact cleanup policy
- better host diagnostics

### Deliverables
- reliable session experience
- understandable failure states
- cleaner operator experience for host

---

## Phase 9 — Packaging and Production-Like Local Deployment
### Goals
- production frontend build served by server
- Docker image hardening
- Tauri packaging
- one-command local startup flow
- ngrok integration workflow
- environment setup scripts

### Deliverables
- packaged desktop app
- reproducible local deployment
- straightforward host startup process

---

## 17. Task Breakdown by Layer

## 17.1 Shared Package Tasks
- define DTOs
- define event payload types
- define room state schema
- define media metadata schema
- define validation schemas using Zod

## 17.2 Server Tasks
- Fastify app bootstrap
- Prisma schema or SQLite access layer
- room service
- media service
- FFmpeg worker service
- subtitle service
- playback sync service
- WebRTC signaling service
- cleanup scheduler

## 17.3 Frontend Tasks
- room state store
- HLS player wrapper
- socket connection layer
- playback sync adapter
- subtitle track UI
- call panel
- reconnect / error banners

## 17.4 Tauri Tasks
- file picker integration
- desktop commands
- local config persistence
- server status display
- host workflow orchestration

---

## 18. Suggested Development Order

1. monorepo + container + basic server
2. room API + room page
3. media import + ffprobe
4. HLS generation + video playback
5. subtitle pipeline
6. sync state model
7. play/pause/seek synchronization
8. Tauri host dashboard
9. WebRTC call
10. reconnect/polish/package

---

## 19. Done Criteria for MVP

The MVP is complete when all of the following are true:

- host launches desktop app
- host selects a local movie file
- movie is processed into HLS
- host generates a secret room URL
- remote participant opens the URL from another location
- both users can watch the movie in a browser-based player UI
- both users can play / pause / seek
- subtitles work
- video call works
- all server-side runtime pieces run in Docker
- the system works through ngrok from the host laptop

---

## 20. Post-MVP Enhancements

- TURN server support
- adaptive bitrate renditions
- resumable rooms
- room history
- prettier participant identities
- chat
- thumbnail previews on seek
- media library
- automatic transcoding presets
- desktop client for remote participant
- access revocation / room lock
- host migration / co-host logic

---

## 21. Non-Goals for Initial Build

- mobile-first support
- multi-room scaling
- multi-user group watch
- DRM-protected commercial streaming source integration
- distributed cloud deployment
- microservices
- advanced auth/accounts
- adaptive bitrate ladder at initial release

---

## 22. Developer Notes for Agent

- prefer clean separations between media serving, playback sync, and WebRTC signaling
- keep room state authoritative on server
- keep client state thin and recoverable
- avoid exposing arbitrary local filesystem paths to frontend
- keep Dockerized server self-contained
- prioritize correctness of HLS pipeline and sync semantics before polish
- implement browser-first remote experience even though host uses Tauri
- design code so remote desktop app can be added later without major backend changes
- only the server backend runs on Docker, the application itself may run on the local computer. 