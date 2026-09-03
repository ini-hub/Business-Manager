import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  MessageSquareWarning,
  Loader2,
  AlertCircle,
  CheckCircle2,
  RotateCcw,
  Building2,
  Mail,
  Clock,
  Send,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { isGenuineSuspensionReason } from "@shared/schema";

type ThreadSummary = {
  id: string;
  reason: string;
  status: "open" | "resolved";
  createdAt: string;
  lastMessageAt: string;
  lastMessageBySenderType: "user" | "admin";
  resolvedAt: string | null;
  resolutionOutcome: "reactivated" | "suspension_upheld" | null;
  organisationId: string;
  organisationName: string;
  organisationStatus: string;
  organisationSuspensionReason: string | null;
  userName: string | null;
  userEmail: string | null;
  unreadForAdmin: boolean;
};

type ThreadMessage = {
  id: string;
  senderType: "user" | "admin";
  body: string;
  createdAt: string;
};

const REASON_LABELS: Record<string, string> = {
  general: "General inquiry",
  policy_violation: "Policy violation",
  fraudulent_activity: "Fraudulent activity",
  owner_request: "Owner request",
  inactivity: "Inactivity",
  non_payment: "Non-payment",
  trial_expired: "Trial expired",
  other: "Other",
};

const POLL_MS = 12000;

function ThreadDetail({ threadId }: { threadId: string }) {
  const { toast } = useToast();
  const [reply, setReply] = useState("");
  const [showReactivateDialog, setShowReactivateDialog] = useState(false);
  const [showCloseUpheldDialog, setShowCloseUpheldDialog] = useState(false);

  const { data, isLoading } = useQuery<{ thread: ThreadSummary; messages: ThreadMessage[] }>({
    queryKey: ["/api/admin/support-threads", threadId, "messages"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/support-threads/${threadId}/messages`);
      return res.json();
    },
    refetchInterval: POLL_MS,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/support-threads"] });
  };

  const replyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/support-threads/${threadId}/messages`, { message: reply });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to send reply");
      return body;
    },
    onSuccess: () => {
      setReply("");
      invalidateAll();
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't send reply", description: err.message, variant: "destructive" });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/support-threads/${threadId}/resolve`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to resolve thread");
      return body;
    },
    onSuccess: () => {
      toast({ title: "Marked as resolved" });
      invalidateAll();
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't resolve thread", description: err.message, variant: "destructive" });
    },
  });

  const reactivateAndResolveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/support-threads/${threadId}/reactivate-and-resolve`, {});
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to reactivate and resolve");
      return body;
    },
    onSuccess: () => {
      toast({ title: "Business reactivated and thread resolved" });
      setShowReactivateDialog(false);
      invalidateAll();
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't reactivate and resolve", description: err.message, variant: "destructive" });
    },
  });

  const closeUpheldMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/support-threads/${threadId}/close-upheld`, {});
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to close thread");
      return body;
    },
    onSuccess: () => {
      toast({ title: "Thread closed — business remains suspended" });
      setShowCloseUpheldDialog(false);
      invalidateAll();
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't close thread", description: err.message, variant: "destructive" });
    },
  });

  const reopenMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/support-threads/${threadId}/reopen`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to reopen thread");
      return body;
    },
    onSuccess: () => {
      toast({ title: "Reopened" });
      invalidateAll();
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't reopen thread", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-violet-600 dark:text-violet-400" />
      </div>
    );
  }

  if (!data) return null;
  const { thread, messages } = data;
  const stillSuspended = isGenuineSuspensionReason(thread.reason) && thread.organisationStatus === "suspended";
  const hasAdminReply = messages.some((m) => m.senderType === "admin");

  return (
    <>
    <Card className="bg-card/40 border-border/80 rounded-3xl overflow-hidden shadow-xl flex flex-col h-full">
      <div className="p-4 border-b border-border/60 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-none bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400 text-[9px] font-extrabold uppercase py-0.5 px-2 rounded-md">
            {REASON_LABELS[thread.reason] || thread.reason}
          </Badge>
          {stillSuspended && (
            <Badge variant="outline" className="border-none bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-400 text-[9px] font-extrabold uppercase py-0.5 px-2 rounded-md">
              Still suspended
            </Badge>
          )}
          {thread.resolutionOutcome === "reactivated" && (
            <Badge variant="outline" className="border-none bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-400 text-[9px] font-extrabold uppercase py-0.5 px-2 rounded-md">
              Reactivated
            </Badge>
          )}
          {thread.resolutionOutcome === "suspension_upheld" && (
            <Badge variant="outline" className="border-none bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400 text-[9px] font-extrabold uppercase py-0.5 px-2 rounded-md">
              Suspension upheld
            </Badge>
          )}
          <span className="text-xs text-muted-foreground font-medium">{thread.organisationName} — {thread.userName || thread.userEmail}</span>
        </div>
        {thread.status === "open" ? (
          stillSuspended ? (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                onClick={() => setShowReactivateDialog(true)}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Reactivate &amp; Resolve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl border-border text-muted-foreground hover:bg-muted"
                disabled={!hasAdminReply}
                title={!hasAdminReply ? "Reply to the owner first" : undefined}
                onClick={() => setShowCloseUpheldDialog(true)}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Close — keep suspended
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              className="rounded-xl bg-violet-500 hover:bg-violet-600 text-white font-bold"
              disabled={resolveMutation.isPending}
              onClick={() => resolveMutation.mutate()}
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Mark resolved
            </Button>
          )
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="rounded-xl border-border text-muted-foreground hover:bg-muted"
            disabled={reopenMutation.isPending}
            onClick={() => reopenMutation.mutate()}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Reopen
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[420px]">
        {messages.map((m) => {
          const isAdmin = m.senderType === "admin";
          return (
            <div key={m.id} className={`flex flex-col ${isAdmin ? "items-end" : "items-start"}`}>
              <div
                className={`rounded-2xl px-3 py-2 text-sm max-w-[80%] whitespace-pre-wrap break-words ${
                  isAdmin ? "bg-violet-500 text-white rounded-br-sm" : "bg-muted text-foreground rounded-bl-sm"
                }`}
              >
                {m.body}
              </div>
              <span className="text-[10px] text-muted-foreground mt-0.5 px-1">{new Date(m.createdAt).toLocaleString()}</span>
            </div>
          );
        })}
      </div>

      <div className="p-4 border-t border-border/60 flex gap-2">
        <Textarea
          placeholder="Type a reply..."
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          className="bg-background border-border text-foreground rounded-xl min-h-[44px] flex-1"
        />
        <Button
          className="rounded-xl bg-violet-500 hover:bg-violet-600 text-white font-bold self-end"
          disabled={!reply.trim() || replyMutation.isPending}
          onClick={() => replyMutation.mutate()}
        >
          {replyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </Card>

    <Dialog open={showReactivateDialog} onOpenChange={setShowReactivateDialog}>
      <DialogContent className="max-w-md rounded-3xl p-6">
        <DialogHeader>
          <DialogTitle>Reactivate business &amp; resolve thread</DialogTitle>
          <DialogDescription>
            This lifts {thread.organisationName}'s suspension immediately (same as the Businesses directory's Reactivate action) and marks this conversation resolved. The owner regains access right away.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="rounded-xl" onClick={() => setShowReactivateDialog(false)}>Cancel</Button>
          <Button
            className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
            disabled={reactivateAndResolveMutation.isPending}
            onClick={() => reactivateAndResolveMutation.mutate()}
          >
            {reactivateAndResolveMutation.isPending ? "Reactivating..." : "Confirm & Reactivate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={showCloseUpheldDialog} onOpenChange={setShowCloseUpheldDialog}>
      <DialogContent className="max-w-md rounded-3xl p-6">
        <DialogHeader>
          <DialogTitle>Close thread — keep business suspended</DialogTitle>
          <DialogDescription>
            {thread.organisationName} stays suspended. Make sure your reply above already explained why before closing — the owner won't be prompted again unless they message you first.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="rounded-xl" onClick={() => setShowCloseUpheldDialog(false)}>Cancel</Button>
          <Button
            variant="destructive"
            className="rounded-xl font-bold"
            disabled={closeUpheldMutation.isPending}
            onClick={() => closeUpheldMutation.mutate()}
          >
            {closeUpheldMutation.isPending ? "Closing..." : "Confirm — Keep Suspended"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

export default function SupportInbox() {
  const [tab, setTab] = useState<"open" | "resolved">("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: threads, isLoading, error } = useQuery<ThreadSummary[]>({
    queryKey: ["/api/admin/support-threads", tab],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/support-threads?status=${tab}`);
      return res.json();
    },
    refetchInterval: POLL_MS,
  });

  return (
    <div className="space-y-6 font-sans">
      <div>
        <h1 className="text-3xl font-extrabold text-foreground tracking-tight font-outfit">Support Inbox</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Conversations from locked-out owners with no pay-to-unlock path, and general Help & Support requests.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => { setTab(v as "open" | "resolved"); setSelectedId(null); }} className="w-full">
        <TabsList className="bg-background/60 border border-border/80 rounded-2xl p-1 mb-6">
          <TabsTrigger value="open" className="rounded-xl px-5 py-2.5 text-xs font-bold text-muted-foreground data-[state=active]:bg-violet-500 data-[state=active]:text-white">
            <MessageSquareWarning className="h-4 w-4 mr-2" />
            Open
          </TabsTrigger>
          <TabsTrigger value="resolved" className="rounded-xl px-5 py-2.5 text-xs font-bold text-muted-foreground data-[state=active]:bg-violet-500 data-[state=active]:text-white">
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Resolved
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-2 space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-violet-600 dark:text-violet-400" />
            </div>
          ) : error ? (
            <div className="p-6 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-2xl text-rose-700 dark:text-rose-300 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>Failed to load support threads.</span>
            </div>
          ) : !threads || threads.length === 0 ? (
            <div className="text-center py-16 bg-card/20 border border-border/80 rounded-3xl">
              <MessageSquareWarning className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-bold text-foreground text-base">
                {tab === "open" ? "No open conversations" : "No resolved conversations yet"}
              </h3>
            </div>
          ) : (
            threads.map((t) => (
              <Card
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={`bg-card/40 border-border/80 rounded-2xl overflow-hidden shadow-xl cursor-pointer transition-colors hover:border-violet-500/50 ${
                  selectedId === t.id ? "border-violet-500/70" : ""
                }`}
              >
                <div className="p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="border-none bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400 text-[9px] font-extrabold uppercase py-0.5 px-2 rounded-md">
                        {REASON_LABELS[t.reason] || t.reason}
                      </Badge>
                      {isGenuineSuspensionReason(t.reason) && t.organisationStatus === "suspended" && (
                        <Badge variant="outline" className="border-none bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-400 text-[9px] font-extrabold uppercase py-0.5 px-2 rounded-md">
                          Still suspended
                        </Badge>
                      )}
                    </div>
                    {t.unreadForAdmin && <span className="h-2 w-2 rounded-full bg-violet-500 shrink-0" />}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                    <Building2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{t.organisationName}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Mail className="h-3 w-3 shrink-0" />
                    <span className="truncate">{t.userName || t.userEmail || "Unknown user"}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <Clock className="h-3 w-3 shrink-0" />
                    <span>{new Date(t.lastMessageAt).toLocaleString()}</span>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>

        <div className="lg:col-span-3">
          {selectedId ? (
            <ThreadDetail key={selectedId} threadId={selectedId} />
          ) : (
            <div className="text-center py-16 bg-card/20 border border-border/80 rounded-3xl h-full flex flex-col items-center justify-center">
              <MessageSquareWarning className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-bold text-foreground text-base">Select a conversation</h3>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
