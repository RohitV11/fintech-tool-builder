import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { initializeSchema, openDatabase } from "../src/server/db.js";
import { seedDemo } from "../src/server/seed.js";

const dbPath = process.env.DB_PATH ?? "./data/app.db";
if (dbPath !== ":memory:") {
  const resolvedPath = resolve(dbPath);
  for (const suffix of ["", "-wal", "-shm"]) {
    const path = `${resolvedPath}${suffix}`;
    if (existsSync(path)) rmSync(path);
  }
}

const db = openDatabase(dbPath);
try {
  initializeSchema(db);
  seedDemo(db);
  console.log("Demo database reset and seeded.");
} finally {
  db.close();
}
