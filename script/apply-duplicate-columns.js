import fs from "fs";
import path from "path";
import { Client } from "pg";

// Load environment variables manually from .env
if (!process.env.DATABASE_URL) {
  try {
    const envPath = path.resolve(".env");
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, "utf8");
      envContent.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            process.env[key] = val;
          }
        }
      });
    }
  } catch (err) {
    console.warn("Could not load .env manually:", err);
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set. Please provision a database and re-run.");
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    console.log("Applying duplicate tracking columns to 'customers' table...");
    await client.query("BEGIN");

    // Add global_customer_id
    await client.query(`
      ALTER TABLE customers 
      ADD COLUMN IF NOT EXISTS global_customer_id varchar
    `);

    // Add is_confirmed_distinct
    await client.query(`
      ALTER TABLE customers 
      ADD COLUMN IF NOT EXISTS is_confirmed_distinct boolean NOT NULL DEFAULT false
    `);

    // Add duplicate_of_id
    await client.query(`
      ALTER TABLE customers 
      ADD COLUMN IF NOT EXISTS duplicate_of_id varchar
    `);

    // Add merged_into_id
    await client.query(`
      ALTER TABLE customers 
      ADD COLUMN IF NOT EXISTS merged_into_id varchar
    `);

    await client.query("COMMIT");
    console.log("Migration columns applied successfully.");
  } catch (err) {
    console.error("Failed to apply columns:", err.message || err);
    try { await client.query("ROLLBACK"); } catch (e) { /* no-op */ }
    process.exit(2);
  } finally {
    await client.end();
  }
}

main();
