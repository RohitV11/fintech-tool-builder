import type { AppDatabase } from "../db.js";
import { AppDefinitionSchema } from "../../shared/schema.js";
import flagsSeed from "./flags.json" with { type: "json" };
import kycSeed from "./kyc.json" with { type: "json" };

const seedTime = "2026-11-23T04:15:00.000Z";

export const kycAppId = "a64f31e4-39c2-4d49-86a8-e33ca68a71ad";
export const flagsAppId = "ba1f9a7a-627e-42b0-a8a0-9af1e2614214";

export const kycAppDefinition = AppDefinitionSchema.parse(kycSeed);
export const flagsAppDefinition = AppDefinitionSchema.parse(flagsSeed);

function seedPublishedApp(
  db: AppDatabase,
  appId: string,
  revisionId: string,
  definition: (typeof kycAppDefinition),
): void {
  db.prepare(
    `INSERT OR IGNORE INTO apps (id, name, created_by, created_at, published_revision_id)
     VALUES (?, ?, 'user_builder', ?, ?)`,
  ).run(appId, definition.name, seedTime, revisionId);
  db.prepare(
    `INSERT OR IGNORE INTO app_revisions
      (id, app_id, revision_number, definition_json, published_by, published_at)
     VALUES (?, ?, 1, ?, 'user_builder', ?)`,
  ).run(revisionId, appId, JSON.stringify(definition), seedTime);
  db.prepare(
    `INSERT OR IGNORE INTO app_drafts (app_id, definition_json, version, updated_by, updated_at)
     VALUES (?, ?, 1, 'user_builder', ?)`,
  ).run(appId, JSON.stringify(definition), seedTime);
}

export function seedPublishedKycApp(db: AppDatabase): void {
  seedPublishedApp(db, kycAppId, "b8a7e238-6a41-48df-bc79-e940908e3a5f", kycAppDefinition);
}

export function seedPublishedFlagsApp(db: AppDatabase): void {
  seedPublishedApp(db, flagsAppId, "e1db4909-9407-4058-9f3e-4c56ff864833", flagsAppDefinition);
}
