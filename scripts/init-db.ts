import { initializeSchema, openDatabase } from "../src/server/db.js";
import { seedDemo } from "../src/server/seed.js";

const db = openDatabase();
try {
  initializeSchema(db);
  seedDemo(db);
  console.log("Database schema initialized and demo data seeded.");
} finally {
  db.close();
}
