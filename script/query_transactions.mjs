import { Client } from 'pg';

async function main(){
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set in environment');
    process.exit(1);
  }
  const client = new Client({ connectionString: databaseUrl });
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
