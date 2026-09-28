/**
 * Seeds N fully-activated owner accounts (+ store, inventory, customers) into
 * TEST_DATABASE_URL for k6 load testing, and mints their jwt_token/CSRF pairs
 * directly (bypassing /api/auth/login) so a 3000-VU run doesn't hammer
 * authLimiter or need a multi-step login flow per VU.
 *
 * Usage: TEST_DATABASE_URL=... N=3000 tsx script/loadtest-seed.ts
 * Writes ./scratch-loadtest/credentials.json: [{ jwt, csrf, businessId, storeId, staffId, userId }]
 */
import { assertTestDatabase } from "../server/test-support/integration-db";
assertTestDatabase();

import bcrypt from "bcrypt";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { db, pool } from "../server/db";
import { generateToken } from "../server/auth";
import {
  users,
  organisations,
  organisationMembers,
  stores,
  staff,
  customers,
  inventory,
  products,
} from "@shared/schema";

const N = Number(process.env.N || 200);
const PASSWORD = "LoadTest@12345";
const OUT_DIR = path.resolve(process.cwd(), "scratch-loadtest");

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const creds: Array<{
    jwt: string;
    csrf: string;
    businessId: string;
    storeId: string;
    staffId: string;
    userId: string;
    email: string;
  }> = [];

  console.log(`Seeding ${N} load-test organisations into TEST_DATABASE_URL...`);

  for (let i = 0; i < N; i++) {
    const suffix = `${Date.now()}-${i}`;
    const email = `loadtest-${suffix}@example.test`;

    const [org] = await db.insert(organisations).values({
      name: `Load Test Org ${suffix}`,
      status: "active",
      trialEndsAt: null, // never gated
    }).returning();

    const [store] = await db.insert(stores).values({
      businessId: org.id,
      name: "Main Store",
      code: "MAIN",
      isMain: true,
    }).returning();

    const [user] = await db.insert(users).values({
      name: `Load Test Owner ${i}`,
      email,
      passwordHash,
      role: "owner",
      isEmailVerified: true,
      isVerified: true,
      status: "active",
    }).returning();

    await db.insert(organisationMembers).values({
      userId: user.id,
      organisationId: org.id,
      role: "owner",
      status: "active",
      activatedAt: new Date(),
    });

    const [staffRow] = await db.insert(staff).values({
      storeId: store.id,
      userId: user.id,
      name: user.name!,
      email,
      staffNumber: `MAIN-STF-${i}`,
      mobileNumber: `0800000${String(i).padStart(4, "0")}`,
      payPerMonth: "0",
      role: "manager",
      signedContract: true,
    }).returning();

    await db.insert(customers).values([
      { storeId: store.id, name: "Load Test Customer 1", mobileNumber: `0801${String(i).padStart(4, "0")}0001`, customerNumber: `MAIN-CUS-${i}-1`, address: "" },
      { storeId: store.id, name: "Load Test Customer 2", mobileNumber: `0801${String(i).padStart(4, "0")}0002`, customerNumber: `MAIN-CUS-${i}-2`, address: "" },
    ]);

    const [productRow, serviceRow] = await db.insert(products).values([
      { storeId: store.id, name: "Load Test Product", type: "product" },
      { storeId: store.id, name: "Load Test Service", type: "service" },
    ]).returning();

    await db.insert(inventory).values([
      { storeId: store.id, name: "Load Test Product", type: "product", costPrice: "1000", sellingPrice: "1500", quantity: 1000, productId: productRow.id },
      { storeId: store.id, name: "Load Test Service", type: "service", costPrice: "0", sellingPrice: "5000", quantity: 999999, productId: serviceRow.id },
    ]);

    const jwt = generateToken({
      userId: user.id,
      organisationId: org.id,
      role: "owner",
      staffId: staffRow.id,
      email,
    });
    const csrf = crypto.randomUUID();

    creds.push({
      jwt,
      csrf,
      businessId: org.id,
      storeId: store.id,
      staffId: staffRow.id,
      userId: user.id,
      email,
    });

    if ((i + 1) % 50 === 0) console.log(`  seeded ${i + 1}/${N}`);
  }

  fs.writeFileSync(path.join(OUT_DIR, "credentials.json"), JSON.stringify(creds, null, 2));
  console.log(`Done. Wrote ${creds.length} credentials to ${path.join(OUT_DIR, "credentials.json")}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
