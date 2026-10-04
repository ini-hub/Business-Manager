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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { DynamicFieldForm } from "./DynamicFieldForm";

interface JobInfoRow { id: string; effectiveDate: string; location: string | null; division: string | null; department: string | null; jobTitle: string | null }
interface AdditionalJobInfoRow { id: string; effectiveDate: string; employeeBoxId: string | null; legalEntity: string | null; beneficiaryEntity: string | null; team: string | null; subteam: string | null; jobFamily: string | null; level: string | null; comment: string | null }

export function JobTab({ staffId, canManage }: { staffId: string; canManage: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const jobHistoryUrl = `/api/hr/staff/${staffId}/job-history`;
  const additionalHistoryUrl = `/api/hr/staff/${staffId}/additional-job-history`;
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
  const [additionalDialogOpen, setAdditionalDialogOpen] = useState(false);
  const [jobForm, setJobForm] = useState({ effectiveDate: "", location: "", division: "", department: "", jobTitle: "" });
  const [additionalForm, setAdditionalForm] = useState({ effectiveDate: "", employeeBoxId: "", legalEntity: "", beneficiaryEntity: "", team: "", subteam: "", jobFamily: "", level: "", comment: "" });

  const { data: jobInfo = [], isLoading: loadingJob } = useQuery<JobInfoRow[]>({
    queryKey: [jobHistoryUrl],
    queryFn: async () => (await apiRequest("GET", jobHistoryUrl)).json(),
  });
  const { data: additionalInfo = [], isLoading: loadingAdditional } = useQuery<AdditionalJobInfoRow[]>({
    queryKey: [additionalHistoryUrl],
    queryFn: async () => (await apiRequest("GET", additionalHistoryUrl)).json(),
  });

  const addJobInfo = useMutation({
    mutationFn: async () => apiRequest("POST", jobHistoryUrl, jobForm),
    onSuccess: () => {
      toast({ title: "Job info added" });
      queryClient.invalidateQueries({ queryKey: [jobHistoryUrl] });
      setJobDialogOpen(false);
      setJobForm({ effectiveDate: "", location: "", division: "", department: "", jobTitle: "" });
    },
    onError: (error) => toast({ variant: "destructive", title: "Could not save", description: getUserFriendlyError(error) }),
  });

  const addAdditionalInfo = useMutation({
    mutationFn: async () => apiRequest("POST", additionalHistoryUrl, additionalForm),
    onSuccess: () => {
      toast({ title: "Additional job info added" });
      queryClient.invalidateQueries({ queryKey: [additionalHistoryUrl] });
      setAdditionalDialogOpen(false);
      setAdditionalForm({ effectiveDate: "", employeeBoxId: "", legalEntity: "", beneficiaryEntity: "", team: "", subteam: "", jobFamily: "", level: "", comment: "" });
    },
    onError: (error) => toast({ variant: "destructive", title: "Could not save", description: getUserFriendlyError(error) }),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Current Job</CardTitle></CardHeader>
        <CardContent>
          <DynamicFieldForm staffId={staffId} section="job_current" basePath="/api/hr" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Job Information History</CardTitle>
          {canManage && (
            <Dialog open={jobDialogOpen} onOpenChange={setJobDialogOpen}>
              <DialogTrigger asChild><Button size="sm" variant="outline" data-testid="button-add-job-info"><Plus className="h-4 w-4 mr-1" />Add</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add job information</DialogTitle></DialogHeader>
                <div className="grid gap-3 sm:grid-cols-2">
                  <LabeledInput label="Effective Date *" type="date" value={jobForm.effectiveDate} onChange={(v) => setJobForm({ ...jobForm, effectiveDate: v })} />
                  <LabeledInput label="Location" value={jobForm.location} onChange={(v) => setJobForm({ ...jobForm, location: v })} />
                  <LabeledInput label="Division" value={jobForm.division} onChange={(v) => setJobForm({ ...jobForm, division: v })} />
                  <LabeledInput label="Department" value={jobForm.department} onChange={(v) => setJobForm({ ...jobForm, department: v })} />
                  <LabeledInput label="Job Title" value={jobForm.jobTitle} onChange={(v) => setJobForm({ ...jobForm, jobTitle: v })} />
                </div>
                <DialogFooter>
                  <Button onClick={() => addJobInfo.mutate()} disabled={!jobForm.effectiveDate || addJobInfo.isPending} data-testid="button-save-job-info">
                    {addJobInfo.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent>
          {loadingJob ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Location</TableHead><TableHead>Division</TableHead><TableHead>Department</TableHead><TableHead>Job Title</TableHead></TableRow></TableHeader>
              <TableBody>
                {jobInfo.map((row) => (
                  <TableRow key={row.id}><TableCell>{row.effectiveDate}</TableCell><TableCell>{row.location}</TableCell><TableCell>{row.division}</TableCell><TableCell>{row.department}</TableCell><TableCell>{row.jobTitle}</TableCell></TableRow>
                ))}
                {jobInfo.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No history yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Additional Job Information</CardTitle>
          {canManage && (
            <Dialog open={additionalDialogOpen} onOpenChange={setAdditionalDialogOpen}>
              <DialogTrigger asChild><Button size="sm" variant="outline" data-testid="button-add-additional-job-info"><Plus className="h-4 w-4 mr-1" />Add</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add additional job information</DialogTitle></DialogHeader>
                <div className="grid gap-3 sm:grid-cols-2">
                  <LabeledInput label="Effective Date *" type="date" value={additionalForm.effectiveDate} onChange={(v) => setAdditionalForm({ ...additionalForm, effectiveDate: v })} />
                  <LabeledInput label="Employee Box ID" value={additionalForm.employeeBoxId} onChange={(v) => setAdditionalForm({ ...additionalForm, employeeBoxId: v })} />
                  <LabeledInput label="Legal Entity" value={additionalForm.legalEntity} onChange={(v) => setAdditionalForm({ ...additionalForm, legalEntity: v })} />
                  <LabeledInput label="Beneficiary Entity" value={additionalForm.beneficiaryEntity} onChange={(v) => setAdditionalForm({ ...additionalForm, beneficiaryEntity: v })} />
                  <LabeledInput label="Team" value={additionalForm.team} onChange={(v) => setAdditionalForm({ ...additionalForm, team: v })} />
                  <LabeledInput label="Subteam" value={additionalForm.subteam} onChange={(v) => setAdditionalForm({ ...additionalForm, subteam: v })} />
                  <LabeledInput label="Job Family" value={additionalForm.jobFamily} onChange={(v) => setAdditionalForm({ ...additionalForm, jobFamily: v })} />
                  <LabeledInput label="Level" value={additionalForm.level} onChange={(v) => setAdditionalForm({ ...additionalForm, level: v })} />
                  <LabeledInput label="Comment" value={additionalForm.comment} onChange={(v) => setAdditionalForm({ ...additionalForm, comment: v })} />
                </div>
                <DialogFooter>
                  <Button onClick={() => addAdditionalInfo.mutate()} disabled={!additionalForm.effectiveDate || addAdditionalInfo.isPending} data-testid="button-save-additional-job-info">
                    {addAdditionalInfo.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent>
          {loadingAdditional ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Box ID</TableHead><TableHead>Legal Entity</TableHead><TableHead>Team</TableHead><TableHead>Level</TableHead></TableRow></TableHeader>
              <TableBody>
                {additionalInfo.map((row) => (
                  <TableRow key={row.id}><TableCell>{row.effectiveDate}</TableCell><TableCell>{row.employeeBoxId}</TableCell><TableCell>{row.legalEntity}</TableCell><TableCell>{row.team}</TableCell><TableCell>{row.level}</TableCell></TableRow>
                ))}
                {additionalInfo.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No history yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LabeledInput({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
