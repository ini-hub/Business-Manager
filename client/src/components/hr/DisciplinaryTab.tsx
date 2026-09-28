import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";

interface DisciplinaryRecord { id: string; incidentDate: string; closedDate: string | null; complaintIssuedBy: string | null; description: string; action: string | null }

/** Manager/owner-only, per server/routes/hr.routes.ts authorizeStaffAccess({ managerOnly: true }). */
export function DisciplinaryTab({ staffId }: { staffId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const url = `/api/hr/staff/${staffId}/disciplinary`;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ incidentDate: "", closedDate: "", complaintIssuedBy: "", description: "", action: "" });

  const { data: records = [], isLoading } = useQuery<DisciplinaryRecord[]>({ queryKey: [url], queryFn: async () => (await apiRequest("GET", url)).json() });

  const create = useMutation({
    mutationFn: async () => apiRequest("POST", url, { ...form, closedDate: form.closedDate || undefined }),
    onSuccess: () => {
      toast({ title: "Record added" });
      queryClient.invalidateQueries({ queryKey: [url] });
      setOpen(false);
      setForm({ incidentDate: "", closedDate: "", complaintIssuedBy: "", description: "", action: "" });
    },
    onError: (error) => toast({ variant: "destructive", title: "Could not save record", description: getUserFriendlyError(error) }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Disciplinary Records</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm" variant="outline" data-testid="button-add-disciplinary-record"><Plus className="h-4 w-4 mr-1" />Add</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add disciplinary record</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Input type="date" placeholder="Incident date" value={form.incidentDate} onChange={(e) => setForm({ ...form, incidentDate: e.target.value })} />
                <Input type="date" placeholder="Closed date" value={form.closedDate} onChange={(e) => setForm({ ...form, closedDate: e.target.value })} />
              </div>
              <Input placeholder="Complaint issued by" value={form.complaintIssuedBy} onChange={(e) => setForm({ ...form, complaintIssuedBy: e.target.value })} />
              <Textarea placeholder="Description *" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              <Textarea placeholder="Action taken" value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })} />
            </div>
            <DialogFooter>
              <Button onClick={() => create.mutate()} disabled={!form.incidentDate || !form.description || create.isPending} data-testid="button-save-disciplinary-record">
                {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Incident Date</TableHead><TableHead>Closed</TableHead><TableHead>Issued By</TableHead><TableHead>Description</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
            <TableBody>
              {records.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.incidentDate}</TableCell><TableCell>{r.closedDate ?? "—"}</TableCell><TableCell>{r.complaintIssuedBy}</TableCell><TableCell className="max-w-xs truncate">{r.description}</TableCell><TableCell className="max-w-xs truncate">{r.action}</TableCell>
                </TableRow>
              ))}
              {records.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No records.</TableCell></TableRow>}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
