import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Megaphone,
  Mail,
  Plus,
  Loader2,
  AlertCircle,
  Clock,
  User,
  Layers,
  CheckCircle,
  Eye,
  Trash2,
} from "lucide-react";
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

export default function AnnouncementsManager() {
  const { admin } = useAdminAuth();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState("banners");
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Announcement Banner Form
  const [bannerTitle, setBannerTitle] = useState("");
  const [bannerMessage, setBannerMessage] = useState("");
  const [bannerType, setBannerType] = useState("info");
  const [bannerTarget, setBannerTarget] = useState("all");
  const [bannerTargetOrgId, setBannerTargetOrgId] = useState("");
  const [bannerShowFrom, setBannerShowFrom] = useState("");
  const [bannerShowUntil, setBannerShowUntil] = useState("");
  const [bannerDismissible, setBannerDismissible] = useState(true);

  // Email Broadcaster Form
  const [emailTarget, setEmailTarget] = useState("all");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");

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
          <h1 className="text-3xl font-extrabold text-white tracking-tight font-outfit">Platform Announcements</h1>
          <p className="text-slate-400 text-sm mt-1">Broadcast high-impact system alert banners or dispatch simulated informational email campaigns.</p>
        </div>
        {canManage && activeTab === "banners" && (
          <Button
            className="rounded-xl bg-violet-500 hover:bg-violet-600 text-white font-bold self-start sm:self-auto"
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
        <TabsList className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-1 mb-6">
          <TabsTrigger value="banners" className="rounded-xl px-5 py-2.5 text-xs font-bold text-slate-400 data-[state=active]:bg-violet-500 data-[state=active]:text-white">
            <Megaphone className="h-4 w-4 mr-2" />
            Banner Broadcasts
          </TabsTrigger>
          <TabsTrigger value="email" className="rounded-xl px-5 py-2.5 text-xs font-bold text-slate-400 data-[state=active]:bg-violet-500 data-[state=active]:text-white">
            <Mail className="h-4 w-4 mr-2" />
            Simulated Email Broadcaster
          </TabsTrigger>
        </TabsList>

        {/* 1. BANNERS TAB */}
        <TabsContent value="banners" className="space-y-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
            </div>
          ) : error || !listData?.announcements ? (
            <div className="p-6 bg-rose-500/15 border border-rose-500/20 rounded-2xl text-rose-300 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>Failed to fetch active announcements from backend ledger.</span>
            </div>
          ) : listData.announcements.length === 0 ? (
            <div className="text-center py-16 bg-slate-900/20 border border-slate-800/80 rounded-3xl">
              <Megaphone className="h-10 w-10 text-slate-600 mx-auto mb-3" />
              <h3 className="font-bold text-white text-base">No Announcements Broadcasted</h3>
              <p className="text-xs text-slate-500 mt-1">Initialize alert banners for system maintenance or software updates.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 animate-in fade-in duration-300">
              {listData.announcements.map((ann: any) => {
                let badgeColor = "bg-sky-500/10 text-sky-400";
                if (ann.type === "warning") badgeColor = "bg-amber-500/10 text-amber-400";
                else if (ann.type === "maintenance") badgeColor = "bg-rose-500/10 text-rose-400";
                else if (ann.type === "update") badgeColor = "bg-emerald-500/10 text-emerald-400";

                return (
                  <Card key={ann.id} className="bg-slate-900/40 border-slate-800/80 rounded-3xl overflow-hidden hover:border-slate-700/80 transition-all duration-300 shadow-xl flex flex-col md:flex-row items-stretch">
                    <div className="p-6 flex-1 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className={`border-none text-[9px] font-extrabold uppercase py-0.5 px-2 rounded-md ${badgeColor}`}>
                            {ann.type}
                          </Badge>
                          <Badge variant="outline" className="border-slate-800 bg-slate-950/60 text-slate-400 text-[9px] py-0.5 px-2 rounded-md font-semibold">
                            Scope: {ann.target === "specific_org" ? `Org (${ann.targetOrgId})` : ann.target}
                          </Badge>
                          {ann.dismissible && (
                            <Badge variant="outline" className="border-none bg-slate-850 text-slate-500 text-[9px] py-0.5 px-2 rounded-md">
                              Dismissible
                            </Badge>
                          )}
                        </div>
                        {canManage && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-slate-800 text-rose-400 hover:bg-rose-950/40 rounded-lg p-2 h-auto"
                            onClick={() => deleteBannerMutation.mutate(ann.id)}
                            disabled={deleteBannerMutation.isPending}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>

                      <h3 className="text-base font-extrabold text-white font-outfit">{ann.title}</h3>
                      <p className="text-slate-300 text-xs leading-relaxed font-semibold">{ann.message}</p>

                      <div className="pt-3 border-t border-slate-800/40 flex flex-wrap items-center gap-x-6 gap-y-2 text-[10px] text-slate-500">
                        <div className="flex items-center gap-1.5 font-medium">
                          <User className="h-3.5 w-3.5" />
                          <span>Author: {ann.createdBy || "System"}</span>
                        </div>
                        <div className="flex items-center gap-1.5 font-medium">
                          <Clock className="h-3.5 w-3.5" />
                          <span>From: {new Date(ann.showFrom).toLocaleDateString()}</span>
                        </div>
                        <div className="flex items-center gap-1.5 font-medium">
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
          <Card className="bg-slate-900/40 border border-slate-800/80 rounded-3xl shadow-xl overflow-hidden">
            <CardHeader className="bg-slate-950/20 p-6 border-b border-slate-800/40">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-violet-500/10 text-violet-400">
                  <Mail className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base font-extrabold text-white font-outfit">Simulated Email Broadcast</CardTitle>
                  <CardDescription className="text-xs text-slate-400">
                    Compile message details to log or simulate dispatching a HTML newsletter directly to your merchant segments.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Target Merchant Segment</Label>
                  <Select value={emailTarget} onValueChange={setEmailTarget}>
                    <SelectTrigger className="bg-slate-950 border-slate-800 text-white rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-900 border-slate-800 text-slate-300">
                      <SelectItem value="all">All Registered Merchants</SelectItem>
                      <SelectItem value="trial">Standard Trial Segment</SelectItem>
                      <SelectItem value="growth">Growth Segment</SelectItem>
                      <SelectItem value="scale">Scale Segment</SelectItem>
                      <SelectItem value="enterprise">Enterprise Segment</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Broadcast Subject</Label>
                  <Input
                    placeholder="e.g. Schedule Maintenance: Server Upgrade on Sunday"
                    className="bg-slate-950 border-slate-800 text-white rounded-xl"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">HTML / Text Email Body</Label>
                <Textarea
                  placeholder="Dear Store Owners, We are updating our database engines..."
                  className="bg-slate-950 border-slate-800 text-white rounded-xl min-h-[160px] font-semibold text-xs leading-relaxed"
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                />
              </div>

              <div className="pt-4 border-t border-slate-800/40 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-[10px] text-slate-500 font-medium">
                  <Layers className="h-4 w-4 text-violet-400" />
                  <span>Emails will be logged inside database simulated outputs.</span>
                </div>
                <Button
                  className="bg-violet-500 hover:bg-violet-600 text-white font-bold rounded-xl px-5"
                  onClick={handleEmailSubmit}
                  disabled={emailBroadcastMutation.isPending || !canManage}
                >
                  {emailBroadcastMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
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
        <DialogContent className="bg-slate-900 border border-slate-800 text-slate-300 max-w-md rounded-3xl p-6">
          <DialogHeader className="space-y-3">
            <DialogTitle className="text-lg font-bold text-white font-outfit">Create Broadcast Banner</DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Mount an in-app banner immediately visible in the merchant dashboards.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 my-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Announcement Title</Label>
                <span className="text-[9px] text-slate-500">{bannerTitle.length}/80</span>
              </div>
              <Input
                placeholder="e.g. Scheduled Network Operations"
                className="bg-slate-950 border-slate-800 text-white rounded-xl"
                maxLength={80}
                value={bannerTitle}
                onChange={(e) => setBannerTitle(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Banner Alert Message</Label>
                <span className="text-[9px] text-slate-500">{bannerMessage.length}/150</span>
              </div>
              <Textarea
                placeholder="Alert text content visible to users..."
                className="bg-slate-950 border-slate-800 text-white rounded-xl min-h-[70px] text-xs"
                maxLength={150}
                value={bannerMessage}
                onChange={(e) => setBannerMessage(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Visual Severity</Label>
                <Select value={bannerType} onValueChange={setBannerType}>
                  <SelectTrigger className="bg-slate-950 border-slate-800 text-white rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-800 text-slate-300">
                    <SelectItem value="info">Info (Sky Blue)</SelectItem>
                    <SelectItem value="update">Update (Emerald Green)</SelectItem>
                    <SelectItem value="warning">Warning (Amber Orange)</SelectItem>
                    <SelectItem value="maintenance">Maintenance (Rose Red)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Target Segment</Label>
                <Select value={bannerTarget} onValueChange={setBannerTarget}>
                  <SelectTrigger className="bg-slate-950 border-slate-800 text-white rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-800 text-slate-300">
                    <SelectItem value="all">All Businesses</SelectItem>
                    <SelectItem value="trial">Trial Accounts</SelectItem>
                    <SelectItem value="growth">Growth Accounts</SelectItem>
                    <SelectItem value="specific_org">Specific Organisation ID</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {bannerTarget === "specific_org" && (
              <div className="space-y-1.5 animate-in slide-in-from-top-2 duration-250">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Organisation ID (UUID)</Label>
                <Input
                  placeholder="e.g. 748b9a3d-..."
                  className="bg-slate-950 border-slate-800 text-white rounded-xl font-mono text-xs"
                  value={bannerTargetOrgId}
                  onChange={(e) => setBannerTargetOrgId(e.target.value)}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Display From (Optional)</Label>
                <Input
                  type="datetime-local"
                  className="bg-slate-950 border-slate-800 text-white rounded-xl text-xs"
                  value={bannerShowFrom}
                  onChange={(e) => setBannerShowFrom(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Display Until (Optional)</Label>
                <Input
                  type="datetime-local"
                  className="bg-slate-950 border-slate-800 text-white rounded-xl text-xs"
                  value={bannerShowUntil}
                  onChange={(e) => setBannerShowUntil(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between p-3 bg-slate-950/60 rounded-2xl border border-slate-850">
              <div className="space-y-0.5">
                <Label className="text-xs font-bold text-white">Merchant Dismissible</Label>
                <span className="block text-[9px] text-slate-500">Allow users to permanently close this notification.</span>
              </div>
              <Switch checked={bannerDismissible} onCheckedChange={setBannerDismissible} />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="rounded-xl border-slate-800 text-slate-400 hover:bg-slate-800"
              onClick={() => setShowCreateDialog(false)}
            >
              Cancel
            </Button>
            <Button
              className="rounded-xl bg-violet-500 hover:bg-violet-600 text-white font-bold"
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
