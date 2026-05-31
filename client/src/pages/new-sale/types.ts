import type { Inventory } from "@shared/schema";

export interface CartItem {
  inventory: Inventory;
  quantity: number;
  customPrice: number;
  totalPrice: number;
  leadStaffId?: string | null;
  assistingStaff1Id?: string | null;
  assistingStaff2Id?: string | null;
  commissionSplit: "standard" | "equal";
  showAsst1?: boolean;
  showAsst2?: boolean;
}
