import express, { type ErrorRequestHandler } from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { AppDatabase } from "./db.js";
import {
  createLoginHandler,
  createLogoutHandler,
  mutationSecurity,
  publicUser,
  requireAuth,
} from "./auth.js";
import { sendError } from "./errors.js";
import { createApiRouter } from "./routes/api.js";

export interface AppHooks {
  beforeAuditInsert?: () => void;
}

export interface CreateAppOptions {
  db: AppDatabase;
  hooks?: AppHooks;
}

function allowedOrigins(): string[] {
  const configured = process.env.ALLOWED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return [
    ...(configured ?? []),
    ...(process.env.NODE_ENV === "production"
      ? []
      : ["http://localhost:5173", "http://127.0.0.1:5173"]),
  ];
}

export function createApp({ db, hooks }: CreateAppOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.use(mutationSecurity(allowedOrigins()));
  app.use(express.json({ limit: "1mb", strict: true }));
  const loginHandler = createLoginHandler(
    db,
    process.env.COOKIE_SECURE === "1",
  );
  const logoutHandler = createLogoutHandler(db);

  app.get("/api/auth/me", requireAuth(db), (req, res) => {
    res.status(200).json({ user: publicUser(req.user!) });
  });
  app.post("/api/auth/login", loginHandler);
  app.post("/api/auth/logout", logoutHandler);
  app.use("/api", createApiRouter(db, hooks));

  const clientPath = resolve("dist/client");
  if (existsSync(clientPath)) {
    app.use(express.static(clientPath));
    app.get("/{*path}", (_req, res, next) => {
      if (_req.path.startsWith("/api/")) return next();
      res.sendFile(resolve(clientPath, "index.html"));
    });
  }

  app.use((_req, res) => sendError(res, 404, "NOT_FOUND", "Resource not found"));
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof SyntaxError && "body" in error) {
      return sendError(res, 422, "INVALID_JSON", "Request body must be valid JSON");
    }
    return sendError(res, 500, "INTERNAL_ERROR", "An unexpected error occurred");
  };
  app.use(errorHandler);
  return app;
}
