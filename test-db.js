import pg from 'pg';
const { Client } = pg;

async function test(user, pw) {
  const connectionString = pw ? `postgresql://${user}:${pw}@127.0.0.1:5432/postgres` : `postgresql://${user}@127.0.0.1:5432/postgres`;
  const client = new Client({ connectionString });
  try {
    await client.connect();
    console.log(`Success with user ${user} and password '${pw}'`);
    await client.end();
    return true;
  } catch (e) {
    // console.log(`Failed with user ${user} and password '${pw}': ${e.message}`);
    return false;
  }
}

async function main() {
  const users = ['mac', 'postgres', 'root'];
  const passwords = ['', 'mac', 'postgres', 'password', 'root'];
  for (const user of users) {
    for (const pw of passwords) {
      if (await test(user, pw)) process.exit(0);
    }
  }
  console.log("None succeeded.");
  process.exit(1);
}

main();
