import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { AppDatabase } from "./db.js";
import { sendError } from "./errors.js";

const SESSION_HOURS = 8;
const THROTTLE_MINUTES = 15;
const MAX_FAILURES = 5;

export type UserRole = "builder" | "reviewer" | "viewer";
export type Permission =
  | "apps.read_published"
  | "apps.read_drafts"
  | "apps.edit"
  | "apps.publish"
  | "records.read"
  | "audit.read"
  | "actions.execute";

export interface AuthenticatedUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  orgId: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
  }).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [algorithm, salt, expectedHex] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = scryptSync(password, salt, expected.length, {
    N: 16384,
    r: 8,
    p: 1,
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function can(user: Pick<AuthenticatedUser, "role">, permission: Permission): boolean {
  switch (permission) {
    case "apps.read_published":
    case "records.read":
    case "audit.read":
      return true;
    case "apps.read_drafts":
    case "apps.edit":
    case "apps.publish":
      return user.role === "builder";
    case "actions.execute":
      return user.role === "reviewer";
  }
}

export function publicUser(user: AuthenticatedUser) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
  };
}

function sessionUser(db: AppDatabase, token: string): AuthenticatedUser | undefined {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const row = db
    .prepare(
      `SELECT users.id, users.username, users.display_name, users.role, users.org_id
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.id = ? AND sessions.expires_at > ?`,
    )
    .get(tokenHash, new Date().toISOString()) as
    | {
        id: string;
        username: string;
        display_name: string;
        role: UserRole;
        org_id: string;
      }
    | undefined;

  return row
    ? {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        role: row.role,
        orgId: row.org_id,
      }
    : undefined;
}

function cookieToken(req: Request): string | undefined {
  const cookieHeader = req.get("cookie");
  if (!cookieHeader) return undefined;
  for (const pair of cookieHeader.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0 || pair.slice(0, separator).trim() !== "sid") continue;
    try {
      return decodeURIComponent(pair.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function requireAuth(db: AppDatabase) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = cookieToken(req);
    const user = token ? sessionUser(db, token) : undefined;
    if (!user) return sendError(res, 401, "UNAUTHENTICATED", "Sign in to continue");
    req.user = user;
    next();
  };
}

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !can(req.user, permission)) {
      return sendError(res, 403, "FORBIDDEN", "You do not have permission to do this");
    }
    next();
  };
}

function requestOrigin(req: Request): string | undefined {
  const origin = req.get("origin");
  if (origin) {
    try {
      return new URL(origin).origin;
    } catch {
      return undefined;
    }
  }
  const referer = req.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function mutationSecurity(allowedOrigins: string[] = []) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
    const origin = requestOrigin(req);
    const ownOrigin = `${req.protocol}://${req.get("host")}`;
    if (!origin || (origin !== ownOrigin && !allowedOrigins.includes(origin))) {
      return sendError(res, 403, "CROSS_ORIGIN_MUTATION", "Request origin is not allowed");
    }
    if (!req.is("application/json")) {
      return sendError(res, 403, "JSON_REQUIRED", "Mutations require application/json");
    }
    next();
  };
}

export function createLoginHandler(db: AppDatabase, cookieSecure: boolean) {
  return (req: Request, res: Response) => {
    const username =
      typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const password =
      typeof req.body?.password === "string" ? req.body.password : "";
    if (!username || !password || Object.keys(req.body ?? {}).some((key) => !["username", "password"].includes(key))) {
      return sendError(res, 422, "INVALID_INPUT", "Username and password are required");
    }

    const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const cutoff = new Date(Date.now() - THROTTLE_MINUTES * 60_000).toISOString();
    const attempts = db
      .prepare(
        "SELECT COUNT(*) AS count FROM login_attempts WHERE username = ? AND ip = ? AND at > ?",
      )
      .get(username, ip, cutoff) as { count: number };
    if (attempts.count >= MAX_FAILURES) {
      return sendError(res, 429, "LOGIN_THROTTLED", "Too many failed attempts; try again later");
    }

    const row = db
      .prepare(
        "SELECT id, username, display_name, role, org_id, password_hash FROM users WHERE username = ?",
      )
      .get(username) as
      | {
          id: string;
          username: string;
          display_name: string;
          role: UserRole;
          org_id: string;
          password_hash: string;
        }
      | undefined;
    if (!row || !verifyPassword(password, row.password_hash)) {
      db.prepare("INSERT INTO login_attempts (username, ip, at) VALUES (?, ?, ?)").run(
        username,
        ip,
        new Date().toISOString(),
      );
      return sendError(res, 401, "INVALID_CREDENTIALS", "Username or password is incorrect");
    }

    db.prepare("DELETE FROM login_attempts WHERE username = ? AND ip = ?").run(username, ip);
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + SESSION_HOURS * 60 * 60_000);
    db.prepare(
      "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    ).run(tokenHash, row.id, createdAt.toISOString(), expiresAt.toISOString());

    const secure =
      process.env.NODE_ENV === "production" && cookieSecure;
    res.setHeader(
      "Set-Cookie",
      `sid=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 60 * 60}${secure ? "; Secure" : ""}`,
    );
    res.status(200).json({
      user: publicUser({
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        role: row.role,
        orgId: row.org_id,
      }),
    });
  };
}

export function createLogoutHandler(db: AppDatabase) {
  return (req: Request, res: Response) => {
    const token = cookieToken(req);
    if (token) {
      const tokenHash = createHash("sha256").update(token).digest("hex");
      db.prepare("DELETE FROM sessions WHERE id = ?").run(tokenHash);
    }
    res.setHeader("Set-Cookie", "sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    res.status(204).end();
  };
}
