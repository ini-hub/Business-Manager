import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/currency-utils";
import { apiRequest } from "@/lib/queryClient";

interface ReceiptPayload {
  business: { name: string } | null;
  store: { name: string; currency: string; phone?: string | null; address?: string | null } | null;
  settings: { receiptPrefix: string; receiptThankYouMessage?: string | null } | null;
  checkout: {
    receiptNumber: string;
    subtotal: number;
    discountAmount: number;
    discountPercent: number;
    totalCharged: number;
    paymentMethod: string;
    paymentStatus: string;
    isVoided: boolean;
    voidReason?: string | null;
    createdAt: string;
  };
  items: Array<{
    checkout: {
      id: string;
      totalPrice: number;
      subtotal: number;
      discountAmount: number;
      discountPercent: number;
      totalCharged: number;
    };
    order: {
      id: string;
      quantity: number;
      totalPrice: number;
    } | null;
    inventory: {
      id: string;
      name: string;
      type: string;
      sellingPrice: number;
    } | null;
    leadStaff?: { name: string } | null;
  }>;
  customer: { name: string; customerNumber: string } | null;
  staff: { name: string } | null;
}

interface ReceiptViewProps {
  payload: ReceiptPayload;
}

function paymentLabel(method: string) {
  const map: Record<string, string> = {
    cash: "Cash",
    transfer: "Bank Transfer",
    pos: "POS / Card",
    flutterwave: "Flutterwave",
  };
  return map[method] ?? method;
}

export function ReceiptView({ payload }: ReceiptViewProps) {
  const { business, store, settings, checkout, items = [], customer, staff } = payload;
  const currency = store?.currency ?? "NGN";
  const fmt = (v: number) => formatCurrency(v, currency);
  const isVoided = checkout?.isVoided;

  return (
    <div
      id="receipt-print-area"
      className="relative bg-white text-black font-mono text-sm p-6 max-w-sm mx-auto border border-gray-200 rounded-lg shadow-sm"
      style={{ fontFamily: "'Courier New', monospace", lineHeight: "1.5" }}
    >
      {/* VOID watermark */}
      {isVoided && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ zIndex: 10 }}
        >
          <span
            className="text-red-500 text-6xl font-black opacity-20 rotate-[-30deg] select-none"
            style={{ letterSpacing: "0.2em" }}
          >
            VOID
          </span>
        </div>
      )}

      {/* Header */}
      <div className="text-center mb-4">
        <p className="font-bold text-base uppercase tracking-widest">{business?.name ?? "Business"}</p>
        {store?.name && <p className="text-xs text-gray-600">{store.name}</p>}
        {store?.address && <p className="text-xs text-gray-500">{store.address}</p>}
        {store?.phone && <p className="text-xs text-gray-500">Tel: {store.phone}</p>}
      </div>

      <div className="border-t border-dashed border-gray-400 my-2" />

      {/* Receipt meta */}
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-500">Receipt #:</span>
        <span className="font-semibold">{checkout?.receiptNumber}</span>
      </div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-500">Date:</span>
        <span>{checkout?.createdAt ? format(new Date(checkout.createdAt), "dd MMM yyyy, h:mm a") : "—"}</span>
      </div>
      {customer && (
        <div className="flex justify-between text-xs mb-1">
          <span className="text-gray-500">Customer:</span>
          <span>{customer.name} ({customer.customerNumber})</span>
        </div>
      )}
      {staff && (
        <div className="flex justify-between text-xs mb-1">
          <span className="text-gray-500">Staff:</span>
          <span>{staff.name}</span>
        </div>
      )}

      <div className="border-t border-dashed border-gray-400 my-2" />

      {/* Items header */}
      <div className="grid grid-cols-12 text-xs font-bold mb-1">
        <div className="col-span-5">Item</div>
        <div className="col-span-2 text-center">Qty</div>
        <div className="col-span-2 text-right">Unit</div>
        <div className="col-span-3 text-right">Total</div>
      </div>

      {/* Items */}
      {items.map((item, idx) => {
        const qty = item.order?.quantity ?? 0;
        const totalPrice = item.checkout?.totalPrice ?? 0;
        const unitPrice = qty > 0 ? (totalPrice / qty) : 0;
        return (
          <div key={idx} className="grid grid-cols-12 text-xs mb-1">
            <div className="col-span-5 truncate">{item.inventory?.name ?? "Unknown Item"}</div>
            <div className="col-span-2 text-center">{qty}</div>
            <div className="col-span-2 text-right">{fmt(unitPrice)}</div>
            <div className="col-span-3 text-right">{fmt(totalPrice)}</div>
          </div>
        );
      })}

      <div className="border-t border-dashed border-gray-400 my-2" />

      {/* Totals */}
      <div className="flex justify-between text-xs mb-1">
        <span>Subtotal</span>
        <span>{fmt(checkout?.subtotal ?? 0)}</span>
      </div>
      {checkout?.discountAmount > 0 && (
        <div className="flex justify-between text-xs mb-1 text-red-600">
          <span>Discount ({checkout.discountPercent.toFixed(0)}%)</span>
          <span>− {fmt(checkout.discountAmount)}</span>
        </div>
      )}
      <div className="flex justify-between font-bold text-sm">
        <span>TOTAL CHARGED</span>
        <span>{fmt(checkout?.totalCharged ?? 0)}</span>
      </div>

      <div className="border-t border-dashed border-gray-400 my-2" />

      {/* Payment */}
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-500">Payment Method:</span>
        <span>{paymentLabel(checkout?.paymentMethod ?? "")}</span>
      </div>
      {checkout?.paymentStatus === "pending" && (
        <div className="flex justify-between text-xs text-amber-600 font-semibold">
          <span>Payment Status:</span>
          <span>⚠ PENDING</span>
        </div>
      )}

      {/* Void info */}
      {isVoided && (
        <>
          <div className="border-t border-dashed border-red-300 my-2" />
          <div className="text-center text-red-600 text-xs font-bold">** VOIDED **</div>
          {checkout?.voidReason && (
            <div className="text-center text-xs text-red-500">Reason: {checkout.voidReason}</div>
          )}
        </>
      )}

      {/* Thank you */}
      {settings?.receiptThankYouMessage && (
        <>
          <div className="border-t border-dashed border-gray-400 my-2" />
          <p className="text-center text-xs text-gray-500 italic">{settings.receiptThankYouMessage}</p>
        </>
      )}

      <div className="text-center text-xs text-gray-400 mt-3">
        Thank you for your patronage!
      </div>
    </div>
  );
}

// Hook to load receipt data
export function useReceiptPayload(checkoutId: string | null | undefined) {
  return useQuery<ReceiptPayload>({
    queryKey: ["/api/transactions/receipt", checkoutId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/transactions/${checkoutId}/receipt`);
      return res.json();
    },
    enabled: !!checkoutId,
  });
}
