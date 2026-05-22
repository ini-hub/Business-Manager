import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function run() {
  console.log("Starting checkouts migration...");
  try {
    await db.execute(sql`
      ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS split_payments jsonb;
    `);
    console.log("Added split_payments to checkouts");

    console.log("Migration completed successfully.");
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

run();
