/**
 * Pin the current exploration onto a dashboard, creating one if needed.
 *
 * A tile stores an inline spec rather than a reference here — pinning an ad-hoc
 * exploration should not oblige you to name and save it first. Tiles that DO
 * reference a saved view update with it; inline ones are frozen at pin time.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { AnalyticsViewSpec } from "@shared/analytics/query";

interface Dashboard {
  id: string;
  name: string;
}

const NEW_DASHBOARD = "__new__";

export function PinToDashboardDialog({
  spec,
  defaultTitle,
}: {
  spec: AnalyticsViewSpec | null;
  defaultTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [tileTitle, setTileTitle] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const dashboards = useQuery<Dashboard[]>({
    queryKey: ["/api/analytics/dashboards"],
    enabled: open,
  });

  const pin = useMutation({
    mutationFn: async () => {
      let dashboardId = target;

      if (target === NEW_DASHBOARD || !target) {
        const created = await (
          await apiRequest("POST", "/api/analytics/dashboards", {
            name: newName.trim() || "My dashboard",
            visibility: "private",
          })
        ).json();
        dashboardId = created.id;
      }

      await apiRequest("POST", `/api/analytics/dashboards/${dashboardId}/tiles`, {
        spec,
        titleOverride: tileTitle.trim() || defaultTitle,
      });
      return dashboardId;
    },
    onSuccess: (dashboardId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/dashboards"] });
      queryClient.invalidateQueries({ queryKey: [`/api/analytics/dashboards/${dashboardId}`] });
      toast({ title: "Pinned", description: "Added to your dashboard." });
      setOpen(false);
      setNewName("");
      setTileTitle("");
    },
    onError: (error: Error) => {
      toast({ title: "Could not pin", description: error.message, variant: "destructive" });
    },
  });

  const creatingNew = target === NEW_DASHBOARD || (!target && !dashboards.data?.length);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" disabled={!spec}>
          <LayoutDashboard className="h-3 w-3" /> Pin
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pin to a dashboard</DialogTitle>
          <DialogDescription>
            The tile keeps this query and re-runs it each time the dashboard is opened.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Dashboard</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a dashboard" />
              </SelectTrigger>
              <SelectContent>
                {dashboards.data?.map((dashboard) => (
                  <SelectItem key={dashboard.id} value={dashboard.id}>
                    {dashboard.name}
                  </SelectItem>
                ))}
                <SelectItem value={NEW_DASHBOARD}>
                  <span className="flex items-center gap-1.5">
                    <Plus className="h-3 w-3" /> New dashboard…
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {creatingNew && (
            <div className="space-y-1.5">
              <Label htmlFor="dashboard-name" className="text-xs">
                New dashboard name
              </Label>
              <Input
                id="dashboard-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="My dashboard"
                maxLength={120}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="tile-title" className="text-xs">
              Tile title
            </Label>
            <Input
              id="tile-title"
              value={tileTitle}
              onChange={(e) => setTileTitle(e.target.value)}
              placeholder={defaultTitle}
              maxLength={120}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => pin.mutate()} disabled={pin.isPending}>
            {pin.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Pin
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
