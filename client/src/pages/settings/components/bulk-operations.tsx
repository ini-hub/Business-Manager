import { useState, useRef } from "react";
import { useStore } from "@/lib/store-context";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Database, User, Download, Upload, Coins, Store, UserPlus } from "lucide-react";
import { queryClient } from "@/lib/queryClient";

export function BulkOperationsSection() {
  const { toast } = useToast();
  const { currentStore } = useStore();

  const [activeImportType, setActiveImportType] = useState<string | null>(null);
  const [isImportingProgressOpen, setIsImportingProgressOpen] = useState(false);
  const [bulkImportProgress, setBulkImportProgress] = useState(0);
  const [bulkImportResult, setBulkImportResult] = useState<any>(null);
  const bulkFileInputRef = useRef<HTMLInputElement>(null);

  const downloadCSVTemplate = (type: string) => {
    let headers: string[] = [];
    let row: string[] = [];
    let filename = "";

    if (type === "staff") {
      headers = ["name", "staffNumber", "email", "mobileNumber", "payPerMonth", "signedContract", "paymentMethod"];
      row = ["Jane Smith", "STF-001", "jane.smith@example.com", "08031234567", "50000", "true", "hybrid"];
      filename = "staff_template.csv";
    } else if (type === "expenses") {
      headers = ["description", "amount", "category", "date"];
      row = ["Store Rent", "150000", "Rent", "2026-05-19"];
      filename = "expenses_template.csv";
    } else if (type === "inventory") {
      headers = ["name", "type", "costPrice", "sellingPrice", "quantity"];
      row = ["Widget Pro", "product", "10.00", "25.00", "100"];
      filename = "inventory_template.csv";
    } else if (type === "customers") {
      headers = ["name", "customerNumber", "mobileNumber", "address"];
      row = ["John Doe", "CUST-001", "08039876543", "123 Main Street"];
      filename = "customers_template.csv";
    }

    const csvContent = [headers.join(","), row.join(",")].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: "Template downloaded",
      description: "Fill in the template and upload it to import your data.",
    });
  };

  const exportRoster = async (type: string) => {
    if (!currentStore) return;
    try {
      let endpoint = "";
      let filename = "";
      if (type === "staff") {
        endpoint = `/api/staff?storeId=${currentStore.id}`;
        filename = `${currentStore.name}_staff_export.csv`;
      } else if (type === "expenses") {
        endpoint = `/api/expenses?storeId=${currentStore.id}`;
        filename = `${currentStore.name}_expenses_export.csv`;
      } else if (type === "inventory") {
        endpoint = `/api/inventory?storeId=${currentStore.id}`;
        filename = `${currentStore.name}_inventory_export.csv`;
      } else if (type === "customers") {
        endpoint = `/api/customers?storeId=${currentStore.id}`;
        filename = `${currentStore.name}_customers_export.csv`;
      }

      const res = await fetch(endpoint);
      if (!res.ok) throw new Error("Failed to fetch list.");
      const listData = await res.json();

      if (!Array.isArray(listData) || listData.length === 0) {
        toast({
          title: "Nothing to Export",
          description: "No entries found to export.",
          variant: "destructive"
        });
        return;
      }

      const headers = Object.keys(listData[0]).filter(k => typeof listData[0][k] !== "object" && k !== "id");
      const rows = listData.map((item: any) =>
        headers.map((h) => `"${String(item[h] ?? "").replace(/"/g, '""')}"`).join(",")
      );
      const csv = [headers.join(","), ...rows].join("\n");

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast({
        title: "Export completed",
        description: `${listData.length} records exported to CSV.`,
      });
    } catch (err) {
      toast({
        title: "Export Failed",
        description: "Could not export records at this time.",
        variant: "destructive"
      });
    }
  };

  const triggerUpload = (type: string) => {
    setActiveImportType(type);
    setTimeout(() => {
      bulkFileInputRef.current?.click();
    }, 100);
  };

  const handleBulkFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeImportType || !currentStore) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.split("\n").filter(l => l.trim());
        if (lines.length < 2) {
          toast({
            title: "Empty File",
            description: "No data rows found in CSV.",
            variant: "destructive"
          });
          return;
        }

        const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
        const parsed = [];
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(",").map(v => v.trim().replace(/^"|"$/g, ""));
          const row: any = {};
          headers.forEach((h, index) => {
            row[h] = values[index] ?? "";
          });
          parsed.push(row);
        }

        setIsImportingProgressOpen(true);
        setBulkImportProgress(40);
        setBulkImportResult(null);

        let endpoint = "";
        let bodyKey = "data";
        if (activeImportType === "staff") {
          endpoint = "/api/staff/bulk";
          bodyKey = "data";
        } else if (activeImportType === "expenses") {
          endpoint = "/api/expenses/bulk";
          bodyKey = "expenses";
        } else if (activeImportType === "inventory") {
          endpoint = "/api/inventory/bulk";
          bodyKey = "data";
        } else if (activeImportType === "customers") {
          endpoint = "/api/customers/bulk";
          bodyKey = "data";
        }

        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storeId: currentStore.id,
            [bodyKey]: parsed,
          })
        });

        const resData = await res.json();
        setBulkImportProgress(100);
        setBulkImportResult(resData);
        
        queryClient.invalidateQueries();
      } catch (err: any) {
        setIsImportingProgressOpen(false);
        toast({
          title: "Import Error",
          description: err.message || "Failed to process import.",
          variant: "destructive"
        });
      }
    };
    reader.readAsText(file);
    if (e.target) e.target.value = "";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5 text-primary" />
          Unified Bulk Operations
        </CardTitle>
        <CardDescription>
          Download templates, perform bulk uploads, and export data lists to CSV files.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!currentStore || currentStore.id === "all" ? (
          <Card className="p-8 border-dashed flex flex-col items-center justify-center text-center space-y-3">
            <Database className="h-10 w-10 text-muted-foreground/50" />
            <div>
              <CardTitle className="text-base font-semibold">No Active Store Location Selected</CardTitle>
              <CardDescription className="max-w-sm mt-1">
                You need to select or create a store location first under the <strong>Stores Management</strong> tab to use bulk operations.
              </CardDescription>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Bulk Staff */}
            <Card className="border border-muted/60 shadow-xs flex flex-col justify-between">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2 font-semibold text-primary">
                  <User className="h-4 w-4" />
                  Bulk Staff Operations
                </CardTitle>
                <CardDescription className="text-xs">
                  Upload a roster of staff using our CSV template, or export active rosters.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => downloadCSVTemplate("staff")}>
                    <Download className="mr-1.5 h-3.5 w-3.5" /> Template
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => exportRoster("staff")}>
                    <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
                  </Button>
                </div>
                <div className="border border-dashed border-muted/60 p-4 rounded-lg flex flex-col items-center justify-center gap-2 text-center bg-muted/10 hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => triggerUpload("staff")}>
                  <Upload className="h-6 w-6 text-muted-foreground/60" />
                  <span className="text-xs font-semibold">Upload Staff CSV</span>
                  <span className="text-[10px] text-muted-foreground">Standardized template match required</span>
                </div>
              </CardContent>
            </Card>

            {/* Bulk Expenses */}
            <Card className="border border-muted/60 shadow-xs flex flex-col justify-between">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2 font-semibold text-primary">
                  <Coins className="h-4 w-4" />
                  Bulk Expense Operations
                </CardTitle>
                <CardDescription className="text-xs">
                  Upload expense lists with automated category name matching (no category IDs needed).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => downloadCSVTemplate("expenses")}>
                    <Download className="mr-1.5 h-3.5 w-3.5" /> Template
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => exportRoster("expenses")}>
                    <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
                  </Button>
                </div>
                <div className="border border-dashed border-muted/60 p-4 rounded-lg flex flex-col items-center justify-center gap-2 text-center bg-muted/10 hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => triggerUpload("expenses")}>
                  <Upload className="h-6 w-6 text-muted-foreground/60" />
                  <span className="text-xs font-semibold">Upload Expenses CSV</span>
                  <span className="text-[10px] text-muted-foreground">Categories resolved by name</span>
                </div>
              </CardContent>
            </Card>

            {/* Bulk Inventory */}
            <Card className="border border-muted/60 shadow-xs flex flex-col justify-between">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2 font-semibold text-primary">
                  <Store className="h-4 w-4" />
                  Bulk Inventory Operations
                </CardTitle>
                <CardDescription className="text-xs">
                  Populate your store's products/services, or export current stock catalogs.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => downloadCSVTemplate("inventory")}>
                    <Download className="mr-1.5 h-3.5 w-3.5" /> Template
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => exportRoster("inventory")}>
                    <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
                  </Button>
                </div>
                <div className="border border-dashed border-muted/60 p-4 rounded-lg flex flex-col items-center justify-center gap-2 text-center bg-muted/10 hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => triggerUpload("inventory")}>
                  <Upload className="h-6 w-6 text-muted-foreground/60" />
                  <span className="text-xs font-semibold">Upload Inventory CSV</span>
                  <span className="text-[10px] text-muted-foreground">Standard template fields supported</span>
                </div>
              </CardContent>
            </Card>

            {/* Bulk Customers */}
            <Card className="border border-muted/60 shadow-xs flex flex-col justify-between">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2 font-semibold text-primary">
                  <UserPlus className="h-4 w-4" />
                  Bulk Customer Operations
                </CardTitle>
                <CardDescription className="text-xs">
                  Onboard directory profiles, or export the active client database.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => downloadCSVTemplate("customers")}>
                    <Download className="mr-1.5 h-3.5 w-3.5" /> Template
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => exportRoster("customers")}>
                    <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
                  </Button>
                </div>
                <div className="border border-dashed border-muted/60 p-4 rounded-lg flex flex-col items-center justify-center gap-2 text-center bg-muted/10 hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => triggerUpload("customers")}>
                  <Upload className="h-6 w-6 text-muted-foreground/60" />
                  <span className="text-xs font-semibold">Upload Customers CSV</span>
                  <span className="text-[10px] text-muted-foreground">Up to 5MB file size</span>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </CardContent>

      {/* Bulk Progress Dialog */}
      <Dialog open={isImportingProgressOpen} onOpenChange={setIsImportingProgressOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="capitalize">Import {activeImportType}</DialogTitle>
            <DialogDescription>
              {bulkImportResult ? "Import completed." : "Processing data rows..."}
            </DialogDescription>
          </DialogHeader>

          {!bulkImportResult && (
            <div className="space-y-4 py-2">
              <Progress value={bulkImportProgress} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">Uploading and saving entries...</p>
            </div>
          )}

          {bulkImportResult && (
            <div className="space-y-4">
              <div className="flex gap-4">
                <span className="text-xs">
                  Success: <strong className="text-green-600">{bulkImportResult.success ?? 0}</strong>
                </span>
                <span className="text-xs">
                  Failed: <strong className="text-red-600">{bulkImportResult.failed ?? 0}</strong>
                </span>
              </div>

              {bulkImportResult.errors && bulkImportResult.errors.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold">Errors list:</p>
                  <ScrollArea className="h-32 border p-2 rounded bg-muted/10">
                    {bulkImportResult.errors.map((err: any, idx: number) => (
                      <p key={idx} className="text-[10px] text-red-600 mb-1">
                        Row {err.row || idx + 1}: {err.message || String(err)}
                      </p>
                    ))}
                  </ScrollArea>
                </div>
              )}

              <DialogFooter>
                <Button onClick={() => setIsImportingProgressOpen(false)}>Close</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Hidden file input for unified CSV uploads */}
      <input
        type="file"
        ref={bulkFileInputRef}
        accept=".csv"
        onChange={handleBulkFileSelect}
        className="hidden"
      />
    </Card>
  );
}
