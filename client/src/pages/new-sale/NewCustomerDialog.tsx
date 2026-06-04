import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { insertCustomerSchema } from "@shared/schema";
import type { InsertCustomer } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getUserFriendlyError } from "@/lib/error-utils";
import { useStore } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
} from "@/components/ui/form";
import { deduplicatedCountryCodes, validatePhoneNumber } from "@/lib/phone-utils";
import { getDefaultCountryCode } from "@/lib/validation-utils";

const newCustomerSchema = insertCustomerSchema.extend({
  mobileNumber: z.string().optional().default(""),
});

interface NewCustomerDialogProps {
  open: boolean;
  storeId: string;
  onClose: () => void;
  onCreated: (customerId: string) => void;
}

export function NewCustomerDialog({ open, storeId, onClose, onCreated }: NewCustomerDialogProps) {
  const { toast } = useToast();
  const { currentStore } = useStore();
  const defaultCountry = getDefaultCountryCode(currentStore?.currency);
  const defaultDialCode = deduplicatedCountryCodes.find(c => c.code === defaultCountry)?.dialCode ?? "+234";

  const form = useForm<InsertCustomer>({
    resolver: zodResolver(newCustomerSchema),
    defaultValues: {
      storeId,
      name: "",
      countryCode: defaultCountry,
      mobileNumber: "",
      address: "",
      customerNumber: "",
    },
  });

  const handleSubmit = (data: InsertCustomer) => {
    if (data.mobileNumber) {
      const dialCode = deduplicatedCountryCodes.find(c => c.code === (data.countryCode ?? defaultCountry))?.dialCode ?? defaultDialCode;
      const phoneCheck = validatePhoneNumber(data.mobileNumber, dialCode);
      if (!phoneCheck.valid) {
        form.setError("mobileNumber", { message: phoneCheck.error });
        return;
      }
    }
    mutation.mutate(data);
  };

  const mutation = useMutation({
    mutationFn: async (data: InsertCustomer) => {
      const response = await apiRequest("POST", "/api/customers", { ...data, storeId });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers", storeId] });
      toast({ title: "Customer created successfully" });
      onCreated(data.id);
      form.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't Add Customer",
        description: getUserFriendlyError(error, "customer"),
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { form.reset(); onClose(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add New Customer</DialogTitle>
          <DialogDescription>Create a new customer quickly during checkout.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl><Input placeholder="John Doe" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="mobileNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Mobile Number (Optional)</FormLabel>
                  <div className="flex gap-2">
                    <FormField control={form.control} name="countryCode" render={({ field: ccField }) => (
                      <Select
                        value={deduplicatedCountryCodes.find(c => c.code === ccField.value)?.dialCode ?? defaultDialCode}
                        onValueChange={(dialCode) => {
                          const country = deduplicatedCountryCodes.find(c => c.dialCode === dialCode);
                          ccField.onChange(country?.code ?? defaultCountry);
                        }}
                      >
                        <SelectTrigger className="w-[110px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-[280px]">
                          {deduplicatedCountryCodes.map(c => (
                            <SelectItem key={c.dialCode} value={c.dialCode}>{c.name} ({c.dialCode})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )} />
                    <FormControl><Input placeholder="8012345678" {...field} /></FormControl>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address (Optional)</FormLabel>
                  <FormControl><Textarea placeholder="123 Main St, City" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Creating..." : "Create Customer"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
