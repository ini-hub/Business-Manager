import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    await pool.query('ALTER TABLE "profit_loss" RENAME COLUMN "total_net_profit" TO "total_gross_profit";');
    console.log("Renamed successfully");
  } catch (err) {
    console.error("Error renaming:", err);
  } finally {
    pool.end();
  }
}

run();
