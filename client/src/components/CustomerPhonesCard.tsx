import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Phone, Star, Trash2, Plus, GitMerge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/icon-button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatPhoneDisplay } from "@/lib/phone-utils";
import type { Customer, CustomerPhone } from "@shared/schema";

interface Props {
  customer: Customer;
  canManage: boolean;
  /** Called when the user chooses to merge with the profile that already owns a number they tried to add. */
  onMerge: (otherCustomerId: string) => void;
}

/** Every number a customer uses. The primary one is what reminders and the profile header show. */
export function CustomerPhonesCard({ customer, canManage, onMerge }: Props) {
  const { toast } = useToast();
  const [number, setNumber] = useState("");
  const [label, setLabel] = useState("");
  const [owner, setOwner] = useState<{ id: string; name: string } | null>(null);
  const queryKey = ["/api/customers", customer.id, "phones"];

  const { data: phones = [] } = useQuery<CustomerPhone[]>({ queryKey });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ["/api/customers", customer.storeId] });
  };
  const onError = (error: Error) => toast({ title: "Couldn't update numbers", description: error.message, variant: "destructive" });

  const addMutation = useMutation({
    mutationFn: async () => {
      // Raw fetch: a 409 here carries the profile that owns the number, which apiRequest's error drops.
      const res = await fetch(`/api/customers/${customer.id}/phones`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number, label: label.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body.existingCustomer) {
        setOwner({ id: body.existingCustomer.id, name: body.existingCustomer.name });
        return false;
      }
      if (!res.ok) throw new Error(body.error || "Could not add phone number.");
      return true;
    },
    onSuccess: (added) => {
      if (!added) return;
      setNumber("");
      setLabel("");
      setOwner(null);
      refresh();
      toast({ title: "Number added" });
    },
    onError,
  });

  const primaryMutation = useMutation({
    mutationFn: (phoneId: string) => apiRequest("PATCH", `/api/customers/${customer.id}/phones/${phoneId}/primary`),
    onSuccess: refresh,
    onError,
  });

  const removeMutation = useMutation({
    mutationFn: (phoneId: string) => apiRequest("DELETE", `/api/customers/${customer.id}/phones/${phoneId}`),
    onSuccess: refresh,
    onError,
  });

  // A single number with nobody to add to it isn't worth a card of its own for read-only users.
  if (!canManage && phones.length <= 1) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Phone className="h-4 w-4" /> Phone numbers
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-2">
          {phones.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-sm">
              <span className="font-medium">{formatPhoneDisplay(p.number, customer.countryCode || "")}</span>
              {p.label && <span className="text-xs text-muted-foreground">{p.label}</span>}
              {p.isPrimary && <Badge variant="secondary" className="text-[11px]">Primary</Badge>}
              {canManage && (
                <span className="ml-auto flex items-center gap-1">
                  {!p.isPrimary && (
                    <IconButton label="Make primary" variant="ghost" className="h-7 w-7" onClick={() => primaryMutation.mutate(p.id)}>
                      <Star className="h-3.5 w-3.5" />
                    </IconButton>
                  )}
                  <IconButton label="Remove number" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeMutation.mutate(p.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                </span>
              )}
            </li>
          ))}
          {phones.length === 0 && <li className="text-sm text-muted-foreground">No number on file.</li>}
        </ul>

        {canManage && (
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setOwner(null);
              if (number.trim()) addMutation.mutate();
            }}
          >
            <Input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="Add another number"
              inputMode="tel"
              className="flex-1 min-w-[160px]"
              aria-label="New phone number"
            />
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (optional)"
              className="w-36"
              aria-label="Label"
            />
            <Button type="submit" variant="outline" disabled={!number.trim() || addMutation.isPending}>
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          </form>
        )}

        {owner && (
          <Alert>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <span>This number already belongs to <strong>{owner.name}</strong>. Same person?</span>
              <Button size="sm" onClick={() => onMerge(owner.id)}>
                <GitMerge className="mr-1 h-4 w-4" /> Merge profiles
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
