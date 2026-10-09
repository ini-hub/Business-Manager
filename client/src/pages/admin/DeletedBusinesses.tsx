import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Eye, RotateCcw, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getUserFriendlyError } from "@/lib/error-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/loader";

type Feedback = { id: string; organisationName: string; userEmail: string | null; reasons: string[]; details: string | null; wouldReturn: string | null; contactOk: boolean; createdAt: string };
type DeletedBusiness = { id: string; name: string; deletedAt: string; deletionReason: string | null; deletedByUserId: string | null; feedback: Feedback | null };

const label = (s: string) => s.replace(/_/g, " ");

export default function DeletedBusinesses() {
  const { toast } = useToast();
  const [purgeTarget, setPurgeTarget] = useState<DeletedBusiness | null>(null);
  const [confirmName, setConfirmName] = useState("");

  const { data: businesses, isLoading } = useQuery<DeletedBusiness[]>({
    queryKey: ["/api/admin/deleted-businesses"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/deleted-businesses")).json(),
  });
  const { data: allFeedback } = useQuery<Feedback[]>({
    queryKey: ["/api/admin/deletion-feedback"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/deletion-feedback")).json(),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/deleted-businesses"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/deletion-feedback"] });
  };
  const onError = (error: unknown) => toast({ title: "Action failed", description: getUserFriendlyError(error), variant: "destructive" });

  const view = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/admin/businesses/${id}/view-as-owner`)).json(),
    onSuccess: () => { window.location.href = "/"; },
    onError,
  });
  const restore = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/admin/businesses/${id}/cancel-deletion`)).json(),
    onSuccess: (r) => { toast({ title: "Restored", description: r.message }); refresh(); },
    onError,
  });
  const purge = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/admin/businesses/${purgeTarget!.id}/purge`, { confirmName })).json(),
    onSuccess: (r) => { toast({ title: "Deleted forever", description: r.message }); setPurgeTarget(null); setConfirmName(""); refresh(); },
    onError,
  });

  return (
    <div className="space-y-6 p-4 sm:p-8">
      <div>
        <h1 className="text-2xl font-bold">Deleted businesses</h1>
        <p className="text-sm text-muted-foreground">Deleted by their owners but fully retained. Open one to see exactly what the owner saw, restore it, or delete it forever.</p>
      </div>
      <Tabs defaultValue="businesses">
        <TabsList>
          <TabsTrigger value="businesses">Businesses</TabsTrigger>
          <TabsTrigger value="feedback">Exit feedback</TabsTrigger>
        </TabsList>

        <TabsContent value="businesses" className="space-y-3">
          {isLoading && <Spinner />}
          {businesses?.length === 0 && <p className="text-sm text-muted-foreground">No deleted businesses.</p>}
          {businesses?.map((b) => (
            <Card key={b.id} data-testid={`card-deleted-${b.id}`}>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
                <div>
                  <CardTitle className="text-base">{b.name}</CardTitle>
                  <p className="text-xs text-muted-foreground">Deleted {new Date(b.deletedAt).toLocaleString()} · {b.deletedByUserId ? "by owner" : "by admin"}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => view.mutate(b.id)} disabled={view.isPending} data-testid={`button-view-${b.id}`}><Eye className="mr-1 h-4 w-4" /> View as owner</Button>
                  <Button size="sm" variant="outline" onClick={() => restore.mutate(b.id)} disabled={restore.isPending} data-testid={`button-restore-${b.id}`}><RotateCcw className="mr-1 h-4 w-4" /> Restore</Button>
                  <Button size="sm" variant="destructive" onClick={() => { setPurgeTarget(b); setConfirmName(""); }} data-testid={`button-purge-${b.id}`}><Trash2 className="mr-1 h-4 w-4" /> Delete forever</Button>
                </div>
              </CardHeader>
              {b.feedback && (
                <CardContent className="space-y-1 text-sm">
                  <div className="flex flex-wrap gap-1">{b.feedback.reasons.map((r) => <Badge key={r} variant="secondary">{label(r)}</Badge>)}</div>
                  {b.feedback.details && <p className="text-muted-foreground">“{b.feedback.details}”</p>}
                </CardContent>
              )}
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="feedback" className="space-y-3">
          {allFeedback?.length === 0 && <p className="text-sm text-muted-foreground">No feedback yet.</p>}
          {allFeedback?.map((f) => (
            <Card key={f.id}>
              <CardContent className="space-y-1 pt-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{f.organisationName}</span>
                  <span className="text-xs text-muted-foreground">{new Date(f.createdAt).toLocaleDateString()} · {f.userEmail ?? "unknown"}{f.contactOk ? " · OK to contact" : ""}</span>
                </div>
                <div className="flex flex-wrap gap-1">{f.reasons.map((r) => <Badge key={r} variant="secondary">{label(r)}</Badge>)}</div>
                {f.wouldReturn && <p className="text-muted-foreground">Would return: {f.wouldReturn}</p>}
                {f.details && <p>“{f.details}”</p>}
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      <Dialog open={!!purgeTarget} onOpenChange={(o) => !o && setPurgeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete {purgeTarget?.name} forever?</DialogTitle>
            <DialogDescription>Every record, store, staff link and transaction for this business is permanently removed. This cannot be undone. Its exit feedback is kept.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="purge-name">Type the business name to confirm</Label>
            <Input id="purge-name" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={purgeTarget?.name} autoComplete="off" data-testid="input-purge-name" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPurgeTarget(null)}>Cancel</Button>
            <Button variant="destructive" disabled={purge.isPending || confirmName.trim().toLowerCase() !== purgeTarget?.name.trim().toLowerCase()} onClick={() => purge.mutate()} data-testid="button-purge-confirm">
              {purge.isPending ? "Deleting…" : "Delete forever"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
