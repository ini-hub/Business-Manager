require('dotenv').config();
const { Client } = require('pg');

async function main(){
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try{
    const res = await client.query(`SELECT id, checkout_id, amount, transaction_date, store_id FROM transactions ORDER BY transaction_date DESC LIMIT 10;`);
    console.log(JSON.stringify(res.rows, null, 2));
  }catch(e){
    console.error('Query error:', e.message);
    process.exit(1);
  }finally{
    await client.end();
  }
}

main();
