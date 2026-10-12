import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { apiRequest } from "@/lib/queryClient";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { fetchAllStaff } from "@/lib/staff-api";

export default function PayrollAdvanceNewPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { currentStore } = useStore();
  const queryClient = useQueryClient();

  const [staffId, setStaffId] = useState(() => new URLSearchParams(window.location.search).get("staffId") ?? "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState("");

  const storeReady = !!currentStore?.id && currentStore.id !== "all";
  const { data: staffList = [] } = useQuery<any[]>({
    queryKey: ["/api/staff", currentStore?.id],
    queryFn: () => fetchAllStaff(currentStore!.id),
    enabled: storeReady,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/payroll/advances", {
        storeId: currentStore?.id, staffId, amount: parseFloat(amount), date, notes: notes || undefined,
      });
      return res.json();
    },
    onSuccess: (advance: { id: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/advances"] });
      toast({ title: "Salary advance recorded" });
      setLocation(`/payroll/advances/${advance.id}`);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  if (!currentStore || currentStore.id === "all") return <StoreRequiredAlert />;

  const canSave = !!staffId && parseFloat(amount) > 0 && !createMutation.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Record Salary Advance"
        description="Once approved, the advance is deducted automatically from the staff member's next payroll."
        compact
        actions={
          <Button variant="outline" onClick={() => setLocation("/payroll/advances")}>
            <ChevronLeft className="h-4 w-4 lg:mr-2" />
            <span className="hidden lg:inline">Back to Advances</span>
          </Button>
        }
      />
      <Card className="max-w-xl">
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-2">
            <Label>Staff Member</Label>
            <Select value={staffId} onValueChange={setStaffId}>
              <SelectTrigger data-testid="select-advance-staff"><SelectValue placeholder="Select staff…" /></SelectTrigger>
              <SelectContent>
                {staffList.filter((s) => !s.isArchived).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}{[s.staffNumber, s.mobileNumber].filter(Boolean).length ? ` (${[s.staffNumber, s.mobileNumber].filter(Boolean).join(" · ")})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" data-testid="input-advance-amount" />
            </div>
            <div className="space-y-2">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reason or reference…" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setLocation("/payroll/advances")}>Cancel</Button>
            <Button disabled={!canSave} onClick={() => createMutation.mutate()} data-testid="button-save-advance">
              Record Advance
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
