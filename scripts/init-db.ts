import { initializeSchema, openDatabase } from "../src/server/db.js";
import { seedDemo } from "../src/server/seed.js";
import { seedPublishedRefundApp } from "../src/server/seed-apps/seed-refunds.js";
import { seedPublishedFlagsApp, seedPublishedKycApp } from "../src/server/seed-apps/seed-reuse.js";

const db = openDatabase();
try {
  initializeSchema(db);
  seedDemo(db);
  seedPublishedRefundApp(db);
  seedPublishedKycApp(db);
  seedPublishedFlagsApp(db);
  console.log("Database schema initialized and demo data seeded.");
} finally {
  db.close();
}
