import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/server/app.js";
import { initializeSchema, openDatabase, type AppDatabase } from "../../src/server/db.js";
import { seedDemo } from "../../src/server/seed.js";

const allowedOrigin = "http://localhost:5173";
let app: Express;
let db: AppDatabase;
let tempDirectory: string;

function login(username: string, password = "demo-password") {
  return request(app)
    .post("/api/auth/login")
    .set("Origin", allowedOrigin)
    .send({ username, password });
}

describe("authentication and session security", () => {
  beforeAll(() => {
    tempDirectory = mkdtempSync(join(tmpdir(), "fintech-tool-builder-auth-"));
    db = openDatabase(join(tempDirectory, "test.db"));
    initializeSchema(db);
    seedDemo(db);
    app = createApp({ db });
  });

  beforeEach(() => {
    db.prepare("DELETE FROM login_attempts").run();
  });

  afterAll(() => {
    db.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("returns 401 when /me has no authenticated session", async () => {
    const response = await request(app).get("/api/auth/me");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects invalid credentials with 401", async () => {
    const response = await login("reviewer", "incorrect-password");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("throttles the sixth failed login attempt", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await login("unknown-throttle-user", "wrong")).status).toBe(401);
    }
    const response = await login("unknown-throttle-user");
    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe("LOGIN_THROTTLED");
  });

  it("invalidates a session after logout", async () => {
    const agent = request.agent(app);
    const loginResponse = await agent
      .post("/api/auth/login")
      .set("Origin", allowedOrigin)
      .send({ username: "reviewer", password: "demo-password" });
    expect(loginResponse.status).toBe(200);
    expect((await agent.get("/api/auth/me")).status).toBe(200);

    const logoutResponse = await agent
      .post("/api/auth/logout")
      .set("Origin", allowedOrigin)
      .send({});
    expect(logoutResponse.status).toBe(204);
    expect((await agent.get("/api/auth/me")).status).toBe(401);
  });

  it("rejects cross-origin mutations", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .set("Origin", "https://attacker.example")
      .send({ username: "reviewer", password: "demo-password" });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("CROSS_ORIGIN_MUTATION");
  });

  it("requires JSON content type on mutations", async () => {
    const response = await request(app)
      .post("/api/auth/logout")
      .set("Origin", allowedOrigin);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("JSON_REQUIRED");
  });

  it("derives role from the authenticated user row, not request data", async () => {
    const agent = request.agent(app);
    const loginResponse = await agent
      .post("/api/auth/login?role=builder")
      .set("Origin", allowedOrigin)
      .set("X-Role", "reviewer")
      .send({ username: "viewer", password: "demo-password" });
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.user.role).toBe("viewer");

    const response = await agent.get("/api/auth/me?role=reviewer").set("X-Role", "builder");
    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe("viewer");

    const forgedBody = await request(app)
      .post("/api/auth/login")
      .set("Origin", allowedOrigin)
      .send({ username: "viewer", password: "demo-password", role: "reviewer" });
    expect(forgedBody.status).toBe(422);
  });
});
