import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Edit, Trash2, Phone, Hash, DollarSign, FileCheck, FileX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertStaffSchema, type Staff, type InsertStaff } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";

export default function StaffPage() {
  const { toast } = useToast();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);

  const { data: staffList = [], isLoading } = useQuery<Staff[]>({
    queryKey: ["/api/staff"],
  });

  const form = useForm<InsertStaff>({
    resolver: zodResolver(insertStaffSchema),
    defaultValues: {
      name: "",
      staffNumber: "",
      mobileNumber: "",
      payPerMonth: 0,
      signedContract: false,
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: InsertStaff) => apiRequest("POST", "/api/staff", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Staff member created successfully" });
      closeForm();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create staff member", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: InsertStaff) =>
      apiRequest("PATCH", `/api/staff/${selectedStaff?.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
      toast({ title: "Staff member updated successfully" });
      closeForm();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update staff member", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/staff/${selectedStaff?.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Staff member deleted successfully" });
      setIsDeleteOpen(false);
      setSelectedStaff(null);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete staff member", description: error.message, variant: "destructive" });
    },
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  };

  const openCreateForm = () => {
    form.reset({
      name: "",
      staffNumber: "",
      mobileNumber: "",
      payPerMonth: 0,
      signedContract: false,
    });
    setSelectedStaff(null);
    setIsFormOpen(true);
  };

  const openEditForm = (staff: Staff) => {
    form.reset({
      name: staff.name,
      staffNumber: staff.staffNumber,
      mobileNumber: staff.mobileNumber,
      payPerMonth: staff.payPerMonth,
      signedContract: staff.signedContract,
    });
    setSelectedStaff(staff);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setSelectedStaff(null);
    form.reset();
  };

  const onSubmit = (data: InsertStaff) => {
    if (selectedStaff) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const columns = [
    {
      key: "staffNumber",
      header: "Staff ID",
      render: (staff: Staff) => (
        <div className="flex items-center gap-2">
          <Hash className="h-3 w-3 text-muted-foreground" />
          <span className="font-mono text-sm">{staff.staffNumber}</span>
        </div>
      ),
    },
    {
      key: "name",
      header: "Name",
      render: (staff: Staff) => (
        <span className="font-medium">{staff.name}</span>
      ),
    },
    {
      key: "mobileNumber",
      header: "Mobile",
      render: (staff: Staff) => (
        <div className="flex items-center gap-2">
          <Phone className="h-3 w-3 text-muted-foreground" />
          <span>{staff.mobileNumber}</span>
        </div>
      ),
    },
    {
      key: "payPerMonth",
      header: "Monthly Pay",
      render: (staff: Staff) => (
        <div className="flex items-center gap-2">
          <DollarSign className="h-3 w-3 text-muted-foreground" />
          <span className="font-mono">{formatCurrency(staff.payPerMonth)}</span>
        </div>
      ),
    },
    {
      key: "signedContract",
      header: "Contract",
      render: (staff: Staff) => (
        <Badge variant={staff.signedContract ? "default" : "secondary"} className="gap-1">
          {staff.signedContract ? (
            <>
              <FileCheck className="h-3 w-3" />
              Signed
            </>
          ) : (
            <>
              <FileX className="h-3 w-3" />
              Pending
            </>
          )}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "w-24",
      render: (staff: Staff) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              openEditForm(staff);
            }}
            data-testid={`button-edit-${staff.id}`}
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedStaff(staff);
              setIsDeleteOpen(true);
            }}
            data-testid={`button-delete-${staff.id}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff"
        description="Manage your staff members and their contracts"
        actions={
          <Button onClick={openCreateForm} data-testid="button-add-staff">
            <Plus className="mr-2 h-4 w-4" />
            Add Staff
          </Button>
        }
      />

      <DataTable
        data={staffList}
        columns={columns}
        searchable
        searchPlaceholder="Search staff..."
        searchKeys={["name", "staffNumber", "mobileNumber"]}
        isLoading={isLoading}
        emptyMessage="No staff members found. Add your first staff member to get started."
      />

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {selectedStaff ? "Edit Staff Member" : "Add New Staff Member"}
            </DialogTitle>
            <DialogDescription>
              {selectedStaff
                ? "Update the staff member information below."
                : "Fill in the details to add a new staff member."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Jane Smith" {...field} data-testid="input-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="staffNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Staff Number</FormLabel>
                      <FormControl>
                        <Input placeholder="EMP-001" {...field} data-testid="input-staff-number" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="mobileNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mobile Number</FormLabel>
                    <FormControl>
                      <Input placeholder="+1 234 567 8900" {...field} data-testid="input-mobile" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="payPerMonth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monthly Pay</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...field}
                        onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                        data-testid="input-pay"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="signedContract"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Contract Signed</FormLabel>
                      <FormDescription>
                        Has this staff member signed their employment contract?
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="switch-contract"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={closeForm}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="button-submit"
                >
                  {createMutation.isPending || updateMutation.isPending
                    ? "Saving..."
                    : selectedStaff
                    ? "Update Staff"
                    : "Add Staff"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
        title="Delete Staff Member"
        description={`Are you sure you want to delete "${selectedStaff?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        onConfirm={() => deleteMutation.mutate()}
        isDestructive
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
