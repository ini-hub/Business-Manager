import type { Inventory } from "@shared/schema";

// Mirrors new-sale's CartItem shape (minus staff/commission fields, which are
// a sale-time concept the quote builder has no use for) so the item picker
// and row UI can be shared/mimicked across both builders.
export interface QuoteCartItem {
  inventory: Inventory;
  quantity: number;
  customPrice: number;
  totalPrice: number;
}
