import type { AppDatabase } from "../db.js";
import { InvalidTransitionError, registerDataset, type DatasetAdapter } from "./registry.js";

type KycRow = Record<string, unknown> & {
  id: string;
  status: string;
  version: number;
};

const kycSelect = `id, customer_ref, masked_email, masked_phone, summary,
  status, version, created_at, updated_at`;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function getKyc(db: AppDatabase, id: string): KycRow | undefined {
  return db
    .prepare(`SELECT ${kycSelect} FROM kyc_cases WHERE id = ?`)
    .get(id) as KycRow | undefined;
}

function applyDecision(status: "approved" | "rejected", label: string) {
  return (db: AppDatabase, row: Record<string, unknown>) => {
    if (row.status !== "pending") throw new InvalidTransitionError();
    if (typeof row.id !== "string" || typeof row.version !== "number") {
      throw new Error("KYC row is missing its identifier or version");
    }

    const now = new Date().toISOString();
    const result = db
      .prepare(
        `UPDATE kyc_cases
         SET status = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND version = ?`,
      )
      .run(status, now, row.id, row.version);
    if (result.changes !== 1) throw new Error(`${label} update did not affect one KYC case`);

    const after = getKyc(db, row.id);
    if (!after) throw new Error("KYC case disappeared while applying its action");
    return { after };
  };
}

const kyc: DatasetAdapter = {
  id: "kyc",
  label: "KYC cases",
  simulatedNotice: "Simulated: no documents, identity verification, or account activation.",
  fields: [
    { key: "customer_ref", label: "Customer reference", type: "text" },
    { key: "masked_email", label: "Masked email", type: "text" },
    { key: "masked_phone", label: "Masked phone", type: "text" },
    { key: "summary", label: "Review summary", type: "text" },
    { key: "status", label: "Status", type: "status" },
    { key: "created_at", label: "Created", type: "datetime" },
    { key: "updated_at", label: "Updated", type: "datetime" },
  ],
  searchableFields: ["customer_ref", "masked_email", "summary"],
  statusField: "status",
  statusValues: ["pending", "approved", "rejected"],
  sortKeys: ["id", "customer_ref", "status", "created_at", "updated_at"],
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
      conditions.push(
        "(customer_ref LIKE ? ESCAPE '\\' OR masked_email LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\')",
      );
      params.push(pattern, pattern, pattern);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const total = db
      .prepare(`SELECT COUNT(*) AS count FROM kyc_cases ${where}`)
      .get(...params) as { count: number };
    const page = Math.max(1, args.page);
    const pageSize = Math.min(50, Math.max(1, args.pageSize));
    const rows = db
      .prepare(
        `SELECT ${kycSelect} FROM kyc_cases ${where}
         ORDER BY ${sort} ${direction}, id ASC LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, (page - 1) * pageSize) as KycRow[];
    return { rows, total: total.count };
  },
  get(db, id) {
    return getKyc(db, id);
  },
  actions: [
    {
      id: "kyc.approve",
      label: "Approve KYC",
      requiresReason: true,
      permission: "actions.execute",
      apply: applyDecision("approved", "Approve"),
    },
    {
      id: "kyc.reject",
      label: "Reject KYC",
      requiresReason: true,
      permission: "actions.execute",
      apply: applyDecision("rejected", "Reject"),
    },
  ],
};

registerDataset(kyc);

export default kyc;
