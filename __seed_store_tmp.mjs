import pg from "pg";
import fs from "fs";
const url = fs.readFileSync(".env", "utf8").split("\n").find(l => l.startsWith("DATABASE_URL=")).split("=").slice(1).join("=").trim();
const client = new pg.Client({ connectionString: url });
await client.connect();
const orgId = process.argv[2];
const res = await client.query(
  `insert into stores (business_id, name, code) values ($1, 'QA Test Store', 'QAT') returning id`,
  [orgId]
);
console.log(res.rows[0].id);
await client.end();
