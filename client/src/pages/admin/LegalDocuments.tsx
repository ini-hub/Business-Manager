import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { FileText, Loader2, AlertCircle, History, Eye, Save, Plus, ExternalLink, Archive, RotateCcw, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { LegalDocumentViewer } from "@/components/legal-document-viewer";
import { legalDocHref } from "@/lib/legal-docs";

interface LegalDocumentRow {
  documentType: string;
  title: string;
  contentMarkdown: string;
  versionNumber: number;
  publishedAt: string;
  publishedByAdminId: string | null;
  archivedAt: string | null;
}

interface LegalDocumentVersionRow {
  id: string;
  versionNumber: number;
  createdAt: string;
  supersededAt: string | null;
  isCurrent: boolean;
}

function slugify(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

function AddSectionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [contentMarkdown, setContentMarkdown] = useState("");

  const reset = () => {
    setTitle("");
    setDocumentType("");
    setSlugEdited(false);
    setContentMarkdown("");
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/legal-documents", { documentType, title, contentMarkdown });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Section added",
        description: `"${data.title}" is now live at ${legalDocHref(data.documentType)} and shown on every consent screen.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/legal-documents"] });
      onOpenChange(false);
      reset();
    },
    onError: (err: any) => {
      toast({
        title: "Could not add section",
        description: err?.message || "Failed to create new section.",
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a new legal section</DialogTitle>
          <DialogDescription>
            Creates a new document beyond Terms, Privacy, and Data Usage - e.g. a Cookie Policy. Every
            new signup and every existing user will be asked to accept it too.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Title</Label>
            <Input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (!slugEdited) setDocumentType(slugify(e.target.value));
              }}
              placeholder="e.g. Cookie Policy"
              data-testid="input-new-section-title"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Identifier (used in the URL — lowercase, underscores only)
            </Label>
            <Input
              value={documentType}
              onChange={(e) => {
                setSlugEdited(true);
                setDocumentType(e.target.value.toLowerCase());
              }}
              placeholder="e.g. cookie_policy"
              className="font-mono text-xs"
              data-testid="input-new-section-slug"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Content (Markdown)</Label>
            <Textarea
              value={contentMarkdown}
              onChange={(e) => setContentMarkdown(e.target.value)}
              className="min-h-[200px] font-mono text-xs leading-relaxed"
              data-testid="textarea-new-section-content"
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!title.trim() || !documentType.trim() || !contentMarkdown.trim() || createMutation.isPending}
            data-testid="button-create-section"
          >
            {createMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Adding...
              </>
            ) : (
              "Add Section"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocumentEditor({ document }: { document: LegalDocumentRow }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState(document.contentMarkdown);
  const [showPreview, setShowPreview] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isArchived = !!document.archivedAt;

  const historyQuery = useQuery<{ versions: LegalDocumentVersionRow[] }>({
    queryKey: [`/api/admin/legal-documents/${document.documentType}/versions`],
    enabled: showHistory,
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/admin/legal-documents/${document.documentType}`, {
        contentMarkdown: draft,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Version published",
        description: "Every user's prior acceptance is now stale - they'll be asked to accept again on next login.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/legal-documents"] });
      queryClient.invalidateQueries({ queryKey: [`/api/admin/legal-documents/${document.documentType}/versions`] });
      setConfirmPublish(false);
    },
    onError: (err: any) => {
      toast({
        title: "Publish failed",
        description: err?.message || "Failed to publish new version.",
        variant: "destructive",
      });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/legal-documents/${document.documentType}/archive`);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Section deactivated",
        description: `"${document.title}" is no longer shown or required for consent. Its history is kept - you can reactivate it any time.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/legal-documents"] });
      setConfirmArchive(false);
    },
    onError: (err: any) => {
      toast({ title: "Could not deactivate", description: err?.message || "Please try again.", variant: "destructive" });
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/legal-documents/${document.documentType}/reactivate`);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Section reactivated",
        description: `"${document.title}" is live again - every user will be asked to accept it on next login.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/legal-documents"] });
    },
    onError: (err: any) => {
      toast({ title: "Could not reactivate", description: err?.message || "Please try again.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/admin/legal-documents/${document.documentType}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Section deleted", description: `"${document.title}" has been permanently removed.` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/legal-documents"] });
      setConfirmDelete(false);
    },
    onError: (err: any) => {
      toast({
        title: "Could not delete",
        description: err?.message || "Please try again.",
        variant: "destructive",
      });
      setConfirmDelete(false);
    },
  });

  const isDirty = draft.trim() !== document.contentMarkdown.trim();

  return (
    <div className="space-y-4">
      {isArchived && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40">
          <span className="text-xs text-amber-800 dark:text-amber-300">
            Deactivated {new Date(document.archivedAt!).toLocaleString()} — not shown publicly, and no longer required for consent.
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => reactivateMutation.mutate()}
            disabled={reactivateMutation.isPending}
            data-testid={`button-reactivate-${document.documentType}`}
          >
            {reactivateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 mr-1.5" />}
            Reactivate
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] font-bold">v{document.versionNumber}</Badge>
          <span className="text-xs text-muted-foreground">
            Published {new Date(document.publishedAt).toLocaleString()}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowHistory(true)} data-testid={`button-history-${document.documentType}`}>
            <History className="h-3.5 w-3.5 mr-1.5" />
            Version history
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowPreview(true)} data-testid={`button-preview-${document.documentType}`}>
            <Eye className="h-3.5 w-3.5 mr-1.5" />
            Preview
          </Button>
          {!isArchived && (
            <Button
              size="sm"
              variant="outline"
              className="text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40"
              onClick={() => setConfirmArchive(true)}
              data-testid={`button-archive-${document.documentType}`}
            >
              <Archive className="h-3.5 w-3.5 mr-1.5" />
              Deactivate
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
            onClick={() => setConfirmDelete(true)}
            data-testid={`button-delete-${document.documentType}`}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Delete
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Content (Markdown)</Label>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={isArchived}
          className="min-h-[360px] font-mono text-xs leading-relaxed"
          data-testid={`textarea-content-${document.documentType}`}
        />
      </div>

      <div className="flex justify-end">
        <Button
          onClick={() => setConfirmPublish(true)}
          disabled={isArchived || !isDirty || !draft.trim() || publishMutation.isPending}
          data-testid={`button-publish-${document.documentType}`}
        >
          <Save className="h-4 w-4 mr-2" />
          Publish New Version
        </Button>
      </div>

      {/* Preview dialog - same renderer end users and the super-admin see */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{document.title} — Preview</DialogTitle>
            <DialogDescription>Renders the content currently in the editor, exactly as a user would see it.</DialogDescription>
          </DialogHeader>
          <LegalDocumentViewer contentMarkdown={draft} />
        </DialogContent>
      </Dialog>

      {/* Version history dialog */}
      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{document.title} — Version history</DialogTitle>
          </DialogHeader>
          {historyQuery.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {historyQuery.data?.versions.map((v) => (
                <div key={v.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                  <div>
                    <span className="font-semibold">Version {v.versionNumber}</span>
                    {v.isCurrent && <Badge className="ml-2 text-[9px]">Current</Badge>}
                    <div className="text-xs text-muted-foreground">{new Date(v.createdAt).toLocaleString()}</div>
                  </div>
                  {v.supersededAt && (
                    <span className="text-[10px] text-muted-foreground">
                      Superseded {new Date(v.supersededAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Publish confirmation - this is the one write, and it makes every prior acceptance stale */}
      <Dialog open={confirmPublish} onOpenChange={setConfirmPublish}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Publish version {document.versionNumber + 1}?</DialogTitle>
            <DialogDescription>
              This immediately replaces the live document. Every user who already accepted the current
              version will be asked to accept again the next time they log in.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmPublish(false)}>Cancel</Button>
            <Button onClick={() => publishMutation.mutate()} disabled={publishMutation.isPending}>
              {publishMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Publishing...
                </>
              ) : (
                "Publish"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deactivate confirmation - reversible, keeps every version and acceptance record */}
      <Dialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Deactivate "{document.title}"?</DialogTitle>
            <DialogDescription>
              It will stop appearing on the public page, the signup form, and the login consent screen,
              and nobody will be asked to accept it going forward. Nothing is deleted — you can reactivate
              it at any time, and its version history and every past acceptance stay intact.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmArchive(false)}>Cancel</Button>
            <Button
              variant="outline"
              className="text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800"
              onClick={() => archiveMutation.mutate()}
              disabled={archiveMutation.isPending}
            >
              {archiveMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deactivating...
                </>
              ) : (
                "Deactivate"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation - only actually succeeds server-side if nobody has ever accepted this document */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Permanently delete "{document.title}"?</DialogTitle>
            <DialogDescription>
              This removes the document and its entire version history. It's only allowed if nobody has
              ever accepted it — if any user already has, deactivate it instead. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete Permanently"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function LegalDocuments() {
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [showAddSection, setShowAddSection] = useState(false);

  const { data, isLoading, error } = useQuery<{ documents: LegalDocumentRow[] }>({
    queryKey: ["/api/admin/legal-documents"],
  });

  const documents = data?.documents ?? [];
  const currentTab = activeTab && documents.some((d) => d.documentType === activeTab)
    ? activeTab
    : documents[0]?.documentType;

  return (
    <div className="space-y-6 font-sans">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-foreground tracking-tight font-outfit flex items-center gap-2.5">
            <FileText className="h-7 w-7 text-violet-500" />
            Legal Documents
          </h1>
          <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
            Author and publish every document users must consent to - Terms and Conditions, Privacy
            Policy, and Data Usage Policy by default, plus any further section you add below. Publishing
            a new version, or adding a section, requires every user to accept it again.
          </p>
        </div>
        <Button
          className="rounded-xl bg-violet-500 hover:bg-violet-600 text-white font-bold self-start"
          onClick={() => setShowAddSection(true)}
          data-testid="button-add-legal-section"
        >
          <Plus className="mr-2 h-4 w-4" />
          Add New Section
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-violet-600 dark:text-violet-400" />
        </div>
      ) : error || !data ? (
        <div className="p-6 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-2xl text-rose-700 dark:text-rose-300 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>Failed to load legal documents.</span>
        </div>
      ) : documents.length === 0 ? (
        <div className="text-center py-16 bg-card/20 border border-border/80 rounded-3xl">
          <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-bold text-foreground text-base">No legal documents yet</h3>
          <p className="text-xs text-muted-foreground mt-1">Add a section to get started.</p>
        </div>
      ) : (
        <Tabs value={currentTab} onValueChange={setActiveTab}>
          <TabsList className="bg-background/60 border border-border/80 rounded-2xl p-1 mb-6 flex-wrap h-auto">
            {documents.map((doc) => (
              <TabsTrigger
                key={doc.documentType}
                value={doc.documentType}
                className="rounded-xl px-4 py-2.5 text-xs font-bold text-muted-foreground data-[state=active]:bg-violet-500 data-[state=active]:text-white"
              >
                {doc.title}
                {doc.archivedAt && <span className="ml-1.5 opacity-60">(deactivated)</span>}
              </TabsTrigger>
            ))}
          </TabsList>

          {documents.map((doc) => (
            <TabsContent key={doc.documentType} value={doc.documentType}>
              <Card className="bg-card/40 border border-border/80 rounded-3xl shadow-xl overflow-hidden">
                <CardHeader className="bg-background/20 p-6 border-b border-border/40">
                  <CardTitle className="text-base font-extrabold text-foreground font-outfit flex items-center gap-2">
                    {doc.title}
                    {doc.archivedAt && (
                      <Badge variant="outline" className="text-[9px] font-bold uppercase text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800">
                        Deactivated
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground flex items-center gap-1.5">
                    Shown publicly at{" "}
                    <a
                      href={legalDocHref(doc.documentType)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 underline hover:text-foreground"
                    >
                      {legalDocHref(doc.documentType)}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                    , and on the signup and login consent screens.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-6">
                  <DocumentEditor document={doc} />
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      )}

      <AddSectionDialog open={showAddSection} onOpenChange={setShowAddSection} />
    </div>
  );
}
