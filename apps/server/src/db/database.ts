import { DatabaseSync } from 'node:sqlite';

const schemaSql = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    original_file_name TEXT NOT NULL,
    source_path TEXT NOT NULL,
    duration_ms INTEGER,
    container TEXT,
    video_codec TEXT,
    audio_codec TEXT,
    width INTEGER,
    height INTEGER,
    hls_manifest_path TEXT,
    processing_error TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS subtitles (
    id TEXT PRIMARY KEY,
    media_id TEXT NOT NULL,
    label TEXT NOT NULL,
    language TEXT,
    format TEXT NOT NULL,
    source_path TEXT NOT NULL,
    served_path TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT,
    status TEXT NOT NULL,
    host_client_id TEXT,
    current_playback_time REAL NOT NULL DEFAULT 0,
    playback_state TEXT NOT NULL DEFAULT 'paused',
    playback_rate REAL NOT NULL DEFAULT 1,
    last_state_updated_at TEXT NOT NULL,
    active_media_id TEXT,
    active_subtitle_id TEXT,
    FOREIGN KEY (active_media_id) REFERENCES media(id) ON DELETE SET NULL,
    FOREIGN KEY (active_subtitle_id) REFERENCES subtitles(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_rooms_token ON rooms(token);
  CREATE INDEX IF NOT EXISTS idx_subtitles_media_id ON subtitles(media_id);
`;

export type DatabaseContext = {
  connection: DatabaseSync;
  path: string;
};

export function createDatabase(databasePath: string): DatabaseContext {
  const connection = new DatabaseSync(databasePath);

  connection.exec(schemaSql);
  ensureColumnExists(connection, 'media', 'processing_error', 'TEXT');

  return {
    connection,
    path: databasePath
  };
}

function ensureColumnExists(
  connection: DatabaseSync,
  tableName: 'media' | 'rooms' | 'subtitles',
  columnName: string,
  columnDefinition: string
) {
  const columns = connection
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;

  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  connection.exec(
    `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`
  );
}
