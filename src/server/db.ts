import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type AppDatabase = Database.Database;

export function openDatabase(path = process.env.DB_PATH ?? "./data/app.db"): AppDatabase {
  const dbPath = path === ":memory:" ? path : resolve(path);
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  return db;
}

export function hasSchema(db: AppDatabase): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'")
      .get(),
  );
}

export function initializeSchema(db: AppDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('builder', 'reviewer', 'viewer')),
      password_hash TEXT NOT NULL,
      org_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS login_attempts (
      username TEXT NOT NULL,
      ip TEXT NOT NULL,
      at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS login_attempts_lookup_idx
      ON login_attempts(username, ip, at);

    CREATE TABLE IF NOT EXISTS apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      published_revision_id TEXT
    );

    CREATE TABLE IF NOT EXISTS app_drafts (
      app_id TEXT PRIMARY KEY REFERENCES apps(id) ON DELETE CASCADE,
      definition_json TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version >= 1),
      updated_by TEXT NOT NULL REFERENCES users(id),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_revisions (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
      revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
      definition_json TEXT NOT NULL,
      published_by TEXT NOT NULL REFERENCES users(id),
      published_at TEXT NOT NULL,
      UNIQUE (app_id, revision_number)
    );

    CREATE TABLE IF NOT EXISTS refund_requests (
      id TEXT PRIMARY KEY,
      customer_ref TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
      currency TEXT NOT NULL,
      reason_submitted TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
      version INTEGER NOT NULL CHECK (version >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kyc_cases (
      id TEXT PRIMARY KEY,
      customer_ref TEXT NOT NULL,
      masked_email TEXT NOT NULL,
      masked_phone TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
      version INTEGER NOT NULL CHECK (version >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feature_flags (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      environment TEXT NOT NULL CHECK (environment = 'staging'),
      version INTEGER NOT NULL CHECK (version >= 1),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL,
      actor_user_id TEXT NOT NULL REFERENCES users(id),
      event_type TEXT NOT NULL CHECK (event_type IN ('action', 'publish')),
      app_id TEXT NOT NULL REFERENCES apps(id),
      app_revision_id TEXT NOT NULL REFERENCES app_revisions(id),
      dataset_id TEXT,
      record_id TEXT,
      action_id TEXT,
      reason TEXT,
      before_json TEXT,
      after_json TEXT
    );
    CREATE INDEX IF NOT EXISTS audit_events_record_idx
      ON audit_events(dataset_id, record_id, at DESC);

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      user_id TEXT NOT NULL REFERENCES users(id),
      key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      response_status INTEGER NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, key)
    );
  `);
}
