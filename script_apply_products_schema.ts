import { db } from "./server/db";
import { sql } from "drizzle-orm";

async function run() {
  console.log("🚀 Starting database schema migration for Products Table...");

  const queries = [
    // Create products table
    `CREATE TABLE IF NOT EXISTS "products" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "store_id" varchar NOT NULL REFERENCES stores(id),
      "name" text NOT NULL,
      "type" text NOT NULL,
      "category" text,
      "brand" text,
      "description" text,
      "is_active" boolean NOT NULL DEFAULT true,
      "is_deleted" boolean NOT NULL DEFAULT false,
      "deleted_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now(),
      CONSTRAINT "products_store_name_unique" UNIQUE ("store_id", "name")
    );`,

    // Alter inventory table to add product_id, sku, barcode
    `ALTER TABLE "inventory" ADD COLUMN IF NOT EXISTS "product_id" varchar REFERENCES products(id);`,
    `ALTER TABLE "inventory" ADD COLUMN IF NOT EXISTS "sku" text;`,
    `ALTER TABLE "inventory" ADD COLUMN IF NOT EXISTS "barcode" text;`,

    // Add unique constraint on store_id + sku for inventory
    `ALTER TABLE "inventory" ADD CONSTRAINT "inventory_store_sku_unique" UNIQUE ("store_id", "sku");`
  ];

  for (const q of queries) {
    try {
      console.log(`Executing: ${q.substring(0, 80).replace(/\n/g, ' ')}...`);
      await db.execute(sql.raw(q));
    } catch (e: any) {
      if (e.message.includes("already exists") || e.message.includes("already contains duplicate values")) {
        console.log(`⚠️ Warning: ${e.message} - Skipping...`);
        continue;
      }
      console.error(`❌ Failed to execute query: ${q}`, e.message);
      process.exit(1);
    }
  }

  console.log("✅ Database schema migration for Products Table applied successfully!");
  process.exit(0);
}

run().catch((err) => {
  console.error("Fatal migration error:", err);
  process.exit(1);
});
