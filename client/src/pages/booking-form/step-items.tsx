import { UseFormReturn, useFieldArray } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2, ShoppingCart } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

import { useStore } from "@/lib/store-context";
import type { Inventory } from "@shared/schema";
import { BookingFormValues } from "./types";

interface StepItemsProps {
  form: UseFormReturn<BookingFormValues>;
  onBack: () => void;
  onNext: () => void;
}

export function StepItems({ form, onBack, onNext }: StepItemsProps) {
  const { currentStore } = useStore();

  const { fields, append, remove } = useFieldArray({
    name: "bookingItems",
    control: form.control,
  });

  const { data: inventory = [] } = useQuery<Inventory[]>({
    queryKey: ["/api/inventory", currentStore?.id],
    enabled: !!currentStore?.id,
  });

  const handleInventorySelect = (index: number, inventoryId: string) => {
    const selectedItem = inventory.find((i) => i.id === inventoryId);
    if (selectedItem) {
      form.setValue(`bookingItems.${index}.unitPrice`, selectedItem.sellingPrice);
    }
  };

  const watchItems = form.watch("bookingItems");
  const subtotal = watchItems.reduce((acc, item) => acc + Number(item.quantity) * Number(item.unitPrice), 0);

  const handleNext = async () => {
    const valid = await form.trigger("bookingItems");
    if (valid) onNext();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" />
            Items & Services
          </CardTitle>
          <CardDescription>Add the services or products for this booking. Prices will auto-fill from your inventory.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {fields.map((field, index) => (
            <div key={field.id} className="relative rounded-lg border bg-muted/20 p-4 space-y-4 animate-in fade-in duration-200">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Item {index + 1}
                </span>
                {fields.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:bg-destructive/10"
                    onClick={() => remove(index)}
                    aria-label={`Remove item ${index + 1}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr] gap-4">
                <FormField
                  control={form.control}
                  name={`bookingItems.${index}.inventoryId`}
                  render={({ field: selectField }) => (
                    <FormItem>
                      <FormLabel>Item / Service</FormLabel>
                      <Select
                        onValueChange={(val) => {
                          selectField.onChange(val);
                          handleInventorySelect(index, val);
                        }}
                        defaultValue={selectField.value}
                      >
                        <FormControl>
                          <SelectTrigger id={`booking-item-${index}-select`}>
                            <SelectValue placeholder="Select an item" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {inventory.map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name={`bookingItems.${index}.quantity`}
                  render={({ field: inputField }) => (
                    <FormItem>
                      <FormLabel>Quantity</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="1"
                          id={`booking-item-${index}-qty`}
                          value={inputField.value === 0 ? "" : inputField.value ?? ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            let cleanVal = val;
                            if (/^0\d+/.test(val)) cleanVal = val.replace(/^0+/, "");
                            inputField.onChange(cleanVal === "" ? 1 : parseInt(cleanVal, 10) || 1);
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name={`bookingItems.${index}.unitPrice`}
                  render={({ field: inputField }) => (
                    <FormItem>
                      <FormLabel>Price (₦)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0"
                          placeholder="0"
                          id={`booking-item-${index}-price`}
                          value={inputField.value === 0 ? "0" : inputField.value ?? ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            let cleanVal = val;
                            if (/^0\d+/.test(val)) cleanVal = val.replace(/^0+/, "");
                            inputField.onChange(cleanVal === "" ? 0 : parseFloat(cleanVal) || 0);
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="text-right text-sm text-muted-foreground">
                Line total:{" "}
                <span className="font-semibold text-foreground">
                  ₦{(Number(watchItems[index]?.quantity || 0) * Number(watchItems[index]?.unitPrice || 0)).toLocaleString()}
                </span>
              </div>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append({ inventoryId: "", quantity: 1, unitPrice: 0 })}
            id="booking-add-item-btn"
            className="w-full border-dashed"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Another Item
          </Button>

          {subtotal > 0 && (
            <>
              <Separator />
              <div className="flex justify-between items-center font-medium">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="text-lg">₦{subtotal.toLocaleString()}</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-between gap-3">
        <Button type="button" variant="outline" onClick={onBack} id="booking-back-step-2">
          ← Back
        </Button>
        <Button type="button" onClick={handleNext} id="booking-next-step-2" className="min-w-[140px]">
          Next: Schedule →
        </Button>
      </div>
    </div>
  );
}
