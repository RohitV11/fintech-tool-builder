import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { createApp } from "../../src/server/app.js";
import { initializeSchema, openDatabase, type AppDatabase } from "../../src/server/db.js";
import { seedDemo } from "../../src/server/seed.js";
import { seedPublishedRefundApp } from "../../src/server/seed-apps/seed-refunds.js";

const origin = "http://localhost:5173";
const appId = "0814100e-c259-426a-81b0-68f73f9da561";
const revisionId = "1f1bbdbc-76a9-4f31-9947-8812486bb982";
let app: express.Express;
let db: AppDatabase;
let tempDirectory: string;

async function signedIn(username = "reviewer", server = app) {
  const agent = request.agent(server);
  const response = await agent
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({ username, password: "demo-password" });
  expect(response.status).toBe(200);
  return agent;
}

function actionBody(
  recordId: string,
  options: {
    expectedVersion?: number;
    reason?: string;
    revisionId?: string;
    idempotencyKey?: string;
  } = {},
) {
  return {
    recordId,
    expectedVersion: options.expectedVersion ?? 1,
    reason: options.reason ?? "Verified synthetic request",
    revisionId: options.revisionId ?? revisionId,
    idempotencyKey: options.idempotencyKey ?? randomUUID(),
  };
}

function execute(agent: ReturnType<typeof request.agent>, blockId: string, body: unknown) {
  return agent
    .post(`/api/apps/${appId}/blocks/${blockId}/execute`)
    .set("Origin", origin)
    .send(body);
}

function refund(id: string) {
  return db
    .prepare("SELECT id, status, version, reason_submitted FROM refund_requests WHERE id = ?")
    .get(id) as { id: string; status: string; version: number; reason_submitted: string | null };
}

function auditCount(recordId: string): number {
  return (
    db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE dataset_id = 'refunds' AND record_id = ?")
      .get(recordId) as { count: number }
  ).count;
}

describe("refund app API and business actions", () => {
  beforeAll(() => {
    tempDirectory = mkdtempSync(join(tmpdir(), "fintech-tool-builder-refunds-"));
    db = openDatabase(join(tempDirectory, "test.db"));
    initializeSchema(db);
    seedDemo(db);
    seedPublishedRefundApp(db);
    app = createApp({ db });
  });

  afterAll(() => {
    db.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("returns the safe catalog, published app list, and seeded runtime", async () => {
    const agent = await signedIn();
    const catalog = await agent.get("/api/catalog");
    expect(catalog.status).toBe(200);
    expect(catalog.body.datasets.map((dataset: { id: string }) => dataset.id)).toContain("refunds");
    expect(catalog.body.datasets[0]).not.toHaveProperty("query");

    const apps = await agent.get("/api/apps");
    expect(apps.status).toBe(200);
    expect(apps.body.apps[0].id).toBe(appId);

    const runtime = await agent.get(`/api/apps/${appId}/runtime`);
    expect(runtime.status).toBe(200);
    expect(runtime.body.revisionNumber).toBe(1);
    expect(runtime.body.definition.blocks.map((block: { type: string }) => block.type)).toEqual([
      "record_table",
      "record_details",
      "action_button",
      "action_button",
      "audit_history",
    ]);
  });

  it("lists, searches, filters, paginates, and projects configured fields", async () => {
    const agent = await signedIn();
    const defaultPage = await agent.get(`/api/apps/${appId}/blocks/refund-table/records?page=1`);
    expect(defaultPage.status).toBe(200);
    expect(defaultPage.body.rows.length).toBeLessThanOrEqual(10);
    expect(defaultPage.body.rows.every((row: { status: string }) => row.status === "pending")).toBe(true);
    expect(defaultPage.body.rows[0]).not.toHaveProperty("reason_submitted");

    const search = await agent.get(
      `/api/apps/${appId}/blocks/refund-table/records?search=SYN-CUST-0001&status=`,
    );
    expect(search.status).toBe(200);
    expect(search.body.rows.map((row: { id: string }) => row.id)).toContain("rf_001");

    const approved = await agent.get(
      `/api/apps/${appId}/blocks/refund-table/records?status=approved`,
    );
    expect(approved.status).toBe(200);
    expect(approved.body.rows.every((row: { status: string }) => row.status === "approved")).toBe(true);
  });

  it.each([
    ["approve-refund", "approved", "rf_001"],
    ["reject-refund", "rejected", "rf_002"],
  ])("records a valid %s decision once", async (blockId, status, recordId) => {
    const agent = await signedIn();
    const response = await execute(agent, blockId, actionBody(recordId));
    expect(response.status).toBe(200);
    expect(response.body.record.status).toBe(status);
    expect(response.body.record.version).toBe(2);
    expect(refund(recordId)).toMatchObject({ status, version: 2 });
    expect(auditCount(recordId)).toBe(1);
  });

  it("rejects a missing reason with 422", async () => {
    const agent = await signedIn();
    const response = await execute(
      agent,
      "approve-refund",
      actionBody("rf_003", { reason: " " }),
    );
    expect(response.status).toBe(422);
    expect(refund("rf_003")).toMatchObject({ status: "pending", version: 1 });
    expect(auditCount("rf_003")).toBe(0);
  });

  it("rejects an invalid transition with 409", async () => {
    const agent = await signedIn();
    const response = await execute(agent, "approve-refund", actionBody("rf_004"));
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("INVALID_TRANSITION");
    expect(refund("rf_004")).toMatchObject({ status: "approved", version: 1 });
    expect(auditCount("rf_004")).toBe(0);
  });

  it("replays the original successful idempotent response without another event", async () => {
    const agent = await signedIn();
    const body = actionBody("rf_014", { idempotencyKey: randomUUID() });
    const first = await execute(agent, "approve-refund", body);
    const replay = await execute(agent, "approve-refund", body);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(auditCount("rf_014")).toBe(1);
  });

  it("rejects reuse of an idempotency key with a different payload", async () => {
    const agent = await signedIn();
    const key = randomUUID();
    expect((await execute(agent, "approve-refund", actionBody("rf_015", { idempotencyKey: key }))).status).toBe(200);
    const response = await execute(
      agent,
      "approve-refund",
      actionBody("rf_015", { idempotencyKey: key, reason: "Different reason" }),
    );
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(auditCount("rf_015")).toBe(1);
  });

  it("serializes concurrent decisions to one success and one version conflict", async () => {
    const agent = await signedIn();
    const [first, second] = await Promise.all([
      execute(agent, "approve-refund", actionBody("rf_007")),
      execute(agent, "reject-refund", actionBody("rf_007")),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect([first, second].find((response) => response.status === 409)?.body.error.code).toBe(
      "VERSION_CONFLICT",
    );
    expect(refund("rf_007").version).toBe(2);
    expect(auditCount("rf_007")).toBe(1);
  });

  it("rolls back the record update if audit insertion fails", async () => {
    const failingApp = createApp({
      db,
      hooks: {
        beforeAuditInsert: () => {
          throw new Error("synthetic audit failure");
        },
      },
    });
    const agent = await signedIn("reviewer", failingApp);
    const body = actionBody("rf_016");
    const response = await execute(agent, "approve-refund", body);
    expect(response.status).toBe(500);
    expect(refund("rf_016")).toMatchObject({ status: "pending", version: 1 });
    expect(auditCount("rf_016")).toBe(0);
    const idempotencyCount = (
      db.prepare("SELECT COUNT(*) AS count FROM idempotency_keys WHERE user_id = 'user_reviewer' AND key = ?")
        .get(body.idempotencyKey) as { count: number }
    ).count;
    expect(idempotencyCount).toBe(0);
  });

  it("rejects a stale published revision with 409", async () => {
    const agent = await signedIn();
    const response = await execute(
      agent,
      "approve-refund",
      actionBody("rf_009", { revisionId: randomUUID() }),
    );
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("STALE_REVISION");
    expect(auditCount("rf_009")).toBe(0);
  });

  it.each(["viewer", "builder"])("forbids %s from executing an action", async (username) => {
    const agent = await signedIn(username);
    const response = await execute(agent, "approve-refund", actionBody("rf_010"));
    expect(response.status).toBe(403);
    expect(refund("rf_010")).toMatchObject({ status: "pending", version: 1 });
  });

  it("returns 404 for a forged action block ID", async () => {
    const agent = await signedIn();
    const response = await execute(agent, "forged-action", actionBody("rf_011"));
    expect(response.status).toBe(404);
    expect(auditCount("rf_011")).toBe(0);
  });

  it.each(["actionId", "datasetId"])("rejects client-supplied %s with 422", async (key) => {
    const agent = await signedIn();
    const body = { ...actionBody("rf_012"), [key]: key === "actionId" ? "refunds.approve" : "refunds" };
    const response = await execute(agent, "approve-refund", body);
    expect(response.status).toBe(422);
    expect(refund("rf_012")).toMatchObject({ status: "pending", version: 1 });
  });
});
