import { useRef, useState } from "react";
import { Receipt, Upload, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { queryClient } from "@/lib/queryClient";
import { attachPoReceipt, PO_RECEIPT_ACCEPT } from "@/lib/poReceiptUpload";
import { useToast } from "@/hooks/use-toast";


interface Props {
  poId: string;
  receiptName?: string | null;
  hasReceipt: boolean;
  canEdit: boolean;
  deliveryReceipts?: { id: string; receiptName: string; createdAt: string }[];
}

// Supplier invoice / delivery note for a PO. The file goes through our server,
// which verifies and attaches it.
export function PoReceipt({ poId, receiptName, hasReceipt, canEdit, deliveryReceipts = [] }: Props) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      await attachPoReceipt(poId, file);
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders", poId] });
      toast({ title: "Receipt attached" });
    } catch (e) {
      toast({ title: "Couldn't attach receipt", description: (e as Error).message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 shrink-0 rounded-lg bg-muted flex items-center justify-center">
            <Receipt className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm">Supplier receipt</p>
            {hasReceipt ? (
              <a
                href={`/api/purchase-orders/${poId}/receipt`}
                target="_blank"
                rel="noreferrer"
                className="text-xs underline truncate inline-flex items-center gap-1 max-w-full"
              >
                <span className="truncate">{receiptName || "View receipt"}</span> <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            ) : (
              <p className="text-xs text-muted-foreground">
                None attached.<span className="hidden sm:inline"> Add the vendor's invoice or delivery note when goods arrive.</span>
              </p>
            )}
          </div>
        </div>
        {canEdit && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept={PO_RECEIPT_ACCEPT}
              className="hidden"
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            />
            <Button variant="outline" size="sm" className="gap-1 shrink-0" disabled={uploading} onClick={() => inputRef.current?.click()}>
              <Upload className="h-4 w-4" /> {uploading ? "Uploading…" : hasReceipt ? "Replace" : "Upload"}
              <span className="hidden sm:inline">{hasReceipt ? "" : " receipt"}</span>
            </Button>
          </>
        )}
      </div>

      {deliveryReceipts.length > 0 && (
        <div className="border-t pt-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Delivery receipts</p>
          {deliveryReceipts.map((r) => (
            <a
              key={r.id}
              href={`/api/purchase-orders/${poId}/receipts/${r.id}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-3 text-sm hover:underline"
            >
              <span className="truncate">{r.receiptName}</span>
              <span className="text-xs text-muted-foreground shrink-0">{new Date(r.createdAt).toLocaleDateString()}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
