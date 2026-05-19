import { useState } from "react";
import { Check, ChevronsUpDown, Building2, Shuffle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
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
} from "@/components/ui/command";

export function OrgSwitcher() {
  const [open, setOpen] = useState(false);
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

  if (isLoading || !orgs || orgs.length === 0) {
    return (
      <Button variant="outline" className="w-full justify-start h-9 border-slate-200 dark:border-slate-800" disabled>
        <Building2 className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate">Loading Organisation...</span>
      </Button>
    );
  }

  const currentOrg = orgs.find((o) => o.id === user?.businessId);

  // If user only belongs to 1 organization, just display it statically as a nice, sleek badge/button
  if (orgs.length === 1) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-slate-800 dark:text-slate-200 text-sm font-semibold max-w-[200px] truncate">
        <Building2 className="h-4 w-4 shrink-0 text-emerald-500" />
        <span className="truncate">{currentOrg?.name || "Organisation"}</span>
      </div>
    );
  }

  return (
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
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
