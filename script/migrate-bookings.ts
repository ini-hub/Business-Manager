import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function run() {
  console.log("Starting migrations...");
  try {
    // Check if store_counters table exists
    await db.execute(sql`
      ALTER TABLE store_counters ADD COLUMN IF NOT EXISTS next_booking_number integer NOT NULL DEFAULT 1;
    `);
    console.log("Added next_booking_number to store_counters");

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "bookings" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "store_id" varchar NOT NULL,
        "customer_id" varchar NOT NULL,
        "booking_ref" text NOT NULL,
        "type" text NOT NULL,
        "status" text DEFAULT 'pending' NOT NULL,
        "scheduled_at" timestamp NOT NULL,
        "expected_ready_at" timestamp,
        "lead_staff_id" varchar,
        "assisting_staff_id" varchar,
        "deposit_amount" real DEFAULT 0 NOT NULL,
        "deposit_payment_method" text,
        "subtotal" real DEFAULT 0 NOT NULL,
        "discount_amount" real DEFAULT 0 NOT NULL,
        "discount_percent" real DEFAULT 0 NOT NULL,
        "discount_reason" text,
        "discount_approved_by" text,
        "total_price" real DEFAULT 0 NOT NULL,
        "reminder_preference" text DEFAULT 'whatsapp' NOT NULL,
        "notes" text,
        "reschedule_reason" text,
        "reschedule_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "bookings_booking_ref_unique" UNIQUE("booking_ref")
      );
    `);
    console.log("Created bookings table");

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "booking_items" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "booking_id" varchar NOT NULL,
        "inventory_id" varchar NOT NULL,
        "quantity" integer DEFAULT 1 NOT NULL,
        "unit_price" real DEFAULT 0 NOT NULL,
        "total_price" real DEFAULT 0 NOT NULL
      );
    `);
    console.log("Created booking_items table");

    // Add foreign keys (ignore errors if they already exist)
    try {
      await db.execute(sql`
        DO $$ BEGIN
          ALTER TABLE "bookings" ADD CONSTRAINT "bookings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;
        EXCEPTION
          WHEN duplicate_object THEN null;
        END $$;
      `);
      await db.execute(sql`
        DO $$ BEGIN
          ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
        EXCEPTION
          WHEN duplicate_object THEN null;
        END $$;
      `);
      await db.execute(sql`
        DO $$ BEGIN
          ALTER TABLE "bookings" ADD CONSTRAINT "bookings_lead_staff_id_staff_id_fk" FOREIGN KEY ("lead_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;
        EXCEPTION
          WHEN duplicate_object THEN null;
        END $$;
      `);
      await db.execute(sql`
        DO $$ BEGIN
          ALTER TABLE "bookings" ADD CONSTRAINT "bookings_assisting_staff_id_staff_id_fk" FOREIGN KEY ("assisting_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;
        EXCEPTION
          WHEN duplicate_object THEN null;
        END $$;
      `);
      await db.execute(sql`
        DO $$ BEGIN
          ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;
        EXCEPTION
          WHEN duplicate_object THEN null;
        END $$;
      `);
      await db.execute(sql`
        DO $$ BEGIN
          ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_inventory_id_inventory_id_fk" FOREIGN KEY ("inventory_id") REFERENCES "public"."inventory"("id") ON DELETE no action ON UPDATE no action;
        EXCEPTION
          WHEN duplicate_object THEN null;
        END $$;
      `);
    } catch (e) {
      console.log("Foreign keys already exist or skipped.");
    }
    
    console.log("Migration completed successfully.");
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

run();
