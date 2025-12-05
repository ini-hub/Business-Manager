import { FileDown, FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exportToCSV, exportToPDF } from "@/lib/export-utils";

interface ExportColumn {
  key: string;
  header: string;
}

interface ExportToolbarProps<T extends Record<string, unknown>> {
  data: T[];
  columns: ExportColumn[];
  filename: string;
  title: string;
  disabled?: boolean;
}

export function ExportToolbar<T extends Record<string, unknown>>({
  data,
  columns,
  filename,
  title,
  disabled = false,
}: ExportToolbarProps<T>) {
  const handleExportCSV = () => {
    exportToCSV(data, columns, filename);
  };

  const handleExportPDF = () => {
    exportToPDF(data, columns, title, filename);
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
        <DropdownMenuItem onClick={handleExportCSV} data-testid="button-export-csv">
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Export as CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExportPDF} data-testid="button-export-pdf">
          <FileText className="mr-2 h-4 w-4" />
          Export as PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
