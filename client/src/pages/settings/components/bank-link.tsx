import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import MonoConnect from "@mono.co/connect.js";
import { Link2, RefreshCw, Unlink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { BankConnection } from "@shared/schema";

type Props = { storeId: string; accountId: string; connection?: BankConnection; publicKey: string };

/** Links one bank account to the open-banking feed, so transfers into it confirm themselves. */
export function BankLink({ storeId, accountId, connection, publicKey }: Props) {
  const { toast } = useToast();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/sales/bank-connections", storeId] });
    queryClient.invalidateQueries({ queryKey: ["/api/reports/payment-accounts"] });
  };
  const onError = (title: string) => (err: any) => toast({ title, description: err?.message, variant: "destructive" });

  const link = useMutation({
    mutationFn: async (code: string) =>
      (await apiRequest("POST", "/api/sales/bank-connections", { storeId, paymentAccountId: accountId, code })).json(),
    onSuccess: (r: { sync: { confirmed: number } | null }) => {
      toast({ title: "Bank account linked", description: r.sync ? `${r.sync.confirmed} transfer${r.sync.confirmed === 1 ? "" : "s"} confirmed automatically.` : "First sync didn't finish; use Sync to retry." });
      refresh();
    },
    onError: onError("Couldn't link the bank account"),
  });
  const sync = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/sales/bank-connections/${connection!.id}/sync`)).json(),
    onSuccess: (r: { stored: number; confirmed: number }) => {
      toast({ title: "Synced", description: `${r.stored} new transaction${r.stored === 1 ? "" : "s"}, ${r.confirmed} transfer${r.confirmed === 1 ? "" : "s"} confirmed.` });
      refresh();
    },
    onError: onError("Couldn't sync"),
  });
  const unlink = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/sales/bank-connections/${connection!.id}`)).json(),
    onSuccess: refresh,
    onError: onError("Couldn't disconnect"),
  });

  // Rebuilt only if the key changes; setup() injects the widget frame once.
  const widget = useMemo(() => {
    const instance = new MonoConnect({
      key: publicKey,
      onSuccess: ({ code }: { code: string }) => link.mutate(code),
      onClose: () => {},
    });
    instance.setup();
    return instance;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey]);

  if (!connection) {
    return (
      <Button size="sm" variant="outline" disabled={link.isPending} onClick={() => widget.open()} data-testid={`button-link-bank-${accountId}`}>
        <Link2 className="h-4 w-4 mr-1" aria-hidden="true" />{link.isPending ? "Linking…" : "Link bank"}
      </Button>
    );
  }
  if (connection.status === "reauth_required") {
    return (
      <>
        <Badge variant="outline" className="text-[11px]">Reconnect needed</Badge>
        <Button size="sm" variant="ghost" disabled={unlink.isPending} onClick={() => unlink.mutate()}>Remove link</Button>
      </>
    );
  }
  return (
    <>
      <Badge variant="secondary" className="gap-1 text-[11px]"><Link2 className="h-3 w-3" aria-hidden="true" />Linked</Badge>
      <Button size="sm" variant="ghost" disabled={sync.isPending} onClick={() => sync.mutate()} aria-label="Sync now">
        <RefreshCw className={`h-4 w-4 ${sync.isPending ? "animate-spin" : ""}`} aria-hidden="true" />
      </Button>
      <Button size="sm" variant="ghost" disabled={unlink.isPending} onClick={() => unlink.mutate()} aria-label="Disconnect bank">
        <Unlink className="h-4 w-4" aria-hidden="true" />
      </Button>
    </>
  );
}
