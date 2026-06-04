import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useStore } from "@/lib/store-context";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BookOpen,
  DollarSign,
  AlertTriangle,
  Calendar,
  CheckCircle,
  MoreVertical,
  Send,
  MessageSquare,
  History,
  TrendingDown,
  User,
  Plus,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { DataTable } from "@/components/data-table";
import { CustomerPresenter, EntityDisplay } from "@/components/oop-ui/EntityDisplayPresenter";


export default function CreditSalesPage() {
  const { currentStore } = useStore();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Modals & Dialog State
  const [selectedEntry, setSelectedEntry] = useState<any | null>(null);
  const [repaymentOpen, setRepaymentOpen] = useState(false);
  const [repaymentAmount, setRepaymentAmount] = useState("0");
  const [repaymentMethod, setRepaymentMethod] = useState("cash");
  const [repaymentNotes, setRepaymentNotes] = useState("");

  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderChannel, setReminderChannel] = useState<"whatsapp" | "sms">("whatsapp");
  const [previewMessage, setPreviewMessage] = useState("");

  const [writeOffOpen, setWriteOffOpen] = useState(false);
  const [writeOffReason, setWriteOffReason] = useState("");

  const [historyOpen, setHistoryOpen] = useState(false);

  // Queries
  const storeId = currentStore?.id;

  const { data: summary, isLoading: isSummaryLoading } = useQuery({
    queryKey: ["/api/credit/summary", storeId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/credit/summary?storeId=${storeId}`);
      return res.json();
    },
    enabled: !!storeId,
  });

  const { data: ledger = [], isLoading: isLedgerLoading, refetch: refetchLedger } = useQuery<any[]>({
    queryKey: ["/api/credit/ledger", storeId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/credit/ledger?storeId=${storeId}`);
      return res.json();
    },
    enabled: !!storeId,
  });

  const { data: repaymentsList = [], refetch: refetchRepayments } = useQuery({
    queryKey: ["/api/credit/entries", selectedEntry?.id, "repayments"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/credit/entries/${selectedEntry.id}/repayments`);
      return res.json();
    },
    enabled: !!selectedEntry?.id && historyOpen,
  });

  const { data: reminderLogs = [], refetch: refetchReminders } = useQuery({
    queryKey: ["/api/credit/entries", selectedEntry?.id, "reminders"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/credit/entries/${selectedEntry.id}/reminders`);
      return res.json();
    },
    enabled: !!selectedEntry?.id && historyOpen,
  });

  const columns = [
    {
      key: "customerName",
      header: "Customer",
      render: (entry: any) => {
        const presenter = new CustomerPresenter({
          name: entry.customer?.name,
          customerNumber: entry.customer?.customerNumber || entry.customerId || "—",
          mobileNumber: entry.customer?.phone || entry.customer?.mobileNumber,
        });
        return <EntityDisplay presenter={presenter} />;
      },
    },
    {
      key: "receiptNumber",
      header: "Receipt / Description",
      render: (entry: any) => (
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-primary">
            {entry.receiptNumber ? `#${entry.receiptNumber}` : "Standalone Entry"}
          </span>
          <span className="text-xs text-muted-foreground truncate max-w-[200px]" title={entry.description}>
            {entry.description || "N/A"}
          </span>
        </div>
      ),
    },
    {
      key: "amountOwed",
      header: "Total Owed",
      className: "text-right",
      render: (entry: any) => (
        <span className="font-medium text-sm">
          ₦{entry.amountOwed.toLocaleString()}
        </span>
      ),
    },
    {
      key: "totalRepayments",
      header: "Paid Back",
      className: "text-right",
      render: (entry: any) => (
        <span className="font-medium text-sm text-emerald-600">
          ₦{(entry.amountPaidUpfront + (entry.totalRepayments || 0)).toLocaleString()}
        </span>
      ),
    },
    {
      key: "outstandingBalance",
      header: "Outstanding",
      className: "text-right",
      render: (entry: any) => (
        <span className="font-bold text-sm text-amber-500">
          ₦{entry.outstandingBalance.toLocaleString()}
        </span>
      ),
    },
    {
      key: "dueDate",
      header: "Due Date",
      render: (entry: any) => (
        entry.dueDate ? (
          <div className="flex flex-col">
            <span>{new Date(entry.dueDate).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}</span>
            {entry.status === "overdue" && (
              <span className="text-[10px] text-rose-500 font-bold uppercase tracking-wider animate-pulse">Overdue</span>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">No due date</span>
        )
      ),
    },
    {
      key: "statusLabel",
      header: "Status",
      render: (entry: any) => getStatusBadge(entry.status),
    },
    {
      key: "actions",
      header: "",
      className: "w-[80px]",
      render: (entry: any) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {entry.outstandingBalance > 0 && (
              <>
                <DropdownMenuItem
                  onClick={() => {
                    setSelectedEntry(entry);
                    setRepaymentAmount("0");
                    setRepaymentOpen(true);
                  }}
                  className="text-emerald-500 font-medium"
                >
                  <DollarSign className="mr-2 h-4 w-4" />
                  Record Repayment
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setSelectedEntry(entry);
                    setPreviewMessage(generatePreview(entry, "whatsapp"));
                    setReminderOpen(true);
                  }}
                >
                  <Send className="mr-2 h-4 w-4" />
                  Send Reminder
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem
              onClick={() => {
                setSelectedEntry(entry);
                setHistoryOpen(true);
              }}
            >
              <History className="mr-2 h-4 w-4" />
              View History
            </DropdownMenuItem>
            
            {entry.outstandingBalance > 0 && user?.role === "owner" && (
              <>
                <Separator className="my-1" />
                <DropdownMenuItem
                  onClick={() => {
                    setSelectedEntry(entry);
                    setWriteOffOpen(true);
                  }}
                  className="text-rose-500"
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  Write Off (Bad Debt)
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const tableData = ledger.map((entry: any) => {
    const statusLabel = 
      entry.status === "owing" ? "Owing" :
      entry.status === "partial" ? "Partial" :
      entry.status === "overdue" ? "Overdue" :
      entry.status === "settled" ? "Settled" :
      entry.status === "written_off" ? "Written Off" :
      entry.status;

    return {
      ...entry,
      customerName: entry.customer?.name || "Unknown",
      customerMobile: entry.customer?.phone || entry.customer?.mobileNumber || "No phone number",
      statusLabel,
    };
  });

  const filterConfigs = [
    { key: "statusLabel", label: "Status", type: "select" as const },
  ];

  // Mutations
  const recordRepaymentMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/credit/entries/${selectedEntry.id}/repayments`, {
        amountReceived: parseFloat(repaymentAmount),
        paymentMethod: repaymentMethod,
        notes: repaymentNotes,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Repayment recorded successfully!" });
      setRepaymentOpen(false);
      setRepaymentAmount("0");
      setRepaymentNotes("");
      queryClient.invalidateQueries({ queryKey: ["/api/credit/summary", storeId] });
      queryClient.invalidateQueries({ queryKey: ["/api/credit/ledger", storeId] });
      refetchLedger();
    },
    onError: (err: any) => {
      toast({
        title: "Could not record repayment",
        description: err.message || "Please check your inputs and try again.",
        variant: "destructive",
      });
    },
  });

  const sendReminderMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/credit/entries/${selectedEntry.id}/reminders`, {
        channel: reminderChannel,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Overdue debt reminder sent successfully!" });
      setReminderOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/credit/summary", storeId] });
      queryClient.invalidateQueries({ queryKey: ["/api/credit/ledger", storeId] });
      refetchLedger();
    },
    onError: (err: any) => {
      toast({
        title: "Could not send reminder",
        description: err.message || "Please check customer mobile details.",
        variant: "destructive",
      });
    },
  });

  const writeOffMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/credit/entries/${selectedEntry.id}/write-off`, {
        reason: writeOffReason,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Debt successfully written off as operational bad debt expense." });
      setWriteOffOpen(false);
      setWriteOffReason("");
      queryClient.invalidateQueries({ queryKey: ["/api/credit/summary", storeId] });
      queryClient.invalidateQueries({ queryKey: ["/api/credit/ledger", storeId] });
      refetchLedger();
    },
    onError: (err: any) => {
      toast({
        title: "Authorization Failed",
        description: err.message || "Only business owners can write off bad debts.",
        variant: "destructive",
      });
    },
  });

  const generatePreview = (entry: any, channel: "whatsapp" | "sms") => {
    if (!entry) return "";
    const isOverdue = entry.status === "overdue" || (entry.dueDate && new Date(entry.dueDate) < new Date());
    const formattedAmt = entry.outstandingBalance.toLocaleString();
    const formattedDate = entry.dueDate ? new Date(entry.dueDate).toLocaleDateString("en-NG", { day: "numeric", month: "short" }) : "";
    const storeName = currentStore?.name || "Our Store";

    return `Hello ${entry.customer.name}! 👋\n\nThis na ${storeName}.\nYou get balance of ₦${formattedAmt} wey due on ${formattedDate}.\n\nIf you don pay already, abeg ignore this message.\nIf not, make you try settle before the date.\n\nThank you! 🙏`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "owing":
        return <Badge variant="outline" className="border-amber-500 text-amber-500 bg-amber-500/5">Owing</Badge>;
      case "partial":
        return <Badge variant="outline" className="border-blue-500 text-blue-500 bg-blue-500/5">Partial</Badge>;
      case "overdue":
        return <Badge variant="destructive" className="animate-pulse">Overdue</Badge>;
      case "settled":
        return <Badge variant="outline" className="border-emerald-500 text-emerald-500 bg-emerald-500/5">Settled</Badge>;
      case "written_off":
        return <Badge variant="outline" className="border-rose-500 text-rose-500 bg-rose-500/5">Written Off</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader title="Credit Sales" description="Manage credit sales and outstanding customer debt" />
        <Card className="glassmorphism p-6 flex flex-col items-center justify-center text-center">
          <BookOpen className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-medium">Select a Store</h3>
          <p className="text-sm text-muted-foreground mt-1">Please select a store from the sidebar header to access its Credit Sales ledger.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        title="Credit Sales Ledger"
        description="Digital ledger for tracking customer credits, partial repayments, and pidgin notifications"
      />

      {/* Summary Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="glass-card hover-elevate transition-all border-l-4 border-amber-500">
          <CardContent className="pt-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total Outstanding</p>
                <h3 className="text-2xl font-bold mt-2">
                  ₦{summary ? summary.totalOwed.toLocaleString() : "0"}
                </h3>
                <p className="text-[10px] text-muted-foreground mt-1 font-medium flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  {summary ? summary.totalOwedCount : 0} customers owing
                </p>
              </div>
              <div className="p-2.5 bg-amber-500/10 rounded-lg">
                <BookOpen className="h-5 w-5 text-amber-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card hover-elevate transition-all border-l-4 border-rose-500">
          <CardContent className="pt-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Overdue Balance</p>
                <h3 className="text-2xl font-bold mt-2 text-rose-500">
                  ₦{summary ? summary.totalOverdue.toLocaleString() : "0"}
                </h3>
                <p className="text-[10px] text-rose-500 mt-1 font-medium flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-rose-500 animate-ping" />
                  {summary ? summary.totalOverdueCount : 0} debts overdue
                </p>
              </div>
              <div className="p-2.5 bg-rose-500/10 rounded-lg">
                <AlertTriangle className="h-5 w-5 text-rose-500 animate-pulse" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card hover-elevate transition-all border-l-4 border-blue-500">
          <CardContent className="pt-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Due This Week</p>
                <h3 className="text-2xl font-bold mt-2">
                  ₦{summary ? summary.totalDueThisWeek.toLocaleString() : "0"}
                </h3>
                <p className="text-[10px] text-muted-foreground mt-1 font-medium flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-blue-500" />
                  {summary ? summary.totalDueThisWeekCount : 0} entries pending
                </p>
              </div>
              <div className="p-2.5 bg-blue-500/10 rounded-lg">
                <Calendar className="h-5 w-5 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card hover-elevate transition-all border-l-4 border-emerald-500">
          <CardContent className="pt-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Collected (Month)</p>
                <h3 className="text-2xl font-bold mt-2 text-emerald-500">
                  ₦{summary ? summary.totalCollectedThisMonth.toLocaleString() : "0"}
                </h3>
                <p className="text-[10px] text-emerald-500 mt-1 font-medium">
                  Reflects successful collections
                </p>
              </div>
              <div className="p-2.5 bg-emerald-500/10 rounded-lg">
                <TrendingDown className="h-5 w-5 text-emerald-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Ledger Table & Filters Card */}
      <Card className="border-border/50 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-base font-medium">Credit Sales Ledger</CardTitle>
          <Button variant="ghost" size="icon" onClick={() => refetchLedger()} title="Refresh list" className="h-8 w-8">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          <DataTable
            data={tableData}
            columns={columns}
            searchable
            searchPlaceholder="Search customer name, phone, receipt or description..."
            searchKeys={["customerName", "customerMobile", "receiptNumber", "description"]}
            isLoading={isLedgerLoading}
            emptyMessage="No credit records found."
            filterConfigs={filterConfigs}
          />
        </CardContent>
      </Card>


      {/* Record Repayment Dialog */}
      <Dialog open={repaymentOpen} onOpenChange={setRepaymentOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-emerald-500" />
              Record Customer Repayment
            </DialogTitle>
            <DialogDescription>
              Record a full or partial debt payment from {selectedEntry?.customer.name}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="p-3 bg-muted rounded-lg flex justify-between text-sm">
              <span className="text-muted-foreground">Outstanding Balance:</span>
              <span className="font-bold text-amber-500">₦{selectedEntry?.outstandingBalance.toLocaleString()}</span>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="repay-amount">Repayment Amount (₦)</Label>
              <Input
                id="repay-amount"
                type="number"
                placeholder="e.g. 5000"
                value={repaymentAmount === "0" ? "0" : repaymentAmount || ""}
                onChange={(e) => {
                  const val = e.target.value;
                  let cleanVal = val;
                  if (/^0\d+/.test(val)) cleanVal = val.replace(/^0+/, '');
                  setRepaymentAmount(cleanVal === "" ? "0" : cleanVal);
                }}
                className={
                  parseFloat(repaymentAmount) > (selectedEntry?.outstandingBalance || 0) || parseFloat(repaymentAmount) <= 0
                    ? "border-rose-500 focus-visible:ring-rose-500"
                    : ""
                }
              />
              {parseFloat(repaymentAmount) > (selectedEntry?.outstandingBalance || 0) && (
                <p className="text-xs text-rose-500 font-semibold mt-1 flex items-center gap-1 animate-pulse">
                  ⚠️ Amount exceeds outstanding balance of ₦{selectedEntry?.outstandingBalance.toLocaleString()}
                </p>
              )}
              {repaymentAmount && parseFloat(repaymentAmount) <= 0 && (
                <p className="text-xs text-rose-500 font-semibold mt-1 flex items-center gap-1">
                  ⚠️ Please enter a valid repayment amount greater than 0
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="repay-method">Payment Channel</Label>
              <Select value={repaymentMethod} onValueChange={setRepaymentMethod}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="transfer">Bank Transfer</SelectItem>
                  <SelectItem value="pos">POS Terminal</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="repay-notes">Repayment Notes (Optional)</Label>
              <Input
                id="repay-notes"
                placeholder="e.g. Paid cash at checkout counter"
                value={repaymentNotes}
                onChange={(e) => setRepaymentNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRepaymentOpen(false)}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={
                recordRepaymentMutation.isPending ||
                !repaymentAmount ||
                parseFloat(repaymentAmount) <= 0 ||
                parseFloat(repaymentAmount) > (selectedEntry?.outstandingBalance || 0)
              }
              onClick={() => recordRepaymentMutation.mutate()}
            >
              {recordRepaymentMutation.isPending ? "Recording..." : "Record Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Reminder Dialog */}
      <Dialog open={reminderOpen} onOpenChange={setReminderOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              Send Overdue Reminder
            </DialogTitle>
            <DialogDescription>
              Select delivery channel to send formatted reminder in customer's preferred language.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-3">
            <div className="space-y-1.5">
              <Label>Delivery Channel</Label>
              <Select
                value={reminderChannel}
                onValueChange={(val: any) => {
                  setReminderChannel(val);
                  setPreviewMessage(generatePreview(selectedEntry, val));
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="whatsapp">WhatsApp Message</SelectItem>
                  <SelectItem value="sms">Mobile SMS</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase">Message Preview</Label>
              <div className="p-3 bg-muted rounded-lg text-xs font-mono whitespace-pre-wrap leading-relaxed border border-border/80">
                {previewMessage}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setReminderOpen(false)}>Cancel</Button>
            <Button
              disabled={sendReminderMutation.isPending}
              onClick={() => sendReminderMutation.mutate()}
            >
              {sendReminderMutation.isPending ? "Sending..." : "Send Reminder"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Write Off Dialog */}
      <Dialog open={writeOffOpen} onOpenChange={setWriteOffOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-rose-500 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Authorize Debt Write-Off
            </DialogTitle>
            <DialogDescription>
              Write off {selectedEntry?.customer.name}'s balance of ₦{selectedEntry?.outstandingBalance.toLocaleString()} as unrecoverable operational bad debt expense.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-3">
            <div className="p-3 bg-rose-500/5 border border-rose-500/10 rounded-lg text-xs text-rose-500 leading-relaxed font-medium">
              ⚠️ WARNING: Writing off debt cancels the outstanding balance permanently. The balance will transfer to your Profit & Loss statement under Operational Expenses (Bad Debt). This action requires OWNER authentication.
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="writeoff-reason">Reason for Write-Off (Mandatory)</Label>
              <Select value={writeOffReason} onValueChange={setWriteOffReason}>
                <SelectTrigger id="writeoff-reason">
                  <SelectValue placeholder="Select a reason…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Bad Debt — Customer Uncontactable">Bad Debt — Customer Uncontactable</SelectItem>
                  <SelectItem value="Bad Debt — Customer Relocated / Moved Away">Bad Debt — Customer Relocated / Moved Away</SelectItem>
                  <SelectItem value="Bad Debt — Customer Deceased">Bad Debt — Customer Deceased</SelectItem>
                  <SelectItem value="Bad Debt — Business Closed">Bad Debt — Business Closed</SelectItem>
                  <SelectItem value="Dispute Settled — Balance Forgiven">Dispute Settled — Balance Forgiven</SelectItem>
                  <SelectItem value="Promotional Write-Off / Goodwill Gesture">Promotional Write-Off / Goodwill Gesture</SelectItem>
                  <SelectItem value="Internal Adjustment / Data Correction">Internal Adjustment / Data Correction</SelectItem>
                  <SelectItem value="Other — See Notes">Other — See Notes</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setWriteOffOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={writeOffMutation.isPending || !writeOffReason || !writeOffReason.trim()}
              onClick={() => writeOffMutation.mutate()}
            >
              {writeOffMutation.isPending ? "Authorizing..." : "Confirm Write-Off"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ledger History Dialog */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5 text-primary" />
              Credit Entry Log Timeline
            </DialogTitle>
            <DialogDescription>
              History of repayments and reminder logs for customer {selectedEntry?.customer.name}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4 max-h-[400px] overflow-y-auto pr-1">
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Repayments History</h4>
              {repaymentsList.length === 0 ? (
                <p className="text-xs text-muted-foreground italic bg-muted/40 p-2.5 rounded border border-dashed">No repayments recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {repaymentsList.map((rep: any) => (
                    <div key={rep.id} className="p-3 bg-background border rounded-lg flex justify-between items-center text-xs">
                      <div className="flex flex-col">
                        <span className="font-semibold text-emerald-500">+₦{rep.amountReceived.toLocaleString()} ({rep.paymentMethod})</span>
                        <span className="text-[10px] text-muted-foreground">Recorded by {rep.recordedBy}</span>
                      </div>
                      <span className="text-muted-foreground">
                        {new Date(rep.createdAt).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            <div className="space-y-3">
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Overdue Reminder Logs</h4>
              {reminderLogs.length === 0 ? (
                <p className="text-xs text-muted-foreground italic bg-muted/40 p-2.5 rounded border border-dashed">No reminders sent yet.</p>
              ) : (
                <div className="space-y-2">
                  {reminderLogs.map((log: any) => (
                    <div key={log.id} className="p-3 bg-background border rounded-lg flex justify-between items-start gap-3 text-xs">
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="font-semibold capitalize text-primary">{log.channel} Reminder ({log.type})</span>
                        <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2 italic" title={log.messageContent}>
                          "{log.messageContent}"
                        </p>
                      </div>
                      <div className="flex flex-col items-end shrink-0">
                        <Badge variant="outline" className="border-emerald-500 text-emerald-500 bg-emerald-500/5 mb-1 py-0 px-1 text-[9px] capitalize">{log.status}</Badge>
                        <span className="text-muted-foreground text-[10px]">
                          {new Date(log.createdAt).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" className="w-full" onClick={() => setHistoryOpen(false)}>Close Timeline</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
