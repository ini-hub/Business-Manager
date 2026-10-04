import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Upload, Trash2, LayoutGrid, List as ListIcon, FileText } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Folder { id: string; key: string; label: string }
interface DocumentRow { id: string; folderId: string; fileName: string; fileMimeType: string; uploadedAt: string }

export function DocumentsTab({ staffId }: { staffId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [view, setView] = useState<"grid" | "list">("grid");
  const [folderId, setFolderId] = useState<string>("");
  const docsUrl = `/api/hr/staff/${staffId}/documents`;

  const { data: folders = [] } = useQuery<Folder[]>({ queryKey: ["/api/hr/document-folders"], queryFn: async () => (await apiRequest("GET", "/api/hr/document-folders")).json() });
  const { data: documents = [], isLoading } = useQuery<DocumentRow[]>({ queryKey: [docsUrl], queryFn: async () => (await apiRequest("GET", docsUrl)).json() });

  const activeFolder = folderId || folders[0]?.id;

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const { uploadUrl, storageKey } = await (await apiRequest("POST", "/api/hr/documents/upload-url", { fileName: file.name, mimeType: file.type })).json();
      await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      await apiRequest("POST", docsUrl, { folderId: activeFolder, fileName: file.name, storageKey, fileMimeType: file.type, fileSizeBytes: file.size });
    },
    onSuccess: () => {
      toast({ title: "Document uploaded" });
      queryClient.invalidateQueries({ queryKey: [docsUrl] });
    },
    onError: (error) => toast({ variant: "destructive", title: "Upload failed", description: getUserFriendlyError(error) }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `${docsUrl}/${id}`),
    onSuccess: () => {
      toast({ title: "Document removed" });
      queryClient.invalidateQueries({ queryKey: [docsUrl] });
    },
  });

  const visibleDocs = documents.filter((d) => !activeFolder || d.folderId === activeFolder);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <Select value={activeFolder ?? ""} onValueChange={setFolderId}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Folder" /></SelectTrigger>
          <SelectContent>{folders.map((f) => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}</SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Button size="icon" variant={view === "grid" ? "secondary" : "ghost"} onClick={() => setView("grid")}><LayoutGrid className="h-4 w-4" /></Button>
          <Button size="icon" variant={view === "list" ? "secondary" : "ghost"} onClick={() => setView("list")}><ListIcon className="h-4 w-4" /></Button>
          <label className="inline-flex items-center gap-2 text-sm border rounded-md px-3 py-2 cursor-pointer hover:bg-accent">
            <Upload className="h-3.5 w-3.5" /> Upload
            <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
          </label>
        </div>
      </div>

      {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : view === "grid" ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {visibleDocs.map((d) => (
            <Card key={d.id}>
              <CardContent className="pt-4 flex flex-col items-center text-center gap-2">
                <FileText className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm truncate w-full">{d.fileName}</p>
                <Button size="icon" variant="ghost" onClick={() => remove.mutate(d.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="divide-y border rounded-md">
          {visibleDocs.map((d) => (
            <div key={d.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground" />{d.fileName}</span>
              <Button size="icon" variant="ghost" onClick={() => remove.mutate(d.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
            </div>
          ))}
        </div>
      )}
      {visibleDocs.length === 0 && !isLoading && <p className="text-sm text-muted-foreground">No documents in this folder yet.</p>}
    </div>
  );
}
