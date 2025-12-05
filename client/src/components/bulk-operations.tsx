import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Upload, Download, FileText, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { exportToCSV } from "@/lib/export-utils";
import { getUserFriendlyError } from "@/lib/error-utils";

interface BulkOperationsProps {
  entityType: "customers" | "staff" | "inventory";
  data: Record<string, unknown>[];
  columns: { key: string; header: string }[];
  isLoading?: boolean;
  storeId?: string;
}

interface ImportResult {
  success: number;
  failed: number;
  errors: { row: number; message: string }[];
}

const ENTITY_CONFIG = {
  customers: {
    label: "Customers",
    endpoint: "/api/customers/bulk",
    exportFilename: "customers",
    sampleHeaders: ["name", "customerNumber", "mobileNumber", "address"],
    sampleRow: ["John Doe", "CUST-001", "555-1234", "123 Main Street"],
  },
  staff: {
    label: "Staff",
    endpoint: "/api/staff/bulk",
    exportFilename: "staff",
    sampleHeaders: ["name", "staffNumber", "mobileNumber", "payPerMonth", "signedContract"],
    sampleRow: ["Jane Smith", "STF-001", "555-5678", "3500", "true"],
  },
  inventory: {
    label: "Inventory",
    endpoint: "/api/inventory/bulk",
    exportFilename: "inventory",
    sampleHeaders: ["name", "type", "costPrice", "sellingPrice", "quantity"],
    sampleRow: ["Widget Pro", "product", "10.00", "25.00", "100"],
  },
};

export function BulkOperations({
  entityType,
  data,
  columns,
  isLoading = false,
  storeId,
}: BulkOperationsProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const config = ENTITY_CONFIG[entityType];

  const importMutation = useMutation({
    mutationFn: async (csvData: Record<string, string>[]) => {
      const response = await apiRequest("POST", config.endpoint, { data: csvData, storeId });
      return response.json();
    },
    onSuccess: (result: ImportResult) => {
      setImportResult(result);
      setImportProgress(100);
      queryClient.invalidateQueries({ queryKey: [`/api/${entityType === "inventory" ? "inventory" : entityType}`, storeId] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats", storeId] });

      if (result.failed === 0) {
        toast({
          title: "Import successful",
          description: `${result.success} ${config.label.toLowerCase()} imported successfully.`,
        });
      } else {
        toast({
          title: "Import completed with errors",
          description: `${result.success} imported, ${result.failed} failed.`,
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Import Failed",
        description: getUserFriendlyError(error, `importing ${config.label.toLowerCase()}`),
        variant: "destructive",
      });
      setImportProgress(0);
    },
  });

  const handleExport = () => {
    if (data.length === 0) {
      toast({
        title: "Nothing to Export",
        description: `You don't have any ${config.label.toLowerCase()} yet. Add some first, then try exporting again.`,
        variant: "destructive",
      });
      return;
    }

    exportToCSV(data, columns, config.exportFilename);
    toast({
      title: "Export successful",
      description: `${data.length} ${config.label.toLowerCase()} exported to CSV.`,
    });
  };

  const handleDownloadTemplate = () => {
    const csvContent = [
      config.sampleHeaders.join(","),
      config.sampleRow.join(","),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `${config.exportFilename}_template.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: "Template downloaded",
      description: "Fill in the template with your data and import it.",
    });
  };

  const parseCSV = (text: string): Record<string, string>[] => {
    const lines = text.split("\n").filter((line) => line.trim());
    if (lines.length < 2) return [];

    const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
    const rows: Record<string, string>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        row[header] = values[index] ?? "";
      });
      rows.push(row);
    }

    return rows;
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsedData = parseCSV(text);

      if (parsedData.length === 0) {
        toast({
          title: "Empty or Invalid File",
          description: "This file appears to be empty or in the wrong format. Please use the template as a guide.",
          variant: "destructive",
        });
        return;
      }

      setImportResult(null);
      setImportProgress(10);
      setIsImportDialogOpen(true);

      setTimeout(() => {
        setImportProgress(30);
        importMutation.mutate(parsedData);
      }, 500);
    };

    reader.onerror = () => {
      toast({
        title: "Couldn't Read File",
        description: "There was a problem opening your file. Please make sure it's a valid CSV file.",
        variant: "destructive",
      });
    };

    reader.readAsText(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const closeImportDialog = () => {
    setIsImportDialogOpen(false);
    setImportResult(null);
    setImportProgress(0);
  };

  return (
    <>
      <input
        type="file"
        ref={fileInputRef}
        accept=".csv"
        onChange={handleFileSelect}
        className="hidden"
        data-testid={`input-import-${entityType}`}
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" disabled={isLoading} data-testid={`button-bulk-${entityType}`}>
            <FileText className="mr-2 h-4 w-4" />
            Bulk Operations
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleImportClick} data-testid={`button-import-${entityType}`}>
            <Upload className="mr-2 h-4 w-4" />
            Import CSV
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleExport} data-testid={`button-export-${entityType}`}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleDownloadTemplate} data-testid={`button-template-${entityType}`}>
            <FileText className="mr-2 h-4 w-4" />
            Download Template
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Import {config.label}</DialogTitle>
            <DialogDescription>
              {importResult
                ? "Import completed. Review the results below."
                : "Importing your data..."}
            </DialogDescription>
          </DialogHeader>

          {!importResult && (
            <div className="space-y-4">
              <Progress value={importProgress} className="h-2" />
              <p className="text-sm text-muted-foreground text-center">
                Processing your data...
              </p>
            </div>
          )}

          {importResult && (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="text-sm">
                    <strong>{importResult.success}</strong> imported
                  </span>
                </div>
                {importResult.failed > 0 && (
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-red-600" />
                    <span className="text-sm">
                      <strong>{importResult.failed}</strong> failed
                    </span>
                  </div>
                )}
              </div>

              {importResult.errors.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Errors:</p>
                  <ScrollArea className="h-[150px] rounded-md border p-2">
                    {importResult.errors.map((error, index) => (
                      <div
                        key={index}
                        className="flex items-start gap-2 py-1 text-sm"
                      >
                        <Badge variant="destructive" className="shrink-0 text-xs">
                          Row {error.row}
                        </Badge>
                        <span className="text-muted-foreground">
                          {error.message}
                        </span>
                      </div>
                    ))}
                  </ScrollArea>
                </div>
              )}

              <div className="flex justify-end">
                <Button onClick={closeImportDialog} data-testid="button-close-import">
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
