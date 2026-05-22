import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: 'postgresql://mac@127.0.0.1:5433/business_manager' });

async function migrate() {
  await pool.query(`
    ALTER TABLE checkouts 
      ADD COLUMN IF NOT EXISTS booking_deposit_amount real DEFAULT 0,
      ADD COLUMN IF NOT EXISTS booking_deposit_method text,
      ADD COLUMN IF NOT EXISTS balance_collected_today real NOT NULL DEFAULT 0
  `);
  const res = await pool.query(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name='checkouts' 
    AND column_name IN ('booking_deposit_amount','booking_deposit_method','balance_collected_today')
  `);
  console.log('Migration complete. Columns:', res.rows.map((r: any) => r.column_name).join(', '));
  await pool.end();
}

migrate().catch(e => { console.error(e.message); process.exit(1); });
