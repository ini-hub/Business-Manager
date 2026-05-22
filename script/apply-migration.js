import fs from "fs/promises";
import { Client } from "pg";

async function main() {
  const file = process.argv[2] || "./migrations/0003_add_transactions_amount.sql";
  const sql = await fs.readFile(file, "utf8");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set. Set it and re-run the script.");
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    console.log(`Applying migration ${file}...`);
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("Migration applied successfully.");
  } catch (err) {
    console.error("Migration failed:", err.message || err);
    try { await client.query("ROLLBACK"); } catch (e) { /* no-op */ }
    process.exit(2);
  } finally {
    await client.end();
  }
}

main();
