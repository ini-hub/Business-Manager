import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/hooks/use-toast";
import { useStore } from "@/lib/store-context";
import { apiRequest } from "@/lib/queryClient";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { ExpenseCategory } from "@shared/schema";

export default function ExpenseCategoriesPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { currentStore } = useStore();
  const queryClient = useQueryClient();

  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: categories = [], isLoading } = useQuery<ExpenseCategory[]>({
    queryKey: ["/api/expense-categories", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/expense-categories?storeId=${currentStore!.id}`);
      return res.json();
    },
    enabled: !!currentStore?.id,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!newName.trim()) throw new Error("Name is required");
      const res = await apiRequest("POST", "/api/expense-categories", {
        name: newName.trim(),
        storeId: currentStore!.id,
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as any).error || "Failed to add category");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expense-categories"] });
      toast({ title: "Category added" });
      setNewName("");
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const res = await apiRequest("PATCH", `/api/expense-categories/${id}`, { name });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as any).error || "Failed to update");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expense-categories"] });
      toast({ title: "Category updated" });
      setEditingId(null);
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/expense-categories/${id}`);
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as any).error || "Failed to delete");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expense-categories"] });
      toast({ title: "Category deleted" });
      setDeleteId(null);
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!currentStore) return <StoreRequiredAlert />;

  const userCategories = categories.filter((c) => !(c as any).isSystem);

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      <PageHeader
        title="Expense Categories"
        description="Manage the categories used to classify expenses."
        actions={
          <Button variant="outline" onClick={() => setLocation("/expenses")}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back to Expenses
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add New Category</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="e.g. Subscriptions, Advertising…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addMutation.mutate()}
              autoFocus
            />
            <Button onClick={() => addMutation.mutate()} disabled={addMutation.isPending || !newName.trim()}>
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your Categories</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
          ) : userCategories.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No categories yet.</p>
          ) : (
            <div className="divide-y">
              {userCategories.map((cat) => (
                <div key={cat.id} className="flex items-center gap-2 py-2.5">
                  {editingId === cat.id ? (
                    <>
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") updateMutation.mutate({ id: cat.id, name: editName });
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="h-8 text-sm flex-1"
                        autoFocus
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-primary"
                        onClick={() => updateMutation.mutate({ id: cat.id, name: editName })}
                        disabled={updateMutation.isPending}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => setEditingId(null)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-sm">{cat.name}</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => { setEditingId(cat.id); setEditName(cat.name); }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteId(cat.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete Category"
        description="This category will be permanently removed. Any expenses using it will lose their category link."
        confirmText="Delete"
        isDestructive
        onConfirm={() => { if (deleteId) deleteMutation.mutate(deleteId); }}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
