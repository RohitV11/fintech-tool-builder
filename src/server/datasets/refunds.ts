import type { AppDatabase } from "../db.js";
import { InvalidTransitionError, registerDataset, type DatasetAdapter } from "./registry.js";

type RefundRow = Record<string, unknown> & {
  id: string;
  status: string;
  version: number;
};

const refundSelect = `id, customer_ref, amount_cents, currency, reason_submitted,
  status, version, created_at, updated_at`;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function applyDecision(status: "approved" | "rejected", label: string) {
  return (db: AppDatabase, row: Record<string, unknown>) => {
    if (row.status !== "pending") throw new InvalidTransitionError();
    if (typeof row.id !== "string" || typeof row.version !== "number") {
      throw new Error("Refund row is missing its identifier or version");
    }
    const now = new Date().toISOString();
    const result = db
      .prepare(
        `UPDATE refund_requests
         SET status = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND version = ?`,
      )
      .run(status, now, row.id, row.version);
    if (result.changes !== 1) throw new Error(`${label} update did not affect one refund`);
    const after = db
      .prepare(`SELECT ${refundSelect} FROM refund_requests WHERE id = ?`)
      .get(row.id) as RefundRow | undefined;
    if (!after) throw new Error("Refund disappeared while applying its action");
    return { after };
  };
}

const refunds: DatasetAdapter = {
  id: "refunds",
  label: "Refund requests",
  simulatedNotice: "Simulated: approving records a decision only; no refund is executed.",
  fields: [
    { key: "customer_ref", label: "Customer reference", type: "text" },
    { key: "amount_cents", label: "Amount", type: "money" },
    { key: "currency", label: "Currency", type: "text" },
    { key: "reason_submitted", label: "Submitted reason", type: "text" },
    { key: "status", label: "Status", type: "status" },
    { key: "created_at", label: "Created", type: "datetime" },
    { key: "updated_at", label: "Updated", type: "datetime" },
  ],
  searchableFields: ["customer_ref", "currency"],
  statusField: "status",
  statusValues: ["pending", "approved", "rejected"],
  sortKeys: ["id", "customer_ref", "amount_cents", "status", "created_at", "updated_at"],
  defaultSort: { key: "created_at", dir: "desc" },
  query(db, args) {
    const sort = this.sortKeys.includes(args.sort ?? "")
      ? args.sort!
      : this.defaultSort.key;
    const direction = args.dir === "asc" ? "ASC" : "DESC";
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (args.status) {
      conditions.push("status = ?");
      params.push(args.status);
    }
    if (args.search) {
      const pattern = `%${escapeLike(args.search)}%`;
      conditions.push("(customer_ref LIKE ? ESCAPE '\\' OR currency LIKE ? ESCAPE '\\')");
      params.push(pattern, pattern);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const total = db
      .prepare(`SELECT COUNT(*) AS count FROM refund_requests ${where}`)
      .get(...params) as { count: number };
    const page = Math.max(1, args.page);
    const pageSize = Math.min(50, Math.max(1, args.pageSize));
    const rows = db
      .prepare(
        `SELECT ${refundSelect} FROM refund_requests ${where}
         ORDER BY ${sort} ${direction}, id ASC LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, (page - 1) * pageSize) as RefundRow[];
    return { rows, total: total.count };
  },
  get(db, id) {
    return db
      .prepare(`SELECT ${refundSelect} FROM refund_requests WHERE id = ?`)
      .get(id) as RefundRow | undefined;
  },
  actions: [
    {
      id: "refunds.approve",
      label: "Approve refund",
      requiresReason: true,
      permission: "actions.execute",
      apply: applyDecision("approved", "Approve"),
    },
    {
      id: "refunds.reject",
      label: "Reject refund",
      requiresReason: true,
      permission: "actions.execute",
      apply: applyDecision("rejected", "Reject"),
    },
  ],
};

registerDataset(refunds);

export default refunds;
