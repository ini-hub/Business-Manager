import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft, Check, MoreHorizontal, Printer, Download, MessageCircle, Trash2, ArrowRightLeft, Phone, CalendarPlus, CalendarIcon,
} from "lucide-react";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useStore } from "@/lib/store-context";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/currency-utils";
import { usePoweredByText } from "@/lib/export-branding";
import { printWithFormat } from "@/lib/print-utils";
import { buildSlug } from "@/lib/slug";
import { EntityLink } from "@/components/oop-ui/EntityDisplayPresenter";
import type { Quote, QuoteItem, Customer, Inventory } from "@shared/schema";

type FullQuote = Quote & { customer: Customer | null; items: (QuoteItem & { inventory: Inventory })[] };
type QuoteStatus = "draft" | "sent" | "accepted" | "declined" | "converted";

const fmtDate = (d?: string | Date | null) =>
  d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null;

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft", sent: "Sent", accepted: "Accepted", declined: "Declined", converted: "Converted",
};
const STATUS_STYLE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  sent: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  accepted: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  declined: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  converted: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
};
const TYPE_STYLE: Record<string, string> = {
  service: "bg-violet-50 text-violet-700 border-violet-200",
  mixed: "bg-amber-50 text-amber-700 border-amber-200",
  product: "bg-sky-50 text-sky-700 border-sky-200",
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

function buildSteps(q: FullQuote): Step[] {
  const order: QuoteStatus[] = ["draft", "sent", "accepted", "converted"];
  // A declined quote never reaches "accepted"; the page shows a banner instead of the stepper.
  const idx = Math.max(order.indexOf(q.status as QuoteStatus), 0);
  const state = (i: number): Step["state"] => (i < idx || (i === idx && q.status === "converted") ? "done" : i === idx ? "current" : "todo");
  return [
    { key: "draft", title: "Draft", sub: `Created ${fmtDate(q.createdAt)}`, state: state(0) },
    { key: "sent", title: "Sent", sub: idx >= 1 ? "Shared with client" : "Share with client", state: state(1) },
    { key: "accepted", title: "Accepted", sub: idx >= 2 ? "Client agreed" : "Awaiting client", state: state(2) },
    { key: "converted", title: "Converted", sub: idx >= 3 ? (q.convertedBookingId ? "Turned into a booking" : "Turned into a sale") : "Book or sell", state: state(3) },
  ];
}

function Stepper({ steps }: { steps: Step[] }) {
  return (
    <>
      <div className="grid grid-cols-4 gap-2 sm:hidden" role="list">
        {steps.map((s) => (
          <div key={s.key} role="listitem" aria-current={s.state === "current" ? "step" : undefined}>
            <div className={`h-1 rounded-full ${s.state === "todo" ? "bg-muted" : "bg-primary"}`} />
            <p className={`mt-1.5 text-xs ${s.state === "current" ? "font-semibold" : "text-muted-foreground"}`}>{s.title}</p>
          </div>
        ))}
      </div>
      <ol className="hidden sm:grid grid-cols-4 gap-3">
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

export default function QuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { stores, currentStore, business } = useStore();
  const { user } = useAuth();
  const { toast } = useToast();
  const poweredBy = usePoweredByText();
  const [confirm, setConfirm] = useState<null | "decline" | "delete" | "convert">(null);

  const canManage = user?.role === "owner" || user?.role === "manager";

  const { data: quote, isLoading, isError } = useQuery<FullQuote>({
    queryKey: ["/api/quotes", id],
    queryFn: async () => (await apiRequest("GET", `/api/quotes/${id}`)).json(),
  });

  const setStatus = useMutation({
    mutationFn: async (status: QuoteStatus) => {
      await apiRequest("PATCH", `/api/quotes/${id}/status`, { status });
      return status;
    },
    onSuccess: (status) => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      toast({ title: "Status updated", description: `Quote marked as ${STATUS_LABEL[status].toLowerCase()}.` });
    },
    onError: (e: Error) => toast({ title: "Couldn't update the quote", description: e.message, variant: "destructive" }),
  });

  const [newExpiry, setNewExpiry] = useState<Date | undefined>();
  const setValidity = useMutation({
    mutationFn: async (body: { validUntil?: string; extendDays?: number }) => {
      const res = await apiRequest("PATCH", `/api/quotes/${id}/validity`, body);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not update the quote");
      return res.json();
    },
    onSuccess: (q: Quote) => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      setNewExpiry(undefined);
      toast({ title: "Validity updated", description: `Valid until ${fmtDate(q.validUntil)}.` });
    },
    onError: (e: Error) => toast({ title: "Couldn't update the quote", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", `/api/quotes/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      toast({ title: "Quote deleted" });
      setLocation("/quotes");
    },
    onError: (e: Error) => toast({ title: "Couldn't delete", description: e.message, variant: "destructive" }),
  });

  // The print stylesheet only hides siblings with `visibility`, which still
  // leaves the app's layout height in the flow; collapse #root while printing.
  useEffect(() => {
    const on = () => document.documentElement.classList.add("print-quote");
    const off = () => document.documentElement.classList.remove("print-quote");
    window.addEventListener("beforeprint", on);
    window.addEventListener("afterprint", off);
    return () => { window.removeEventListener("beforeprint", on); window.removeEventListener("afterprint", off); off(); };
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-6xl mx-auto">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (isError || !quote) {
    return (
      <div className="max-w-6xl mx-auto space-y-4">
        <Button variant="ghost" size="sm" className="gap-1" onClick={() => setLocation("/quotes")}>
          <ArrowLeft className="h-4 w-4" /> Quotes
        </Button>
        <p className="text-muted-foreground">This quote couldn't be found.</p>
      </div>
    );
  }

  const currency = stores.find((s) => s.id === quote.storeId)?.currency || currentStore?.currency || "NGN";
  const money = (n: number) => formatCurrency(n, currency);
  const status = quote.status as QuoteStatus;
  const open = status === "draft" || status === "sent";
  const itemCount = quote.items.length;
  const customerName = quote.customer?.name ?? "Walk-in customer";
  const expired = !!quote.validUntil && open && new Date(quote.validUntil).getTime() < Date.now();
  // An accepted quote that has lapsed can't be converted (the server enforces the same rule).
  const lapsed = !!quote.validUntil && status === "accepted" && new Date(quote.validUntil).getTime() < Date.now();

  const handlePrint = () => printWithFormat("a4-document");

  const handleDownloadPdf = async () => {
    const el = document.getElementById("quote-printable-invoice");
    if (!el) return;
    try {
      // Desktop-width capture so a phone viewport doesn't produce a cramped PDF.
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, windowWidth: 900 });
      const img = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ unit: "mm", format: "a4" });
      const w = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const h = (canvas.height * w) / canvas.width;
      // addImage doesn't paginate: redraw the full-height image shifted up one page per slice.
      let left = h;
      let pos = 0;
      pdf.addImage(img, "PNG", 0, pos, w, h);
      left -= pageH;
      while (left > 0) {
        pos -= pageH;
        pdf.addPage();
        pdf.addImage(img, "PNG", 0, pos, w, h);
        left -= pageH;
      }
      pdf.save(`${quote.quoteRef}.pdf`);
    } catch (err) {
      console.error("Quote PDF generation failed:", err);
      toast({ title: "Download failed", description: "Could not generate the PDF. Please try again.", variant: "destructive" });
    }
  };

  const handleShare = () => {
    const itemLines = quote.items
      .map((i) => `• ${i.inventory?.name ?? "Item"}${i.inventory?.type ? ` (${i.inventory.type})` : ""} — ${i.quantity} x ${money(i.unitPrice)} = ${money(i.totalPrice)}`)
      .join("\n");
    const msg = encodeURIComponent(
      `*${currentStore?.name ?? "Business"}*\n` +
      `PROFORMA ESTIMATE PROPOSAL\n\n` +
      `Ref: ${quote.quoteRef}\n` +
      `Status: ${quote.status.toUpperCase()}\n` +
      `Date: ${new Date(quote.createdAt).toLocaleDateString()}\n` +
      `Valid until: ${quote.validUntil ? new Date(quote.validUntil).toLocaleDateString() : "N/A"}\n\n` +
      `*Client:* ${customerName}${quote.customer?.mobileNumber ? ` (${quote.customer.mobileNumber})` : ""}\n\n` +
      `*Items:*\n${itemLines}\n\n` +
      `*Terms & Notes:*\n${quote.notes || "Standard proforma conditions apply."}\n\n` +
      `*Aggregated Quote Value: ${money(quote.totalPrice)}*\n\n` +
      `Thank you for your business!`
    );
    window.open(`https://wa.me/?text=${msg}`, "_blank");
  };

  const primary =
    canManage && open
      ? { label: "Mark as accepted", icon: <Check className="h-4 w-4" />, onClick: () => setStatus.mutate("accepted") }
      : canManage && status === "accepted"
        ? { label: "Convert to sale", icon: <ArrowRightLeft className="h-4 w-4" />, onClick: () => setConfirm("convert"), disabled: lapsed }
        : null;

  const bookIt = canManage && status === "accepted"
    ? { label: "Book it", icon: <CalendarPlus className="h-4 w-4" />, onClick: () => setLocation(`/bookings/new?quoteId=${id}`), disabled: lapsed }
    : null;

  const canDelete = user?.role === "owner" && status === "draft";

  const actionsMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="More actions"><MoreHorizontal className="h-4 w-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handlePrint}><Printer className="h-4 w-4 mr-2" />Print proforma</DropdownMenuItem>
        <DropdownMenuItem onClick={handleDownloadPdf}><Download className="h-4 w-4 mr-2" />Download PDF</DropdownMenuItem>
        {/* On phones "Book it" takes Share's slot in the bottom bar, so Share moves here. */}
        {bookIt && (
          <DropdownMenuItem className="sm:hidden" onClick={handleShare}><MessageCircle className="h-4 w-4 mr-2" />Share</DropdownMenuItem>
        )}
        {canManage && status === "draft" && (
          <DropdownMenuItem onClick={() => setStatus.mutate("sent")}>Mark as sent</DropdownMenuItem>
        )}
        {canManage && open && (
          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setConfirm("decline")}>
            Mark as declined
          </DropdownMenuItem>
        )}
        {canDelete && <DropdownMenuSeparator />}
        {canDelete && (
          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setConfirm("delete")}>
            <Trash2 className="h-4 w-4 mr-2" />Delete draft
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-5 pb-24 sm:pb-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="space-y-3">
        <Link href="/quotes" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> Quotes
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-[26px] sm:text-[26px] font-bold font-mono tracking-tight">{quote.quoteRef}</h1>
              <Badge variant="secondary" className={STATUS_STYLE[status] ?? ""}>{STATUS_LABEL[status] ?? quote.status}</Badge>
            </div>
            <p className="hidden sm:block text-sm text-muted-foreground mt-1">
              {customerName} · {itemCount} item{itemCount === 1 ? "" : "s"} · {money(quote.totalPrice)}
              {quote.validUntil ? ` · ${expired ? "expired" : "valid until"} ${fmtDate(quote.validUntil)}` : ""}
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-2 shrink-0">
            {actionsMenu}
            <Button variant="outline" className="gap-1 text-green-600 border-green-300 hover:bg-green-50 dark:border-green-900 dark:hover:bg-green-950" onClick={handleShare}>
              <MessageCircle className="h-4 w-4" /> Share
            </Button>
            {bookIt && (
              <Button variant="outline" className="gap-1" onClick={bookIt.onClick} disabled={bookIt.disabled}>
                {bookIt.icon}{bookIt.label}
              </Button>
            )}
            {primary && (
              <Button className="gap-1" onClick={primary.onClick} disabled={setStatus.isPending || ("disabled" in primary && primary.disabled)}>
                {primary.icon}{primary.label}
              </Button>
            )}
          </div>
        </div>
      </div>

      {status === "declined" ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          The client declined this quote. It can't be accepted or converted to a sale.
        </div>
      ) : (
        <Stepper steps={buildSteps(quote)} />
      )}

      {status === "converted" && (quote.convertedBookingId || quote.convertedSaleId) && (
        <div className="rounded-xl border bg-card p-4 text-sm">
          {quote.convertedBookingId
            ? <>This quote became a booking. <Link href={`/bookings/${quote.convertedBookingId}`} className="text-primary hover:underline">Open the booking</Link></>
            : "This quote was checked out as a sale."}
        </div>
      )}

      {lapsed && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200 p-4 text-sm">
          <p>This quote expired on {fmtDate(quote.validUntil)}, so it can't be booked or checked out.</p>
          {canManage && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className={cn("justify-start font-normal bg-background text-foreground", !newExpiry && "text-muted-foreground")}>
                    {newExpiry ? format(newExpiry, "PPP") : <span>Pick a new date</span>}
                    <CalendarIcon className="ml-2 h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={newExpiry}
                    onSelect={setNewExpiry}
                    disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <Button size="sm" variant="outline" disabled={!newExpiry || setValidity.isPending} onClick={() => setValidity.mutate({ validUntil: format(newExpiry!, "yyyy-MM-dd") })}>
                Update date
              </Button>
              <span className="text-xs opacity-70">or</span>
              <Button size="sm" disabled={setValidity.isPending} onClick={() => setValidity.mutate({ extendDays: 3 })}>
                Override: add 3 days
              </Button>
            </div>
          )}
        </div>
      )}

      {expired && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200 p-4 text-sm">
          This quote expired on {fmtDate(quote.validUntil)}. Check the prices with the client before accepting it.
        </div>
      )}

      {/* Phone: total card */}
      <div className="sm:hidden rounded-2xl bg-slate-900 text-white p-5 space-y-4">
        <div className="flex justify-between text-sm text-slate-300">
          <span>Quote total</span>
          <span>{itemCount} item{itemCount === 1 ? "" : "s"}</span>
        </div>
        <p className="text-4xl font-bold tracking-tight">{money(quote.totalPrice)}</p>
        <div className="border-t border-slate-700 pt-3 grid grid-cols-2 gap-4 text-sm">
          <div><p className="text-slate-400">Created</p><p className="font-semibold">{fmtDate(quote.createdAt)}</p></div>
          <div><p className="text-slate-400">Valid until</p><p className="font-semibold">{fmtDate(quote.validUntil) ?? "No expiry"}</p></div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_340px] gap-5 items-start">
        {/* Main column */}
        <div className="space-y-5 order-2 lg:order-1">
          <Card title={`Items${itemCount ? ` (${itemCount})` : ""}`}>
            <div className="-mx-4 sm:-mx-5">
              <div className="hidden sm:grid grid-cols-[1fr_70px_110px_120px] gap-3 px-5 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
                <span>Item</span><span className="text-right">Qty</span><span className="text-right">Unit price</span><span className="text-right">Line total</span>
              </div>
              {quote.items.map((i) => (
                <div key={i.id} className="px-4 sm:px-5 py-3 border-b last:border-b-0 sm:grid sm:grid-cols-[1fr_70px_110px_120px] sm:gap-3 sm:items-center">
                  <div className="flex justify-between gap-3 sm:block min-w-0">
                    <div className="min-w-0">
                      {i.inventory?.id ? (
                        <EntityLink href={`/inventory/${buildSlug(i.inventory.name, i.inventory.id)}`} className="font-medium truncate block">
                          {i.inventory.name}
                        </EntityLink>
                      ) : (
                        <p className="font-medium truncate">{i.inventory?.name ?? "Item"}</p>
                      )}
                      <p className="text-xs text-muted-foreground capitalize">{i.inventory?.type}</p>
                    </div>
                    <div className="text-right sm:hidden shrink-0">
                      <p className="font-semibold">{money(i.totalPrice)}</p>
                      <p className="text-xs text-muted-foreground">{i.quantity} × {money(i.unitPrice)}</p>
                    </div>
                  </div>
                  <span className="hidden sm:block text-right text-sm">{i.quantity}</span>
                  <span className="hidden sm:block text-right text-sm">{money(i.unitPrice)}</span>
                  <span className="hidden sm:block text-right text-sm font-medium">{money(i.totalPrice)}</span>
                </div>
              ))}
              <div className="px-4 sm:px-5 pt-3 space-y-1 text-sm">
                <div className="flex justify-between text-base font-bold"><span>Total</span><span>{money(quote.totalPrice)}</span></div>
              </div>
            </div>
          </Card>

          <Card title="Terms & notes">
            <p className="text-sm whitespace-pre-wrap break-words text-muted-foreground">
              {quote.notes || "Standard proforma conditions apply."}
            </p>
          </Card>
        </div>

        {/* Side column */}
        <div className="space-y-5 order-1 lg:order-2">
          <Card
            title="Client"
            action={quote.customer?.id && (
              <Link href={`/customers/${buildSlug(quote.customer.name, quote.customer.id)}`} className="text-sm text-primary hover:underline">
                View customer
              </Link>
            )}
          >
            <Row label="Name"><span className="font-semibold">{customerName}</span></Row>
            <Row label="Phone">
              {quote.customer?.mobileNumber && (business as any)?.viewerMask?.contact
                ? <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{quote.customer.mobileNumber}</span>
                : quote.customer?.mobileNumber
                ? <a href={`tel:${quote.customer.mobileNumber}`} className="inline-flex items-center gap-1 text-primary hover:underline"><Phone className="h-3.5 w-3.5" />{quote.customer.mobileNumber}</a>
                : <span className="text-muted-foreground">Not added</span>}
            </Row>
          </Card>

          <div className="hidden sm:block">
            <Card title="Quote details">
              <Row label="Created">{fmtDate(quote.createdAt)}</Row>
              <Row label="Valid until">
                {quote.validUntil
                  ? <span className={expired ? "text-destructive font-medium" : ""}>{fmtDate(quote.validUntil)}{expired ? " (expired)" : ""}</span>
                  : <span className="text-muted-foreground">No expiry</span>}
              </Row>
              <Row label="Prepared by">{currentStore?.name}</Row>
            </Card>
          </div>
        </div>
      </div>

      {/* Phone: sticky action bar */}
      <div className="sm:hidden fixed bottom-0 inset-x-0 z-30 border-t bg-background/95 backdrop-blur p-3 flex gap-2">
        {actionsMenu}
        {bookIt ? (
          <Button variant="outline" className="flex-1 gap-1" onClick={bookIt.onClick} disabled={bookIt.disabled}>
            {bookIt.icon}{bookIt.label}
          </Button>
        ) : (
          <Button variant="outline" className="flex-1 gap-1" onClick={handleShare}>
            <MessageCircle className="h-4 w-4" /> Share
          </Button>
        )}
        {primary && <Button className="flex-1" onClick={primary.onClick} disabled={setStatus.isPending || ("disabled" in primary && primary.disabled)}>{primary.label}</Button>}
      </div>

      {/* Printable proforma: parked off-screen for PDF capture, shown alone when printing. */}
      {createPortal(
        <div className="fixed left-[-10000px] top-0 w-[900px] print:static print:w-full">
          <div id="quote-printable-invoice" className="bg-white text-black p-8">
            <div className="flex justify-between items-start border-b pb-6">
              <div>
                <h1 className="text-[26px] font-bold tracking-tight text-primary uppercase">{currentStore?.name}</h1>
                <p className="text-xs text-gray-500 mt-1">PROFORMA ESTIMATE proposal</p>
                <p className="text-sm font-semibold text-gray-700 mt-2">Ref: {quote.quoteRef}</p>
              </div>
              <div className="text-right">
                <span className="inline-flex items-center justify-center leading-none px-3 py-2 bg-primary/10 border text-primary rounded-full font-bold text-xs uppercase tracking-wide">
                  {quote.status}
                </span>
                <p className="text-xs text-gray-400 mt-2">Date: {new Date(quote.createdAt).toLocaleDateString()}</p>
                {quote.validUntil && <p className="text-xs text-red-500 font-medium">Valid until: {new Date(quote.validUntil).toLocaleDateString()}</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-6 my-6 text-sm">
              <div>
                <p className="text-xs text-gray-400 uppercase font-semibold">Prepared By</p>
                <p className="font-bold text-gray-800">{currentStore?.name}</p>
                <p className="text-gray-500 text-xs">Branch ID: {currentStore?.id}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 uppercase font-semibold">Client Recipient</p>
                <p className="font-bold text-gray-800">{customerName}</p>
                {quote.customer?.mobileNumber && <p className="text-gray-500 text-xs">{quote.customer.mobileNumber}</p>}
              </div>
            </div>
            <table className="w-full text-left text-sm border-collapse my-6">
              <thead>
                <tr className="border-b bg-gray-50 text-gray-500 font-semibold">
                  <th className="py-2 px-3">Item Description</th>
                  <th className="py-2 px-3 text-right">Quantity</th>
                  <th className="py-2 px-3 text-right">Unit Rate</th>
                  <th className="py-2 px-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {quote.items.map((i) => (
                  <tr key={i.id} className="border-b text-gray-700">
                    {/* No `truncate`: html2canvas garbles CSS ellipsis in the PDF capture. */}
                    <td className="py-3 px-3">
                      <p className="font-medium text-gray-800 break-words max-w-[300px]">{i.inventory?.name}</p>
                      <Badge variant="outline" className={`mt-1 text-[11px] leading-none capitalize ${TYPE_STYLE[i.inventory?.type] ?? TYPE_STYLE.product}`}>
                        {i.inventory?.type}
                      </Badge>
                    </td>
                    <td className="py-3 px-3 text-right font-mono">{i.quantity}</td>
                    <td className="py-3 px-3 text-right font-mono">{money(i.unitPrice)}</td>
                    <td className="py-3 px-3 text-right font-mono font-semibold">{money(i.totalPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-between items-start mt-6 pt-6 border-t">
              <div className="max-w-[400px]">
                <p className="text-xs text-gray-400 uppercase font-semibold">Terms & Notes</p>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed italic">{quote.notes || "Standard proforma conditions apply."}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-400 uppercase font-semibold">Aggregated Quote Value</p>
                <h2 className="text-lg font-bold text-primary font-mono mt-1">{money(quote.totalPrice)}</h2>
              </div>
            </div>
            {poweredBy && <p className="text-center text-[10px] text-gray-400 mt-6">{poweredBy}</p>}
          </div>
        </div>,
        document.body,
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "decline" ? "Mark this quote as declined?" : confirm === "convert" ? "Proceed to checkout?" : "Delete this draft?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "decline" && "A declined quote can't be accepted or converted to a sale."}
              {confirm === "convert" && "The quote's items open in checkout, where you can add more before taking payment. The quote is marked converted once the sale completes."}
              {confirm === "delete" && "This permanently removes the draft."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => (confirm === "decline" ? setStatus.mutate("declined") : confirm === "convert" ? setLocation(`/sales/new?quoteId=${id}`) : remove.mutate())}
            >
              {confirm === "decline" ? "Mark declined" : confirm === "convert" ? "Proceed to checkout" : "Delete draft"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
