import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("=== Administrative Database Schema Sync ===");
  console.log("Executing SQL migrations directly...");

  try {
    // 1. Add columns to organisations
    console.log("1. Syncing organisations table...");
    await db.execute(sql`
      ALTER TABLE organisations 
      ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
      ADD COLUMN IF NOT EXISTS suspension_reason text,
      ADD COLUMN IF NOT EXISTS suspension_note text,
      ADD COLUMN IF NOT EXISTS suspended_at timestamp,
      ADD COLUMN IF NOT EXISTS deleted_at timestamp,
      ADD COLUMN IF NOT EXISTS deletion_reason text;
    `);

    // 2. Add columns to users
    console.log("2. Syncing users table...");
    await db.execute(sql`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
      ADD COLUMN IF NOT EXISTS suspension_reason text,
      ADD COLUMN IF NOT EXISTS suspended_at timestamp;
    `);

    // 3. Create super_admins table
    console.log("3. Syncing super_admins table...");
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS super_admins (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        email text UNIQUE NOT NULL,
        password_hash text NOT NULL,
        mfa_secret text,
        mfa_enabled boolean NOT NULL DEFAULT false,
        role text NOT NULL DEFAULT 'ops_manager',
        status text NOT NULL DEFAULT 'active',
        created_at timestamp NOT NULL DEFAULT now(),
        last_login_at timestamp
      );
    `);

    // 4. Create feature_flags table
    console.log("4. Syncing feature_flags table...");
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS feature_flags (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        name text UNIQUE NOT NULL,
        status text NOT NULL DEFAULT 'off',
        scoped_org_ids jsonb,
        subscription_tier text,
        description text NOT NULL,
        updated_at timestamp NOT NULL DEFAULT now(),
        updated_by text
      );
    `);

    // 5. Create announcements table
    console.log("5. Syncing announcements table...");
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS announcements (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        title text NOT NULL,
        message text NOT NULL,
        type text NOT NULL DEFAULT 'info',
        target text NOT NULL DEFAULT 'all',
        target_org_id varchar REFERENCES organisations(id),
        show_from timestamp NOT NULL,
        show_until timestamp NOT NULL,
        dismissible boolean NOT NULL DEFAULT true,
        created_at timestamp NOT NULL DEFAULT now(),
        created_by text
      );
    `);

    // 6. Create super_admin_audit_logs table
    console.log("6. Syncing super_admin_audit_logs table...");
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS super_admin_audit_logs (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        admin_id varchar NOT NULL REFERENCES super_admins(id),
        admin_email text NOT NULL,
        admin_role text NOT NULL,
        action text NOT NULL,
        target text NOT NULL,
        ip_address text NOT NULL,
        details jsonb,
        created_at timestamp NOT NULL DEFAULT now()
      );
    `);

    console.log("\n==========================================");
    console.log("SUCCESS: Administrative database schema synced!");
    console.log("==========================================\n");
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  }
}

main().then(() => process.exit(0));
