import { createApp } from "./app.js";
import { hasSchema, openDatabase } from "./db.js";

const db = openDatabase();
if (!hasSchema(db)) {
  console.error("Database schema is missing; run npm run db:init");
  db.close();
  process.exit(1);
}

const app = createApp({ db });
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);
app.listen(port, host, () => {
  console.log(`Fintech Tool Builder listening at http://${host}:${port}`);
});
