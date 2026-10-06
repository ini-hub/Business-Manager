import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { SettingsPageHeader } from "@/components/settings-page-header";
import { Card, SaveBar } from "@/pages/settings/components/settings-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { useAuth } from "@/hooks/useAuth";
import { useEntitlements, formatPrice } from "@/hooks/useEntitlements";
import { openBilling } from "@/lib/upgrade-prompt";
import { validatePhoneNumber } from "@/lib/phone-utils";
import { getUserFriendlyError } from "@/lib/error-utils";
import { formatCurrency } from "@/lib/currency-utils";
import { cn } from "@/lib/utils";

type Draft = {
  name: string;
  businessUrl: string;
  address: string;
  phone: string;
  logoUrl: string;
  staffShare: string;
  businessShare: string;
};

const digits = (v: string) => v.replace(/[^0-9]/g, "");
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

function fromBusiness(b: any): Draft {
  return {
    name: b?.name ?? "",
    businessUrl: b?.businessUrl ?? "",
    address: b?.address ?? "",
    phone: b?.phone ?? "",
    logoUrl: b?.logoUrl ?? "",
    staffShare: String(b?.commissionSplitStaffShare ?? 20),
    businessShare: String(b?.commissionSplitBusinessShare ?? 80),
  };
}

/**
 * Org-wide business profile - applies across every store, never scoped to one.
 * Edited in place: there is no separate edit page, just a Save that lights up
 * once something has changed. Setting up a business for the first time still
 * goes through /settings/business/new.
 */
export default function SettingsBusinessPage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { business, currentStore, isLoading, updateBusiness } = useStore();
  const { toast } = useToast();
  const isOwner = user?.role === "owner";
  const fileInput = useRef<HTMLInputElement>(null);

  const saved = useMemo(() => fromBusiness(business), [business]);
  const [draft, setDraft] = useState<Draft>(saved);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(saved); setTried(false); }, [saved]);

  const storeId = currentStore && currentStore.id !== "all" ? currentStore.id : undefined;
  const { data: storeSettings } = useQuery<any>({ queryKey: ["/api/settings", storeId], enabled: !!storeId });

  // Choosing what Staff see is the paid "Staff Sales Visibility" feature. Without it the
  // server applies the default (own sales only), so the switch is shown ON and locked.
  const { isLocked, priceFor } = useEntitlements();
  const visibilityLocked = isLocked("staff_sales_visibility");
  const ownOnly = visibilityLocked || (business as any)?.staffOwnTransactionsOnly !== false;
  const setOwnOnly = async (checked: boolean) => {
    if (!business) return;
    try {
      await updateBusiness(business.id, { staffOwnTransactionsOnly: checked } as any);
      toast({ title: checked ? "Staff now see only their own sales" : "Staff can now see all sales" });
    } catch {
      toast({ title: "Couldn't update this setting", description: "Please try again.", variant: "destructive" });
    }
  };

  if (isLoading) {
    return <div className="flex min-h-[400px] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!business) {
    return (
      <div className="space-y-4">
        <SettingsPageHeader title="Business profile" description="Who your business is. Shown across every store." scope="business" />
        <Card>
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              No business details yet. {isOwner ? "Add them to get started." : "Ask your business owner to set this up."}
            </p>
            {isOwner && <Button onClick={() => setLocation("/settings/business/new")} data-testid="button-edit-business">Set up</Button>}
          </div>
        </Card>
      </div>
    );
  }

  const set = (k: keyof Draft) => (v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const n = (s: string) => parseInt(s, 10) || 0;
  const sum = n(draft.staffShare) + n(draft.businessShare);
  const splitOk = sum === 100;
  const phoneError = draft.phone
    ? validatePhoneNumber(draft.phone, (business as any).phoneCountryCode || "+234").valid ? "" : "Enter a valid phone number, for example 801 234 5678."
    : "";
  const nameError = tried && !draft.name.trim() ? "Enter your business name." : "";
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const canSave = isOwner && dirty && !saving;

  const staffPct = n(draft.staffShare);
  const storeRate = storeSettings && storeSettings.commissionType === "percentage" && storeSettings.defaultPaymentMethod !== "fixed"
    ? Math.round((storeSettings.commissionRate ?? 0) * 100) : null;
  const overridden = storeRate !== null && storeRate !== staffPct;

  const pickLogo = (file?: File) => {
    if (!file) return;
    if (file.size > LOGO_MAX_BYTES) {
      toast({ title: "File too large", description: "The logo must be smaller than 2 MB.", variant: "destructive" });
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => set("logoUrl")(reader.result as string);
    reader.readAsDataURL(file);
  };

  const save = async () => {
    setTried(true);
    if (!draft.name.trim() || phoneError || !splitOk) return;
    setSaving(true);
    try {
      await updateBusiness(business.id, {
        name: draft.name.trim(),
        businessUrl: draft.businessUrl,
        address: draft.address,
        phone: draft.phone,
        logoUrl: draft.logoUrl,
        commissionSplitStaffShare: n(draft.staffShare),
        commissionSplitBusinessShare: n(draft.businessShare),
      } as any);
      toast({ title: "Business profile saved" });
    } catch (error) {
      toast({ title: "Couldn't save", description: getUserFriendlyError(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const readOnly = !isOwner;
  const bizName = draft.name.trim() || "Your business";

  return (
    <div className="space-y-4">
      <SettingsPageHeader title="Business profile" description={`Who ${business.name} is. Shown across every store.`} scope="business" />

      <Card title="Identity">
        <div className="flex flex-col gap-4 rounded-lg border border-dashed bg-muted/30 p-4 sm:flex-row sm:items-center sm:gap-5">
          <div className="flex min-w-0 flex-1 items-start gap-4">
            {draft.logoUrl ? (
              <img src={draft.logoUrl} alt="Business logo" className="size-16 shrink-0 rounded-xl border bg-background object-contain p-1" />
            ) : (
              <div className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-2xl font-bold text-primary" aria-hidden>
                {bizName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold">Logo</p>
              <p className="mt-1 text-[13px] text-muted-foreground">PNG or JPG, up to 2 MB. Square works best. Until you add one, your initial is shown.</p>
            </div>
          </div>
          {!readOnly && (
            <div className="flex gap-2 sm:shrink-0">
              <input ref={fileInput} type="file" accept="image/png,image/jpeg" className="sr-only" aria-label="Upload logo" onChange={(e) => pickLogo(e.target.files?.[0])} />
              <Button type="button" variant="outline" className="min-h-11 flex-1 sm:min-h-10 sm:flex-none" onClick={() => fileInput.current?.click()}>{draft.logoUrl ? "Change" : "Upload"}</Button>
              {draft.logoUrl && <Button type="button" variant="ghost" className="min-h-11 flex-1 sm:min-h-10 sm:flex-none" onClick={() => set("logoUrl")("")}>Remove</Button>}
            </div>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="biz-name">Business name</Label>
            <Input id="biz-name" value={draft.name} disabled={readOnly} onChange={(e) => set("name")(e.target.value)} aria-invalid={!!nameError} data-testid="text-business-name" />
            {nameError && <p className="text-sm text-destructive">{nameError}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="biz-web">Website</Label>
            <div className="flex">
              <span className="flex items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm text-muted-foreground">https://</span>
              <Input id="biz-web" className="rounded-l-none" placeholder="yourbusiness.com" value={draft.businessUrl} disabled={readOnly}
                onChange={(e) => set("businessUrl")(e.target.value.replace(/^https?:\/\//i, ""))} data-testid="input-business-url" />
            </div>
            <p className="text-xs text-muted-foreground">Optional</p>
          </div>
        </div>
      </Card>

      <Card title="Head office" hint="Optional. Each store has its own address under Stores.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="biz-addr">Address</Label>
            <Input id="biz-addr" placeholder="Street, area, city" value={draft.address} disabled={readOnly} onChange={(e) => set("address")(e.target.value)} data-testid="input-business-address" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="biz-phone">Phone</Label>
            <div className="flex">
              <span className="flex items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm text-muted-foreground">{(business as any).phoneCountryCode || "+234"}</span>
              <Input id="biz-phone" className="rounded-l-none" inputMode="tel" placeholder="801 234 5678" value={draft.phone} disabled={readOnly}
                onChange={(e) => set("phone")(digits(e.target.value))} aria-invalid={!!phoneError} data-testid="input-business-phone" />
            </div>
            {phoneError && <p className="text-sm text-destructive">{phoneError}</p>}
          </div>
        </div>
      </Card>

      <Card title="Default commission split" hint="How service revenue is shared when a staff member is on commission. Stores and individual services can set their own.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="split-staff">Staff earn</Label>
            <div className="flex">
              <Input id="split-staff" inputMode="numeric" className="rounded-r-none" value={draft.staffShare} disabled={readOnly} data-testid="input-business-split-staff"
                onChange={(e) => { const v = digits(e.target.value).slice(0, 3); setDraft((d) => ({ ...d, staffShare: v, businessShare: v === "" ? d.businessShare : String(Math.max(0, 100 - n(v))) })); }} />
              <span className="flex items-center rounded-r-md border border-l-0 bg-muted px-3 text-sm text-muted-foreground">%</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="split-biz">{bizName} keeps</Label>
            <div className="flex">
              <Input id="split-biz" inputMode="numeric" className="rounded-r-none" value={draft.businessShare} disabled={readOnly} data-testid="input-business-split-business"
                onChange={(e) => set("businessShare")(digits(e.target.value).slice(0, 3))} />
              <span className="flex items-center rounded-r-md border border-l-0 bg-muted px-3 text-sm text-muted-foreground">%</span>
            </div>
          </div>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, staffPct)}%` }} />
        </div>
        <p className={cn("text-sm", splitOk ? "text-muted-foreground" : "font-medium text-destructive")}>
          {splitOk
            ? `On a ${formatCurrency(10000, currentStore?.currency || "NGN")} service, staff earn ${formatCurrency(100 * staffPct, currentStore?.currency || "NGN")} and ${bizName} keeps ${formatCurrency(100 * n(draft.businessShare), currentStore?.currency || "NGN")}.`
            : `Adds up to ${sum}%. Make it 100%.`}
        </p>
        {overridden && currentStore && (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            {currentStore.name} uses its own rate of {storeRate}% instead.{" "}
            <Link href="/settings/store-details" className="font-semibold underline">Pay rules</Link>
          </p>
        )}
      </Card>

      <Card title="Who sees which sales" hint="Owners and managers always see every sale. This decides what Staff see.">
        <div className="flex items-start justify-between gap-4">
          <label htmlFor="staff-own-transactions-only" className="text-sm">
            <span className="font-medium">Staff see only their own sales</span>
            <span className="block text-muted-foreground">
              A sale is theirs if they checked it out or were the lead or assistant on it. Customer spend and visit history stay hidden from Staff either way.
            </span>
          </label>
          <Switch id="staff-own-transactions-only" checked={ownOnly} onCheckedChange={setOwnOnly} disabled={!isOwner || visibilityLocked} data-testid="switch-staff-own-transactions-only" />
        </div>
        {!isOwner && <p className="text-xs text-muted-foreground">Only the owner can change this.</p>}
        {isOwner && visibilityLocked && (
          <p className="text-xs text-muted-foreground" data-testid="text-staff-visibility-locked">
            Letting Staff see every sale is the Staff Sales Visibility add-on{formatPrice(priceFor("staff_sales_visibility")) ? ` (${formatPrice(priceFor("staff_sales_visibility"))})` : ""}.{" "}
            <button type="button" className="font-semibold text-primary underline" onClick={() => openBilling(setLocation)}>View plans &amp; add-ons</button>
          </p>
        )}
      </Card>

      {isOwner ? (
        <SaveBar
          label="Save changes"
          pending={saving}
          disabled={!canSave}
          note={tried && !splitOk ? "The commission split must add up to 100%." : undefined}
          onSave={save}
        />
      ) : (
        <p className="text-sm text-muted-foreground">Only the owner can change the business profile.</p>
      )}

      <p className="text-sm text-muted-foreground">
        Looking for the receipt prefix? It moved to <Link href="/settings/store-details" className="font-medium text-primary underline">Receipts and stock alerts</Link>, next to the rest of the receipt.
      </p>
    </div>
  );
}
