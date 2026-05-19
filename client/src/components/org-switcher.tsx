import { useState } from "react";
import { Check, ChevronsUpDown, Building2, Shuffle, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function OrgSwitcher() {
  const [open, setOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const { toast } = useToast();

  // Fetch the user data using custom key to ensure we match auth hook query
  const { data: user } = useQuery<any>({
    queryKey: ["/api/auth/user"],
    enabled: false, // Don't trigger new load, just read cache
  });

  const { data: orgs, isLoading } = useQuery<any[]>({
    queryKey: ["/api/auth/organisations"],
    enabled: !!user,
  });

  const switchMutation = useMutation({
    mutationFn: async (organisationId: string) => {
      const response = await apiRequest("POST", "/api/auth/organisation/switch", { organisationId });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Switched workspace",
        description: data.message || "Successfully switched organization.",
      });
      // Clear react-query cache and perform a hard page reload to re-initialize store provider and other state
      queryClient.clear();
      window.location.reload();
    },
    onError: (error: any) => {
      const errorMsg = error.response?.data?.error || "Failed to switch organization.";
      toast({
        title: "Switch failed",
        description: errorMsg,
        variant: "destructive",
      });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await apiRequest("POST", "/api/auth/organisation/create", { name });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Workspace Created",
        description: data.message || "Successfully created your new business workspace.",
      });
      // Clear react-query cache and perform a hard page reload to re-initialize store provider and other state
      queryClient.clear();
      window.location.reload();
    },
    onError: (error: any) => {
      const errorMsg = error.response?.data?.error || "Failed to create new business workspace.";
      toast({
        title: "Creation Failed",
        description: errorMsg,
        variant: "destructive",
      });
    },
  });

  if (isLoading || !orgs || orgs.length === 0) {
    return (
      <Button variant="outline" className="w-full justify-start h-9 border-slate-200 dark:border-slate-800" disabled>
        <Building2 className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate">Loading Organisation...</span>
      </Button>
    );
  }

  const currentOrg = orgs.find((o) => o.id === user?.businessId);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between h-9 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
            data-testid="button-org-switcher"
          >
            <span className="flex items-center gap-2 truncate">
              <Building2 className="h-4 w-4 shrink-0 text-emerald-500" />
              <span className="truncate font-semibold">{currentOrg?.name || "Select Organisation..."}</span>
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[240px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search organisation..." data-testid="input-org-search" />
            <CommandList>
              <CommandEmpty>No organisation found.</CommandEmpty>
              <CommandGroup heading="Your Workspaces">
                {orgs.map((org) => (
                  <CommandItem
                    key={org.id}
                    value={org.name}
                    onSelect={() => {
                      if (org.id !== user?.businessId) {
                        switchMutation.mutate(org.id);
                      }
                      setOpen(false);
                    }}
                    data-testid={`option-org-${org.slug}`}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Check
                        className={cn(
                          "h-4 w-4 text-emerald-500 shrink-0",
                          user?.businessId === org.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <span className="truncate font-medium">{org.name}</span>
                    </div>
                    {user?.businessId !== org.id && (
                      <Shuffle className="h-3 w-3 text-slate-400 opacity-0 group-hover:opacity-100 shrink-0" />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading="Actions">
                <CommandItem
                  onSelect={() => {
                    setOpen(false);
                    setNewOrgName("");
                    setCreateDialogOpen(true);
                  }}
                  className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold cursor-pointer"
                >
                  <Plus className="h-4 w-4 shrink-0 text-emerald-500" />
                  <span>Create Workspace</span>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-md border-emerald-500/20 shadow-lg">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
              <Building2 className="h-5 w-5 shrink-0 text-emerald-500" />
              Create Business Workspace
            </DialogTitle>
            <DialogDescription className="text-slate-500 dark:text-slate-400 text-sm">
              Each workspace operates with its own isolated sales ledger, catalog, store locations, and staff assignments.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="business-name" className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                Business Name
              </Label>
              <Input
                id="business-name"
                placeholder="e.g. Vanguard Retailers, Arewa Salon..."
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
                className="w-full h-10 border-slate-200 dark:border-slate-800 focus-visible:ring-emerald-500"
                disabled={createMutation.isPending}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setCreateDialogOpen(false)}
              disabled={createMutation.isPending}
              className="border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!newOrgName.trim()) {
                  toast({
                    title: "Required Field",
                    description: "Please enter a valid business name.",
                    variant: "destructive",
                  });
                  return;
                }
                createMutation.mutate(newOrgName);
              }}
              disabled={createMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-700 text-white font-semibold"
            >
              {createMutation.isPending ? "Creating..." : "Create Workspace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
