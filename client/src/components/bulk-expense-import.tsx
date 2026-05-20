import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, FileText, CheckCircle2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store-context";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { bulkUploadApi } from "@/services/BulkUploadApiService";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function BulkExpenseImport({ categories }: { categories: any[] }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const { currentStore } = useStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      const maxSize = 5 * 1024 * 1024; // 5MB
      if (selectedFile.size > maxSize) {
        toast({
          title: "File too large",
          description: "CSV files must be smaller than 5MB.",
          variant: "destructive"
        });
        e.target.value = ""; // clear input
        return;
      }
      setFile(selectedFile);
      parseCSV(selectedFile);
    }
  };

  const parseCSV = (file: File) => {
    setIsParsing(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split("\n");
      const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
      
      const items = lines.slice(1).filter(l => l.trim()).map(line => {
        const values = line.split(",").map(v => v.trim());
        const item: any = {};
        headers.forEach((header, index) => {
          item[header] = values[index];
        });

        // Try to match category name to ID
        if (item.category) {
          const cat = categories.find(c => c.name.toLowerCase() === item.category.toLowerCase());
          if (cat) item.categoryId = cat.id;
        }

        return item;
      });
      
      setPreview(items);
      setIsParsing(false);
    };
    reader.readAsText(file);
  };

  const importMutation = useMutation({
    mutationFn: (expenses: any[]) => bulkUploadApi.uploadExpenses(expenses, currentStore!.id),
    onSuccess: (data) => {
      toast({ 
        title: "Import Complete", 
        description: `Successfully imported ${data.success} expenses. ${data.failed} failed.` 
      });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses", currentStore?.id] });
      setOpen(false);
      setFile(null);
      setPreview([]);
    },
    onError: (error: Error) => {
      toast({ title: "Import Failed", description: error.message, variant: "destructive" });
    }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="mr-2 h-4 w-4" /> Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Bulk Expense Import</DialogTitle>
          <DialogDescription>
            Upload a CSV file with headers: description, amount, category (name), date (YYYY-MM-DD), notes
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden py-4">
          {!file ? (
            <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer relative">
              <input 
                type="file" 
                accept=".csv" 
                onChange={handleFileChange} 
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
              <FileText className="h-10 w-10 text-muted-foreground mb-2" />
              <p className="text-sm font-medium">Click to upload or drag and drop</p>
              <p className="text-xs text-muted-foreground">CSV files only (Max size 5MB)</p>
            </div>
          ) : isParsing ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-2">Parsing CSV...</span>
            </div>
          ) : (
            <div className="space-y-4 h-full flex flex-col">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  {file.name} ({preview.length} expenses found)
                </div>
                <Button variant="ghost" size="sm" onClick={() => { setFile(null); setPreview([]); }}>
                  Remove
                </Button>
              </div>
              
              <ScrollArea className="flex-1 border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.slice(0, 50).map((item, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{item.description}</TableCell>
                        <TableCell>
                          {item.category} 
                          {!item.categoryId && <span className="ml-1 text-xs text-red-500 font-bold">(Invalid)</span>}
                        </TableCell>
                        <TableCell className="text-right">{item.amount}</TableCell>
                        <TableCell>{item.date}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button 
            disabled={!preview.length || importMutation.isPending || preview.some(p => !p.categoryId)} 
            onClick={() => importMutation.mutate(preview)}
          >
            {importMutation.isPending ? "Importing..." : "Start Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
