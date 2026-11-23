import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AppDefinitionSchema } from "../src/shared/schema.js";
import { openDatabase } from "../src/server/db.js";

const targets = [
  { name: "KYC review", datasetId: "kyc", fileName: "kyc.json" },
  { name: "Staging feature flags", datasetId: "flags", fileName: "flags.json" },
] as const;

const db = openDatabase();
try {
  const publishedApps = db.prepare(
    `SELECT app_revisions.definition_json AS definitionJson
     FROM apps
     JOIN app_revisions ON app_revisions.id = apps.published_revision_id
     WHERE apps.name = ?
     ORDER BY app_revisions.published_at DESC, app_revisions.revision_number DESC`,
  );

  for (const target of targets) {
    const rows = publishedApps.all(target.name) as { definitionJson: string }[];
    const definition = rows
      .map((row) => AppDefinitionSchema.parse(JSON.parse(row.definitionJson)))
      .find((candidate) => candidate.datasetId === target.datasetId);
    if (!definition) {
      throw new Error(`No published ${target.datasetId} app named "${target.name}" was found`);
    }
    writeFileSync(
      resolve("src/server/seed-apps", target.fileName),
      `${JSON.stringify(definition, null, 2)}\n`,
    );
    console.log(`Exported ${definition.name} to src/server/seed-apps/${target.fileName}`);
  }
} finally {
  db.close();
}
