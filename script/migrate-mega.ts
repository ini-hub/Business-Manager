import { pool } from '../server/db.ts';

async function run() {
  console.log("Starting Mega Migration (V2/V3/V4)...");
  
  try {
    await pool.query('BEGIN');
    
    console.log("1. Adding V2 Columns to existing tables...");
    // Inventory
    await pool.query(`ALTER TABLE inventory ADD COLUMN IF NOT EXISTS is_bundle BOOLEAN NOT NULL DEFAULT false`);
    // Orders
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS returned_quantity INTEGER NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS refunded_amount REAL NOT NULL DEFAULT 0`);
    // Checkouts
    await pool.query(`ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS is_partially_returned BOOLEAN NOT NULL DEFAULT false`);

    console.log("2. Creating V2 Tables...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS return_logs (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id VARCHAR NOT NULL REFERENCES stores(id),
        checkout_id VARCHAR NOT NULL REFERENCES checkouts(id),
        order_id VARCHAR NOT NULL REFERENCES orders(id),
        quantity INTEGER NOT NULL,
        refund_amount REAL NOT NULL,
        refund_method TEXT NOT NULL,
        reason TEXT,
        staff_id VARCHAR REFERENCES staff(id),
        user_id VARCHAR REFERENCES users(id),
        restock_event_id VARCHAR REFERENCES inventory_restock_events(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS cash_register_sessions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id VARCHAR NOT NULL REFERENCES stores(id),
        status TEXT NOT NULL DEFAULT 'open',
        opened_at TIMESTAMP NOT NULL DEFAULT NOW(),
        closed_at TIMESTAMP,
        opened_by_user_id VARCHAR REFERENCES users(id),
        closed_by_user_id VARCHAR REFERENCES users(id),
        opening_float REAL NOT NULL DEFAULT 0,
        expected_cash REAL NOT NULL DEFAULT 0,
        actual_cash REAL,
        difference REAL,
        notes TEXT
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS cash_drops (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id VARCHAR NOT NULL REFERENCES cash_register_sessions(id),
        amount REAL NOT NULL,
        dropped_at TIMESTAMP NOT NULL DEFAULT NOW(),
        dropped_by_user_id VARCHAR REFERENCES users(id),
        notes TEXT
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS vendors (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id VARCHAR NOT NULL REFERENCES stores(id),
        name TEXT NOT NULL,
        contact_name TEXT,
        email TEXT,
        phone TEXT,
        address TEXT,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS vendor_bills (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id VARCHAR NOT NULL REFERENCES stores(id),
        vendor_id VARCHAR NOT NULL REFERENCES vendors(id),
        amount REAL NOT NULL,
        amount_paid REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'unpaid',
        due_date TIMESTAMP,
        bill_date TIMESTAMP NOT NULL DEFAULT NOW(),
        notes TEXT,
        linked_restock_event_id VARCHAR REFERENCES inventory_restock_events(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS stock_audits (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id VARCHAR NOT NULL REFERENCES stores(id),
        status TEXT NOT NULL DEFAULT 'draft',
        notes TEXT,
        conducted_by_staff_id VARCHAR REFERENCES staff(id),
        approved_by_user_id VARCHAR REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        approved_at TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS stock_audit_items (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        audit_id VARCHAR NOT NULL REFERENCES stock_audits(id),
        inventory_id VARCHAR NOT NULL REFERENCES inventory(id),
        system_quantity INTEGER NOT NULL,
        physical_quantity INTEGER NOT NULL,
        variance INTEGER NOT NULL,
        reason TEXT
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bundle_components (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        parent_inventory_id VARCHAR NOT NULL REFERENCES inventory(id),
        component_inventory_id VARCHAR NOT NULL REFERENCES inventory(id),
        quantity INTEGER NOT NULL DEFAULT 1
      );
    `);

    // V3 Tables
    console.log("3. Creating V3 Tables...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quotes (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id VARCHAR NOT NULL REFERENCES stores(id),
        customer_id VARCHAR REFERENCES customers(id),
        quote_ref TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'draft',
        total_price REAL NOT NULL DEFAULT 0,
        notes TEXT,
        valid_until TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quote_items (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        quote_id VARCHAR NOT NULL REFERENCES quotes(id),
        inventory_id VARCHAR NOT NULL REFERENCES inventory(id),
        quantity INTEGER NOT NULL DEFAULT 1,
        unit_price REAL NOT NULL DEFAULT 0,
        total_price REAL NOT NULL DEFAULT 0
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id VARCHAR NOT NULL REFERENCES stores(id),
        vendor_id VARCHAR NOT NULL REFERENCES vendors(id),
        po_number TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'draft',
        total_amount REAL NOT NULL DEFAULT 0,
        expected_delivery TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS purchase_order_items (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        po_id VARCHAR NOT NULL REFERENCES purchase_orders(id),
        inventory_id VARCHAR NOT NULL REFERENCES inventory(id),
        quantity INTEGER NOT NULL,
        received_quantity INTEGER NOT NULL DEFAULT 0,
        unit_cost REAL NOT NULL,
        total_cost REAL NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS stock_transfers (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        from_store_id VARCHAR NOT NULL REFERENCES stores(id),
        to_store_id VARCHAR NOT NULL REFERENCES stores(id),
        status TEXT NOT NULL DEFAULT 'pending',
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS stock_transfer_items (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        transfer_id VARCHAR NOT NULL REFERENCES stock_transfers(id),
        inventory_id VARCHAR NOT NULL REFERENCES inventory(id),
        quantity INTEGER NOT NULL
      );
    `);

    // Add V3 Columns
    await pool.query(`ALTER TABLE inventory ADD COLUMN IF NOT EXISTS parent_inventory_id VARCHAR REFERENCES inventory(id)`);
    await pool.query(`ALTER TABLE inventory ADD COLUMN IF NOT EXISTS variant_dimensions JSONB`);

    // V4 Tables
    console.log("4. Creating V4 Tables...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tax_rates (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id VARCHAR NOT NULL REFERENCES stores(id),
        name TEXT NOT NULL,
        rate REAL NOT NULL,
        is_default BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS inventory_batches (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id VARCHAR NOT NULL REFERENCES stores(id),
        inventory_id VARCHAR NOT NULL REFERENCES inventory(id),
        batch_number TEXT NOT NULL,
        expiry_date TIMESTAMP NOT NULL,
        quantity INTEGER NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_applied REAL NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS tax_total REAL NOT NULL DEFAULT 0`);

    await pool.query('COMMIT');
    console.log("Migration successful!");
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error("Migration failed:", error);
  } finally {
    pool.end();
  }
}

run();
