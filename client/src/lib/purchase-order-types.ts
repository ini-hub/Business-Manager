import type { PurchaseOrder, PurchaseOrderItem, Inventory } from "@shared/schema";

export type PoVendor = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  companyName?: string | null;
};

export type FullPO = PurchaseOrder & {
  vendor: PoVendor;
  items: (PurchaseOrderItem & { inventory: Inventory })[];
  deliveryReceipts?: { id: string; receiptName: string; createdAt: string }[];
};

export const PO_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  ordered: "Placed",
  partially_received: "Partially received",
  received: "Received",
  cancelled: "Cancelled",
};
