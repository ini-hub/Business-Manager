/**
 * Save the current exploration as a named view, and reload a saved one.
 *
 * Sharing is a two-state choice on purpose: private, or visible to everyone in
 * the business who can already open the Explorer. Anything finer (per-person
 * ACLs, public links) is a different feature with different security questions.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, Check, Loader2, Trash2 } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { AnalyticsViewSpec } from "@shared/analytics/query";

interface SavedView {
  id: string;
  name: string;
  description: string | null;
  visibility: string;
  ownerUserId: string;
  spec: AnalyticsViewSpec;
}

interface SaveViewDialogProps {
  spec: AnalyticsViewSpec | null;
  onLoad: (spec: AnalyticsViewSpec) => void;
}

export function SaveViewDialog({ spec, onLoad }: SaveViewDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [shared, setShared] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const views = useQuery<SavedView[]>({ queryKey: ["/api/analytics/views"] });

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/analytics/views", {
        name,
        description: description || null,
        spec,
        visibility: shared ? "business" : "private",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/views"] });
      toast({ title: "View saved", description: `"${name}" is now in your saved views.` });
      setOpen(false);
      setName("");
      setDescription("");
    },
    onError: (error: Error) => {
      toast({
        title: "Could not save",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/analytics/views/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/views"] });
      toast({ title: "View deleted" });
    },
  });

  const loadView = async (id: string) => {
    try {
      const res = await apiRequest("GET", `/api/analytics/views/${id}`);
      const view = await res.json();
      onLoad(view.spec);
      // The server strips anything the reader cannot reach; say so rather than
      // letting the numbers quietly differ from what the author saw.
      (view.warnings ?? []).forEach((warning: string) =>
        toast({ title: "Partially loaded", description: warning }),
      );
    } catch (error) {
      toast({
        title: "Could not open that view",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 text-xs">
            Saved views
            {views.data && views.data.length > 0 && (
              <span className="ml-1.5 text-muted-foreground">({views.data.length})</span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-xs">Open a saved view</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {views.isLoading && (
            <div className="px-2 py-3 text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading…
            </div>
          )}
          {views.data?.length === 0 && (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              Nothing saved yet. Build a view and save it.
            </p>
          )}
          {views.data?.map((view) => (
            <DropdownMenuItem
              key={view.id}
              onSelect={(e) => {
                e.preventDefault();
                loadView(view.id);
              }}
              className="text-xs flex items-start gap-2"
            >
              <span className="flex-1 min-w-0">
                <span className="font-medium block truncate">{view.name}</span>
                {view.description && (
                  <span className="text-muted-foreground block truncate">
                    {view.description}
                  </span>
                )}
                {view.visibility === "business" && (
                  <span className="text-muted-foreground text-[10px]">Shared</span>
                )}
              </span>
              <button
                type="button"
                aria-label={`Delete ${view.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  remove.mutate(view.id);
                }}
                className="rounded-sm p-0.5 hover:bg-destructive/10 hover:text-destructive shrink-0"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" disabled={!spec}>
            <BookmarkPlus className="h-3 w-3" /> Save view
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save this view</DialogTitle>
            <DialogDescription>
              Stores the measures, breakdowns, filters and time grain — not the data, so it
              always reflects the latest figures.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="view-name" className="text-xs">
                Name
              </Label>
              <Input
                id="view-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Monday revenue review"
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="view-description" className="text-xs">
                Description (optional)
              </Label>
              <Textarea
                id="view-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={500}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="view-shared" className="text-xs">
                  Share with my team
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Anyone who can open the Explorer will see it. They will only see the
                  stores and measures their own role allows.
                </p>
              </div>
              <Switch id="view-shared" checked={shared} onCheckedChange={setShared} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => save.mutate()}
              disabled={!name.trim() || save.isPending}
            >
              {save.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
