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
import { refundAppDefinition } from "../../src/server/seed-apps/refunds.js";
import type { AppDefinition } from "../../src/shared/schema.js";

const origin = "http://localhost:5173";
const appId = "0814100e-c259-426a-81b0-68f73f9da561";
const approveBlockId = "approve-refund";
type Agent = ReturnType<typeof request.agent>;

let app: express.Express;
let db: AppDatabase;
let tempDirectory: string;
let databasePath: string;

async function signedIn(username: "builder" | "reviewer" | "viewer" = "builder"): Promise<Agent> {
  const agent = request.agent(app);
  const response = await agent
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({ username, password: "demo-password" });
  expect(response.status).toBe(200);
  return agent;
}

function putDraft(agent: Agent, id: string, definition: AppDefinition, expectedVersion: number) {
  return agent
    .put(`/api/apps/${id}/draft`)
    .set("Origin", origin)
    .send({ definition, expectedVersion });
}

function publish(agent: Agent, id: string, expectedDraftVersion: number) {
  return agent
    .post(`/api/apps/${id}/publish`)
    .set("Origin", origin)
    .send({ expectedDraftVersion });
}

beforeEach(() => {
  tempDirectory = mkdtempSync(join(tmpdir(), "fintech-tool-builder-apps-"));
  databasePath = join(tempDirectory, "test.db");
  db = openDatabase(databasePath);
  initializeSchema(db);
  seedDemo(db);
  seedPublishedRefundApp(db);
  app = createApp({ db });
});

afterEach(() => {
  db.close();
  rmSync(tempDirectory, { recursive: true, force: true });
});

describe("app drafts, publishing, and preview", () => {
  it("denies reviewer and viewer create, save, and publish operations", async () => {
    for (const username of ["reviewer", "viewer"] as const) {
      const agent = await signedIn(username);
      expect(
        (await agent
          .post("/api/apps")
          .set("Origin", origin)
          .send({ name: "Forbidden", datasetId: "refunds" })).status,
      ).toBe(403);
      expect(
        (await putDraft(agent, appId, refundAppDefinition, 1)).status,
      ).toBe(403);
      expect((await publish(agent, appId, 1)).status).toBe(403);
    }
  });

  it("uses optimistic draft versions and rejects schema-invalid saves", async () => {
    const builder = await signedIn();
    const initial = await builder.get(`/api/apps/${appId}/draft`);
    expect(initial.status).toBe(200);

    expect(
      (await putDraft(builder, appId, initial.body.definition, initial.body.version + 1)).status,
    ).toBe(409);
    expect((await publish(builder, appId, initial.body.version + 1)).status).toBe(409);

    const invalid = structuredClone(initial.body.definition) as AppDefinition;
    invalid.blocks[0]!.layout.x = 12;
    const invalidSave = await putDraft(builder, appId, invalid, initial.body.version);
    expect(invalidSave.status).toBe(422);
    expect(
      (db.prepare("SELECT version FROM app_drafts WHERE app_id = ?").get(appId) as { version: number }).version,
    ).toBe(initial.body.version);
  });

  it("stores reference errors in drafts and rejects publishing each invalid definition", async () => {
    const builder = await signedIn();
    let version = 1;
    const invalidDefinitions = [
      (definition: AppDefinition) => {
        const details = definition.blocks.find((block) => block.type === "record_details");
        if (details?.type === "record_details") details.config.sourceTableId = "missing-table";
      },
      (definition: AppDefinition) => {
        const table = definition.blocks.find((block) => block.type === "record_table");
        if (table?.type === "record_table") table.config.columns = ["private_field"];
      },
      (definition: AppDefinition) => {
        const action = definition.blocks.find(
          (block) => block.type === "action_button" && block.config.actionId.endsWith(".approve"),
        );
        if (action?.type === "action_button") action.config.actionId = "kyc.approve";
      },
      (definition: AppDefinition) => {
        const details = definition.blocks.find((block) => block.type === "record_details");
        if (details) details.layout = { x: 0, y: 0, w: 6, h: 6 };
      },
    ];

    for (const makeInvalid of invalidDefinitions) {
      const definition = structuredClone(refundAppDefinition);
      makeInvalid(definition);
      const save = await putDraft(builder, appId, definition, version);
      expect(save.status).toBe(200);
      expect(save.body.validationErrors.length).toBeGreaterThan(0);
      version = save.body.version;
      const response = await publish(builder, appId, version);
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("INVALID_DEFINITION");
    }
  });

  it("keeps draft changes private to runtime until publishing, then invalidates the old revision", async () => {
    const builder = await signedIn();
    const reviewer = await signedIn("reviewer");
    const originalRuntime = await reviewer.get(`/api/apps/${appId}/runtime`);
    const draft = await builder.get(`/api/apps/${appId}/draft`);
    const definition = structuredClone(draft.body.definition) as AppDefinition;
    definition.name = "Updated refund approvals";

    const saved = await putDraft(builder, appId, definition, draft.body.version);
    expect(saved.status).toBe(200);
    expect(saved.body.validationErrors).toEqual([]);
    const beforePublish = await reviewer.get(`/api/apps/${appId}/runtime`);
    expect(beforePublish.body.revisionId).toBe(originalRuntime.body.revisionId);
    expect(beforePublish.body.app.name).toBe("Refund approvals");
    expect(beforePublish.body.definition.name).toBe("Refund approvals");
    const builderApps = await builder.get("/api/apps");
    const reviewerApps = await reviewer.get("/api/apps");
    expect(builderApps.body.apps.find((entry: { id: string }) => entry.id === appId).name)
      .toBe("Updated refund approvals");
    expect(reviewerApps.body.apps.find((entry: { id: string }) => entry.id === appId).name)
      .toBe("Refund approvals");

    const published = await publish(builder, appId, saved.body.version);
    expect(published.status).toBe(201);
    expect(published.body.revisionNumber).toBe(2);
    const afterPublish = await reviewer.get(`/api/apps/${appId}/runtime`);
    expect(afterPublish.body.revisionId).toBe(published.body.revisionId);
    expect(afterPublish.body.app.name).toBe("Updated refund approvals");
    expect(afterPublish.body.definition.name).toBe("Updated refund approvals");
    expect(
      (db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'publish'").get() as { count: number })
        .count,
    ).toBe(1);

    const staleExecute = await reviewer
      .post(`/api/apps/${appId}/blocks/${approveBlockId}/execute`)
      .set("Origin", origin)
      .send({
        recordId: "rf_001",
        expectedVersion: 1,
        reason: "Old runtime decision",
        revisionId: originalRuntime.body.revisionId,
        idempotencyKey: randomUUID(),
      });
    expect(staleExecute.status).toBe(409);
    expect(staleExecute.body.error.code).toBe("STALE_REVISION");
  });

  it("restricts preview reads to builders and exposes no draft execute route", async () => {
    const builder = await signedIn();
    const viewer = await signedIn("viewer");
    const recordsPath = `/api/apps/${appId}/draft/blocks/refund-table/records`;
    const detailsPath = `/api/apps/${appId}/draft/blocks/refund-details/records/rf_001`;
    const auditPath = `/api/apps/${appId}/draft/blocks/refund-audit/audit?recordId=rf_001`;

    expect((await builder.get(recordsPath)).status).toBe(200);
    expect((await builder.get(detailsPath)).status).toBe(200);
    expect((await builder.get(auditPath)).status).toBe(200);
    expect((await viewer.get(recordsPath)).status).toBe(403);
    expect((await viewer.get(detailsPath)).status).toBe(403);
    expect((await viewer.get(auditPath)).status).toBe(403);
    expect(
      (await builder
        .post(`/api/apps/${appId}/draft/blocks/${approveBlockId}/execute`)
        .set("Origin", origin)
        .send({})).status,
    ).toBe(404);
  });

  it("duplicates a definition into an independent draft", async () => {
    const builder = await signedIn();
    const source = await builder.get(`/api/apps/${appId}/draft`);
    const created = await builder
      .post("/api/apps")
      .set("Origin", origin)
      .send({ name: "New refund app", datasetId: "refunds" });
    expect(created.status).toBe(201);
    expect(created.body.draft.definition.blocks[0].type).toBe("record_table");

    const duplicate = await builder
      .post("/api/apps")
      .set("Origin", origin)
      .send({
        name: "Refund approvals copy",
        datasetId: "refunds",
        duplicateFromAppId: appId,
      });
    expect(duplicate.status).toBe(201);
    expect(duplicate.body.app.id).not.toBe(appId);
    expect(duplicate.body.draft.definition.name).toBe("Refund approvals copy");

    const copiedDefinition = duplicate.body.draft.definition as AppDefinition;
    copiedDefinition.name = "Edited copy";
    expect(
      (await putDraft(builder, duplicate.body.app.id, copiedDefinition, 1)).status,
    ).toBe(200);
    const unchangedSource = await builder.get(`/api/apps/${appId}/draft`);
    expect(unchangedSource.body.definition.name).toBe(source.body.definition.name);
    const listed = await builder.get("/api/apps");
    expect(
      listed.body.apps.find((entry: { id: string }) => entry.id === duplicate.body.app.id)
        .hasUnpublishedChanges,
    ).toBe(true);
  });

  it("preserves saved drafts after createApp is re-instantiated on the same database file", async () => {
    const builder = await signedIn();
    const draft = await builder.get(`/api/apps/${appId}/draft`);
    const definition = structuredClone(draft.body.definition) as AppDefinition;
    definition.name = "Persisted after restart";
    const saved = await putDraft(builder, appId, definition, draft.body.version);
    expect(saved.status).toBe(200);

    db.close();
    db = openDatabase(databasePath);
    app = createApp({ db });
    const restartedBuilder = await signedIn();
    const persisted = await restartedBuilder.get(`/api/apps/${appId}/draft`);
    expect(persisted.body.version).toBe(saved.body.version);
    expect(persisted.body.definition.name).toBe("Persisted after restart");
  });
});
