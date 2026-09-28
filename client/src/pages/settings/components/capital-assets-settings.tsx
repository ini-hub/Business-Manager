import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Wallet, Landmark, HandCoins, Plus, Trash2, Loader2 } from "lucide-react";
import { useStore } from "@/lib/store-context";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type CapitalContribution = { id: string; type: "capital_injection" | "withdrawal"; amount: number; description: string | null; date: string };
type Asset = { id: string; name: string; category: "cash" | "fixed" | "other"; value: number; acquiredDate: string | null };
type Liability = { id: string; name: string; category: "loan" | "payable" | "other"; amount: number; dueDate: string | null };

function useFormattedCurrency() {
  const { currentStore } = useStore();
  const currency = currentStore?.currency || "NGN";
  return (n: number) => new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(n || 0);
}

/**
 * Capital contributions/withdrawals, manually tracked assets & liabilities -
 * the inputs behind the Balance Sheet report (client/src/pages/balance-sheet.tsx).
 * Also reachable from onboarding's Capital step; this is where it's edited
 * afterwards or filled in if skipped there.
 */
export function CapitalAssetsSettings() {
  const { currentStore } = useStore();
  const { toast } = useToast();
  const storeId = currentStore?.id;
  const formatCurrency = useFormattedCurrency();

  const { data: contributions = [] } = useQuery<CapitalContribution[]>({
    queryKey: ["/api/accounting/capital", storeId],
    queryFn: async () => (await fetch(`/api/accounting/capital?storeId=${storeId}`)).json(),
    enabled: !!storeId,
  });
  const { data: assets = [] } = useQuery<Asset[]>({
    queryKey: ["/api/accounting/assets", storeId],
    queryFn: async () => (await fetch(`/api/accounting/assets?storeId=${storeId}`)).json(),
    enabled: !!storeId,
  });
  const { data: liabilities = [] } = useQuery<Liability[]>({
    queryKey: ["/api/accounting/liabilities", storeId],
    queryFn: async () => (await fetch(`/api/accounting/liabilities?storeId=${storeId}`)).json(),
    enabled: !!storeId,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/accounting/capital", storeId] });
    queryClient.invalidateQueries({ queryKey: ["/api/accounting/assets", storeId] });
    queryClient.invalidateQueries({ queryKey: ["/api/accounting/liabilities", storeId] });
    queryClient.invalidateQueries({ queryKey: ["/api/accounting/balance-sheet"] });
  };

  // ── Capital dialog ────────────────────────────────────────────────────────
  const [capitalOpen, setCapitalOpen] = useState(false);
  const [capitalType, setCapitalType] = useState<"capital_injection" | "withdrawal">("capital_injection");
  const [capitalAmount, setCapitalAmount] = useState("");
  const [capitalDescription, setCapitalDescription] = useState("");

  const addCapital = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/accounting/capital", {
        storeId,
        type: capitalType,
        amount: Number(capitalAmount),
        description: capitalDescription || undefined,
        date: new Date().toISOString().slice(0, 10),
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: capitalType === "capital_injection" ? "Capital recorded" : "Withdrawal recorded" });
      setCapitalOpen(false);
      setCapitalAmount("");
      setCapitalDescription("");
      invalidateAll();
    },
    onError: (error: Error) => toast({ title: "Failed to save", description: getUserFriendlyError(error), variant: "destructive" }),
  });

  // ── Asset dialog ──────────────────────────────────────────────────────────
  const [assetOpen, setAssetOpen] = useState(false);
  const [assetName, setAssetName] = useState("");
  const [assetCategory, setAssetCategory] = useState<"cash" | "fixed" | "other">("fixed");
  const [assetValue, setAssetValue] = useState("");

  const addAsset = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/accounting/assets", {
        storeId,
        name: assetName,
        category: assetCategory,
        value: Number(assetValue),
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Asset added" });
      setAssetOpen(false);
      setAssetName("");
      setAssetValue("");
      invalidateAll();
    },
    onError: (error: Error) => toast({ title: "Failed to add asset", description: getUserFriendlyError(error), variant: "destructive" }),
  });

  const deleteAsset = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/accounting/assets/${id}`, {}),
    onSuccess: invalidateAll,
    onError: (error: Error) => toast({ title: "Failed to remove asset", description: getUserFriendlyError(error), variant: "destructive" }),
  });

  // ── Liability dialog ──────────────────────────────────────────────────────
  const [liabilityOpen, setLiabilityOpen] = useState(false);
  const [liabilityName, setLiabilityName] = useState("");
  const [liabilityCategory, setLiabilityCategory] = useState<"loan" | "payable" | "other">("loan");
  const [liabilityAmount, setLiabilityAmount] = useState("");

  const addLiability = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/accounting/liabilities", {
        storeId,
        name: liabilityName,
        category: liabilityCategory,
        amount: Number(liabilityAmount),
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Liability added" });
      setLiabilityOpen(false);
      setLiabilityName("");
      setLiabilityAmount("");
      invalidateAll();
    },
    onError: (error: Error) => toast({ title: "Failed to add liability", description: getUserFriendlyError(error), variant: "destructive" }),
  });

  const deleteLiability = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/accounting/liabilities/${id}`, {}),
    onSuccess: invalidateAll,
    onError: (error: Error) => toast({ title: "Failed to remove liability", description: getUserFriendlyError(error), variant: "destructive" }),
  });

  if (!currentStore) return null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base"><Wallet className="h-4 w-4" /> Capital Contributions</CardTitle>
              <CardDescription>Money the owner has put into, or taken out of, the business. Drives Retained Earnings and ROI on the Balance Sheet report.</CardDescription>
            </div>
            <Dialog open={capitalOpen} onOpenChange={setCapitalOpen}>
              <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" /> Record</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Record Capital Movement</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select value={capitalType} onValueChange={(v) => setCapitalType(v as typeof capitalType)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="capital_injection">Capital Injection (invested)</SelectItem>
                        <SelectItem value="withdrawal">Withdrawal (taken out)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Amount</Label>
                    <Input type="number" min="0" value={capitalAmount} onChange={(e) => setCapitalAmount(e.target.value)} placeholder="0" />
                  </div>
                  <div className="space-y-2">
                    <Label>Description (optional)</Label>
                    <Input value={capitalDescription} onChange={(e) => setCapitalDescription(e.target.value)} placeholder="e.g. Additional cash injection" />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={() => addCapital.mutate()} disabled={!capitalAmount || addCapital.isPending}>
                    {addCapital.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {contributions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No capital movements recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {contributions.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{c.date}</TableCell>
                    <TableCell className="capitalize">{c.type.replace("_", " ")}</TableCell>
                    <TableCell className="text-muted-foreground">{c.description || "—"}</TableCell>
                    <TableCell className="text-right">{c.type === "withdrawal" ? "-" : ""}{formatCurrency(c.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base"><Landmark className="h-4 w-4" /> Assets</CardTitle>
              <CardDescription>Cash on hand, equipment, and other things the business owns. Manually tracked — not auto-updated by sales.</CardDescription>
            </div>
            <Dialog open={assetOpen} onOpenChange={setAssetOpen}>
              <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add Asset</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add Asset</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input value={assetName} onChange={(e) => setAssetName(e.target.value)} placeholder="e.g. Delivery van" />
                  </div>
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select value={assetCategory} onValueChange={(v) => setAssetCategory(v as typeof assetCategory)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="fixed">Fixed Asset (equipment, property)</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Value</Label>
                    <Input type="number" min="0" value={assetValue} onChange={(e) => setAssetValue(e.target.value)} placeholder="0" />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={() => addAsset.mutate()} disabled={!assetName || !assetValue || addAsset.isPending}>
                    {addAsset.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {assets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No assets recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Name</TableHead><TableHead>Category</TableHead><TableHead className="text-right">Value</TableHead><TableHead /></TableRow>
              </TableHeader>
              <TableBody>
                {assets.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{a.name}</TableCell>
                    <TableCell className="capitalize">{a.category}</TableCell>
                    <TableCell className="text-right">{formatCurrency(a.value)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => deleteAsset.mutate(a.id)} disabled={deleteAsset.isPending}>
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base"><HandCoins className="h-4 w-4" /> Liabilities</CardTitle>
              <CardDescription>Loans, payables, and other amounts the business owes.</CardDescription>
            </div>
            <Dialog open={liabilityOpen} onOpenChange={setLiabilityOpen}>
              <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add Liability</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add Liability</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input value={liabilityName} onChange={(e) => setLiabilityName(e.target.value)} placeholder="e.g. Bank loan" />
                  </div>
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select value={liabilityCategory} onValueChange={(v) => setLiabilityCategory(v as typeof liabilityCategory)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="loan">Loan</SelectItem>
                        <SelectItem value="payable">Payable</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Amount</Label>
                    <Input type="number" min="0" value={liabilityAmount} onChange={(e) => setLiabilityAmount(e.target.value)} placeholder="0" />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={() => addLiability.mutate()} disabled={!liabilityName || !liabilityAmount || addLiability.isPending}>
                    {addLiability.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {liabilities.length === 0 ? (
            <p className="text-sm text-muted-foreground">No liabilities recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Name</TableHead><TableHead>Category</TableHead><TableHead className="text-right">Amount</TableHead><TableHead /></TableRow>
              </TableHeader>
              <TableBody>
                {liabilities.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{l.name}</TableCell>
                    <TableCell className="capitalize">{l.category}</TableCell>
                    <TableCell className="text-right">{formatCurrency(l.amount)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => deleteLiability.mutate(l.id)} disabled={deleteLiability.isPending}>
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
