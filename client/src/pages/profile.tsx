import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useStore } from "@/lib/store-context";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, type ApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput, PasswordChecklist } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { User, Lock, Camera, Shield, CheckCircle2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deduplicatedCountryCodes, validatePhoneNumber } from "@/lib/phone-utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { PolymorphicTabsList, TabItem } from "@/components/oop-ui/PolymorphicTabsList";
import { getUserFriendlyError } from "@/lib/error-utils";

export default function ProfilePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  
  // Profile Form State
  const [name, setName] = useState(user?.name || "");
  const [photoUrl, setPhotoUrl] = useState(user?.profilePhotoUrl || "");

  // Password Form State
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isPasswordValid, setIsPasswordValid] = useState(false);

  // Email Change Form State
  const [emailChangeStep, setEmailChangeStep] = useState<"idle" | "enter_new_email" | "verify_otp">("idle");
  const [newEmail, setNewEmail] = useState("");
  const [emailChangePassword, setEmailChangePassword] = useState("");
  const [emailChangeOtp, setEmailChangeOtp] = useState("");
  const [emailChangeResendCooldown, setEmailChangeResendCooldown] = useState(0);

  // Phone Change Form State - mirrors email change, phone is only ever
  // updated through this OTP-verified flow, never via Save Changes below.
  const [phoneChangeStep, setPhoneChangeStep] = useState<"idle" | "enter_new_phone" | "verify_otp">("idle");
  const [newPhoneCountryCode, setNewPhoneCountryCode] = useState("+234");
  const [newPhoneNumber, setNewPhoneNumber] = useState("");
  const [phoneChangePassword, setPhoneChangePassword] = useState("");
  const [phoneChangeOtp, setPhoneChangeOtp] = useState("");
  const [phoneChangeResendCooldown, setPhoneChangeResendCooldown] = useState(0);
  const [smsUnavailableOpen, setSmsUnavailableOpen] = useState(false);

  useEffect(() => {
    if (emailChangeResendCooldown <= 0) return;
    const timer = setTimeout(() => setEmailChangeResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [emailChangeResendCooldown]);

  useEffect(() => {
    if (phoneChangeResendCooldown <= 0) return;
    const timer = setTimeout(() => setPhoneChangeResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [phoneChangeResendCooldown]);

  const updateProfileMutation = useMutation({
    mutationFn: (data: { name: string; profilePhotoUrl: string }) =>
      apiRequest("PATCH", "/api/auth/user/profile", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "Profile updated successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Update Failed",
        description: getUserFriendlyError(error),
        variant: "destructive"
      });
    }
  });

  const changePasswordMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/auth/user/change-password", data),
    onSuccess: () => {
      toast({ title: "Password changed successfully" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (error: Error) => {
      toast({ 
        title: "Change Password Failed", 
        description: getUserFriendlyError(error), 
        variant: "destructive" 
      });
    }
  });

  const requestEmailChangeMutation = useMutation({
    mutationFn: (data: { newEmail: string; currentPassword: string }) =>
      apiRequest("POST", "/api/auth/user/change-email", data),
    onSuccess: () => {
      toast({ title: "Code sent", description: `A verification code was sent to ${newEmail}.` });
      setEmailChangeStep("verify_otp");
      setEmailChangeResendCooldown(60);
    },
    onError: (error: Error) => {
      toast({
        title: "Could Not Start Email Change",
        description: getUserFriendlyError(error),
        variant: "destructive",
      });
    }
  });

  const verifyEmailChangeMutation = useMutation({
    mutationFn: (data: { otp: string }) =>
      apiRequest("POST", "/api/auth/user/verify-email-change", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "Email address updated successfully" });
      setEmailChangeStep("idle");
      setNewEmail("");
      setEmailChangePassword("");
      setEmailChangeOtp("");
    },
    onError: (error: Error) => {
      toast({
        title: "Verification Failed",
        description: getUserFriendlyError(error),
        variant: "destructive",
      });
    }
  });

  const requestPhoneChangeMutation = useMutation({
    mutationFn: (data: { newPhone: string; phoneCountryCode: string; currentPassword: string }) =>
      apiRequest("POST", "/api/auth/user/change-phone", data),
    onSuccess: () => {
      toast({ title: "Code sent", description: `A verification code was sent to your new phone number.` });
      setPhoneChangeStep("verify_otp");
      setPhoneChangeResendCooldown(60);
    },
    onError: (error: ApiError) => {
      if (error.code === "SMS_UNAVAILABLE") {
        setSmsUnavailableOpen(true);
        return;
      }
      toast({
        title: "Could Not Start Phone Number Change",
        description: getUserFriendlyError(error),
        variant: "destructive",
      });
    }
  });

  const verifyPhoneChangeMutation = useMutation({
    mutationFn: (data: { otp: string }) =>
      apiRequest("POST", "/api/auth/user/verify-phone-change", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "Phone number updated successfully" });
      setPhoneChangeStep("idle");
      setNewPhoneNumber("");
      setPhoneChangePassword("");
      setPhoneChangeOtp("");
    },
    onError: (error: Error) => {
      toast({
        title: "Verification Failed",
        description: getUserFriendlyError(error),
        variant: "destructive",
      });
    }
  });

  const handlePasswordChange = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPasswordValid) {
      toast({
        title: "Invalid Password",
        description: "Your new password does not meet the security checklist requirements.",
        variant: "destructive",
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    changePasswordMutation.mutate({ currentPassword, newPassword });
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <PageHeader 
        title="My Profile" 
        description="Manage your account settings and preferences"
      />

      <div className="grid gap-6 md:grid-cols-[250px_1fr]">
        <div className="space-y-6">
          <Card className="overflow-hidden border-primary/10 shadow-md">
            <div className="h-24 bg-gradient-to-br from-primary/20 to-primary/5" />
            <CardContent className="pt-0 -mt-12 text-center pb-6">
              <div className="relative inline-block group">
                <Avatar className="h-24 w-24 border-4 border-background shadow-xl">
                  <AvatarImage src={user?.profilePhotoUrl || ""} />
                  <AvatarFallback className="bg-primary/10 text-primary text-2xl font-bold">
                    {user?.name?.charAt(0) || user?.email?.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                  <Camera className="h-6 w-6 text-white" />
                </div>
              </div>
              <h3 className="mt-4 font-bold text-lg">{user?.name || "User"}</h3>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
              <Badge className="mt-2 capitalize" variant="outline">
                <Shield className="mr-1 h-3 w-3" />
                {user?.role}
              </Badge>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Tabs defaultValue="general" className="w-full">
            <PolymorphicTabsList
              tabs={[
                { value: "general", label: "General Information" },
                { value: "security", label: "Security & Password" },
              ]}
              variant="default"
              className="mb-6"
            />

            <TabsContent value="general" className="space-y-6 mt-0 border-none p-0">
              <Card id="general" className="border-primary/10">
                <CardHeader>
                  <CardTitle>Personal Information</CardTitle>
                  <CardDescription>Update your personal details and display photo</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-2">
                    <Label htmlFor="email">Email Address</Label>
                    <div className="flex items-center gap-2">
                      <Input id="email" value={user?.email || ""} disabled className="bg-muted" />
                      {user?.isVerified && <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />}
                    </div>

                    {emailChangeStep === "idle" && (
                      user?.pendingEmail ? (
                        <div className="text-xs text-amber-600 flex items-center gap-1 flex-wrap">
                          <span>Change to <strong>{user.pendingEmail}</strong> pending — check that inbox for a code.</span>
                          <Button type="button" variant="ghost" size="sm" className="h-auto p-0 text-xs underline" onClick={() => setEmailChangeStep("verify_otp")}>
                            Enter code
                          </Button>
                          <span className="text-muted-foreground">·</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-auto p-0 text-xs underline"
                            onClick={() => { setNewEmail(""); setEmailChangePassword(""); setEmailChangeStep("enter_new_email"); }}
                          >
                            Typo? Use a different email
                          </Button>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-auto w-fit p-0 justify-start text-xs underline"
                          onClick={() => setEmailChangeStep("enter_new_email")}
                        >
                          Change email address
                        </Button>
                      )
                    )}

                    {emailChangeStep === "enter_new_email" && (
                      <div className="border rounded-md p-3 space-y-3 mt-1">
                        <div className="grid gap-2">
                          <Label htmlFor="new-email">New Email Address</Label>
                          <Input
                            id="new-email"
                            type="email"
                            placeholder="new@example.com"
                            value={newEmail}
                            onChange={(e) => setNewEmail(e.target.value)}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="email-change-password">Current Password</Label>
                          <PasswordInput
                            id="email-change-password"
                            value={emailChangePassword}
                            onChange={(e) => setEmailChangePassword(e.target.value)}
                          />
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => { setEmailChangeStep("idle"); setNewEmail(""); setEmailChangePassword(""); }}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            disabled={requestEmailChangeMutation.isPending || !newEmail || !emailChangePassword}
                            onClick={() => requestEmailChangeMutation.mutate({ newEmail, currentPassword: emailChangePassword })}
                          >
                            {requestEmailChangeMutation.isPending ? "Sending..." : "Send Verification Code"}
                          </Button>
                        </div>
                      </div>
                    )}

                    {emailChangeStep === "verify_otp" && (
                      <div className="border rounded-md p-3 space-y-3 mt-1">
                        <p className="text-xs text-muted-foreground">
                          Enter the 6-digit code sent to {user?.pendingEmail || newEmail}.
                        </p>
                        <div className="grid gap-2">
                          <Label htmlFor="email-change-otp">Verification Code</Label>
                          <Input
                            id="email-change-otp"
                            inputMode="numeric"
                            maxLength={6}
                            placeholder="123456"
                            value={emailChangeOtp}
                            onChange={(e) => setEmailChangeOtp(e.target.value.replace(/\D/g, ""))}
                          />
                        </div>
                        <div className="flex justify-between items-center gap-2 flex-wrap">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-auto p-0 text-xs underline"
                            disabled={requestEmailChangeMutation.isPending || emailChangeResendCooldown > 0 || !newEmail || !emailChangePassword}
                            onClick={() => requestEmailChangeMutation.mutate({ newEmail, currentPassword: emailChangePassword })}
                          >
                            {emailChangeResendCooldown > 0 ? `Resend in ${emailChangeResendCooldown}s` : "Resend code"}
                          </Button>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => { setEmailChangeStep("idle"); setEmailChangeOtp(""); }}
                            >
                              Cancel
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              disabled={verifyEmailChangeMutation.isPending || emailChangeOtp.length !== 6}
                              onClick={() => verifyEmailChangeMutation.mutate({ otp: emailChangeOtp })}
                            >
                              {verifyEmailChangeMutation.isPending ? "Verifying..." : "Verify Code"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="name">Display Name</Label>
                    <Input
                      id="name"
                      placeholder="Your name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>

                  <div className="grid gap-2">
                    <div className="flex items-center gap-2">
                      <Label>Phone Number <span className="text-muted-foreground font-normal text-xs">(Optional)</span></Label>
                      {user?.phone && !user?.isPhoneVerified && (
                        <Badge variant="outline" className="text-amber-600 border-amber-300">Pending verification</Badge>
                      )}
                    </div>
                    <Input value={user?.phone || "Not set"} disabled className="bg-muted" />

                    {phoneChangeStep === "idle" && (
                      user?.pendingPhone ? (
                        <div className="text-xs text-amber-600 flex items-center gap-1 flex-wrap">
                          <span>Change to <strong>{user.pendingPhone}</strong> pending — check that number for a code.</span>
                          <Button type="button" variant="ghost" size="sm" className="h-auto p-0 text-xs underline" onClick={() => setPhoneChangeStep("verify_otp")}>
                            Enter code
                          </Button>
                          <span className="text-muted-foreground">·</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-auto p-0 text-xs underline"
                            onClick={() => { setNewPhoneNumber(""); setPhoneChangePassword(""); setPhoneChangeStep("enter_new_phone"); }}
                          >
                            Typo? Use a different number
                          </Button>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-auto w-fit p-0 justify-start text-xs underline"
                          onClick={() => setPhoneChangeStep("enter_new_phone")}
                        >
                          {user?.phone ? "Change phone number" : "Add phone number"}
                        </Button>
                      )
                    )}

                    {phoneChangeStep === "enter_new_phone" && (
                      <div className="border rounded-md p-3 space-y-3 mt-1">
                        <div className="grid gap-2">
                          <Label>New Phone Number</Label>
                          <div className="grid grid-cols-3 gap-2">
                            <Select value={newPhoneCountryCode} onValueChange={setNewPhoneCountryCode}>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {deduplicatedCountryCodes.map((c) => (
                                  <SelectItem key={c.dialCode} value={c.dialCode}>
                                    {c.dialCode}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input
                              className="col-span-2"
                              type="tel"
                              placeholder="Phone number"
                              value={newPhoneNumber}
                              onChange={(e) => setNewPhoneNumber(e.target.value)}
                            />
                          </div>
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="phone-change-password">Current Password</Label>
                          <PasswordInput
                            id="phone-change-password"
                            value={phoneChangePassword}
                            onChange={(e) => setPhoneChangePassword(e.target.value)}
                          />
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => { setPhoneChangeStep("idle"); setNewPhoneNumber(""); setPhoneChangePassword(""); }}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            disabled={requestPhoneChangeMutation.isPending || !newPhoneNumber || !phoneChangePassword}
                            onClick={() => {
                              const check = validatePhoneNumber(newPhoneNumber, newPhoneCountryCode);
                              if (!check.valid) {
                                toast({ title: "Invalid phone number", description: check.error, variant: "destructive" });
                                return;
                              }
                              requestPhoneChangeMutation.mutate({
                                newPhone: newPhoneNumber,
                                phoneCountryCode: newPhoneCountryCode,
                                currentPassword: phoneChangePassword,
                              });
                            }}
                          >
                            {requestPhoneChangeMutation.isPending ? "Sending..." : "Send Verification Code"}
                          </Button>
                        </div>
                      </div>
                    )}

                    {phoneChangeStep === "verify_otp" && (
                      <div className="border rounded-md p-3 space-y-3 mt-1">
                        <p className="text-xs text-muted-foreground">
                          Enter the 6-digit code sent to {user?.pendingPhone || newPhoneNumber}.
                        </p>
                        <div className="grid gap-2">
                          <Label htmlFor="phone-change-otp">Verification Code</Label>
                          <Input
                            id="phone-change-otp"
                            inputMode="numeric"
                            maxLength={6}
                            placeholder="123456"
                            value={phoneChangeOtp}
                            onChange={(e) => setPhoneChangeOtp(e.target.value.replace(/\D/g, ""))}
                          />
                        </div>
                        <div className="flex justify-between items-center gap-2 flex-wrap">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-auto p-0 text-xs underline"
                            disabled={requestPhoneChangeMutation.isPending || phoneChangeResendCooldown > 0 || !newPhoneNumber || !phoneChangePassword}
                            onClick={() => requestPhoneChangeMutation.mutate({
                              newPhone: newPhoneNumber,
                              phoneCountryCode: newPhoneCountryCode,
                              currentPassword: phoneChangePassword,
                            })}
                          >
                            {phoneChangeResendCooldown > 0 ? `Resend in ${phoneChangeResendCooldown}s` : "Resend code"}
                          </Button>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => { setPhoneChangeStep("idle"); setPhoneChangeOtp(""); }}
                            >
                              Cancel
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              disabled={verifyPhoneChangeMutation.isPending || phoneChangeOtp.length !== 6}
                              onClick={() => verifyPhoneChangeMutation.mutate({ otp: phoneChangeOtp })}
                            >
                              {verifyPhoneChangeMutation.isPending ? "Verifying..." : "Verify Code"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>


                  <div className="grid gap-2">
                    <Label>Profile Photo</Label>
                    <div className="flex items-center gap-4">
                      <Avatar className="h-16 w-16 border">
                        <AvatarImage src={photoUrl} />
                        <AvatarFallback>{name?.charAt(0) || user?.email?.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <Input 
                          type="file" 
                          accept="image/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const maxSize = 2 * 1024 * 1024; // 2MB
                              if (file.size > maxSize) {
                                toast({
                                  title: "File too large",
                                  description: "Profile photo must be smaller than 2MB.",
                                  variant: "destructive"
                                });
                                e.target.value = ""; // clear input
                                return;
                              }
                              const reader = new FileReader();
                              reader.onloadend = () => {
                                setPhotoUrl(reader.result as string);
                              };
                              reader.readAsDataURL(file);
                            }
                          }}
                        />
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Upload a professional photo (JPG, PNG). Max size 2MB (Strictly enforced).
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
                <Separator />
                <CardContent className="pt-6 flex justify-end">
                  <Button
                    onClick={() => {
                      updateProfileMutation.mutate({
                        name,
                        profilePhotoUrl: photoUrl,
                      });
                    }}
                    disabled={updateProfileMutation.isPending}
                  >
                    {updateProfileMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="security" className="space-y-6 mt-0 border-none p-0">
              <Card id="security" className="border-primary/10">
                <CardHeader>
                  <CardTitle>Change Password</CardTitle>
                  <CardDescription>Ensure your account is using a long, random password to stay secure</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handlePasswordChange} className="space-y-4">
                    <div className="grid gap-2">
                      <Label htmlFor="current-password">Current Password</Label>
                      <PasswordInput 
                        id="current-password" 
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        required
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="new-password">New Password</Label>
                      <PasswordInput 
                        id="new-password" 
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        required
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="confirm-password">Confirm New Password</Label>
                      <PasswordInput 
                        id="confirm-password" 
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                      />
                    </div>
                    {newPassword && (
                      <div className="mt-2">
                        <PasswordChecklist
                          password={newPassword}
                          confirmPassword={confirmPassword}
                          onValidationChange={setIsPasswordValid}
                        />
                      </div>
                    )}
                    <div className="flex justify-end pt-4">
                      <Button 
                        type="submit" 
                        disabled={changePasswordMutation.isPending}
                        variant="default"
                      >
                        {changePasswordMutation.isPending ? "Updating..." : "Update Password"}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <Dialog open={smsUnavailableOpen} onOpenChange={setSmsUnavailableOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>SMS verification is unavailable</DialogTitle>
            <DialogDescription>
              We're unable to send an SMS verification code to your phone right now. Please try
              again later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setSmsUnavailableOpen(false)}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
