import type { AppDatabase } from "../db.js";
import { InvalidTransitionError, registerDataset, type DatasetAdapter } from "./registry.js";

type FlagRow = Record<string, unknown> & {
  id: string;
  enabled: number | boolean;
  environment: string;
  version: number;
};

const flagSelect = `id, key, description, enabled, environment, version, updated_at`;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function asFlagRecord(row: FlagRow): FlagRow & { enabled: boolean; state: string } {
  const enabled = Boolean(row.enabled);
  return { ...row, enabled, state: enabled ? "enabled" : "disabled" };
}

function getFlag(db: AppDatabase, id: string) {
  const row = db
    .prepare(
      `SELECT ${flagSelect} FROM feature_flags
       WHERE id = ? AND environment = 'staging'`,
    )
    .get(id) as FlagRow | undefined;
  return row ? asFlagRecord(row) : undefined;
}

function applyState(enabled: boolean, label: string) {
  return (db: AppDatabase, row: Record<string, unknown>) => {
    const currentEnabled = row.enabled === true || row.enabled === 1;
    if (row.environment !== "staging" || currentEnabled === enabled) {
      throw new InvalidTransitionError();
    }
    if (typeof row.id !== "string" || typeof row.version !== "number") {
      throw new Error("Feature flag row is missing its identifier or version");
    }

    const now = new Date().toISOString();
    const result = db
      .prepare(
        `UPDATE feature_flags
         SET enabled = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND version = ? AND enabled = ? AND environment = 'staging'`,
      )
      .run(Number(enabled), now, row.id, row.version, Number(currentEnabled));
    if (result.changes !== 1) throw new Error(`${label} update did not affect one staging flag`);

    const after = getFlag(db, row.id);
    if (!after) throw new Error("Staging flag disappeared while applying its action");
    return { after };
  };
}

const flags: DatasetAdapter = {
  id: "flags",
  label: "Staging feature flags",
  simulatedNotice: "Simulated staging flags: changes demo records only; no live product is controlled.",
  fields: [
    { key: "key", label: "Flag key", type: "text" },
    { key: "description", label: "Description", type: "text" },
    { key: "enabled", label: "Enabled", type: "boolean" },
    { key: "environment", label: "Environment", type: "text" },
    { key: "state", label: "State", type: "status" },
    { key: "updated_at", label: "Updated", type: "datetime" },
  ],
  searchableFields: ["key", "description"],
  statusField: "state",
  statusValues: ["enabled", "disabled"],
  sortKeys: ["id", "key", "description", "state", "updated_at"],
  defaultSort: { key: "key", dir: "asc" },
  query(db, args) {
    const requestedSort = this.sortKeys.includes(args.sort ?? "")
      ? args.sort!
      : this.defaultSort.key;
    const sort = requestedSort === "state" ? "enabled" : requestedSort;
    const direction = args.dir === "desc" ? "DESC" : "ASC";
    const conditions = ["environment = 'staging'"];
    const params: (string | number)[] = [];

    if (args.status) {
      conditions.push("enabled = ?");
      params.push(args.status === "enabled" ? 1 : 0);
    }
    if (args.search) {
      const pattern = `%${escapeLike(args.search)}%`;
      conditions.push("(key LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')");
      params.push(pattern, pattern);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;
    const total = db
      .prepare(`SELECT COUNT(*) AS count FROM feature_flags ${where}`)
      .get(...params) as { count: number };
    const page = Math.max(1, args.page);
    const pageSize = Math.min(50, Math.max(1, args.pageSize));
    const rows = db
      .prepare(
        `SELECT ${flagSelect} FROM feature_flags ${where}
         ORDER BY ${sort} ${direction}, id ASC LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, (page - 1) * pageSize) as FlagRow[];
    return { rows: rows.map(asFlagRecord), total: total.count };
  },
  get(db, id) {
    return getFlag(db, id);
  },
  actions: [
    {
      id: "flags.enable",
      label: "Enable flag",
      requiresReason: true,
      permission: "actions.execute",
      apply: applyState(true, "Enable"),
    },
    {
      id: "flags.disable",
      label: "Disable flag",
      requiresReason: true,
      permission: "actions.execute",
      apply: applyState(false, "Disable"),
    },
  ],
};

registerDataset(flags);

export default flags;
