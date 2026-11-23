import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { createApp } from "../../src/server/app.js";
import { initializeSchema, openDatabase, type AppDatabase } from "../../src/server/db.js";
import { seedDemo } from "../../src/server/seed.js";
import { seedPublishedRefundApp } from "../../src/server/seed-apps/seed-refunds.js";
import {
  flagsAppDefinition,
  flagsAppId,
  kycAppDefinition,
  kycAppId,
  seedPublishedFlagsApp,
  seedPublishedKycApp,
} from "../../src/server/seed-apps/seed-reuse.js";

const origin = "http://localhost:5173";
const refundAppId = "0814100e-c259-426a-81b0-68f73f9da561";
const allowedBlockTypes = new Set([
  "record_table",
  "record_details",
  "action_button",
  "audit_history",
]);

type Agent = ReturnType<typeof request.agent>;

let app: express.Express;
let db: AppDatabase;
let tempDirectory: string;

async function signedIn(username = "reviewer"): Promise<Agent> {
  const agent = request.agent(app);
  const response = await agent
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({ username, password: "demo-password" });
  expect(response.status).toBe(200);
  return agent;
}

function revisionId(appId: string): string {
  const row = db
    .prepare("SELECT published_revision_id AS revisionId FROM apps WHERE id = ?")
    .get(appId) as { revisionId: string };
  return row.revisionId;
}

function blockId(
  definition: typeof kycAppDefinition,
  actionId: string,
): string {
  const block = definition.blocks.find(
    (candidate) => candidate.type === "action_button" && candidate.config.actionId === actionId,
  );
  if (!block || block.type !== "action_button") throw new Error(`Missing action block: ${actionId}`);
  return block.id;
}

function execute(agent: Agent, appId: string, blockId: string, body: unknown) {
  return agent
    .post(`/api/apps/${appId}/blocks/${blockId}/execute`)
    .set("Origin", origin)
    .send(body);
}

function actionBody(recordId: string, appId: string, idempotencyKey = randomUUID()) {
  return {
    recordId,
    expectedVersion: 1,
    reason: "Reviewed synthetic record",
    revisionId: revisionId(appId),
    idempotencyKey,
  };
}

function recordState(datasetId: "kyc" | "flags", recordId: string) {
  return datasetId === "kyc"
    ? (db.prepare("SELECT status, version FROM kyc_cases WHERE id = ?").get(recordId) as {
        status: string;
        version: number;
      })
    : (db.prepare("SELECT enabled, version FROM feature_flags WHERE id = ?").get(recordId) as {
        enabled: number;
        version: number;
      });
}

function auditCount(datasetId: string, recordId: string): number {
  return (
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'action' AND dataset_id = ? AND record_id = ?",
      )
      .get(datasetId, recordId) as { count: number }
  ).count;
}

beforeEach(() => {
  tempDirectory = mkdtempSync(join(tmpdir(), "fintech-tool-builder-reuse-"));
  db = openDatabase(join(tempDirectory, "test.db"));
  initializeSchema(db);
  seedDemo(db);
  seedPublishedRefundApp(db);
  seedPublishedKycApp(db);
  seedPublishedFlagsApp(db);
  app = createApp({ db });
});

afterEach(() => {
  db.close();
  rmSync(tempDirectory, { recursive: true, force: true });
});

describe("KYC and staging feature flag apps", () => {
  it("publishes KYC metadata and derived staging flag states", async () => {
    const reviewer = await signedIn();
    const catalog = await reviewer.get("/api/catalog");
    const kycDataset = catalog.body.datasets.find((dataset: { id: string }) => dataset.id === "kyc");
    const flagsDataset = catalog.body.datasets.find((dataset: { id: string }) => dataset.id === "flags");

    expect(kycDataset.simulatedNotice)
      .toBe("Simulated: no documents, identity verification, or account activation.");
    expect(flagsDataset.simulatedNotice)
      .toBe("Simulated staging flags: changes demo records only; no live product is controlled.");
    expect(flagsDataset.fields.find((field: { key: string }) => field.key === "state").type)
      .toBe("status");
    expect(flagsDataset.statusValues).toEqual(["enabled", "disabled"]);

    const enabledFlags = await reviewer.get(
      `/api/apps/${flagsAppId}/blocks/main-table/records?status=enabled`,
    );
    const disabledFlags = await reviewer.get(
      `/api/apps/${flagsAppId}/blocks/main-table/records?status=disabled`,
    );
    expect(enabledFlags.body.rows.length).toBeGreaterThan(0);
    expect(disabledFlags.body.rows.length).toBeGreaterThan(0);
    expect(
      [...enabledFlags.body.rows, ...disabledFlags.body.rows].every(
        (row: { state: string; environment: string }) =>
          row.environment === "staging" &&
          ["enabled", "disabled"].includes(row.state),
      ),
    ).toBe(true);
    expect(enabledFlags.body.rows.every((row: { state: string }) => row.state === "enabled")).toBe(true);
    expect(disabledFlags.body.rows.every((row: { state: string }) => row.state === "disabled")).toBe(true);
  });

  it.each([
    {
      name: "approves a pending KYC case",
      appId: kycAppId,
      definition: kycAppDefinition,
      actionId: "kyc.approve",
      recordId: "kyc_001",
      datasetId: "kyc",
      expectedState: "approved",
    },
    {
      name: "rejects a pending KYC case",
      appId: kycAppId,
      definition: kycAppDefinition,
      actionId: "kyc.reject",
      recordId: "kyc_002",
      datasetId: "kyc",
      expectedState: "rejected",
    },
    {
      name: "enables a disabled staging flag",
      appId: flagsAppId,
      definition: flagsAppDefinition,
      actionId: "flags.enable",
      recordId: "ff_002",
      datasetId: "flags",
      expectedState: "enabled",
    },
    {
      name: "disables an enabled staging flag",
      appId: flagsAppId,
      definition: flagsAppDefinition,
      actionId: "flags.disable",
      recordId: "ff_001",
      datasetId: "flags",
      expectedState: "disabled",
    },
  ])("$name", async ({ appId, definition, actionId, recordId, datasetId, expectedState }) => {
    const reviewer = await signedIn();
    const response = await execute(
      reviewer,
      appId,
      blockId(definition, actionId),
      actionBody(recordId, appId),
    );

    expect(response.status).toBe(200);
    expect(datasetId === "kyc" ? response.body.record.status : response.body.record.state)
      .toBe(expectedState);
    expect(response.body.record.version).toBe(2);
    expect(recordState(datasetId, recordId).version).toBe(2);
    expect(auditCount(datasetId, recordId)).toBe(1);
  });

  it.each([
    {
      name: "rejects an already approved KYC case",
      appId: kycAppId,
      definition: kycAppDefinition,
      actionId: "kyc.reject",
      recordId: "kyc_003",
      datasetId: "kyc",
    },
    {
      name: "rejects an already rejected KYC case",
      appId: kycAppId,
      definition: kycAppDefinition,
      actionId: "kyc.approve",
      recordId: "kyc_004",
      datasetId: "kyc",
    },
    {
      name: "rejects enabling an enabled staging flag",
      appId: flagsAppId,
      definition: flagsAppDefinition,
      actionId: "flags.enable",
      recordId: "ff_001",
      datasetId: "flags",
    },
    {
      name: "rejects disabling a disabled staging flag",
      appId: flagsAppId,
      definition: flagsAppDefinition,
      actionId: "flags.disable",
      recordId: "ff_002",
      datasetId: "flags",
    },
  ])("$name", async ({ appId, definition, actionId, recordId, datasetId }) => {
    const reviewer = await signedIn();
    const before = recordState(datasetId, recordId);
    const response = await execute(
      reviewer,
      appId,
      blockId(definition, actionId),
      actionBody(recordId, appId),
    );

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("INVALID_TRANSITION");
    expect(recordState(datasetId, recordId)).toEqual(before);
    expect(auditCount(datasetId, recordId)).toBe(0);
  });

  it.each([
    {
      name: "KYC action",
      appId: kycAppId,
      definition: kycAppDefinition,
      actionId: "kyc.approve",
      recordId: "kyc_005",
      datasetId: "kyc",
    },
    {
      name: "flag action",
      appId: flagsAppId,
      definition: flagsAppDefinition,
      actionId: "flags.enable",
      recordId: "ff_002",
      datasetId: "flags",
    },
  ])("requires a reason for a $name", async ({ appId, definition, actionId, recordId, datasetId }) => {
    const reviewer = await signedIn();
    const body = actionBody(recordId, appId);
    const { reason: _reason, ...withoutReason } = body;
    const before = recordState(datasetId, recordId);
    const response = await execute(
      reviewer,
      appId,
      blockId(definition, actionId),
      withoutReason,
    );

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("INVALID_INPUT");
    expect(recordState(datasetId, recordId)).toEqual(before);
    expect(auditCount(datasetId, recordId)).toBe(0);
  });

  it.each([
    {
      name: "KYC decision",
      appId: kycAppId,
      definition: kycAppDefinition,
      actionId: "kyc.approve",
      recordId: "kyc_007",
      datasetId: "kyc",
    },
    {
      name: "staging flag update",
      appId: flagsAppId,
      definition: flagsAppDefinition,
      actionId: "flags.enable",
      recordId: "ff_002",
      datasetId: "flags",
    },
  ])("replays an idempotent $name without duplicate audit", async ({
    appId,
    definition,
    actionId,
    recordId,
    datasetId,
  }) => {
    const reviewer = await signedIn();
    const body = actionBody(recordId, appId);
    const targetBlockId = blockId(definition, actionId);
    const first = await execute(reviewer, appId, targetBlockId, body);
    const replay = await execute(reviewer, appId, targetBlockId, body);

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(recordState(datasetId, recordId).version).toBe(2);
    expect(auditCount(datasetId, recordId)).toBe(1);
  });

  it("does not apply the refund action block to a KYC record", async () => {
    const reviewer = await signedIn();
    const response = await execute(
      reviewer,
      refundAppId,
      "approve-refund",
      actionBody("kyc_001", refundAppId),
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(recordState("kyc", "kyc_001")).toEqual({ status: "pending", version: 1 });
    expect(
      db.prepare("SELECT status, version FROM refund_requests WHERE id = 'rf_001'").get(),
    ).toEqual({ status: "pending", version: 1 });
    expect(auditCount("kyc", "kyc_001")).toBe(0);
    expect(auditCount("refunds", "kyc_001")).toBe(0);
  });

  it("seeds all apps exclusively from registered block types", () => {
    for (const appId of [refundAppId, kycAppId, flagsAppId]) {
      const row = db
        .prepare(
          `SELECT app_revisions.definition_json AS definitionJson
           FROM apps
           JOIN app_revisions ON app_revisions.id = apps.published_revision_id
           WHERE apps.id = ?`,
        )
        .get(appId) as { definitionJson: string };
      const definition = JSON.parse(row.definitionJson) as { blocks: { type: string }[] };
      expect(definition.blocks.length).toBeGreaterThan(0);
      expect(definition.blocks.every((block) => allowedBlockTypes.has(block.type))).toBe(true);
    }
  });

  it("enables status badges only in refunds and preserves legacy KYC and flags definitions", () => {
    const tableConfig = (appId: string) => {
      const row = db
        .prepare(
          `SELECT app_revisions.definition_json AS definitionJson
           FROM apps
           JOIN app_revisions ON app_revisions.id = apps.published_revision_id
           WHERE apps.id = ?`,
        )
        .get(appId) as { definitionJson: string };
      const definition = JSON.parse(row.definitionJson) as {
        blocks: { type: string; config: Record<string, unknown> }[];
      };
      const table = definition.blocks.find((block) => block.type === "record_table");
      if (!table) throw new Error(`Missing record table for app ${appId}`);
      return table.config;
    };

    expect(tableConfig(refundAppId).showStatusBadge).toBe(true);
    expect(tableConfig(kycAppId)).not.toHaveProperty("showStatusBadge");
    expect(tableConfig(flagsAppId)).not.toHaveProperty("showStatusBadge");
  });
});
