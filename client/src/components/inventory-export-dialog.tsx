import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { exportToCSV, exportToPDF } from "@/lib/export-utils";
import {
  buildExportColumnConfig,
  buildInventoryExportRows,
  computeExportOrientation,
  DEFAULT_EXPORT_COLUMN_KEYS,
  INVENTORY_EXPORT_COLUMNS,
  resolveScopeProducts,
  type ExportableProduct,
  type ExportGranularity,
  type ExportScope,
} from "@/lib/inventory-export";

interface InventoryExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeProducts: ExportableProduct[];
  currentViewProducts: ExportableProduct[];
  archivedProducts: ExportableProduct[];
  isLoadingArchived?: boolean;
  selectedIds: (string | number)[];
  currentViewLabel: string;
  isMultiStoreView: boolean;
  lowStockThreshold: number;
  formatCurrency: (value: number) => string;
  storeLabel: string;
}

export function InventoryExportDialog({
  open,
  onOpenChange,
  activeProducts,
  currentViewProducts,
  archivedProducts,
  isLoadingArchived,
  selectedIds,
  currentViewLabel,
  isMultiStoreView,
  lowStockThreshold,
  formatCurrency,
  storeLabel,
}: InventoryExportDialogProps) {
  const { toast } = useToast();
  const [scope, setScope] = useState<ExportScope>("all");
  const [granularity, setGranularity] = useState<ExportGranularity>("item");
  const [format, setFormat] = useState<"csv" | "pdf">("csv");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [landscapeOverride, setLandscapeOverride] = useState<boolean | null>(null);
  const [selectedColumnKeys, setSelectedColumnKeys] = useState<Set<string>>(
    () => new Set(DEFAULT_EXPORT_COLUMN_KEYS)
  );

  const applicableColumns = useMemo(
    () =>
      INVENTORY_EXPORT_COLUMNS.filter((col) => {
        if (col.multiStoreOnly && !isMultiStoreView) return false;
        if (col.variantOnly && granularity !== "variant") return false;
        return true;
      }),
    [isMultiStoreView, granularity]
  );

  const effectiveColumnKeys = useMemo(() => {
    const keys = new Set(selectedColumnKeys);
    if (includeArchived) keys.add("status");
    return keys;
  }, [selectedColumnKeys, includeArchived]);

  const scopedProducts = useMemo(
    () => resolveScopeProducts(scope, { activeProducts, currentViewProducts, selectedIds }),
    [scope, activeProducts, currentViewProducts, selectedIds]
  );

  const rows = useMemo(
    () =>
      buildInventoryExportRows(scopedProducts, includeArchived ? archivedProducts : null, {
        granularity,
        lowStockThreshold,
        formatCurrency,
        isMultiStoreView,
      }),
    [scopedProducts, includeArchived, archivedProducts, granularity, lowStockThreshold, formatCurrency, isMultiStoreView]
  );

  const columnConfig = useMemo(
    () => buildExportColumnConfig(effectiveColumnKeys, granularity, isMultiStoreView),
    [effectiveColumnKeys, granularity, isMultiStoreView]
  );

  const orientation = landscapeOverride === null
    ? computeExportOrientation(columnConfig.length)
    : landscapeOverride ? "landscape" : "portrait";

  const toggleColumn = (key: string, checked: boolean) => {
    setSelectedColumnKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedColumnKeys(new Set(applicableColumns.map((c) => c.key)));
  };

  const handleReset = () => {
    setSelectedColumnKeys(new Set(DEFAULT_EXPORT_COLUMN_KEYS));
  };

  const handleExport = () => {
    if (rows.length === 0 || columnConfig.length === 0) return;
    const filename = `inventory_${storeLabel}_${new Date().toISOString().slice(0, 10)}`.replace(/\s+/g, "_");

    if (format === "csv") {
      exportToCSV(rows, columnConfig, filename);
    } else {
      exportToPDF(rows, columnConfig, "Inventory Report", filename, { orientation });
    }

    toast({
      title: "Export successful",
      description: `${rows.length} row${rows.length !== 1 ? "s" : ""} exported to ${format.toUpperCase()}.`,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="dialog-customize-export">
        <DialogHeader>
          <DialogTitle>Customize Export</DialogTitle>
          <DialogDescription>Choose what to export and how it should look.</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-5">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Scope</Label>
              <RadioGroup value={scope} onValueChange={(v) => setScope(v as ExportScope)}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="all" id="scope-all" data-testid="radio-scope-all" />
                  <Label htmlFor="scope-all" className="font-normal">
                    All items ({activeProducts.length})
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="current-view" id="scope-current-view" data-testid="radio-scope-current-view" />
                  <Label htmlFor="scope-current-view" className="font-normal">
                    Current view ({currentViewProducts.length}, {currentViewLabel})
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem
                    value="selected"
                    id="scope-selected"
                    disabled={selectedIds.length === 0}
                    data-testid="radio-scope-selected"
                  />
                  <Label htmlFor="scope-selected" className={`font-normal ${selectedIds.length === 0 ? "text-muted-foreground" : ""}`}>
                    Selected only ({selectedIds.length})
                  </Label>
                </div>
              </RadioGroup>
              {scope === "current-view" && (
                <p className="text-xs text-muted-foreground">
                  Matches the active tab ({currentViewLabel}). Doesn't include the table's search box or column filters.
                </p>
              )}
            </div>

            <Separator />

            <div className="space-y-2">
              <Label className="text-sm font-medium">Row detail</Label>
              <RadioGroup value={granularity} onValueChange={(v) => setGranularity(v as ExportGranularity)}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="item" id="granularity-item" data-testid="radio-granularity-item" />
                  <Label htmlFor="granularity-item" className="font-normal">
                    One row per item
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="variant" id="granularity-variant" data-testid="radio-granularity-variant" />
                  <Label htmlFor="granularity-variant" className="font-normal">
                    One row per variant (SKU-level detail)
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="include-archived" className="font-normal">
                  Include archived items
                </Label>
                {isLoadingArchived && includeArchived && (
                  <p className="text-xs text-muted-foreground">Loading archived items…</p>
                )}
              </div>
              <Switch
                id="include-archived"
                checked={includeArchived}
                onCheckedChange={setIncludeArchived}
                data-testid="switch-include-archived"
              />
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Columns</Label>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={handleSelectAll} data-testid="button-select-all-columns">
                    Select all
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={handleReset} data-testid="button-reset-columns">
                    Reset
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {applicableColumns.map((col) => {
                  const forced = includeArchived && col.key === "status";
                  return (
                    <div key={col.key} className="flex items-center space-x-2">
                      <Checkbox
                        id={`col-${col.key}`}
                        checked={effectiveColumnKeys.has(col.key)}
                        disabled={forced}
                        onCheckedChange={(checked) => toggleColumn(col.key, checked === true)}
                        data-testid={`checkbox-column-${col.key}`}
                      />
                      <Label htmlFor={`col-${col.key}`} className="font-normal text-sm">
                        {col.header}
                      </Label>
                    </div>
                  );
                })}
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label className="text-sm font-medium">Format</Label>
              <RadioGroup value={format} onValueChange={(v) => setFormat(v as "csv" | "pdf")} className="flex gap-4">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="csv" id="format-csv" data-testid="radio-format-csv" />
                  <Label htmlFor="format-csv" className="font-normal">CSV</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="pdf" id="format-pdf" data-testid="radio-format-pdf" />
                  <Label htmlFor="format-pdf" className="font-normal">PDF</Label>
                </div>
              </RadioGroup>
              {format === "pdf" && (
                <div className="flex items-center justify-between pt-1">
                  <Label htmlFor="landscape-toggle" className="font-normal text-sm text-muted-foreground">
                    Landscape orientation
                  </Label>
                  <Switch
                    id="landscape-toggle"
                    checked={orientation === "landscape"}
                    onCheckedChange={(checked) => setLandscapeOverride(checked)}
                    data-testid="switch-landscape"
                  />
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        <p className="text-sm text-muted-foreground" data-testid="text-export-summary">
          {rows.length} item{rows.length !== 1 ? "s" : ""} · {columnConfig.length} column{columnConfig.length !== 1 ? "s" : ""} will be exported
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-export">
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={rows.length === 0 || columnConfig.length === 0} data-testid="button-confirm-export">
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
