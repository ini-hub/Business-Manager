import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { apiRequest } from "@/lib/queryClient";
import { StoreRequiredAlert } from "@/components/store-required-alert";

export default function VendorBillNewPage() {
  const { vendorId } = useParams<{ vendorId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { currentStore } = useStore();
  const queryClient = useQueryClient();

  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");

  const { data: vendor } = useQuery<any>({
    queryKey: ["/api/vendors", vendorId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/vendors/${vendorId}`);
      return res.json();
    },
    enabled: !!vendorId,
  });

  const addBillMutation = useMutation({
    mutationFn: async () => {
      if (!amount || Number(amount) <= 0) throw new Error("Valid amount is required.");
      const res = await apiRequest("POST", "/api/vendors/bills", {
        storeId: currentStore!.id,
        vendorId,
        amount: Number(amount),
        dueDate: dueDate || undefined,
        notes: notes || undefined,
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as any).error || "Failed to record bill");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendors/bills", currentStore?.id] });
      toast({ title: "Bill recorded" });
      setLocation("/vendors");
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!currentStore) return <StoreRequiredAlert />;

  return (
    <div className="space-y-6 max-w-md mx-auto">
      <PageHeader
        title="Record Bill"
        description={vendor ? `Log an outstanding bill for ${vendor.name}.` : "Log an outstanding bill."}
        actions={
          <Button variant="outline" onClick={() => setLocation("/vendors")}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back to Vendors
          </Button>
        }
      />
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bill-amount">
              Amount <span className="text-destructive">*</span>
            </Label>
            <Input
              id="bill-amount"
              type="number"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="font-mono"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bill-due">Due Date</Label>
            <Input
              id="bill-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bill-notes">Notes</Label>
            <Textarea
              id="bill-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="h-20 resize-none"
            />
          </div>

          <Separator />
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={() => setLocation("/vendors")}>
              Cancel
            </Button>
            <Button
              onClick={() => addBillMutation.mutate()}
              disabled={addBillMutation.isPending || !amount || Number(amount) <= 0}
            >
              {addBillMutation.isPending ? "Recording…" : "Record Bill"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
