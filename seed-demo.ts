import { db } from "./server/db";
import { sql } from "drizzle-orm";
import { users, businesses, stores, storeCounters } from "./shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  // Mark demo user as verified
  const [demoUser] = await db.update(users)
    .set({ isVerified: true })
    .where(eq(users.email, "demo@businessmanager.com"))
    .returning();

  if (!demoUser) throw new Error("Demo user not found");
  console.log("✓ Demo user verified:", demoUser.email);

  // Create a store
  let [store] = await db.select().from(stores).where(eq(stores.businessId, demoUser.businessId!));
  if (!store) {
    [store] = await db.insert(stores).values({
      businessId: demoUser.businessId!,
      name: "Main Store",
      code: "MAIN",
      address: "123 Business Ave",
      phone: "08012345678",
      country: "NG",
      currency: "NGN",
    }).returning();
    console.log("✓ Store created:", store.id);
  } else {
    console.log("✓ Store already exists:", store.id, "code:", store.code);
  }

  const sid = store.id;

  // Upsert store counter
  await db.execute(sql`
    INSERT INTO store_counters (store_id, next_customer_number, next_transaction_number)
    VALUES (${sid}, 4, 1)
    ON CONFLICT (store_id) DO NOTHING
  `);
  console.log("✓ Store counters ready");

  // Create staff using raw SQL with correct column names
  await db.execute(sql`
    INSERT INTO staff (store_id, user_id, name, email, mobile_number, country_code, staff_number, role, pay_per_month, signed_contract, is_archived)
    VALUES (${sid}, ${demoUser.id}, 'Demo Owner', 'demo@businessmanager.com', '08012345678', '+234', 'MAIN-STF-001', 'manager', 300000, true, false)
    ON CONFLICT DO NOTHING
  `);
  console.log("✓ Staff (Demo Owner) ready");

  // Create inventory items
  await db.execute(sql`
    INSERT INTO inventory (store_id, name, type, cost_price, selling_price, quantity)
    VALUES
      (${sid}, 'Laptop Pro 14', 'product', 250000, 320000, 15),
      (${sid}, 'Wireless Mouse', 'product', 8000, 12000, 50),
      (${sid}, 'USB-C Hub', 'product', 12000, 18000, 30),
      (${sid}, 'Screen Protector', 'product', 2000, 3500, 100),
      (${sid}, 'Tech Support (1hr)', 'service', 0, 15000, 999)
    ON CONFLICT DO NOTHING
  `);
  console.log("✓ Inventory items ready");

  // Create customers
  await db.execute(sql`
    INSERT INTO customers (store_id, name, mobile_number, customer_number, address, is_archived)
    VALUES
      (${sid}, 'Adebayo Johnson', '08031234567', 'MAIN-CUS-001', '', false),
      (${sid}, 'Ngozi Okafor', '08054321987', 'MAIN-CUS-002', '', false),
      (${sid}, 'Emmanuel Chukwu', '09011112222', 'MAIN-CUS-003', '', false)
    ON CONFLICT DO NOTHING
  `);
  console.log("✓ Customers ready");

  console.log("\n======================================");
  console.log("         DEMO SETUP COMPLETE         ");
  console.log("======================================");
  console.log("URL:      http://localhost:5001");
  console.log("Email:    demo@businessmanager.com");
  console.log("Password: Demo@1234!");
  console.log("OTP Code: 123456");
  console.log("Store:    Main Store (code: MAIN)");
  console.log("======================================");
}

main().catch(console.error).finally(() => process.exit(0));
