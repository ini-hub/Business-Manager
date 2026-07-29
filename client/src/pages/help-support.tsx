import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/page-header";
import { SupportChatPanel } from "@/components/support/SupportChatPanel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Mail, MessageCircle, CheckCircle2 } from "lucide-react";

function EmailSupportForm() {
  const { toast } = useToast();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/support/email", { subject, message });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to send email");
      return body;
    },
    onSuccess: () => {
      setSent(true);
      setSubject("");
      setMessage("");
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't send your email", description: err.message, variant: "destructive" });
    },
  });

  if (sent) {
    return (
      <Card className="max-w-md mx-auto">
        <CardContent className="p-6 text-center space-y-2">
          <CheckCircle2 className="h-8 w-8 text-primary mx-auto" />
          <p className="font-medium">Email sent</p>
          <p className="text-sm text-muted-foreground">
            We'll reply directly to your email address as soon as possible.
          </p>
          <Button variant="outline" size="sm" onClick={() => setSent(false)}>
            Send another
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-md mx-auto">
      <CardContent className="p-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          We'll reply straight to your own inbox - no need to check back here.
        </p>
        <Input
          placeholder="Subject (optional)"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          data-testid="input-support-email-subject"
        />
        <Textarea
          placeholder="Describe what you need help with..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="min-h-[120px]"
          data-testid="input-support-email-message"
        />
        <Button
          className="w-full gap-2"
          disabled={!message.trim() || sendMutation.isPending}
          onClick={() => sendMutation.mutate()}
          data-testid="button-send-support-email"
        >
          {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
          Send email
        </Button>
      </CardContent>
    </Card>
  );
}

export default function HelpSupportPage() {
  const [mode, setMode] = useState<"chat" | "email">("chat");

  return (
    <div className="space-y-6">
      <PageHeader title="Help & Support" description="Chat with us in real time, or send an email if you'd rather not wait around." />

      <div className="flex justify-center">
        <Tabs value={mode} onValueChange={(v) => setMode(v as "chat" | "email")}>
          <TabsList>
            <TabsTrigger value="chat" className="gap-2" data-testid="tab-support-chat">
              <MessageCircle className="h-4 w-4" />
              Chat with support
            </TabsTrigger>
            <TabsTrigger value="email" className="gap-2" data-testid="tab-support-email">
              <Mail className="h-4 w-4" />
              Email us
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {mode === "chat" ? <SupportChatPanel /> : <EmailSupportForm />}
    </div>
  );
}
