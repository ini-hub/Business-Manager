import pg from "pg";
import fs from "fs";
import bcrypt from "bcrypt";

const url = fs.readFileSync(".env", "utf8").split("\n").find(l => l.startsWith("DATABASE_URL=")).split("=").slice(1).join("=").trim();
const client = new pg.Client({ connectionString: url });
await client.connect();

const password = "QaSmoke123!";
const hash = await bcrypt.hash(password, 10);
const email = "qa-smoke-test-verify@example.invalid";

await client.query("BEGIN");
try {
  const orgRes = await client.query(
    `insert into organisations (name, status) values ($1, 'active') returning id`,
    ["QA SMOKE TEST - delete me"]
  );
  const orgId = orgRes.rows[0].id;

  const userRes = await client.query(
    `insert into users (email, password_hash, role, is_verified, is_email_verified, business_id, status)
     values ($1, $2, 'owner', true, true, $3, 'active') returning id`,
    [email, hash, orgId]
  );
  const userId = userRes.rows[0].id;

  await client.query(
    `insert into organisation_members (user_id, organisation_id, role, status, activated_at)
     values ($1, $2, 'owner', 'active', now())`,
    [userId, orgId]
  );

  await client.query("COMMIT");
  console.log(JSON.stringify({ orgId, userId, email, password }));
} catch (e) {
  await client.query("ROLLBACK");
  console.error(e);
  process.exit(1);
} finally {
  await client.end();
}
