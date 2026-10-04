import { apiRequest } from "@/lib/queryClient";

export const PO_RECEIPT_ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";
export const PO_RECEIPT_MAX_BYTES = 10 * 1024 * 1024;

/** Throws a user-readable Error if the file can't be used as a receipt. */
export function checkPoReceiptFile(file: File): void {
  if (file.size > PO_RECEIPT_MAX_BYTES) throw new Error("Receipts can be up to 10 MB.");
  if (!PO_RECEIPT_ACCEPT.split(",").includes(file.type)) throw new Error("Receipts must be a PDF, PNG, JPEG or WebP file.");
}

/** Uploads the file via our own server (same-origin); returns the staged key. */
export async function stagePoReceipt(poId: string, file: File): Promise<string> {
  checkPoReceiptFile(file);
  const res = await apiRequest(
    "PUT",
    `/api/purchase-orders/${poId}/receipt/file?fileName=${encodeURIComponent(file.name)}`,
    undefined,
    { "Content-Type": file.type },
    file,
  );
  const { storageKey } = await res.json();
  return storageKey;
}

/** Stages the file and attaches it as the PO-level receipt. */
export async function attachPoReceipt(poId: string, file: File): Promise<void> {
  const storageKey = await stagePoReceipt(poId, file);
  await apiRequest("POST", `/api/purchase-orders/${poId}/receipt`, { storageKey, fileName: file.name });
}
