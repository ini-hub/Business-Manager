import * as z from "zod";
import { insertCustomerSchema } from "@shared/schema";

export const bookingFormSchema = z.object({
  type: z.enum(["appointment", "order"]),
  customerId: z.string().min(1, "Customer is required"),
  scheduledAt: z.date({ required_error: "Date is required" }),
  time: z.string().optional(),
  expectedReadyAt: z.date().optional(),
  leadStaffId: z.string().optional(),
  depositAmount: z.coerce.number().min(0, "Deposit cannot be negative").default(0),
  depositPaymentMethod: z.enum(["cash", "transfer", "pos"]).default("cash"),
  reminderPreference: z.enum(["whatsapp", "sms", "both", "none"]).default("whatsapp"),
  notes: z.string().optional(),
  subtotal: z.number().min(0).default(0),
  discountAmount: z.number().min(0).default(0),
  discountPercent: z.number().min(0).default(0),
  discountReason: z.string().optional(),
  discountApprovedBy: z.string().optional(),
  totalPrice: z.number().min(0).default(0),
  bookingItems: z
    .array(
      z.object({
        inventoryId: z.string().min(1, "Item is required"),
        quantity: z.coerce.number().min(1, "Quantity must be at least 1"),
        unitPrice: z.coerce.number().min(0),
      })
    )
    .min(1, "At least one item or service is required"),
});

export type BookingFormValues = z.infer<typeof bookingFormSchema>;

const newCustomerSchema = insertCustomerSchema.extend({
  mobileNumber: z.string().optional().default(""),
});
export type InsertCustomer = z.infer<typeof newCustomerSchema>;
export { newCustomerSchema };

export type WizardStep = "customer" | "items" | "schedule" | "summary";

export const WIZARD_STEPS: { id: WizardStep; label: string; description: string }[] = [
  { id: "customer", label: "Customer", description: "Who is this booking for?" },
  { id: "items", label: "Items & Services", description: "What services or products?" },
  { id: "schedule", label: "Schedule", description: "When and who?" },
  { id: "summary", label: "Payment & Confirm", description: "Review and finalize" },
];
