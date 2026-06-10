import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface SupervisorOverrideDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  discountPercent: number;
  userRole?: string;
  onApproved: (approvedBy: string) => void;
}

export function SupervisorOverrideDialog({
  open,
  onOpenChange,
  discountPercent,
  userRole,
  onApproved,
}: SupervisorOverrideDialogProps) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isPending, setIsPending] = useState(false);

  const handleClose = () => {
    setEmail("");
    setPassword("");
    onOpenChange(false);
  };

  const handleAuthorize = async () => {
    try {
      setIsPending(true);
      const res = await fetch("/api/auth/supervisor-override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Invalid credentials.");
      }
      const { supervisor: sup } = await res.json();

      if (discountPercent > 20 && sup.role !== "owner") {
        throw new Error("Only an Owner can authorize discounts exceeding 20%.");
      }

      toast({ title: "Override Authorized!", description: `Approved by ${sup.name} (${sup.role})` });
      onApproved(`${sup.name} (${sup.role})`);
      handleClose();
    } catch (err: unknown) {
      toast({
        title: "Authorization Failed",
        description: err instanceof Error ? err.message : "Could not verify credentials.",
        variant: "destructive",
      });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else onOpenChange(v); }}>
      <DialogContent className="max-w-md border-primary/20 shadow-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-primary font-bold">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-ping shrink-0" />
            Supervisor Override Required
          </DialogTitle>
          <DialogDescription className="text-xs">
            {userRole === "staff"
              ? "Staff accounts cannot grant discounts. A Manager or Owner must input their credentials to authorize this adjustment."
              : "Manager accounts can only authorize discounts up to 20%. An Owner must authorize this discount."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Supervisor Email</Label>
            <Input
              type="email"
              placeholder="supervisor@business.com"
              className="text-xs h-9"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Supervisor Password</Label>
            <Input
              type="password"
              placeholder="••••••••"
              className="text-xs h-9"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t">
          <Button type="button" variant="outline" className="text-xs h-9" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            type="button"
            className="text-xs h-9"
            disabled={isPending || !email || !password}
            onClick={handleAuthorize}
          >
            {isPending ? "Authorizing..." : "Authorize"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
