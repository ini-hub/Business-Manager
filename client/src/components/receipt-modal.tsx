import { Printer, Download, MessageCircle, X, Loader2, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ReceiptView, useReceiptPayload } from "@/components/receipt-view";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { printWithFormat } from "@/lib/print-utils";

interface ReceiptModalProps {
  checkoutId: string | null | undefined;
  open: boolean;
  onClose: () => void;
}

export function ReceiptModal({ checkoutId, open, onClose }: ReceiptModalProps) {
  const { data: payload, isLoading, error } = useReceiptPayload(open ? checkoutId : null);

  const handlePrint = () => {
    printWithFormat("receipt-80mm");
  };

  const handleDownloadPDF = async () => {
    const printContent = document.getElementById("receipt-print-area");
    if (!printContent) return;
    try {
      const canvas = await html2canvas(printContent, { scale: 2, useCORS: true });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ unit: "mm", format: "a4" });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
      const receiptNum = payload?.checkout?.receiptNumber ?? "receipt";
      pdf.save(`${receiptNum}.pdf`);
    } catch (err) {
      console.error("PDF generation failed:", err);
    }
  };

  const handleWhatsApp = async () => {
    if (!payload) return;
    const receiptNum = payload.checkout?.receiptNumber ?? "N/A";
    // A receipt can span multiple checkout rows (one per line item) sharing the
    // same receiptNumber; payload.checkout is only the primary (oldest) row, so
    // its totalCharged is just that one item's charge. Sum across items to match
    // the "TOTAL CHARGED" shown on the printed receipt (see receipt-view.tsx).
    const total = payload.items?.length
      ? payload.items.reduce((sum, it) => sum + (it.checkout?.totalCharged ?? 0), 0)
      : payload.checkout?.totalCharged ?? 0;
    const currency = payload.store?.currency ?? "NGN";
    const itemName = payload.items?.map(it => it.inventory?.name).filter(Boolean).join(", ") || "Service";
    const businessName = payload.business?.name ?? "Business";

    const fmt = new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(total);
    const text =
      `*Receipt from ${businessName}*\n` +
      `Receipt #: ${receiptNum}\n` +
      `Item: ${itemName}\n` +
      `Total: ${fmt}\n\n` +
      `Thank you for your patronage!`;

    // Prefer sharing an actual PNG of the receipt via the native share sheet
    // (Android/iOS only — wa.me has no attachment param, so this is the only
    // way to get a real file into the chat instead of text-only). Desktop and
    // unsupported browsers fall through to the text-only wa.me link below.
    try {
      const printContent = document.getElementById("receipt-print-area");
      const canShareFiles = printContent && typeof navigator.share === "function" && typeof navigator.canShare === "function";
      if (canShareFiles) {
        const canvas = await html2canvas(printContent!, { scale: 2, useCORS: true });
        const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        if (blob) {
          const file = new File([blob], `${receiptNum}.png`, { type: "image/png" });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], text, title: `Receipt ${receiptNum}` });
            return;
          }
        }
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return; // user dismissed the share sheet
      console.error("Receipt image share failed, falling back to text link:", err);
    }

    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>Receipt</span>
            {payload?.checkout?.isVoided && (
              <span className="text-xs font-medium bg-red-100 text-red-700 px-2 py-0.5 rounded-full">VOIDED</span>
            )}
          </DialogTitle>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && !isLoading && (
          <div className="flex items-center gap-2 text-destructive py-8 justify-center">
            <AlertCircle className="h-5 w-5" />
            <span className="text-sm">Could not load receipt. Please try again.</span>
          </div>
        )}

        {payload && !isLoading && (
          <>
            {/* Action buttons */}
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={handlePrint} className="flex-1 gap-2">
                <Printer className="h-4 w-4" />
                Print
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownloadPDF} className="flex-1 gap-2">
                <Download className="h-4 w-4" />
                PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleWhatsApp}
                className="flex-1 gap-2 text-green-600 border-green-300 hover:bg-green-50"
              >
                <MessageCircle className="h-4 w-4" />
                WhatsApp
              </Button>
            </div>

            {/* Receipt — ReceiptView renders id="receipt-print-area", which @media print targets */}
            <ReceiptView payload={payload} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
