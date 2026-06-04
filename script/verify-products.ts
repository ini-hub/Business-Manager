import { db } from "../server/db";
import { storage } from "../server/storage";
import {
  products,
  inventory,
  checkouts,
  transactions,
  organisations,
  stores,
  staff,
  customers,
  storeCounters,
  inventoryRestockEvents,
  orders,
  profitLoss,
  settings,
  type CostStrategy
} from "../shared/schema";
import { eq, and, isNull } from "drizzle-orm";

async function run() {
  console.log("🚀 Starting Automated Product-Variant Decoupling Verification Checks...\n");

  const timestamp = Date.now();
  let testBusiness: any = null;
  let testStore: any = null;
  let testStaff: any = null;
  let testCustomer: any = null;
  
  const createdProductIds: string[] = [];
  const createdInventoryIds: string[] = [];
  const createdRestockEventIds: string[] = [];
  const createdCheckoutIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdTransactionIds: string[] = [];

  let hasFailed = false;

  function assert(condition: boolean, message: string) {
    if (!condition) {
      console.error(`❌ [FAILED] ${message}`);
      throw new Error(message);
    } else {
      console.log(`✅ [PASS] ${message}`);
    }
  }

  try {
    // ==========================================
    // 0. SETUP TEMPORARY TEST ENVIRONMENT
    // ==========================================
    console.log("--- 0. Setup Temporary Test Environment ---");
    
    // Create Business
    const [biz] = await db.insert(organisations).values({
      name: `Test Business ${timestamp}`,
      slug: `test-business-slug-${timestamp}`,
      receiptPrefix: `TST-${timestamp}`,
      phone: "+2348000000000",
    }).returning();
    testBusiness = biz;
    console.log(`Created test business: ${biz.name} (ID: ${biz.id})`);

    // Create Store
    const [store] = await db.insert(stores).values({
      businessId: biz.id,
      name: `Test Store ${timestamp}`,
      code: `TST${String(timestamp).slice(-4)}`,
      country: "NG",
      currency: "NGN",
    }).returning();
    testStore = store;
    console.log(`Created test store: ${store.name} (ID: ${store.id})`);

    // Create Store Counter
    await db.insert(storeCounters).values({
      storeId: store.id,
      nextCustomerNumber: 1,
      nextTransactionNumber: 1,
      nextBookingNumber: 1,
    });
    console.log("Created test store counter.");

    // Create Staff
    const [staffMember] = await db.insert(staff).values({
      storeId: store.id,
      name: `Test Staff ${timestamp}`,
      email: `staff-${timestamp}@test.com`,
      mobileNumber: "08012345678",
      countryCode: "+234",
      staffNumber: `STF-${timestamp}`,
      role: "manager",
      payPerMonth: 100000,
      signedContract: true,
      isArchived: false,
    }).returning();
    testStaff = staffMember;
    console.log(`Created test staff: ${staffMember.name} (ID: ${staffMember.id})`);

    // Create Customer
    const [customer] = await db.insert(customers).values({
      storeId: store.id,
      name: `Test Customer ${timestamp}`,
      customerNumber: `TST-CUS-${timestamp}`,
      mobileNumber: "08099998888",
      address: "123 Test Street",
    }).returning();
    testCustomer = customer;
    console.log(`Created test customer: ${customer.name} (ID: ${customer.id})\n`);

    // ==========================================
    // 1. CHECK 1: CREATE PRODUCT WITH VARIANTS
    // ==========================================
    console.log("--- 1. Check 1: Product with Variants Creation ---");
    
    // Create Product grouping
    const poloProduct = await storage.createProduct({
      storeId: store.id,
      name: `Test Polo ${timestamp}`,
      type: "product",
      category: "Apparel",
      brand: "BrandX",
      description: "A premium polo shirt"
    });
    createdProductIds.push(poloProduct.id);
    
    assert(!!poloProduct.id, "Product grouping created successfully and returned valid ID");
    assert(poloProduct.name === `Test Polo ${timestamp}`, "Product grouping name matches");
    assert(poloProduct.type === "product", "Product grouping type is 'product'");

    // Verify it is in database
    const [dbProduct] = await db.select().from(products).where(eq(products.id, poloProduct.id));
    assert(!!dbProduct, "Product grouping verified directly in database");

    // Add variants
    const poloRed = await storage.createInventoryItem({
      storeId: store.id,
      name: `Test Polo ${timestamp} - Red`,
      type: "product",
      costPrice: 50,
      sellingPrice: 100,
      quantity: 10,
      productId: poloProduct.id,
      sku: `POLO-RED-${timestamp}`,
    });
    createdInventoryIds.push(poloRed.id);

    const poloBlue = await storage.createInventoryItem({
      storeId: store.id,
      name: `Test Polo ${timestamp} - Blue`,
      type: "product",
      costPrice: 60,
      sellingPrice: 120,
      quantity: 15,
      productId: poloProduct.id,
      sku: `POLO-BLUE-${timestamp}`,
    });
    createdInventoryIds.push(poloBlue.id);

    assert(poloRed.productId === poloProduct.id, "Red variant successfully linked to product grouping");
    assert(poloBlue.productId === poloProduct.id, "Blue variant successfully linked to product grouping");
    assert(poloRed.quantity === 10, "Red variant quantity correctly set to 10");
    assert(poloBlue.quantity === 15, "Blue variant quantity correctly set to 15");

    // Verify retrieving product with variants
    const retrievedProduct = await storage.getProduct(poloProduct.id);
    assert(!!retrievedProduct, "Successfully retrieved product details via storage");
    assert(retrievedProduct.variants && retrievedProduct.variants.length === 2, "Product details returned exactly 2 variants");
    
    const hasRed = retrievedProduct.variants.some((v: any) => v.id === poloRed.id);
    const hasBlue = retrievedProduct.variants.some((v: any) => v.id === poloBlue.id);
    assert(hasRed && hasBlue, "Variants match the created records\n");

    // ==========================================
    // 2. CHECK 2: SIMPLE PRODUCT AUTO-CREATION FALLBACK
    // ==========================================
    console.log("--- 2. Check 2: Simple Product Auto-Creation ---");
    
    // Create an inventory item without sending a productId
    const simpleMug = await storage.createInventoryItem({
      storeId: store.id,
      name: `Test Mug ${timestamp}`,
      type: "product",
      costPrice: 30,
      sellingPrice: 50,
      quantity: 8,
      sku: `MUG-${timestamp}`,
    });
    createdInventoryIds.push(simpleMug.id);

    assert(!!simpleMug.productId, "Simple item was assigned a product ID fallback automatically");
    
    // Verify that the product grouping was created
    const autoProduct = await storage.getProduct(simpleMug.productId!);
    assert(!!autoProduct, "Automatic product grouping found in database");
    assert(autoProduct.name === `Test Mug ${timestamp}`, "Automatic product grouping name matches the inventory name");
    assert(autoProduct.type === "product", "Automatic product grouping type is product");
    
    createdProductIds.push(autoProduct.id);
    console.log("Simple product auto-creation verified successfully.\n");

    // ==========================================
    // 3. CHECK 3: POS CHECKOUT AND SALE REGISTERING
    // ==========================================
    console.log("--- 3. Check 3: POS Checkout Flow ---");
    
    // Process checkout: buy 2 units of Red Polo, 1 unit of Simple Mug using "transfer"
    const checkoutResult = await storage.processCheckout({
      storeId: store.id,
      customerId: customer.id,
      staffId: staffMember.id,
      items: [
        {
          inventoryId: poloRed.id,
          quantity: 2,
          commissionSplit: "standard",
        },
        {
          inventoryId: simpleMug.id,
          quantity: 1,
          commissionSplit: "standard",
        }
      ],
      paymentMethod: "transfer",
    });

    if (!checkoutResult.success) {
      console.error("Checkout failed with message:", checkoutResult.message);
    }
    assert(checkoutResult.success === true, "processCheckout executed successfully");
    assert(!!checkoutResult.checkoutIds && checkoutResult.checkoutIds.length > 0, "Checkout returned non-empty checkout ID");
    
    if (checkoutResult.checkoutIds) {
      createdCheckoutIds.push(...checkoutResult.checkoutIds);
    }

    // Verify stock deduction
    const [updatedPoloRed] = await db.select().from(inventory).where(eq(inventory.id, poloRed.id));
    assert(updatedPoloRed.quantity === 8, `Polo Red stock decremented successfully: expected 8, got ${updatedPoloRed.quantity}`);

    const [updatedMug] = await db.select().from(inventory).where(eq(inventory.id, simpleMug.id));
    assert(updatedMug.quantity === 7, `Mug stock decremented successfully: expected 7, got ${updatedMug.quantity}`);

    // Verify checkout and order record creation
    for (const cId of checkoutResult.checkoutIds || []) {
      const [dbCheckout] = await db.select().from(checkouts).where(eq(checkouts.id, cId));
      assert(!!dbCheckout, `Checkout record ${cId} verified in database`);
      createdOrderIds.push(dbCheckout.orderId);

      const dbTxns = await db.select().from(transactions).where(eq(transactions.checkoutId, cId));
      assert(dbTxns.length > 0, `Transaction records found referencing checkout ${cId}`);
      for (const txn of dbTxns) {
        createdTransactionIds.push(txn.id);
      }
    }
    console.log("POS checkout flow verified successfully.\n");

    // ==========================================
    // 4. CHECK 4: RESTOCK FLOW AND WEIGHTED COST
    // ==========================================
    console.log("--- 4. Check 4: Restocking with Weighted Cost strategy ---");
    
    // Current state of poloRed: quantity = 8, costPrice = 50, sellingPrice = 100
    // Restock: add 5 units at cost of 60, change sellingPrice to 110. Strategy = weighted.
    // Expected quantity: 8 + 5 = 13
    // Expected cost price: ((8 * 50) + (5 * 60)) / 13 = (400 + 300) / 13 = 700 / 13 = 53.846... ~ 53.85
    
    const restockResult = await storage.createRestockEvent({
      storeId: store.id,
      inventoryId: poloRed.id,
      staffId: staffMember.id,
      quantityAdded: 5,
      unitCost: 60,
      costStrategy: "weighted" as CostStrategy,
      newSellingPrice: 110,
      reason: "Restock",
      notes: "Verification check for weighted cost strategy"
    });

    assert(!!restockResult.restockEvent.id, "Restock event logged successfully");
    createdRestockEventIds.push(restockResult.restockEvent.id);

    const updatedInvItem = restockResult.updatedInventory;
    assert(updatedInvItem.quantity === 13, `Quantity after restock is correct: expected 13, got ${updatedInvItem.quantity}`);
    assert(updatedInvItem.sellingPrice === 110, `Selling price updated: expected 110, got ${updatedInvItem.sellingPrice}`);
    
    const expectedCost = 53.85;
    const diff = Math.abs(updatedInvItem.costPrice - expectedCost);
    assert(diff < 0.05, `Weighted cost price calculation is correct: expected close to 53.85, got ${updatedInvItem.costPrice}`);

    // Verify profit and loss summary reflects correct records
    const todayStr = new Date().toISOString().split("T")[0];
    const plSummary = await storage.getProfitLossSummary(store.id, todayStr, todayStr);
    assert(plSummary.totalRevenue > 0, `Profit & Loss summary has recorded revenue: got ${plSummary.totalRevenue}`);
    console.log("Restock flow and weighted cost verification successful.\n");

  } catch (err) {
    console.error("❌ Verification failed:", err);
    hasFailed = true;
  } finally {
    console.log("--- Cleaning up verification test records ---");
    
    try {
      // -1. Delete settings records
      if (testStore) {
        await db.delete(settings).where(eq(settings.storeId, testStore.id));
      }
      // 0. Delete profit_loss records
      if (testStore) {
        await db.delete(profitLoss).where(eq(profitLoss.storeId, testStore.id));
      }
      // 1. Delete restock events
      for (const reId of createdRestockEventIds) {
        await db.delete(inventoryRestockEvents).where(eq(inventoryRestockEvents.id, reId));
      }
      // 2. Delete transactions
      for (const tId of createdTransactionIds) {
        await db.delete(transactions).where(eq(transactions.id, tId));
      }
      // 3. Delete checkouts
      for (const cId of createdCheckoutIds) {
        await db.delete(checkouts).where(eq(checkouts.id, cId));
      }
      // 4. Delete orders
      for (const oId of createdOrderIds) {
        await db.delete(orders).where(eq(orders.id, oId));
      }
      // 5. Delete inventory
      for (const invId of createdInventoryIds) {
        await db.delete(inventory).where(eq(inventory.id, invId));
      }
      // 6. Delete products
      for (const prodId of createdProductIds) {
        await db.delete(products).where(eq(products.id, prodId));
      }

      // 7. Delete Customer, Staff, Store Counter, Store, and Business
      if (testCustomer) {
        await db.delete(customers).where(eq(customers.id, testCustomer.id));
      }
      if (testStaff) {
        await db.delete(staff).where(eq(staff.id, testStaff.id));
      }
      if (testStore) {
        await db.delete(storeCounters).where(eq(storeCounters.storeId, testStore.id));
        await db.delete(stores).where(eq(stores.id, testStore.id));
      }
      if (testBusiness) {
        await db.delete(organisations).where(eq(organisations.id, testBusiness.id));
      }
      
      console.log("🧹 Cleanup complete.");
    } catch (cleanupErr: any) {
      console.error("❌ Cleanup failed:", cleanupErr.message);
      hasFailed = true;
    }

    if (hasFailed) {
      console.log("\n❌ AUTOMATED VERIFICATION CHECKS ENCOUNTERED ERRORS.");
      process.exit(1);
    } else {
      console.log("\n🎉 ALL AUTOMATED VERIFICATION CHECKS PASSED!");
      process.exit(0);
    }
  }
}

run().catch((err) => {
  console.error("Fatal verification script crash:", err);
  process.exit(1);
});
