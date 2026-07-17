import { FileDown, FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exportToCSV, exportToPDF, exportReportToPDF, type ReportPdfOptions } from "@/lib/export-utils";

interface ExportColumn {
  key: string;
  header: string;
}

interface ExportToolbarProps<T extends Record<string, unknown>, P extends Record<string, unknown> = T> {
  data: T[];
  columns: ExportColumn[];
  filename: string;
  title: string;
  disabled?: boolean;
  /**
   * When provided, "Export as PDF" renders the branded report layout instead of the plain
   * grid. Its row shape (P) can differ from the CSV row shape (T) — the PDF report often
   * wants richer/grouped rows than the flat CSV export.
   */
  pdfReport?: Omit<ReportPdfOptions<P>, "filename" | "title">;
  /**
   * The table's current search/filter-narrowed rows (from `DataTable`'s
   * `onVisibleDataChange`). When present and narrower than `data`, adds an "Export current
   * view" item alongside the normal full-dataset export — the default export always stays
   * the full dataset so leftover search text can't silently shrink someone's export.
   */
  visibleData?: T[];
  /** Same idea as `pdfReport`, built from the narrowed rows, for the "current view" PDF. */
  visiblePdfReport?: Omit<ReportPdfOptions<P>, "filename" | "title">;
  /**
   * Overrides "Export as PDF" with a custom renderer (e.g. a financial-statement layout
   * instead of the standard branded table) instead of building one from `pdfReport`.
   */
  onExportPDF?: () => void | Promise<void>;
  /** Same idea as `onExportPDF` but for the "current view" PDF action. */
  onExportFilteredPDF?: () => void | Promise<void>;
}

export function ExportToolbar<T extends Record<string, unknown>, P extends Record<string, unknown> = T>({
  data,
  columns,
  filename,
  title,
  disabled = false,
  pdfReport,
  visibleData,
  visiblePdfReport,
  onExportPDF,
  onExportFilteredPDF,
}: ExportToolbarProps<T, P>) {
  const hasNarrowedView = !!visibleData && visibleData.length !== data.length;

  const handleExportCSV = (rows: T[] = data) => {
    exportToCSV(rows, columns, filename);
  };

  const handleExportPDF = async (filtered = false) => {
    const customHandler = filtered ? (onExportFilteredPDF ?? onExportPDF) : onExportPDF;
    if (customHandler) {
      await customHandler();
      return;
    }
    const report = filtered ? (visiblePdfReport ?? pdfReport) : pdfReport;
    const rows = filtered ? (visibleData ?? data) : data;
    if (report) {
      await exportReportToPDF({ ...report, filename, title });
    } else {
      exportToPDF(rows, columns, title, filename);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || data.length === 0}
          data-testid="button-export"
        >
          <FileDown className="mr-2 h-4 w-4" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleExportCSV()} data-testid="button-export-csv">
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Export as CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExportPDF()} data-testid="button-export-pdf">
          <FileText className="mr-2 h-4 w-4" />
          Export as PDF
        </DropdownMenuItem>
        {hasNarrowedView && (
          <>
            <DropdownMenuItem onClick={() => handleExportCSV(visibleData)} data-testid="button-export-csv-filtered">
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Export current view — CSV ({visibleData!.length})
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExportPDF(true)} data-testid="button-export-pdf-filtered">
              <FileText className="mr-2 h-4 w-4" />
              Export current view — PDF ({visibleData!.length})
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
