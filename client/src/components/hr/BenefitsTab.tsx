import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";

interface Dependant { id: string; name: string; relationship: string | null; gender: string | null; ssn: string | null; birthDate: string | null }
interface Beneficiary { id: string; name: string; relationship: string | null; address: string | null; phone: string | null; percentage: number }

export function BenefitsTab({ staffId }: { staffId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const dependantsUrl = `/api/hr/staff/${staffId}/dependants`;
  const beneficiariesUrl = `/api/hr/staff/${staffId}/estate-beneficiaries`;

  const [depOpen, setDepOpen] = useState(false);
  const [depForm, setDepForm] = useState({ name: "", relationship: "", gender: "", ssn: "", birthDate: "" });
  const [benOpen, setBenOpen] = useState(false);
  const [benForm, setBenForm] = useState({ name: "", relationship: "", address: "", phone: "", percentage: "" });

  const { data: dependants = [], isLoading: loadingDep } = useQuery<Dependant[]>({ queryKey: [dependantsUrl], queryFn: async () => (await apiRequest("GET", dependantsUrl)).json() });
  const { data: beneficiaries = [], isLoading: loadingBen } = useQuery<Beneficiary[]>({ queryKey: [beneficiariesUrl], queryFn: async () => (await apiRequest("GET", beneficiariesUrl)).json() });

  const totalPct = beneficiaries.reduce((sum, b) => sum + Number(b.percentage), 0);

  const addDependant = useMutation({
    mutationFn: async () => apiRequest("POST", dependantsUrl, { ...depForm, birthDate: depForm.birthDate || undefined }),
    onSuccess: () => { toast({ title: "Dependant added" }); queryClient.invalidateQueries({ queryKey: [dependantsUrl] }); setDepOpen(false); setDepForm({ name: "", relationship: "", gender: "", ssn: "", birthDate: "" }); },
    onError: (error) => toast({ variant: "destructive", title: "Could not add dependant", description: getUserFriendlyError(error) }),
  });

  const removeDependant = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `${dependantsUrl}/${id}`),
    onSuccess: () => { toast({ title: "Removed" }); queryClient.invalidateQueries({ queryKey: [dependantsUrl] }); },
  });

  const addBeneficiary = useMutation({
    mutationFn: async () => apiRequest("POST", beneficiariesUrl, { ...benForm, percentage: Number(benForm.percentage) }),
    onSuccess: () => { toast({ title: "Beneficiary added" }); queryClient.invalidateQueries({ queryKey: [beneficiariesUrl] }); setBenOpen(false); setBenForm({ name: "", relationship: "", address: "", phone: "", percentage: "" }); },
    onError: (error) => toast({ variant: "destructive", title: "Could not add beneficiary", description: getUserFriendlyError(error) }),
  });

  const removeBeneficiary = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `${beneficiariesUrl}/${id}`),
    onSuccess: () => { toast({ title: "Removed" }); queryClient.invalidateQueries({ queryKey: [beneficiariesUrl] }); },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Dependants</CardTitle>
          <Dialog open={depOpen} onOpenChange={setDepOpen}>
            <DialogTrigger asChild><Button size="sm" variant="outline" data-testid="button-add-dependant"><Plus className="h-4 w-4 mr-1" />Add</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add dependant</DialogTitle></DialogHeader>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input placeholder="Name *" value={depForm.name} onChange={(e) => setDepForm({ ...depForm, name: e.target.value })} />
                <Input placeholder="Relationship" value={depForm.relationship} onChange={(e) => setDepForm({ ...depForm, relationship: e.target.value })} />
                <Input placeholder="Gender" value={depForm.gender} onChange={(e) => setDepForm({ ...depForm, gender: e.target.value })} />
                <Input placeholder="SSN" value={depForm.ssn} onChange={(e) => setDepForm({ ...depForm, ssn: e.target.value })} />
                <Input type="date" value={depForm.birthDate} onChange={(e) => setDepForm({ ...depForm, birthDate: e.target.value })} />
              </div>
              <DialogFooter><Button onClick={() => addDependant.mutate()} disabled={!depForm.name || addDependant.isPending}>{addDependant.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {loadingDep ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Relationship</TableHead><TableHead>Gender</TableHead><TableHead>SSN</TableHead><TableHead>Birthdate</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {dependants.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{d.name}</TableCell><TableCell>{d.relationship}</TableCell><TableCell>{d.gender}</TableCell><TableCell>{d.ssn}</TableCell><TableCell>{d.birthDate}</TableCell>
                    <TableCell><Button size="icon" variant="ghost" onClick={() => removeDependant.mutate(d.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                  </TableRow>
                ))}
                {dependants.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No dependants added.</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Estate Beneficiaries</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">Total allocated: {totalPct}% {totalPct < 100 && `(${(100 - totalPct).toFixed(2)}% remaining)`}</p>
          </div>
          <Dialog open={benOpen} onOpenChange={setBenOpen}>
            <DialogTrigger asChild><Button size="sm" variant="outline" data-testid="button-add-beneficiary"><Plus className="h-4 w-4 mr-1" />Add</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add estate beneficiary</DialogTitle></DialogHeader>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input placeholder="Full name *" value={benForm.name} onChange={(e) => setBenForm({ ...benForm, name: e.target.value })} />
                <Input placeholder="Relationship" value={benForm.relationship} onChange={(e) => setBenForm({ ...benForm, relationship: e.target.value })} />
                <Input placeholder="Address" value={benForm.address} onChange={(e) => setBenForm({ ...benForm, address: e.target.value })} />
                <Input placeholder="Phone" value={benForm.phone} onChange={(e) => setBenForm({ ...benForm, phone: e.target.value })} />
                <Input type="number" placeholder="Percentage *" value={benForm.percentage} onChange={(e) => setBenForm({ ...benForm, percentage: e.target.value })} />
              </div>
              <DialogFooter><Button onClick={() => addBeneficiary.mutate()} disabled={!benForm.name || !benForm.percentage || addBeneficiary.isPending}>{addBeneficiary.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {loadingBen ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Relationship</TableHead><TableHead>Address</TableHead><TableHead>Phone</TableHead><TableHead>%</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {beneficiaries.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>{b.name}</TableCell><TableCell>{b.relationship}</TableCell><TableCell>{b.address}</TableCell><TableCell>{b.phone}</TableCell><TableCell>{b.percentage}%</TableCell>
                    <TableCell><Button size="icon" variant="ghost" onClick={() => removeBeneficiary.mutate(b.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                  </TableRow>
                ))}
                {beneficiaries.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No beneficiaries added.</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
