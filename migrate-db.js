import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "expense_categories" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "store_id" varchar NOT NULL REFERENCES stores(id),
        "name" text NOT NULL,
        "is_system" boolean NOT NULL DEFAULT false,
        "created_at" timestamp NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS "expenses" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "store_id" varchar NOT NULL REFERENCES stores(id),
        "title" text NOT NULL,
        "amount" real NOT NULL DEFAULT 0,
        "category_id" varchar NOT NULL REFERENCES expense_categories(id),
        "date" text NOT NULL,
        "notes" text,
        "receipt_url" text,
        "is_auto_generated" boolean NOT NULL DEFAULT false,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );
    `);
    console.log("Tables created successfully");
  } catch (err) {
    console.error("Error creating tables:", err);
  } finally {
    pool.end();
  }
}

run();
