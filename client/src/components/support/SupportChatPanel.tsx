import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Send, ShieldCheck } from "lucide-react";
import type { SupportThread, SupportThreadMessage } from "@shared/schema";

type ThreadResponse = {
  thread: SupportThread | null;
  messages: SupportThreadMessage[];
  isResolved: boolean;
};

/**
 * A persistent, per-user chat with "Support" - the client never tracks a
 * thread id, it only ever posts a message; the server finds-or-creates the
 * caller's open thread (server/routes/support.routes.ts). Reused identically
 * on the Paywall lockout screen and the general Help & Support page. Live
 * updates arrive via the "support" resource key in useRealtimeSync - no
 * polling needed here.
 */
export function SupportChatPanel() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [message, setMessage] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery<ThreadResponse>({
    queryKey: ["/api/support/thread"],
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/support/messages", { message });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to send message");
      return body;
    },
    onSuccess: () => {
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ["/api/support/thread"] });
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't send your message", description: err.message, variant: "destructive" });
    },
  });

  const messages = data?.messages ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Card className="max-w-md mx-auto text-left flex flex-col">
      <CardContent className="p-4 space-y-3">
        {data?.isResolved && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted rounded-md p-2">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            This conversation was resolved. Sending a message below starts a new one.
          </div>
        )}

        {messages.length > 0 && (
          <div className="flex flex-col gap-2 max-h-80 overflow-y-auto pr-1">
            {messages.map((m) => {
              const isUser = m.senderType === "user";
              return (
                <div key={m.id} className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
                  {!isUser && <span className="text-[10px] font-medium text-muted-foreground mb-0.5 px-1">Support</span>}
                  <div
                    className={`rounded-2xl px-3 py-2 text-sm max-w-[85%] whitespace-pre-wrap break-words ${
                      isUser ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted rounded-bl-sm"
                    }`}
                  >
                    {m.body}
                  </div>
                  <span className="text-[10px] text-muted-foreground mt-0.5 px-1">
                    {new Date(m.createdAt).toLocaleString()}
                  </span>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}

        {messages.length === 0 && !data?.isResolved && (
          <p className="text-sm text-muted-foreground">
            {user?.name ? `Hi ${user.name.split(" ")[0]}, ` : ""}send us a message and we'll get back to you as soon as possible.
          </p>
        )}

        <Textarea
          placeholder="Type a message..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="min-h-[80px]"
          data-testid="input-support-chat-message"
        />
        <Button
          className="w-full gap-2"
          disabled={!message.trim() || sendMutation.isPending}
          onClick={() => sendMutation.mutate()}
          data-testid="button-send-support-chat-message"
        >
          {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send
        </Button>
      </CardContent>
    </Card>
  );
}
