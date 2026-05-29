import { pool } from "./server/db.ts";

async function run() {
  try {
    const res = await pool.query('SELECT store_id, customer_number, COUNT(*) FROM customers GROUP BY store_id, customer_number HAVING COUNT(*) > 1');
    console.log('Duplicates:', res.rows);
    if (res.rows.length > 0) {
      console.log("Fixing duplicates by setting empty customer_number...");
      await pool.query(`UPDATE customers SET customer_number = '' WHERE customer_number IS NULL OR customer_number = ''`);
      // Wait, if the duplicate is '' (empty string), that's the issue!
      // Many customers might have an empty customerNumber!
    }
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
run();
