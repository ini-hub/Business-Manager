import { useState } from "react";
import { useSessionState } from "@/hooks/use-session-state";
import { useUrlState } from "@/hooks/use-url-state";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Megaphone, Mail, Plus, AlertCircle, Clock, User, Layers, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/loader";

export default function AnnouncementsManager() {
  const { admin } = useAdminAuth();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useUrlState<string>("tab", "banners");
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Announcement Banner Form
  const [bannerTitle, setBannerTitle] = useSessionState("admin:announcements:bannerTitle", "");
  const [bannerMessage, setBannerMessage] = useSessionState("admin:announcements:bannerMessage", "");
  const [bannerType, setBannerType] = useSessionState("admin:announcements:bannerType", "info");
  const [bannerTarget, setBannerTarget] = useSessionState("admin:announcements:bannerTarget", "all");
  const [bannerTargetOrgId, setBannerTargetOrgId] = useSessionState("admin:announcements:bannerTargetOrgId", "");
  const [bannerShowFrom, setBannerShowFrom] = useSessionState("admin:announcements:bannerShowFrom", "");
  const [bannerShowUntil, setBannerShowUntil] = useSessionState("admin:announcements:bannerShowUntil", "");
  const [bannerDismissible, setBannerDismissible] = useSessionState("admin:announcements:bannerDismissible", true);

  // Email Broadcaster Form
  const [emailTarget, setEmailTarget] = useSessionState("admin:announcements:emailTarget", "all");
  const [emailSubject, setEmailSubject] = useSessionState("admin:announcements:emailSubject", "");
  const [emailBody, setEmailBody] = useSessionState("admin:announcements:emailBody", "");

  // Query Announcements list
  const { data: listData, isLoading, error } = useQuery({
    queryKey: ["/api/admin/announcements"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/announcements");
      return res.json();
    },
  });

  // Create Announcement Banner Mutation
  const createBannerMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await apiRequest("POST", "/api/admin/announcements", payload);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Banner Announcement Dispatched",
        description: "The live notification banner is now broadcasting to target scopes.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/announcements"] });
      setShowCreateDialog(false);
      resetBannerForm();
    },
    onError: (err: any) => {
      toast({
        title: "Dispatch Failed",
        description: err?.message || "Failed to create announcement.",
        variant: "destructive",
      });
    },
  });

  // Delete Announcement Mutation
  const deleteBannerMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/announcements/${id}`);
    },
    onSuccess: () => {
      toast({
        title: "Announcement Retired",
        description: "The banner has been removed and will no longer display.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/announcements"] });
    },
    onError: (err: any) => {
      toast({
        title: "Retire Failed",
        description: err?.message || "Failed to retire announcement.",
        variant: "destructive",
      });
    },
  });

  // Email Broadcaster Mutation
  const emailBroadcastMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await apiRequest("POST", "/api/admin/announcements/broadcast-email", payload);
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Email Broadcast Complete",
        description: `${data.message} Dispatched to ${data.recipientsCount} merchants.`,
      });
      resetEmailForm();
    },
    onError: (err: any) => {
      toast({
        title: "Broadcast Failed",
        description: err?.message || "Failed to dispatch email broadcast.",
        variant: "destructive",
      });
    },
  });

  const resetBannerForm = () => {
    setBannerTitle("");
    setBannerMessage("");
    setBannerType("info");
    setBannerTarget("all");
    setBannerTargetOrgId("");
    setBannerShowFrom("");
    setBannerShowUntil("");
    setBannerDismissible(true);
  };

  const resetEmailForm = () => {
    setEmailTarget("all");
    setEmailSubject("");
    setEmailBody("");
  };

  const handleBannerSubmit = () => {
    if (!bannerTitle || !bannerMessage) {
      toast({
        title: "Fields Required",
        description: "Title and message are required fields.",
        variant: "destructive",
      });
      return;
    }

    const payload: any = {
      title: bannerTitle,
      message: bannerMessage,
      type: bannerType,
      target: bannerTarget,
      targetOrgId: bannerTarget === "specific_org" && bannerTargetOrgId ? bannerTargetOrgId : null,
      dismissible: bannerDismissible,
    };

    if (bannerShowFrom) payload.showFrom = bannerShowFrom;
    if (bannerShowUntil) payload.showUntil = bannerShowUntil;

    createBannerMutation.mutate(payload);
  };

  const handleEmailSubmit = () => {
    if (!emailSubject || !emailBody) {
      toast({
        title: "Fields Required",
        description: "Email subject and body are required fields.",
        variant: "destructive",
      });
      return;
    }

    emailBroadcastMutation.mutate({
      target: emailTarget,
      subject: emailSubject,
      body: emailBody,
    });
  };

  const canManage = admin?.role === "super_admin" || admin?.role === "ops_manager";

  return (
    <div className="space-y-6 font-sans">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold text-foreground tracking-tight">Platform Announcements</h1>
          <p className="text-muted-foreground text-sm mt-1">Broadcast high-impact system alert banners or dispatch simulated informational email campaigns.</p>
        </div>
        {canManage && activeTab === "banners" && (
          <Button
            className="rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold self-start sm:self-auto"
            onClick={() => {
              resetBannerForm();
              setShowCreateDialog(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            New Banner Alert
          </Button>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-background/60 border border-border/80 rounded-2xl p-1 mb-6">
          <TabsTrigger value="banners" className="rounded-xl px-5 py-3 text-xs font-bold text-muted-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Megaphone className="h-4 w-4 mr-2" />
            Banner Broadcasts
          </TabsTrigger>
          <TabsTrigger value="email" className="rounded-xl px-5 py-3 text-xs font-bold text-muted-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Mail className="h-4 w-4 mr-2" />
            Simulated Email Broadcaster
          </TabsTrigger>
        </TabsList>

        {/* 1. BANNERS TAB */}
        <TabsContent value="banners" className="space-y-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : error || !listData?.announcements ? (
            <div className="p-6 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-2xl text-rose-700 dark:text-rose-300 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>Failed to fetch active announcements from backend ledger.</span>
            </div>
          ) : listData.announcements.length === 0 ? (
            <div className="text-center py-16 bg-card/20 border border-border/80 rounded-2xl">
              <Megaphone className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-bold text-foreground text-base">No Announcements Broadcasted</h3>
              <p className="text-xs text-muted-foreground mt-1">Initialize alert banners for system maintenance or software updates.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 animate-in fade-in duration-300">
              {listData.announcements.map((ann: any) => {
                let badgeColor = "bg-sky-100 dark:bg-sky-950/40 text-sky-800 dark:text-sky-400";
                if (ann.type === "warning") badgeColor = "bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400";
                else if (ann.type === "maintenance") badgeColor = "bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-400";
                else if (ann.type === "update") badgeColor = "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-400";

                return (
                  <Card key={ann.id} className="bg-card/40 border-border/80 rounded-2xl overflow-hidden hover:border-border/80 transition-all duration-300 shadow-xl flex flex-col md:flex-row items-stretch">
                    <div className="p-6 flex-1 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className={`border-none text-[11px] font-bold uppercase py-0.5 px-2 rounded-md ${badgeColor}`}>
                            {ann.type}
                          </Badge>
                          <Badge variant="outline" className="border-border bg-background/60 text-muted-foreground text-[11px] py-0.5 px-2 rounded-md font-semibold">
                            Scope: {ann.target === "specific_org" ? `Org (${ann.targetOrgId})` : ann.target}
                          </Badge>
                          {ann.dismissible && (
                            <Badge variant="outline" className="border-none bg-muted text-muted-foreground text-[11px] py-0.5 px-2 rounded-md">
                              Dismissible
                            </Badge>
                          )}
                        </div>
                        {canManage && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-border text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg p-2 h-auto"
                            onClick={() => deleteBannerMutation.mutate(ann.id)}
                            disabled={deleteBannerMutation.isPending}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>

                      <h3 className="text-base font-bold text-foreground">{ann.title}</h3>
                      <p className="text-muted-foreground text-xs leading-relaxed font-semibold">{ann.message}</p>

                      <div className="pt-3 border-t border-border/40 flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] text-muted-foreground">
                        <div className="flex items-center gap-2 font-medium">
                          <User className="h-3.5 w-3.5" />
                          <span>Author: {ann.createdBy || "System"}</span>
                        </div>
                        <div className="flex items-center gap-2 font-medium">
                          <Clock className="h-3.5 w-3.5" />
                          <span>From: {new Date(ann.showFrom).toLocaleDateString()}</span>
                        </div>
                        <div className="flex items-center gap-2 font-medium">
                          <Clock className="h-3.5 w-3.5" />
                          <span>Until: {new Date(ann.showUntil).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* 2. EMAIL TAB */}
        <TabsContent value="email" className="max-w-2xl animate-in fade-in duration-300">
          <Card className="bg-card/40 border border-border/80 rounded-2xl shadow-xl overflow-hidden">
            <CardHeader className="bg-background/20 p-6 border-b border-border/40">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-violet-100 dark:bg-violet-950/40 text-violet-800 dark:text-violet-400">
                  <Mail className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base font-bold text-foreground">Simulated Email Broadcast</CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">
                    Compile message details to log or simulate dispatching a HTML newsletter directly to your merchant segments.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Target Merchant Segment</Label>
                  <Select value={emailTarget} onValueChange={setEmailTarget}>
                    <SelectTrigger className="bg-background border-border text-foreground rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border text-muted-foreground">
                      <SelectItem value="all">All Registered Merchants</SelectItem>
                      <SelectItem value="trial">Standard Trial Segment</SelectItem>
                      <SelectItem value="growth">Growth Segment</SelectItem>
                      <SelectItem value="scale">Scale Segment</SelectItem>
                      <SelectItem value="enterprise">Enterprise Segment</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Broadcast Subject</Label>
                  <Input
                    placeholder="e.g. Schedule Maintenance: Server Upgrade on Sunday"
                    className="bg-background border-border text-foreground rounded-xl"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">HTML / Text Email Body</Label>
                <Textarea
                  placeholder="Dear Store Owners, We are updating our database engines..."
                  className="bg-background border-border text-foreground rounded-xl min-h-[160px] font-semibold text-xs leading-relaxed"
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                />
              </div>

              <div className="pt-4 border-t border-border/40 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground font-medium">
                  <Layers className="h-4 w-4 text-primary" />
                  <span>Emails will be logged inside database simulated outputs.</span>
                </div>
                <Button
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-xl px-5"
                  onClick={handleEmailSubmit}
                  disabled={emailBroadcastMutation.isPending || !canManage}
                >
                  {emailBroadcastMutation.isPending ? (
                    <>
                      <Spinner className="mr-2 h-5 w-5 animate-spin" />
                      Dispatching...
                    </>
                  ) : (
                    <>
                      <Mail className="mr-2 h-4 w-4" />
                      Broadcast Email
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Creation Modal for Banner */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="bg-card border border-border text-muted-foreground max-w-md rounded-2xl p-6">
          <DialogHeader className="space-y-3">
            <DialogTitle className="text-lg font-bold text-foreground">Create Broadcast Banner</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Mount an in-app banner immediately visible in the merchant dashboards.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 my-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Announcement Title</Label>
                <span className="text-[11px] text-muted-foreground">{bannerTitle.length}/80</span>
              </div>
              <Input
                placeholder="e.g. Scheduled Network Operations"
                className="bg-background border-border text-foreground rounded-xl"
                maxLength={80}
                value={bannerTitle}
                onChange={(e) => setBannerTitle(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Banner Alert Message</Label>
                <span className="text-[11px] text-muted-foreground">{bannerMessage.length}/150</span>
              </div>
              <Textarea
                placeholder="Alert text content visible to users..."
                className="bg-background border-border text-foreground rounded-xl min-h-[70px] text-xs"
                maxLength={150}
                value={bannerMessage}
                onChange={(e) => setBannerMessage(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Visual Severity</Label>
                <Select value={bannerType} onValueChange={setBannerType}>
                  <SelectTrigger className="bg-background border-border text-foreground rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border text-muted-foreground">
                    <SelectItem value="info">Info (Sky Blue)</SelectItem>
                    <SelectItem value="update">Update (Emerald Green)</SelectItem>
                    <SelectItem value="warning">Warning (Amber Orange)</SelectItem>
                    <SelectItem value="maintenance">Maintenance (Rose Red)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Target Segment</Label>
                <Select value={bannerTarget} onValueChange={setBannerTarget}>
                  <SelectTrigger className="bg-background border-border text-foreground rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border text-muted-foreground">
                    <SelectItem value="all">All Businesses</SelectItem>
                    <SelectItem value="trial">Trial Accounts</SelectItem>
                    <SelectItem value="growth">Growth Accounts</SelectItem>
                    <SelectItem value="specific_org">Specific Organisation ID</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {bannerTarget === "specific_org" && (
              <div className="space-y-2 animate-in slide-in-from-top-2 duration-250">
                <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Organisation ID (UUID)</Label>
                <Input
                  placeholder="e.g. 748b9a3d-..."
                  className="bg-background border-border text-foreground rounded-xl font-mono text-xs"
                  value={bannerTargetOrgId}
                  onChange={(e) => setBannerTargetOrgId(e.target.value)}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Display From (Optional)</Label>
                <Input
                  type="datetime-local"
                  className="bg-background border-border text-foreground rounded-xl text-xs"
                  value={bannerShowFrom}
                  onChange={(e) => setBannerShowFrom(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Display Until (Optional)</Label>
                <Input
                  type="datetime-local"
                  className="bg-background border-border text-foreground rounded-xl text-xs"
                  value={bannerShowUntil}
                  onChange={(e) => setBannerShowUntil(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between p-3 bg-background/60 rounded-2xl border border-border">
              <div className="space-y-0.5">
                <Label className="text-xs font-bold text-foreground">Merchant Dismissible</Label>
                <span className="block text-[11px] text-muted-foreground">Allow users to permanently close this notification.</span>
              </div>
              <Switch checked={bannerDismissible} onCheckedChange={setBannerDismissible} />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="rounded-xl border-border text-muted-foreground hover:bg-muted"
              onClick={() => setShowCreateDialog(false)}
            >
              Cancel
            </Button>
            <Button
              className="rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold"
              onClick={handleBannerSubmit}
              disabled={
                createBannerMutation.isPending ||
                !bannerTitle.trim() ||
                !bannerMessage.trim() ||
                bannerTitle.length > 80 ||
                bannerMessage.length > 150
              }
            >
              Broadcast Alert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
