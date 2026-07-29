/**
 * Dashboard list.
 */

import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, LayoutDashboard, Loader2, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface Dashboard {
  id: string;
  name: string;
  description: string | null;
  visibility: string;
  updatedAt: string;
}

export default function AnalyticsDashboardsPage() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const dashboards = useQuery<Dashboard[]>({ queryKey: ["/api/analytics/dashboards"] });

  const create = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", "/api/analytics/dashboards", {
          name,
          visibility: shared ? "business" : "private",
        })
      ).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/dashboards"] });
      toast({ title: "Dashboard created" });
      setOpen(false);
      setName("");
    },
    onError: (error: Error) =>
      toast({ title: "Could not create", description: error.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/analytics/dashboards/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/dashboards"] });
      toast({ title: "Dashboard deleted" });
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dashboards"
        description="Pin saved explorations side by side."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1">
                <Plus className="h-4 w-4" /> New dashboard
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New dashboard</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="name" className="text-xs">
                    Name
                  </Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Monday review"
                    maxLength={120}
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border p-3">
                  <Label htmlFor="shared" className="text-xs">
                    Share with my team
                  </Label>
                  <Switch id="shared" checked={shared} onCheckedChange={setShared} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => create.mutate()}
                  disabled={!name.trim() || create.isPending}
                >
                  {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {dashboards.isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}

      {dashboards.data?.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <LayoutDashboard className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm font-medium">No dashboards yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Build a view in the Explorer and pin it, or create an empty dashboard here.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {dashboards.data?.map((dashboard) => (
          <Card key={dashboard.id} className="group hover:border-primary/50 transition-colors">
            <CardContent className="p-4 flex items-start gap-3">
              <Link href={`/analytics/dashboards/${dashboard.id}`} className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-sm truncate">{dashboard.name}</p>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </div>
                {dashboard.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {dashboard.description}
                  </p>
                )}
                {dashboard.visibility === "business" && (
                  <p className="text-[10px] text-muted-foreground mt-1">Shared with the team</p>
                )}
              </Link>
              <button
                type="button"
                aria-label={`Delete ${dashboard.name}`}
                onClick={() => remove.mutate(dashboard.id)}
                className="rounded-sm p-1 opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-opacity"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
