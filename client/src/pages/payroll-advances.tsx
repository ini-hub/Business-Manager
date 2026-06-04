import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ChevronLeft, Plus, Banknote, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { DataTable } from "@/components/data-table";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/currency-utils";
import { useLocation } from "wouter";

export default function PayrollAdvancesPage() {
  const { currentStore } = useStore();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const currency = currentStore?.currency || "NGN";
  const fmt = (v: number) => formatCurrency(v, currency);

  const [showCreate, setShowCreate] = useState(false);
  const [staffId, setStaffId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState("");

  const { data: staffList = [] } = useQuery<any[]>({
    queryKey: ["/api/staff", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/staff?storeId=${currentStore?.id}`);
      return res.json();
    },
    enabled: !!currentStore?.id && currentStore?.id !== "all",
  });

  const { data: advances = [], refetch } = useQuery<any[]>({
    queryKey: ["/api/payroll/advances", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/payroll/advances?storeId=${currentStore?.id}`);
      return res.json();
    },
    enabled: !!currentStore?.id && currentStore?.id !== "all",
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/payroll/advances", {
        storeId: currentStore?.id, staffId, amount: parseFloat(amount), date, notes: notes || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      refetch();
      setShowCreate(false);
      setStaffId(""); setAmount(""); setDate(new Date().toISOString().split("T")[0]); setNotes("");
      toast({ title: "Salary advance recorded" });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/payroll/advances/${id}`),
    onSuccess: () => { refetch(); toast({ title: "Advance deleted" }); },
  });

  if (!currentStore) return <StoreRequiredAlert />;
  if (currentStore.id === "all") return (
    <div className="space-y-6">
      <PageHeader title="Salary Advances" description="Select a specific store to manage advances" />
    </div>
  );

  const totalPending = advances.filter((a: any) => !a.isRecovered).reduce((s: number, a: any) => s + Number(a.amount), 0);

  const columns = [
    {
      key: "staffName",
      header: "Staff",
      render: (a: any) => <span className="font-medium">{staffList.find(s => s.id === a.staffId)?.name || a.staffId}</span>,
    },
    {
      key: "amount",
      header: "Amount",
      render: (a: any) => <span className="font-mono font-semibold">{fmt(Number(a.amount))}</span>,
    },
    {
      key: "date",
      header: "Date",
      render: (a: any) => <span className="text-muted-foreground">{format(parseISO(a.date), "MMM d, yyyy")}</span>,
    },
    {
      key: "notes",
      header: "Notes",
      render: (a: any) => <span className="text-xs text-muted-foreground">{a.notes || "—"}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (a: any) => a.isRecovered
        ? <Badge variant="outline" className="text-emerald-700 bg-emerald-50 dark:bg-emerald-950 border-emerald-200 gap-1"><Check className="h-3 w-3" /> Recovered</Badge>
        : <Badge variant="outline" className="text-amber-700 bg-amber-50 dark:bg-amber-950 border-amber-200">Pending</Badge>,
    },
    {
      key: "actions",
      header: "",
      render: (a: any) => !a.isRecovered ? (
        <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive"
          onClick={() => deleteMutation.mutate(a.id)}>
          <Trash2 className="h-3 w-3" />
        </Button>
      ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Salary Advances"
        description={`Pending recoverable: ${fmt(totalPending)}`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setLocation("/payroll")}>
              <ChevronLeft className="mr-2 h-4 w-4" />
              Back to Payroll
            </Button>
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Record Advance
            </Button>
          </div>
        }
      />

      {totalPending > 0 && (
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/30">
          <CardContent className="flex items-center gap-3 py-4">
            <Banknote className="h-5 w-5 text-amber-600" />
            <div>
              <p className="font-semibold text-amber-800 dark:text-amber-300">{fmt(totalPending)} outstanding</p>
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {advances.filter((a: any) => !a.isRecovered).length} advance(s) not yet recovered. Add deductions to a payroll period to recover them.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">All Advances</CardTitle></CardHeader>
        <CardContent>
          <DataTable
            data={advances.map((a: any) => ({ ...a, staffName: staffList.find(s => s.id === a.staffId)?.name || a.staffId }))}
            columns={columns}
            searchable
            searchKeys={["staffName", "notes"]}
            searchPlaceholder="Search by staff or notes..."
            emptyMessage="No salary advances recorded."
          />
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Salary Advance</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Staff Member</Label>
              <Select value={staffId} onValueChange={setStaffId}>
                <SelectTrigger><SelectValue placeholder="Select staff…" /></SelectTrigger>
                <SelectContent>
                  {staffList.filter(s => !s.isArchived).map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Amount</Label>
                <Input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Reason or reference…" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button disabled={!staffId || !amount || createMutation.isPending} onClick={() => createMutation.mutate()}>
                Record Advance
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
