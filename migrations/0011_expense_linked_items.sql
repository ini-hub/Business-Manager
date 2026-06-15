-- Add allocation_driver column to expenses table
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "allocation_driver" text NOT NULL DEFAULT 'count';

-- Create expense_linked_items table for multi-product expense allocation
CREATE TABLE IF NOT EXISTS "expense_linked_items" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "expense_id" varchar NOT NULL REFERENCES "expenses"("id") ON DELETE CASCADE,
  "product_id" varchar NOT NULL REFERENCES "products"("id"),
  CONSTRAINT "expense_linked_items_unique" UNIQUE ("expense_id", "product_id")
);
