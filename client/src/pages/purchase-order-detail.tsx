import { useState } from "react";
import { useLocation, useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, Check, MoreHorizontal, Plus, Inbox, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PoReceipt } from "@/components/purchase-orders/PoReceipt";
import { SupplierRefEditor } from "@/components/purchase-orders/SupplierRefEditor";
import { ReceiveStockDialog } from "@/components/purchase-orders/ReceiveStockDialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useStore } from "@/lib/store-context";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/currency-utils";
import { placedOrderMessage, type SupplierEmailOutcome } from "@/lib/poSupplierEmail";
import { PO_STATUS_LABEL, type FullPO } from "@/lib/purchase-order-types";

const fmtDate = (d?: string | Date | null) =>
  d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null;

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  ordered: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  partially_received: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  received: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 text-sm border-b last:border-b-0">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right min-w-0">{children}</span>
    </div>
  );
}

function Card({ title, action, children }: { title?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4 sm:p-5">
      {(title || action) && (
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

type Step = { key: string; title: string; sub: string; state: "done" | "current" | "todo" };

function buildSteps(po: FullPO): Step[] {
  const received = po.status === "received";
  const partial = po.status === "partially_received";
  const placed = po.status !== "draft";
  return [
    { key: "draft", title: "Draft", sub: `Created ${fmtDate(po.createdAt)}`, state: placed ? "done" : "current" },
    {
      key: "placed",
      title: "Placed",
      sub: placed ? (fmtDate(po.placedAt) ? `Sent ${fmtDate(po.placedAt)}` : "Sent to vendor") : "Send to vendor",
      state: received || partial ? "done" : placed ? "current" : "todo",
    },
    {
      key: "received",
      title: "Received",
      sub: received ? `Completed ${fmtDate(po.updatedAt)}` : partial ? "Partly counted in" : "Count items in",
      state: received ? "done" : partial ? "current" : "todo",
    },
  ];
}

function Stepper({ steps }: { steps: Step[] }) {
  return (
    <>
      {/* Phone: slim progress bars */}
      <div className="grid grid-cols-3 gap-2 sm:hidden" role="list">
        {steps.map((s) => (
          <div key={s.key} role="listitem" aria-current={s.state === "current" ? "step" : undefined}>
            <div className={`h-1 rounded-full ${s.state === "todo" ? "bg-muted" : "bg-primary"}`} />
            <p className={`mt-1.5 text-xs ${s.state === "current" ? "font-semibold" : "text-muted-foreground"}`}>{s.title}</p>
          </div>
        ))}
      </div>
      {/* Larger screens: step cards */}
      <ol className="hidden sm:grid grid-cols-3 gap-3">
        {steps.map((s, i) => (
          <li
            key={s.key}
            aria-current={s.state === "current" ? "step" : undefined}
            className={`flex items-center gap-3 rounded-xl border p-4 bg-card ${s.state === "current" ? "border-primary ring-1 ring-primary" : ""}`}
          >
            <span
              className={`h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold ${
                s.state === "done" ? "bg-emerald-600 text-white" : s.state === "current" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {s.state === "done" ? <Check className="h-4 w-4" /> : i + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{s.title}</span>
              <span className="block text-xs text-muted-foreground truncate">{s.sub}</span>
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

type Activity = { at: Date; text: string };

function buildActivity(po: FullPO): Activity[] {
  const list: Activity[] = [{ at: new Date(po.createdAt), text: "Created as draft" }];
  if (po.placedAt) list.push({ at: new Date(po.placedAt), text: `Placed with ${po.vendor.name}` });
  for (const r of po.deliveryReceipts ?? []) list.push({ at: new Date(r.createdAt), text: `Delivery receipt added: ${r.receiptName}` });
  if (po.status === "partially_received") list.push({ at: new Date(po.updatedAt), text: "Partly received" });
  if (po.status === "received") list.push({ at: new Date(po.updatedAt), text: "Fully received" });
  if (po.status === "cancelled") list.push({ at: new Date(po.updatedAt), text: "Cancelled" });
  return list.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export default function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { stores, currentStore } = useStore();
  const { user } = useAuth();
  const { toast } = useToast();
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | "place" | "cancel" | "delete">(null);

  const canManage = user?.role === "owner" || user?.role === "manager";

  const { data: po, isLoading, isError } = useQuery<FullPO>({
    queryKey: ["/api/purchase-orders", id],
    queryFn: async () => (await apiRequest("GET", `/api/purchase-orders/${id}`)).json(),
  });

  const status = useMutation({
    mutationFn: async (next: "ordered" | "cancelled") => {
      const res = await apiRequest("PATCH", `/api/purchase-orders/${id}/status`, { status: next });
      return { next, ...((await res.json()) as { supplierEmail?: SupplierEmailOutcome }) };
    },
    onSuccess: ({ next, supplierEmail }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      toast({
        title: next === "ordered" ? "Order placed" : "Order cancelled",
        description: next === "ordered" ? placedOrderMessage(supplierEmail, po?.vendor.name) : undefined,
      });
    },
    onError: (e: Error) => toast({ title: "Couldn't update the order", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", `/api/purchase-orders/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      toast({ title: "Draft deleted" });
      setLocation("/purchase-orders");
    },
    onError: (e: Error) => toast({ title: "Couldn't delete", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-6xl mx-auto">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (isError || !po) {
    return (
      <div className="max-w-6xl mx-auto space-y-4">
        <Button variant="ghost" size="sm" className="gap-1" onClick={() => setLocation("/purchase-orders")}>
          <ArrowLeft className="h-4 w-4" /> Purchase orders
        </Button>
        <p className="text-muted-foreground">This purchase order couldn't be found.</p>
      </div>
    );
  }

  const currency = stores.find((s) => s.id === po.storeId)?.currency || currentStore?.currency || "NGN";
  const money = (n: number) => formatCurrency(n, currency);
  const isDraft = po.status === "draft";
  const canReceive = po.status === "ordered" || po.status === "partially_received";
  const canCancel = isDraft || po.status === "ordered";
  const total = po.items.reduce((sum, i) => sum + i.quantity * i.unitCost, 0);
  const itemCount = po.items.length;
  const activity = buildActivity(po);

  const primary = canManage
    ? isDraft
      ? { label: "Place order", onClick: () => setConfirm("place") }
      : canReceive
        ? { label: "Receive stock", onClick: () => setReceiveOpen(true) }
        : null
    : null;

  const actionsMenu = canManage && (canCancel || isDraft) && (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="More actions"><MoreHorizontal className="h-4 w-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canCancel && <DropdownMenuItem onClick={() => setConfirm("cancel")}>Cancel order</DropdownMenuItem>}
        {isDraft && canCancel && <DropdownMenuSeparator />}
        {isDraft && (
          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setConfirm("delete")}>
            Delete draft
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-5 pb-24 sm:pb-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="space-y-3">
        <Link href="/purchase-orders" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> Purchase orders
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-[26px] sm:text-[26px] font-bold font-mono tracking-tight">{po.poNumber}</h1>
              <Badge variant="secondary" className={STATUS_STYLE[po.status] ?? ""}>{PO_STATUS_LABEL[po.status] ?? po.status}</Badge>
            </div>
            <p className="hidden sm:block text-sm text-muted-foreground mt-1">
              {po.vendor.name} · {itemCount} item{itemCount === 1 ? "" : "s"} · {money(total)}
              {po.expectedDelivery ? ` · expected ${fmtDate(po.expectedDelivery)}` : ""}
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-2 shrink-0">
            {actionsMenu}
            {canManage && isDraft && (
              <Button variant="outline" className="gap-1" onClick={() => setLocation(`/purchase-orders/${po.id}/edit`)}>
                <Pencil className="h-4 w-4" /> Edit order
              </Button>
            )}
            {primary && (
              <Button className="gap-1" onClick={primary.onClick} disabled={status.isPending}>
                {canReceive && <Inbox className="h-4 w-4" />}{primary.label}
              </Button>
            )}
          </div>
        </div>
      </div>

      {po.status === "cancelled" ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          This order was cancelled on {fmtDate(po.updatedAt)}. It can't be placed or received.
        </div>
      ) : (
        <Stepper steps={buildSteps(po)} />
      )}

      {/* Phone: total card */}
      <div className="sm:hidden rounded-2xl bg-slate-900 text-white p-5 space-y-4">
        <div className="flex justify-between text-sm text-slate-300">
          <span>Order total</span>
          <span>{itemCount} item{itemCount === 1 ? "" : "s"}</span>
        </div>
        <p className="text-4xl font-bold tracking-tight">{money(total)}</p>
        <div className="border-t border-slate-700 pt-3 grid grid-cols-2 gap-4 text-sm">
          <div><p className="text-slate-400">Created</p><p className="font-semibold">{fmtDate(po.createdAt)}</p></div>
          <div><p className="text-slate-400">Expected arrival</p><p className="font-semibold">{fmtDate(po.expectedDelivery) ?? "Not set"}</p></div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_340px] gap-5 items-start">
        {/* Main column */}
        <div className="space-y-5 order-2 lg:order-1">
          <Card
            title={`Items${itemCount ? ` (${itemCount})` : ""}`}
            action={
              canManage && isDraft && (
                <Button variant="outline" size="sm" className="gap-1" onClick={() => setLocation(`/purchase-orders/${po.id}/edit`)}>
                  <Plus className="h-4 w-4" /> Add item
                </Button>
              )
            }
          >
            <div className="-mx-4 sm:-mx-5">
              <div className="hidden sm:grid grid-cols-[1fr_80px_80px_110px_110px] gap-3 px-5 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
                <span>Item</span><span className="text-right">Ordered</span><span className="text-right">Received</span>
                <span className="text-right">Unit cost</span><span className="text-right">Line total</span>
              </div>
              {po.items.map((i) => (
                <div key={i.id} className="px-4 sm:px-5 py-3 border-b last:border-b-0 sm:grid sm:grid-cols-[1fr_80px_80px_110px_110px] sm:gap-3 sm:items-center">
                  <div className="flex justify-between gap-3 sm:block min-w-0">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{i.inventory.name}</p>
                      <p className="text-xs text-muted-foreground">SKU {i.inventory.id.substring(0, 8).toUpperCase()}</p>
                    </div>
                    <div className="text-right sm:hidden shrink-0">
                      <p className="font-semibold">{money(i.quantity * i.unitCost)}</p>
                      <p className="text-xs text-muted-foreground">
                        {i.quantity} × {money(i.unitCost)}
                        {!isDraft && ` · ${i.receivedQuantity || 0} received`}
                      </p>
                    </div>
                  </div>
                  <span className="hidden sm:block text-right text-sm">{i.quantity}{i.inventory.unit ? ` ${i.inventory.unit}` : ""}</span>
                  <span className="hidden sm:block text-right text-sm">{i.receivedQuantity || 0}</span>
                  <span className="hidden sm:block text-right text-sm">{money(i.unitCost)}</span>
                  <span className="hidden sm:block text-right text-sm font-medium">{money(i.quantity * i.unitCost)}</span>
                </div>
              ))}
              <div className="px-4 sm:px-5 pt-3 space-y-1 text-sm">
                <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>{money(total)}</span></div>
                <div className="flex justify-between text-base font-bold"><span>Total</span><span>{money(total)}</span></div>
              </div>
            </div>
          </Card>

          <PoReceipt
            poId={po.id}
            receiptName={po.receiptName}
            hasReceipt={!!po.receiptKey}
            canEdit={canManage}
            deliveryReceipts={po.deliveryReceipts}
          />
        </div>

        {/* Side column */}
        <div className="space-y-5 order-1 lg:order-2">
          <Card title="Vendor" action={canManage && <Link href={`/vendors/${po.vendorId}/edit`} className="text-sm text-primary hover:underline">View vendor</Link>}>
            <Row label="Name"><span className="font-semibold">{po.vendor.name}</span></Row>
            {po.vendor.companyName && <Row label="Company">{po.vendor.companyName}</Row>}
            <Row label="Corporate ID"><span className="font-mono font-semibold">{po.vendorId.substring(0, 8).toUpperCase()}</span></Row>
            <Row label="Phone">{po.vendor.phone ? po.vendor.phone : <span className="text-muted-foreground">Not added</span>}</Row>
            <Row label="Email">{po.vendor.email ? <span className="break-all">{po.vendor.email}</span> : <span className="text-muted-foreground">Not added</span>}</Row>
            <div className="sm:hidden">
              <Row label="Supplier reference"><SupplierRefEditor poId={po.id} value={po.supplierRef} canEdit={canManage} /></Row>
            </div>
          </Card>

          <div className="hidden sm:block">
            <Card title="Order details">
              <Row label="Created">{fmtDate(po.createdAt)}</Row>
              <Row label="Placed">{fmtDate(po.placedAt) ?? <span className="text-muted-foreground">Not yet</span>}</Row>
              <Row label="Expected arrival">{fmtDate(po.expectedDelivery) ?? <span className="text-muted-foreground">Not set</span>}</Row>
              <Row label="Supplier reference"><SupplierRefEditor poId={po.id} value={po.supplierRef} canEdit={canManage} /></Row>
            </Card>
          </div>

          {po.notes && (
            <Card title="Note to vendor">
              <p className="text-sm whitespace-pre-wrap break-words">{po.notes}</p>
            </Card>
          )}

          <Card title="Activity">
            <ol className="space-y-3 mt-2">
              {activity.map((a, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-muted-foreground/60 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">{a.text}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(a.at)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      {/* Phone: sticky action bar */}
      {canManage && (primary || (isDraft)) && (
        <div className="sm:hidden fixed bottom-0 inset-x-0 z-30 border-t bg-background/95 backdrop-blur p-3 flex gap-2">
          {actionsMenu}
          {isDraft && (
            <Button variant="outline" className="flex-1 gap-1" onClick={() => setLocation(`/purchase-orders/${po.id}/edit`)}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          )}
          {primary && <Button className="flex-1" onClick={primary.onClick} disabled={status.isPending}>{primary.label}</Button>}
        </div>
      )}

      <ReceiveStockDialog po={po} open={receiveOpen} onOpenChange={setReceiveOpen} />

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "place" ? "Place this order?" : confirm === "cancel" ? "Cancel this order?" : "Delete this draft?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "place" &&
                (po.vendor.email
                  ? `${po.vendor.name} will be emailed this order at ${po.vendor.email}. The order is locked afterwards - to change it you'd cancel and re-create it.`
                  : `${po.vendor.name} has no email on file, so nothing will be sent - you'll need to contact them yourself. The order is locked afterwards.`)}
              {confirm === "cancel" && "The supplier isn't notified. A cancelled order can't be placed or received."}
              {confirm === "delete" && "This permanently removes the draft."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm === "place") status.mutate("ordered");
                else if (confirm === "cancel") status.mutate("cancelled");
                else if (confirm === "delete") remove.mutate();
              }}
            >
              {confirm === "place" ? "Place order" : confirm === "cancel" ? "Cancel order" : "Delete draft"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
