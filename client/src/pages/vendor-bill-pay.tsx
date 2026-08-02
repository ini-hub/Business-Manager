import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { apiRequest } from "@/lib/queryClient";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { formatCurrency as fmt } from "@/lib/currency-utils";
import { useReturnTo } from "@/lib/return-to";

export default function VendorBillPayPage() {
  const { billId } = useParams<{ billId: string }>();
  const [, setLocation] = useLocation();
  const { backHref } = useReturnTo("/vendors");
  const { toast } = useToast();
  const { currentStore } = useStore();
  const queryClient = useQueryClient();

  const [payAmount, setPayAmount] = useState("");

  const { data: bill } = useQuery<any>({
    queryKey: ["/api/vendors/bills", billId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/vendors/bills/${billId}`);
      return res.json();
    },
    enabled: !!billId,
  });

  const currency = currentStore?.currency || "NGN";
  const outstanding = bill ? Number(bill.amount) - Number(bill.amountPaid ?? 0) : 0;

  const payMutation = useMutation({
    mutationFn: async () => {
      if (!payAmount || Number(payAmount) <= 0) throw new Error("Valid payment amount is required.");
      const res = await apiRequest("PATCH", `/api/vendors/bills/${billId}`, {
        amountPaid: Number(bill?.amountPaid ?? 0) + Number(payAmount),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as any).error || "Failed to record payment");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendors/bills", currentStore?.id] });
      toast({ title: "Payment recorded" });
      setLocation(backHref);
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!currentStore) return <StoreRequiredAlert />;

  return (
    <div className="space-y-6 max-w-md mx-auto">
      <PageHeader
        title="Record Payment"
        description={bill ? `Outstanding balance: ${fmt(outstanding, currency)}` : "Record a payment against this bill."}
        actions={
          <Button variant="outline" onClick={() => setLocation(backHref)}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back to Vendors
          </Button>
        }
      />
      <Card>
        <CardContent className="pt-6 space-y-4">
          {bill && (
            <div className="rounded-lg bg-muted/20 border p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Bill</span>
                <span className="font-mono font-medium">{fmt(Number(bill.amount), currency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Already Paid</span>
                <span className="font-mono">{fmt(Number(bill.amountPaid ?? 0), currency)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Outstanding</span>
                <span className="font-mono text-destructive">{fmt(outstanding, currency)}</span>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="pay-amount">
              Amount Paid <span className="text-destructive">*</span>
            </Label>
            <Input
              id="pay-amount"
              type="number"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              className="font-mono"
              autoFocus
            />
          </div>

          <Separator />
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={() => setLocation(backHref)}>
              Cancel
            </Button>
            <Button
              onClick={() => payMutation.mutate()}
              disabled={payMutation.isPending || !payAmount || Number(payAmount) <= 0}
            >
              {payMutation.isPending ? "Saving…" : "Confirm Payment"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
