import type { AppDatabase } from "../db.js";
import { refundAppDefinition } from "./refunds.js";

const seedTime = "2026-11-23T04:15:00.000Z";

export function seedPublishedRefundApp(db: AppDatabase): void {
  const appId = "0814100e-c259-426a-81b0-68f73f9da561";
  const revisionId = "1f1bbdbc-76a9-4f31-9947-8812486bb982";
  db.prepare(
    `INSERT OR IGNORE INTO apps (id, name, created_by, created_at, published_revision_id)
     VALUES (?, ?, 'user_builder', ?, ?)`,
  ).run(appId, refundAppDefinition.name, seedTime, revisionId);
  db.prepare(
    `INSERT OR IGNORE INTO app_revisions
      (id, app_id, revision_number, definition_json, published_by, published_at)
     VALUES (?, ?, 1, ?, 'user_builder', ?)`,
  ).run(revisionId, appId, JSON.stringify(refundAppDefinition), seedTime);
  db.prepare(
    `INSERT OR IGNORE INTO app_drafts (app_id, definition_json, version, updated_by, updated_at)
     VALUES (?, ?, 1, 'user_builder', ?)`,
  ).run(appId, JSON.stringify(refundAppDefinition), seedTime);
}
