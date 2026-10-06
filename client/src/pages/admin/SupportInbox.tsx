import { useEffect, useMemo, useRef, useState } from "react";
import { useUrlState } from "@/hooks/use-url-state";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  MessageSquareWarning,
  Loader2,
  AlertCircle,
  CheckCircle2,
  RotateCcw,
  Mail,
  Send,
  Search,
  ArrowLeft,
  Inbox,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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

const PILL = "border-none text-[10px] font-semibold uppercase tracking-wide py-0.5 px-1.5 rounded-md";
const PILL_AMBER = `${PILL} bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400`;
const PILL_ROSE = `${PILL} bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-400`;
const PILL_GREEN = `${PILL} bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-400`;
const PILL_VIOLET = `${PILL} bg-primary/10 text-primary`;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function ThreadDetail({ threadId, onBack }: { threadId: string; onBack: () => void }) {
  const { toast } = useToast();
  const [reply, setReply] = useState("");
  const [showReactivateDialog, setShowReactivateDialog] = useState(false);
  const [showCloseUpheldDialog, setShowCloseUpheldDialog] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery<{ thread: ThreadSummary; messages: ThreadMessage[] }>({
    queryKey: ["/api/admin/support-threads", threadId, "messages"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/support-threads/${threadId}/messages`);
      return res.json();
    },
    refetchInterval: POLL_MS,
  });

  const messageCount = data?.messages.length ?? 0;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messageCount]);

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
      <div className="flex h-full items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!data) return null;
  const { thread, messages } = data;
  const stillSuspended = isGenuineSuspensionReason(thread.reason) && thread.organisationStatus === "suspended";
  const hasAdminReply = messages.some((m) => m.senderType === "admin");
  const isOpen = thread.status === "open";

  const send = () => {
    if (reply.trim() && !replyMutation.isPending) replyMutation.mutate();
  };

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b border-border/60 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <Button variant="ghost" size="icon" className="lg:hidden -ml-2 h-8 w-8 shrink-0" onClick={onBack} aria-label="Back to inbox">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="h-10 w-10 shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold">
              {initials(thread.organisationName)}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-bold text-foreground truncate leading-tight">{thread.organisationName}</h2>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 truncate mt-0.5">
                <Mail className="h-3 w-3 shrink-0" />
                <span className="truncate">
                  {thread.userName || "Unknown user"}
                  {thread.userEmail && thread.userName ? ` · ${thread.userEmail}` : thread.userEmail && !thread.userName ? thread.userEmail : ""}
                </span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className={PILL_AMBER}>{REASON_LABELS[thread.reason] || thread.reason}</Badge>
              {stillSuspended && <Badge variant="outline" className={PILL_ROSE}>Still suspended</Badge>}
              {thread.resolutionOutcome === "reactivated" && <Badge variant="outline" className={PILL_GREEN}>Reactivated</Badge>}
              {thread.resolutionOutcome === "suspension_upheld" && <Badge variant="outline" className={PILL_AMBER}>Suspension upheld</Badge>}
            </div>
            <div className="flex flex-wrap gap-2">
              {isOpen ? (
                stillSuspended ? (
                  <>
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setShowReactivateDialog(true)}>
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Reactivate &amp; resolve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!hasAdminReply}
                      title={!hasAdminReply ? "Reply to the owner first" : undefined}
                      onClick={() => setShowCloseUpheldDialog(true)}
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Close — keep suspended
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    disabled={resolveMutation.isPending}
                    onClick={() => resolveMutation.mutate()}
                  >
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Mark resolved
                  </Button>
                )
              ) : (
                <Button size="sm" variant="outline" disabled={reopenMutation.isPending} onClick={() => reopenMutation.mutate()}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Reopen
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto bg-muted/20 px-4 py-4 space-y-1.5">
          {messages.map((m, i) => {
            const isAdmin = m.senderType === "admin";
            const prev = messages[i - 1];
            const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
            const newSender = !prev || prev.senderType !== m.senderType || newDay;
            return (
              <div key={m.id}>
                {newDay && (
                  <div className="flex items-center gap-3 py-3">
                    <div className="h-px flex-1 bg-border/60" />
                    <span className="text-[11px] font-medium text-muted-foreground">{dayLabel(m.createdAt)}</span>
                    <div className="h-px flex-1 bg-border/60" />
                  </div>
                )}
                <div className={`flex flex-col ${isAdmin ? "items-end" : "items-start"} ${newSender && !newDay ? "pt-2" : ""}`}>
                  <div
                    className={`rounded-2xl px-3.5 py-2 text-sm max-w-[85%] sm:max-w-[75%] whitespace-pre-wrap break-words ${
                      isAdmin ? "bg-primary text-primary-foreground rounded-br-md" : "bg-card border border-border/70 text-foreground rounded-bl-md"
                    }`}
                  >
                    {m.body}
                  </div>
                  <span className="text-[10px] text-muted-foreground mt-0.5 px-1">
                    {isAdmin ? "You · " : ""}
                    {new Date(m.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </span>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-border/60 p-3">
          <div className="flex items-end gap-2">
            <Textarea
              placeholder={isOpen ? "Write a reply…  (Ctrl/⌘ + Enter to send)" : "Reopen this conversation to reply"}
              value={reply}
              disabled={!isOpen}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  send();
                }
              }}
              className="bg-background border-border text-foreground rounded-xl min-h-[44px] max-h-40 flex-1 resize-none"
              rows={2}
            />
            <Button
              size="icon"
              className="h-11 w-11 shrink-0 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground"
              disabled={!isOpen || !reply.trim() || replyMutation.isPending}
              onClick={send}
              aria-label="Send reply"
            >
              {replyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={showReactivateDialog} onOpenChange={setShowReactivateDialog}>
        <DialogContent className="max-w-md rounded-2xl p-6">
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
        <DialogContent className="max-w-md rounded-2xl p-6">
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

function ThreadRow({ t, selected, onSelect }: { t: ThreadSummary; selected: boolean; onSelect: () => void }) {
  const suspended = isGenuineSuspensionReason(t.reason) && t.organisationStatus === "suspended";
  const awaitingReply = t.status === "open" && t.lastMessageBySenderType === "user";
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left flex gap-3 px-4 py-3 border-b border-border/50 transition-colors hover:bg-muted/50 ${
        selected ? "bg-primary/5 border-l-2 border-l-primary" : "border-l-2 border-l-transparent"
      }`}
    >
      <div className="relative shrink-0">
        <div className="h-10 w-10 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-sm font-bold">
          {initials(t.organisationName)}
        </div>
        {t.unreadForAdmin && <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-primary ring-2 ring-background" />}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`truncate text-sm ${t.unreadForAdmin ? "font-bold text-foreground" : "font-semibold text-foreground/90"}`}>
            {t.organisationName}
          </span>
          <span className="text-[11px] text-muted-foreground shrink-0">{relativeTime(t.lastMessageAt)}</span>
        </div>
        <p className="truncate text-xs text-muted-foreground">{t.userName || t.userEmail || "Unknown user"}</p>
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant="outline" className={PILL_AMBER}>{REASON_LABELS[t.reason] || t.reason}</Badge>
          {suspended && <Badge variant="outline" className={PILL_ROSE}>Suspended</Badge>}
          {awaitingReply && <Badge variant="outline" className={PILL_VIOLET}>Awaiting reply</Badge>}
          {t.resolutionOutcome === "reactivated" && <Badge variant="outline" className={PILL_GREEN}>Reactivated</Badge>}
        </div>
      </div>
    </button>
  );
}

export default function SupportInbox() {
  const [tab, setTab] = useUrlState<"open" | "resolved">("tab", "open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { data: threads, isLoading, error } = useQuery<ThreadSummary[]>({
    queryKey: ["/api/admin/support-threads", tab],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/support-threads?status=${tab}`);
      return res.json();
    },
    refetchInterval: POLL_MS,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!threads) return [];
    if (!q) return threads;
    return threads.filter((t) =>
      [t.organisationName, t.userName, t.userEmail, REASON_LABELS[t.reason] ?? t.reason]
        .some((v) => v?.toLowerCase().includes(q)),
    );
  }, [threads, search]);

  const unreadCount = threads?.filter((t) => t.unreadForAdmin).length ?? 0;

  return (
    <div className="space-y-4 font-sans">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold text-foreground tracking-tight">Support Inbox</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Locked-out owners with no pay-to-unlock path, and general Help &amp; Support requests.
          </p>
        </div>
        {unreadCount > 0 && (
          <Badge variant="outline" className={`${PILL_VIOLET} text-xs py-1 px-2.5`}>
            {unreadCount} unread
          </Badge>
        )}
      </div>

      <div className="rounded-2xl border border-border/80 bg-card/40 shadow-sm overflow-hidden grid grid-cols-1 lg:grid-cols-[360px_1fr] h-[calc(100vh-14rem)] min-h-[520px]">
        <div className={`${selectedId ? "hidden lg:flex" : "flex"} min-h-0 flex-col border-r border-border/60`}>
          <div className="p-3 space-y-3 border-b border-border/60">
            <Tabs
              value={tab}
              onValueChange={(v) => {
                setTab(v as "open" | "resolved");
                setSelectedId(null);
              }}
            >
              <TabsList className="grid w-full grid-cols-2 bg-muted/60 rounded-xl p-1 h-auto">
                <TabsTrigger value="open" className="rounded-lg py-2 text-xs font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  <Inbox className="h-3.5 w-3.5 mr-1.5" />
                  Open
                </TabsTrigger>
                <TabsTrigger value="resolved" className="rounded-lg py-2 text-xs font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                  Resolved
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search business, person or reason"
                className="pl-9 rounded-xl bg-background"
              />
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : error ? (
              <div className="m-3 p-4 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-xl text-rose-700 dark:text-rose-300 flex items-center gap-3 text-sm">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <span>Failed to load support threads.</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16 px-4">
                <MessageSquareWarning className="h-9 w-9 text-muted-foreground mx-auto mb-3" />
                <h3 className="font-semibold text-foreground text-sm">
                  {search.trim() ? "No matches" : tab === "open" ? "Inbox zero" : "No resolved conversations yet"}
                </h3>
                {!search.trim() && tab === "open" && (
                  <p className="text-xs text-muted-foreground mt-1">No open conversations right now.</p>
                )}
              </div>
            ) : (
              filtered.map((t) => <ThreadRow key={t.id} t={t} selected={selectedId === t.id} onSelect={() => setSelectedId(t.id)} />)
            )}
          </div>
        </div>

        <div className={`${selectedId ? "flex" : "hidden lg:flex"} min-h-0 flex-col`}>
          {selectedId ? (
            <ThreadDetail key={selectedId} threadId={selectedId} onBack={() => setSelectedId(null)} />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
              <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mb-3">
                <MessageSquareWarning className="h-7 w-7 text-muted-foreground" />
              </div>
              <h3 className="font-semibold text-foreground">Select a conversation</h3>
              <p className="text-sm text-muted-foreground mt-1">Pick a thread on the left to read and reply.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
