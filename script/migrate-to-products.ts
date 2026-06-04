import { db } from "../server/db";
import { inventory, products } from "../shared/schema";
import { eq, and, isNull } from "drizzle-orm";

async function run() {
  console.log("🚀 Starting data migration: Decoupling Products and Variants...");

  // Fetch all root inventory items (where parentInventoryId is null and productId is null)
  const rootItems = await db
    .select()
    .from(inventory)
    .where(
      and(
        isNull(inventory.parentInventoryId),
        isNull(inventory.productId)
      )
    );

  console.log(`Found ${rootItems.length} root/standalone inventory items to process.`);

  let migratedProductsCount = 0;
  let linkedStandaloneCount = 0;
  let migratedVariantsParentCount = 0;
  let migratedVariantsCount = 0;

  for (const rootItem of rootItems) {
    try {
      // Find children of this root item
      const children = await db
        .select()
        .from(inventory)
        .where(eq(inventory.parentInventoryId, rootItem.id));

      // Create product record
      const [newProduct] = await db
        .insert(products)
        .values({
          storeId: rootItem.storeId,
          name: rootItem.name,
          type: rootItem.type,
          isDeleted: rootItem.isDeleted,
          deletedAt: rootItem.deletedAt,
          isActive: !rootItem.isDeleted,
        })
        .returning();

      migratedProductsCount++;

      if (children.length > 0) {
        // This was a parent with variants.
        // Update all children to link to the new product
        for (const child of children) {
          await db
            .update(inventory)
            .set({ productId: newProduct.id })
            .where(eq(inventory.id, child.id));
          migratedVariantsCount++;
        }

        // Soft-delete the parent placeholder inventory record
        await db
          .update(inventory)
          .set({
            productId: newProduct.id,
            isDeleted: true,
            deletedAt: new Date(),
          })
          .where(eq(inventory.id, rootItem.id));

        migratedVariantsParentCount++;
        console.log(`Migrated parent "${rootItem.name}" with ${children.length} variants.`);
      } else {
        // This is a standalone product.
        // Link the root inventory item to the new product
        await db
          .update(inventory)
          .set({ productId: newProduct.id })
          .where(eq(inventory.id, rootItem.id));

        linkedStandaloneCount++;
        console.log(`Migrated standalone product "${rootItem.name}".`);
      }
    } catch (err: any) {
      console.error(`❌ Failed to migrate inventory item ID ${rootItem.id}:`, err.message);
    }
  }

  console.log("\n📊 Migration Summary:");
  console.log(`- Created Products: ${migratedProductsCount}`);
  console.log(`- Standalone Items Linked: ${linkedStandaloneCount}`);
  console.log(`- Phantom Parent Records Deleted/Marked: ${migratedVariantsParentCount}`);
  console.log(`- Variant Items Linked: ${migratedVariantsCount}`);
  console.log("✅ Data migration completed successfully!");
  process.exit(0);
}

run().catch((err) => {
  console.error("Fatal migration error:", err);
  process.exit(1);
});
