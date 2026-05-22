import { Pool } from 'pg';
import fs from 'fs';

const pool = new Pool({
  connectionString: 'postgresql://mac@127.0.0.1:5433/business_manager'
});

async function run() {
  try {
    const sql = fs.readFileSync('fix.sql', 'utf-8');
    await pool.query(sql);
    console.log('SQL executed successfully!');
  } catch (err) {
    console.error('Error executing SQL:', err);
  } finally {
    await pool.end();
  }
}

run();
