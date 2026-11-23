import { hashPassword } from "./auth.js";
import type { AppDatabase } from "./db.js";

const DEMO_PASSWORD = "demo-password";
const seedTime = "2026-11-23T04:15:00.000Z";

export function seedDemo(db: AppDatabase): void {
  const insertUser = db.prepare(
    `INSERT OR IGNORE INTO users (id, username, display_name, role, password_hash, org_id)
     VALUES (?, ?, ?, ?, ?, 'demo_org')`,
  );
  for (const [id, username, displayName, role] of [
    ["user_builder", "builder", "Demo Builder", "builder"],
    ["user_reviewer", "reviewer", "Demo Reviewer", "reviewer"],
    ["user_viewer", "viewer", "Demo Viewer", "viewer"],
  ] as const) {
    insertUser.run(id, username, displayName, role, hashPassword(DEMO_PASSWORD));
  }

  const insertRefund = db.prepare(
    `INSERT OR IGNORE INTO refund_requests
      (id, customer_ref, amount_cents, currency, reason_submitted, status, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  );
  const refundStatuses = [
    "pending", "pending", "pending", "approved", "rejected",
    "pending", "pending", "approved", "pending", "pending",
    "rejected", "pending", "approved", "pending", "pending",
    "pending", "rejected", "pending", "approved", "pending",
    "pending", "pending", "approved", "rejected", "pending",
  ] as const;
  refundStatuses.forEach((status, index) => {
    const number = index + 1;
    const date = new Date(Date.UTC(2026, 10, 1 + (index % 20), 9, 0)).toISOString();
    insertRefund.run(
      `rf_${String(number).padStart(3, "0")}`,
      `SYN-CUST-${String(number).padStart(4, "0")}`,
      1299 + number * 417,
      number % 3 === 0 ? "EUR" : "USD",
      `Synthetic customer request reason ${number}`,
      status,
      date,
      date,
    );
  });

  const insertKyc = db.prepare(
    `INSERT OR IGNORE INTO kyc_cases
      (id, customer_ref, masked_email, masked_phone, summary, status, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  );
  const kycStatuses = [
    "pending", "pending", "approved", "rejected", "pending",
    "approved", "pending", "pending", "rejected", "pending",
    "approved", "pending", "pending", "rejected", "pending",
  ] as const;
  kycStatuses.forEach((status, index) => {
    const number = index + 1;
    const date = new Date(Date.UTC(2026, 10, 2 + (index % 18), 11, 30)).toISOString();
    insertKyc.run(
      `kyc_${String(number).padStart(3, "0")}`,
      `SYN-CUST-${String(number + 100).padStart(4, "0")}`,
      `c***${number}@example.test`,
      `+1 (***) ***-${String(1000 + number).slice(-4)}`,
      `Synthetic identity review case ${number}`,
      status,
      date,
      date,
    );
  });

  const insertFlag = db.prepare(
    `INSERT OR IGNORE INTO feature_flags
      (id, key, description, enabled, environment, version, updated_at)
     VALUES (?, ?, ?, ?, 'staging', 1, ?)`,
  );
  for (let index = 1; index <= 8; index += 1) {
    insertFlag.run(
      `ff_${String(index).padStart(3, "0")}`,
      `demo_feature_${index}`,
      `Synthetic staging feature flag ${index}`,
      index % 2,
      seedTime,
    );
  }

}
