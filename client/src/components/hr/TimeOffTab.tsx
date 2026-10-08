import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Check, X, Pencil, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { getUserFriendlyError } from "@/lib/error-utils";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/loader";

const LEAVE_TYPES = ["annual", "sick", "bereavement", "maternity"] as const;

interface Balance { leaveType: string; available: number; used: number; earned: number }
interface TimeOffRequest { id: string; leaveType: string; startDate: string; endDate: string; daysRequested: number; status: string; reason: string | null }
interface HistoryEntry { id: string; date: string; description: string; usedDays: number; earnedDays: number; balanceAfter: number; leaveType: string }
interface Holiday { id: string; date: string; name: string; recursYearly: boolean }
interface HolidaySuggestion { name: string; holidayDate: string; recursYearly: boolean }

export function TimeOffTab({ staffId, storeId, canManage }: { staffId: string; storeId?: string; canManage: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const balancesUrl = `/api/hr/staff/${staffId}/time-off/balances`;
  const requestsUrl = `/api/hr/staff/${staffId}/time-off/requests`;
  const historyUrl = `/api/hr/staff/${staffId}/time-off/history`;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ leaveType: "annual" as typeof LEAVE_TYPES[number], startDate: "", endDate: "", daysRequested: "", reason: "" });
  const [historyFilter, setHistoryFilter] = useState<string>("all");

  const { data: balances = [], isLoading: loadingBalances } = useQuery<Balance[]>({ queryKey: [balancesUrl], queryFn: async () => (await apiRequest("GET", balancesUrl)).json() });
  const { data: requests = [] } = useQuery<TimeOffRequest[]>({ queryKey: [requestsUrl], queryFn: async () => (await apiRequest("GET", requestsUrl)).json() });
  const { data: history = [] } = useQuery<HistoryEntry[]>({ queryKey: [historyUrl], queryFn: async () => (await apiRequest("GET", historyUrl)).json() });
  const holidaysUrl = `/api/hr/staff/${staffId}/holidays`;
  const storeHolidaysUrl = storeId ? `/api/hr/stores/${storeId}/holidays` : "";
  const { data: holidays = [] } = useQuery<Holiday[]>({ queryKey: [holidaysUrl], queryFn: async () => (await apiRequest("GET", holidaysUrl)).json() });
  const { data: holidayConfig } = useQuery<{ suggestions: HolidaySuggestion[] }>({
    queryKey: [storeHolidaysUrl],
    queryFn: async () => (await apiRequest("GET", storeHolidaysUrl)).json(),
    enabled: canManage && !!storeId,
  });
  const [holidayForm, setHolidayForm] = useState({ name: "", holidayDate: "", recursYearly: true });
  const [allowanceFor, setAllowanceFor] = useState<typeof LEAVE_TYPES[number] | null>(null);
  const [allowanceDays, setAllowanceDays] = useState("");

  const refreshHolidays = () => {
    queryClient.invalidateQueries({ queryKey: [holidaysUrl] });
    if (storeHolidaysUrl) queryClient.invalidateQueries({ queryKey: [storeHolidaysUrl] });
  };
  const addHolidays = useMutation({
    mutationFn: async (list: HolidaySuggestion[]) => apiRequest("POST", storeHolidaysUrl, { holidays: list }),
    onSuccess: () => { refreshHolidays(); setHolidayForm({ name: "", holidayDate: "", recursYearly: true }); },
    onError: (error) => toast({ variant: "destructive", title: "Could not save holiday", description: getUserFriendlyError(error) }),
  });
  const removeHoliday = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `${storeHolidaysUrl}/${id}`),
    onSuccess: refreshHolidays,
    onError: (error) => toast({ variant: "destructive", title: "Could not remove holiday", description: getUserFriendlyError(error) }),
  });
  const setAllowance = useMutation({
    mutationFn: async () => apiRequest("PUT", `/api/hr/staff/${staffId}/time-off/allowance`, { leaveType: allowanceFor, totalDays: Number(allowanceDays) }),
    onSuccess: () => {
      toast({ title: "Allowance saved" });
      queryClient.invalidateQueries({ queryKey: [balancesUrl] });
      queryClient.invalidateQueries({ queryKey: [historyUrl] });
      setAllowanceFor(null);
    },
    onError: (error) => toast({ variant: "destructive", title: "Could not save allowance", description: getUserFriendlyError(error) }),
  });

  const createRequest = useMutation({
    mutationFn: async () => apiRequest("POST", requestsUrl, { ...form, daysRequested: Number(form.daysRequested) }),
    onSuccess: () => {
      toast({ title: "Request submitted" });
      queryClient.invalidateQueries({ queryKey: [requestsUrl] });
      setOpen(false);
      setForm({ leaveType: "annual", startDate: "", endDate: "", daysRequested: "", reason: "" });
    },
    onError: (error) => toast({ variant: "destructive", title: "Could not submit request", description: getUserFriendlyError(error) }),
  });

  const review = useMutation({
    mutationFn: async ({ requestId, action }: { requestId: string; action: "approve" | "reject" }) =>
      apiRequest("POST", `${requestsUrl}/${requestId}/${action}`),
    onSuccess: () => {
      toast({ title: "Updated" });
      queryClient.invalidateQueries({ queryKey: [requestsUrl] });
      queryClient.invalidateQueries({ queryKey: [balancesUrl] });
      queryClient.invalidateQueries({ queryKey: [historyUrl] });
    },
    onError: (error) => toast({ variant: "destructive", title: "Could not update request", description: getUserFriendlyError(error) }),
  });

  const availableForType = balances.find((x) => x.leaveType === form.leaveType)?.available ?? 0;
  const pendingForType = requests.filter((r) => r.status === "pending" && r.leaveType === form.leaveType).reduce((n, r) => n + Number(r.daysRequested), 0);
  const requestable = availableForType - pendingForType;
  const overAllowance = Number(form.daysRequested) > requestable;
  const filteredHistory = historyFilter === "all" ? history : history.filter((h) => h.leaveType === historyFilter);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        {loadingBalances ? <Spinner className="h-5 w-5 animate-spin text-muted-foreground" /> : LEAVE_TYPES.map((lt) => {
          const b = balances.find((x) => x.leaveType === lt);
          return (
            <Card key={lt}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground capitalize">{lt} leave</p>
                  {canManage && (
                    <Button size="icon" variant="ghost" className="h-6 w-6" aria-label={`Set ${lt} leave allowance`} data-testid={`button-set-allowance-${lt}`}
                      onClick={() => { setAllowanceFor(lt); setAllowanceDays(String(b?.earned ?? 0)); }}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                <p className="text-2xl font-semibold">{b?.available ?? 0}</p>
                <p className="text-xs text-muted-foreground">Allowed {b?.earned ?? 0} · Used {b?.used ?? 0}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Requests</CardTitle>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm" variant="outline" data-testid="button-request-time-off"><Plus className="h-4 w-4 mr-1" />Request time off</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Request time off</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <Select value={form.leaveType} onValueChange={(v) => setForm({ ...form, leaveType: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{LEAVE_TYPES.map((lt) => <SelectItem key={lt} value={lt} className="capitalize">{lt}</SelectItem>)}</SelectContent>
                </Select>
                <div className="grid grid-cols-2 gap-3">
                  <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
                  <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
                </div>
                <Input type="number" min={0.5} step={0.5} max={Math.max(requestable, 0)} placeholder="Days requested" value={form.daysRequested} onChange={(e) => setForm({ ...form, daysRequested: e.target.value })} />
                <p className={`text-xs ${overAllowance ? "text-destructive" : "text-muted-foreground"}`}>
                  {requestable} {form.leaveType} leave day(s) available to request{pendingForType > 0 ? ` (${pendingForType} already pending)` : ""}.
                </p>
                <Input placeholder="Reason (optional)" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              </div>
              <DialogFooter>
                <Button onClick={() => createRequest.mutate()} disabled={!form.startDate || !form.endDate || !form.daysRequested || overAllowance || createRequest.isPending} data-testid="button-submit-time-off-request">
                  {createRequest.isPending && <Spinner className="h-5 w-5 mr-2 animate-spin" />}Submit
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Dates</TableHead><TableHead>Days</TableHead><TableHead>Status</TableHead>{canManage && <TableHead /> }</TableRow></TableHeader>
            <TableBody>
              {requests.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="capitalize">{r.leaveType}</TableCell>
                  <TableCell>{r.startDate} – {r.endDate}</TableCell>
                  <TableCell>{r.daysRequested}</TableCell>
                  <TableCell><Badge variant={r.status === "approved" ? "default" : r.status === "rejected" ? "destructive" : "secondary"}>{r.status}</Badge></TableCell>
                  {canManage && (
                    <TableCell className="flex gap-1">
                      {r.status === "pending" && (
                        <>
                          <Button size="icon" variant="ghost" onClick={() => review.mutate({ requestId: r.id, action: "approve" })} data-testid={`button-approve-timeoff-${r.id}`}><Check className="h-4 w-4 text-green-600" /></Button>
                          <Button size="icon" variant="ghost" onClick={() => review.mutate({ requestId: r.id, action: "reject" })} data-testid={`button-reject-timeoff-${r.id}`}><X className="h-4 w-4 text-destructive" /></Button>
                        </>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {requests.length === 0 && <TableRow><TableCell colSpan={canManage ? 5 : 4} className="text-center text-muted-foreground">No requests yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Upcoming Public Holidays</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {holidays.map((h) => (
            <div key={h.id} className="text-sm flex items-center justify-between gap-2">
              <span>{h.name}</span>
              <span className="flex items-center gap-1 text-muted-foreground">
                {h.date}
                {canManage && storeId && (
                  <Button size="icon" variant="ghost" className="h-6 w-6" aria-label={`Remove ${h.name}`} onClick={() => removeHoliday.mutate(h.id)} data-testid={`button-remove-holiday-${h.id}`}><Trash2 className="h-3 w-3" /></Button>
                )}
              </span>
            </div>
          ))}
          {holidays.length === 0 && <p className="text-sm text-muted-foreground">{canManage ? "No holidays set for this store yet." : "Your store hasn't listed any upcoming holidays."}</p>}
          {canManage && storeId && (
            <div className="pt-3 space-y-3 border-t mt-3">
              {(holidayConfig?.suggestions.length ?? 0) > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">National holidays this store hasn't adopted - add only the ones it observes.</p>
                  {holidayConfig!.suggestions.map((sg) => (
                    <div key={sg.name + sg.holidayDate} className="text-sm flex items-center justify-between">
                      <span>{sg.name} <span className="text-muted-foreground">({sg.holidayDate})</span></span>
                      <Button size="sm" variant="outline" disabled={addHolidays.isPending} onClick={() => addHolidays.mutate([sg])} data-testid={`button-adopt-holiday-${sg.name}`}>Observe</Button>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                <Input placeholder="Custom holiday name" value={holidayForm.name} onChange={(e) => setHolidayForm({ ...holidayForm, name: e.target.value })} />
                <Input type="date" value={holidayForm.holidayDate} onChange={(e) => setHolidayForm({ ...holidayForm, holidayDate: e.target.value })} />
                <Button size="sm" disabled={!holidayForm.name.trim() || !holidayForm.holidayDate || addHolidays.isPending} onClick={() => addHolidays.mutate([holidayForm])} data-testid="button-add-holiday">Add</Button>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={holidayForm.recursYearly} onChange={(e) => setHolidayForm({ ...holidayForm, recursYearly: e.target.checked })} />
                Repeats on the same date every year
              </label>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={allowanceFor !== null} onOpenChange={(o) => !o && setAllowanceFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="capitalize">{allowanceFor} leave allowance</DialogTitle></DialogHeader>
          <Input type="number" min={0} step={0.5} value={allowanceDays} onChange={(e) => setAllowanceDays(e.target.value)} data-testid="input-allowance-days" />
          <p className="text-xs text-muted-foreground">Total days this staff member may take. Requests beyond what is left are blocked.</p>
          <DialogFooter>
            <Button onClick={() => setAllowance.mutate()} disabled={allowanceDays === "" || setAllowance.isPending} data-testid="button-save-allowance">
              {setAllowance.isPending && <Spinner className="h-5 w-5 mr-2 animate-spin" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Balance History</CardTitle>
          <Select value={historyFilter} onValueChange={setHistoryFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {LEAVE_TYPES.map((lt) => <SelectItem key={lt} value={lt} className="capitalize">{lt}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Description</TableHead><TableHead>Used</TableHead><TableHead>Earned</TableHead><TableHead>Balance</TableHead></TableRow></TableHeader>
            <TableBody>
              {filteredHistory.map((h) => (
                <TableRow key={h.id}><TableCell>{h.date}</TableCell><TableCell>{h.description}</TableCell><TableCell>{h.usedDays}</TableCell><TableCell>{h.earnedDays}</TableCell><TableCell>{h.balanceAfter}</TableCell></TableRow>
              ))}
              {filteredHistory.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No history yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
