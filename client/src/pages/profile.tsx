import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useStore } from "@/lib/store-context";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

  const updateProfileMutation = useMutation({
    mutationFn: (data: { name: string; profilePhotoUrl: string }) => 
      apiRequest("PATCH", "/api/auth/user/profile", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
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
                    onClick={() => updateProfileMutation.mutate({ name, profilePhotoUrl: photoUrl })}
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
    </div>
  );
}
