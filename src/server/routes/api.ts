import { createHash, randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { AppHooks } from "../app.js";
import { can, requireAuth, requirePermission } from "../auth.js";
import type { AppDatabase } from "../db.js";
import { sendError } from "../errors.js";
import {
  getDataset,
  InvalidTransitionError,
  safeCatalog,
} from "../datasets/registry.js";
import "../datasets/refunds.js";
import { ExecuteBodySchema, type AppDefinition, type Block } from "../../shared/schema.js";

interface PublishedApp {
  id: string;
  name: string;
  created_at: string;
  revision_id: string;
  revision_number: number;
  definition: AppDefinition;
}

class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function getPublishedApp(db: AppDatabase, appId: string): PublishedApp | undefined {
  const row = db
    .prepare(
      `SELECT apps.id, apps.name, apps.created_at,
              app_revisions.id AS revision_id,
              app_revisions.revision_number,
              app_revisions.definition_json
       FROM apps
       JOIN app_revisions ON app_revisions.id = apps.published_revision_id
       WHERE apps.id = ?`,
    )
    .get(appId) as
    | {
        id: string;
        name: string;
        created_at: string;
        revision_id: string;
        revision_number: number;
        definition_json: string;
      }
    | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    revision_id: row.revision_id,
    revision_number: row.revision_number,
    definition: JSON.parse(row.definition_json) as AppDefinition,
  };
}

function projectRecord(
  row: Record<string, unknown>,
  fields: string[],
  statusField: string,
): Record<string, unknown> {
  const keys = new Set(["id", "version", statusField, ...fields]);
  return Object.fromEntries(
    [...keys].filter((key) => key in row).map((key) => [key, row[key]]),
  );
}

function findBlock(definition: AppDefinition, blockId: string): Block | undefined {
  return definition.blocks.find((block) => block.id === blockId);
}

function pathParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : value?.[0] ?? "";
}

function sendFailure(res: Response, failure: ApiFailure): void {
  sendError(res, failure.status, failure.code, failure.message, failure.details);
}

const querySchema = z
  .object({
    revisionId: z.string().uuid().optional(),
    search: z.string().max(200).optional(),
    status: z.string().optional(),
    sort: z.string().optional(),
    dir: z.enum(["asc", "desc"]).optional(),
    page: z.coerce.number().int().min(1).default(1),
  })
  .strict();

const auditQuerySchema = z.object({ recordId: z.string().min(1) }).strict();

export function createApiRouter(db: AppDatabase, hooks: AppHooks = {}): Router {
  const router = Router();
  const requireSignedIn = requireAuth(db);
  const catalog = safeCatalog();

  router.get(
    "/catalog",
    requireSignedIn,
    requirePermission("apps.read_published"),
    (_req, res) => {
      res.status(200).json(catalog);
    },
  );

  router.get(
    "/apps",
    requireSignedIn,
    requirePermission("apps.read_published"),
    (req, res) => {
      const canReadDrafts = can(req.user!, "apps.read_drafts");
      const rows = db
        .prepare(
          `SELECT apps.id, apps.name, apps.created_at, apps.published_revision_id,
                  app_revisions.revision_number,
                  app_revisions.definition_json AS published_definition,
                  app_drafts.definition_json AS draft_definition,
                  app_drafts.version AS draft_version
           FROM apps
           LEFT JOIN app_revisions ON app_revisions.id = apps.published_revision_id
           LEFT JOIN app_drafts ON app_drafts.app_id = apps.id
           WHERE apps.published_revision_id IS NOT NULL OR ? = 1
           ORDER BY apps.created_at DESC, apps.id`,
        )
        .all(canReadDrafts ? 1 : 0) as {
        id: string;
        name: string;
        created_at: string;
        published_revision_id: string | null;
        revision_number: number | null;
        published_definition: string | null;
        draft_definition: string | null;
        draft_version: number | null;
      }[];

      res.status(200).json({
        apps: rows.map((row) => ({
          id: row.id,
          name: row.name,
          createdAt: row.created_at,
          publishedRevisionId: row.published_revision_id,
          revisionNumber: row.revision_number,
          draftVersion: canReadDrafts ? row.draft_version : undefined,
          hasUnpublishedChanges:
            canReadDrafts &&
            row.draft_definition !== null &&
            row.draft_definition !== row.published_definition,
        })),
      });
    },
  );

  router.get(
    "/apps/:appId/runtime",
    requireSignedIn,
    requirePermission("apps.read_published"),
    (req, res) => {
      const app = getPublishedApp(db, pathParam(req.params.appId));
      if (!app) return sendError(res, 404, "NOT_FOUND", "Published app not found");
      res.status(200).json({
        app: { id: app.id, name: app.name, createdAt: app.created_at },
        revisionId: app.revision_id,
        revisionNumber: app.revision_number,
        definition: app.definition,
      });
    },
  );

  router.get(
    "/apps/:appId/blocks/:blockId/records",
    requireSignedIn,
    requirePermission("records.read"),
    (req, res) => {
      const app = getPublishedApp(db, pathParam(req.params.appId));
      if (!app) return sendError(res, 404, "NOT_FOUND", "Published app not found");
      const block = findBlock(app.definition, pathParam(req.params.blockId));
      if (!block || block.type !== "record_table") {
        return sendError(res, 404, "NOT_FOUND", "Record table block not found");
      }
      const parsedQuery = querySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        return sendError(res, 422, "INVALID_QUERY", "Invalid records query", parsedQuery.error.issues);
      }
      const dataset = getDataset(app.definition.datasetId);
      if (!dataset) return sendError(res, 404, "NOT_FOUND", "Dataset not found");
      const query = parsedQuery.data;
      if (query.status && !dataset.statusValues.includes(query.status)) {
        return sendError(res, 422, "INVALID_QUERY", "Unknown status filter");
      }
      if (query.sort && !dataset.sortKeys.includes(query.sort)) {
        return sendError(res, 422, "INVALID_QUERY", "Unknown sort field");
      }

      const result = dataset.query(db, {
        search: query.search,
        status: query.status ?? block.config.defaultStatusFilter ?? undefined,
        sort: query.sort,
        dir: query.dir,
        page: query.page,
        pageSize: block.config.pageSize,
      });
      res.status(200).json({
        rows: result.rows.map((row) =>
          projectRecord(row, block.config.columns, dataset.statusField),
        ),
        total: result.total,
        page: query.page,
        pageSize: block.config.pageSize,
      });
    },
  );

  router.get(
    "/apps/:appId/blocks/:blockId/records/:recordId",
    requireSignedIn,
    requirePermission("records.read"),
    (req, res) => {
      const app = getPublishedApp(db, pathParam(req.params.appId));
      if (!app) return sendError(res, 404, "NOT_FOUND", "Published app not found");
      const block = findBlock(app.definition, pathParam(req.params.blockId));
      if (!block || block.type !== "record_details") {
        return sendError(res, 404, "NOT_FOUND", "Record details block not found");
      }
      const dataset = getDataset(app.definition.datasetId);
      if (!dataset) return sendError(res, 404, "NOT_FOUND", "Dataset not found");
      const row = dataset.get(db, pathParam(req.params.recordId));
      if (!row) return sendError(res, 404, "NOT_FOUND", "Record not found");
      res.status(200).json({
        record: projectRecord(row, block.config.fields, dataset.statusField),
      });
    },
  );

  router.get(
    "/apps/:appId/blocks/:blockId/audit",
    requireSignedIn,
    requirePermission("audit.read"),
    (req, res) => {
      const app = getPublishedApp(db, pathParam(req.params.appId));
      if (!app) return sendError(res, 404, "NOT_FOUND", "Published app not found");
      const block = findBlock(app.definition, pathParam(req.params.blockId));
      if (!block || block.type !== "audit_history") {
        return sendError(res, 404, "NOT_FOUND", "Audit history block not found");
      }
      const parsedQuery = auditQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        return sendError(res, 422, "INVALID_QUERY", "A recordId is required");
      }
      const dataset = getDataset(app.definition.datasetId);
      if (!dataset) return sendError(res, 404, "NOT_FOUND", "Dataset not found");
      const events = db
        .prepare(
          `SELECT audit_events.id AS auditEventId, audit_events.at,
                  audit_events.action_id AS actionId, audit_events.reason,
                  audit_events.before_json AS beforeJson,
                  audit_events.after_json AS afterJson,
                  users.display_name AS actor
           FROM audit_events
           JOIN users ON users.id = audit_events.actor_user_id
           WHERE audit_events.event_type = 'action'
             AND audit_events.dataset_id = ? AND audit_events.record_id = ?
           ORDER BY audit_events.at DESC, audit_events.id DESC`,
        )
        .all(app.definition.datasetId, parsedQuery.data.recordId) as {
        auditEventId: string;
        at: string;
        actionId: string;
        reason: string;
        beforeJson: string | null;
        afterJson: string | null;
        actor: string;
      }[];
      res.status(200).json({
        events: events.map((event) => ({
          auditEventId: event.auditEventId,
          at: event.at,
          actionId: event.actionId,
          reason: event.reason,
          actor: event.actor,
          before: event.beforeJson ? JSON.parse(event.beforeJson) : null,
          after: event.afterJson ? JSON.parse(event.afterJson) : null,
        })),
      });
    },
  );

  router.post(
    "/apps/:appId/blocks/:blockId/execute",
    requireSignedIn,
    requirePermission("actions.execute"),
    (req, res, next) => {
      const app = getPublishedApp(db, pathParam(req.params.appId));
      if (!app) return sendError(res, 404, "NOT_FOUND", "Published app not found");
      const block = findBlock(app.definition, pathParam(req.params.blockId));
      if (!block || block.type !== "action_button") {
        return sendError(res, 404, "NOT_FOUND", "Action button block not found");
      }

      const parsedBody = ExecuteBodySchema.safeParse(req.body);
      if (!parsedBody.success) {
        return sendError(res, 422, "INVALID_INPUT", "Invalid action request", parsedBody.error.issues);
      }
      const body = parsedBody.data;

      const requestHash = createHash("sha256")
        .update(
          JSON.stringify({
            appId: app.id,
            blockId: block.id,
            recordId: body.recordId,
            expectedVersion: body.expectedVersion,
            reason: body.reason,
            revisionId: body.revisionId,
          }),
        )
        .digest("hex");
      const existing = db
        .prepare(
          `SELECT request_hash AS requestHash, response_status AS responseStatus,
                  response_json AS responseJson
           FROM idempotency_keys WHERE user_id = ? AND key = ?`,
        )
        .get(req.user!.id, body.idempotencyKey) as
        | { requestHash: string; responseStatus: number; responseJson: string }
        | undefined;
      if (existing) {
        if (existing.requestHash !== requestHash) {
          return sendError(
            res,
            422,
            "IDEMPOTENCY_KEY_REUSED",
            "Idempotency key was already used with a different request",
          );
        }
        return res.status(existing.responseStatus).json(JSON.parse(existing.responseJson));
      }

      if (body.revisionId !== app.revision_id) {
        return sendError(
          res,
          409,
          "STALE_REVISION",
          "This app has been republished; reload before deciding",
        );
      }

      const dataset = getDataset(app.definition.datasetId);
      if (!dataset) return sendError(res, 404, "NOT_FOUND", "Dataset not found");
      const action = dataset.actions.find(({ id }) => id === block.config.actionId);
      if (!action) return sendError(res, 404, "NOT_FOUND", "Configured action not found");

      try {
        const responseBody = db.transaction(() => {
          const before = dataset.get(db, body.recordId);
          if (!before) throw new ApiFailure(404, "NOT_FOUND", "Record not found");
          if (before.version !== body.expectedVersion) {
            throw new ApiFailure(409, "VERSION_CONFLICT", "Record has changed; refresh and try again");
          }

          let after: Record<string, unknown>;
          try {
            after = action.apply(db, before).after;
          } catch (error) {
            if (error instanceof InvalidTransitionError) {
              throw new ApiFailure(409, "INVALID_TRANSITION", error.message);
            }
            throw error;
          }

          const auditEventId = randomUUID();
          hooks.beforeAuditInsert?.();
          db.prepare(
            `INSERT INTO audit_events
              (id, at, actor_user_id, event_type, app_id, app_revision_id,
               dataset_id, record_id, action_id, reason, before_json, after_json)
             VALUES (?, ?, ?, 'action', ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            auditEventId,
            new Date().toISOString(),
            req.user!.id,
            app.id,
            app.revision_id,
            app.definition.datasetId,
            body.recordId,
            action.id,
            body.reason,
            JSON.stringify(before),
            JSON.stringify(after),
          );
          const response = { record: after, auditEventId };
          db.prepare(
            `INSERT INTO idempotency_keys
              (user_id, key, request_hash, response_status, response_json, created_at)
             VALUES (?, ?, ?, 200, ?, ?)`,
          ).run(
            req.user!.id,
            body.idempotencyKey,
            requestHash,
            JSON.stringify(response),
            new Date().toISOString(),
          );
          return response;
        })();
        return res.status(200).json(responseBody);
      } catch (error) {
        if (error instanceof ApiFailure) return sendFailure(res, error);
        return next(error);
      }
    },
  );

  return router;
}
