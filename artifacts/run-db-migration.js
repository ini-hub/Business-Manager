import pkg from 'pg';
const { Pool } = pkg;
import fs from 'fs';
import path from 'path';

// Load .env
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

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    console.log("Running direct DDL migrations in Plain JS...");

    // 1. Alter inventory_restock_events
    await client.query(`
      ALTER TABLE inventory_restock_events 
      ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT 'Regular Restock';
    `);
    console.log("- Column 'reason' checked/added to inventory_restock_events");

    await client.query(`
      ALTER TABLE inventory_restock_events 
      ADD COLUMN IF NOT EXISTS attachment TEXT;
    `);
    console.log("- Column 'attachment' checked/added to inventory_restock_events");

    // 2. Create promotions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS promotions (
        id VARCHAR(256) PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id VARCHAR(256) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        buy_item_id VARCHAR(256) REFERENCES inventory(id),
        buy_quantity INTEGER,
        get_item_id VARCHAR(256) REFERENCES inventory(id),
        get_quantity INTEGER,
        spend_amount REAL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    console.log("- Table 'promotions' checked/created");

    console.log("Migrations successfully completed!");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
