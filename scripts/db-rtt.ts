// Measures database round-trip time from wherever this runs: `npm run db:rtt`.
// Run it on the production host as well as on a dev machine; statements x this number is the floor on every
// request's latency, and the gap between the two is what colocating the app and database would buy.
import "../server/lib/loadEnv";
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must be set.");
const samples = Number(process.env.RTT_SAMPLES || 30);
const ssl = /\bsslmode=require\b/.test(url) || /\.neon\.tech\b/.test(url) ? { rejectUnauthorized: true } : undefined;

async function main() {
  const client = new Client({ connectionString: url, ssl });
  const t0 = performance.now();
  await client.connect();
  const connectMs = performance.now() - t0;
  await client.query("select 1"); // first statement on a connection is not representative

  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    const t = performance.now();
    await client.query("select 1");
    times.push(performance.now() - t);
  }
  await client.end();
  times.sort((a, b) => a - b);
  const at = (p: number) => times[Math.min(times.length - 1, Math.floor((p / 100) * times.length))].toFixed(0);
  const host = new URL(url).hostname;
  console.log(`host      ${host}`);
  console.log(`connect   ${connectMs.toFixed(0)} ms`);
  console.log(`select 1  min ${at(0)}  median ${at(50)}  p90 ${at(90)}  max ${at(100)} ms  (${samples} samples)`);
  console.log(`rule of thumb: a request with N statements costs about N x ${at(50)} ms in database time`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
