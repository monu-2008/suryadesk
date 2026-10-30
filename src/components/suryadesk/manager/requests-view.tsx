"use client";
// SuryaDesk — Service Requests inbox: full review workflow.
// List + filters + record dialog + detail drawer with triage / convert / close.
import { useEffect, useState } from "react";
import {
  Search, Plus, ChevronRight, AlertTriangle, Loader2, Sparkles, Inbox, Phone, Mail,
  MapPin, Zap, CalendarPlus, Ban, CheckCircle2, X,
} from "lucide-react";
import { api, useApi, qs } from "@/lib/surya/client";
import { toast } from "@/hooks/use-toast";
import {
  fmtDate, fmtDateTime, relativeDay, REQUEST_CATEGORY_LABELS, REQUEST_STATUSES,
  PRIORITIES, STATUS_LABELS,
} from "@/lib/surya/types";
import { cn } from "@/lib/utils";
import { StatusPill, PriorityPill, PageHeader, EmptyState, TableShell } from "../shared/bits";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

// ── local response types (subset of what the APIs return) ──────
interface RequestRow {
  id: string;
  code: string;
  category: string;
  description: string;
  priority: string;
  status: string;
  source: string;
  aiSummary?: string | null;
  aiCategory?: string | null;
  aiPriority?: string | null;
  reviewNotes?: string | null;
  createdAt: string;
  customer: { id: string; name: string; city: string };
  installation: { id: string; assetCode: string; capacityKw: number } | null;
  jobs: { id: string; code: string; status: string; scheduledFor: string }[];
}

interface RequestsPage {
  total: number;
  page: number;
  pageSize: number;
  counts: Record<string, number>;
  requests: RequestRow[];
}

interface InstallationLite {
  id: string;
  assetCode: string;
  customerId: string;
  capacityKw: number;
  city: string;
}

interface MetaResponse {
  technicians: { id: string; name: string; title: string | null }[];
  customers: { id: string; name: string; city: string }[];
  installations: InstallationLite[];
  cities: string[];
}

interface RequestDetailResponse {
  request: RequestRow & {
    customer: { id: string; name: string; city: string; phone: string; email: string };
    installation:
      | {
          id: string;
          assetCode: string;
          capacityKw: number;
          siteAddress: string;
          city: string;
          inverterMake: string;
          inverterModel: string;
        }
      | null;
    jobs: { id: string; code: string; status: string; scheduledFor: string }[];
  };
}

// ── small helpers ───────────────────────────────────────────────
const PAGE_SIZE = 10;

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function tomorrowISO(): string {
  return toISODate(new Date(Date.now() + 86400000));
}

/** date input (yyyy-mm-dd) → ISO string of that local midnight */
function localMidnight(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toISOString();
}

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const SOURCE_LABELS: Record<string, string> = { PHONE: "Phone", EMAIL: "Email", PORTAL: "Portal" };

const selectCls =
  "w-full h-10 rounded-xl border-0 shadow-none bg-transparent sd-inset px-3.5 text-sm text-sd-ink data-[placeholder]:text-sd-ink-soft/60 focus-visible:ring-2 focus-visible:ring-sd-forest/40";

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-semibold text-sd-ink mb-1.5">{children}</label>;
}

// ── status filter chip ──────────────────────────────────────────
function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "sd-pill border transition-colors sd-focus",
        active
          ? "bg-sd-forest text-white border-transparent"
          : "bg-card/70 text-sd-ink-soft border-sd-line hover:text-sd-ink hover:border-sd-forest/40"
      )}
    >
      {children}
    </button>
  );
}

// ── record request dialog ───────────────────────────────────────
function RecordRequestDialog({
  open,
  onOpenChange,
  meta,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  meta: MetaResponse | null;
  onCreated: () => void;
}) {
  const [customerId, setCustomerId] = useState("");
  const [installationId, setInstallationId] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [source, setSource] = useState("PHONE");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const insts = (meta?.installations ?? []).filter((i) => i.customerId === customerId);

  const reset = () => {
    setCustomerId("");
    setInstallationId("");
    setCategory("");
    setPriority("MEDIUM");
    setSource("PHONE");
    setDescription("");
  };

  const submit = async () => {
    if (!customerId || !category || !description.trim()) {
      toast({
        variant: "destructive",
        title: "Missing details",
        description: "Customer, category and description are required.",
      });
      return;
    }
    setSaving(true);
    try {
      const res = await api<{ request: { code: string } }>("/api/requests", {
        method: "POST",
        json: {
          customerId,
          installationId: installationId || undefined,
          category,
          description: description.trim(),
          priority,
          source,
        },
      });
      toast({
        title: `Request ${res.request.code} recorded`,
        description: `${REQUEST_CATEGORY_LABELS[category] ?? category} · ${SOURCE_LABELS[source] ?? source}. It is now in the New queue.`,
      });
      reset();
      onOpenChange(false);
      onCreated();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not record request",
        description: e instanceof Error ? e.message : "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl w-[calc(100%-2rem)] rounded-2xl p-5 sm:p-6 max-h-[88vh] overflow-y-auto sd-scroll">
        <DialogHeader>
          <DialogTitle className="text-sd-ink text-lg">Record a service request</DialogTitle>
          <DialogDescription className="text-sd-ink-soft">
            Log a complaint on behalf of a customer (phone, email or portal follow-up).
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>Customer</Label>
            <Select value={customerId || "none"} onValueChange={(v) => { setCustomerId(v === "none" ? "" : v); setInstallationId(""); }}>
              <SelectTrigger className={selectCls} aria-label="Customer">
                <SelectValue placeholder="Select customer" />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-sd-line">
                <SelectItem value="none">Select customer…</SelectItem>
                {(meta?.customers ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} · {c.city}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Installation (optional)</Label>
            <Select value={installationId || "none"} onValueChange={(v) => setInstallationId(v === "none" ? "" : v)} disabled={!customerId}>
              <SelectTrigger className={selectCls} aria-label="Installation">
                <SelectValue placeholder={customerId ? "Select installation" : "Pick a customer first"} />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-sd-line">
                <SelectItem value="none">No specific installation</SelectItem>
                {insts.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.assetCode} · {i.capacityKw} kW
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Category</Label>
            <Select value={category || "none"} onValueChange={(v) => setCategory(v === "none" ? "" : v)}>
              <SelectTrigger className={selectCls} aria-label="Category">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-sd-line">
                <SelectItem value="none">Select category…</SelectItem>
                {Object.entries(REQUEST_CATEGORY_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Priority</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger className={selectCls} aria-label="Priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-sd-line">
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Source</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger className={selectCls} aria-label="Source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-sd-line">
                {Object.entries(SOURCE_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What did the customer report? (required)"
              rows={4}
              className="sd-inset border-0 shadow-none px-3.5 py-2.5 text-sm text-sd-ink placeholder:text-sd-ink-soft/60 focus-visible:ring-2 focus-visible:ring-sd-forest/40 min-h-[5.5rem]"
              aria-label="Description"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" className="h-10 px-4 text-sd-ink-soft hover:text-sd-ink" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="ghost" className="sd-btn-primary h-10 px-5 border-0" onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Plus className="w-4 h-4" aria-hidden="true" />}
            Record request
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── request detail drawer (full workflow) ───────────────────────
function RequestDetailDialog({
  id,
  onClose,
  onChanged,
  technicians,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
  technicians: { id: string; name: string }[];
}) {
  const { data, loading, error, refresh } = useApi<RequestDetailResponse>(`/api/requests/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [priorityPick, setPriorityPick] = useState("");
  const [convertOpen, setConvertOpen] = useState(false);
  const [convDate, setConvDate] = useState(tomorrowISO());
  const [convTech, setConvTech] = useState("none");
  const [convPriority, setConvPriority] = useState("MEDIUM");

  const req = data?.request;
  const status = req?.status ?? "";

  useEffect(() => {
    if (req) {
      setPriorityPick(req.priority);
      setConvPriority(req.priority);
    }
  }, [req?.id, req?.priority]);

  const act = async (key: string, payload: Record<string, unknown>, okTitle: string, okDesc?: string) => {
    setBusy(key);
    try {
      await api(`/api/requests/${id}`, { method: "PATCH", json: payload });
      toast({ title: okTitle, description: okDesc });
      setNotes("");
      await refresh();
      onChanged();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Action failed",
        description: e instanceof Error ? e.message : "Please try again.",
      });
    } finally {
      setBusy(null);
    }
  };

  const convert = async () => {
    if (!convDate) {
      toast({ variant: "destructive", title: "Pick a date", description: "A scheduled date is required to convert." });
      return;
    }
    setBusy("convert");
    try {
      const res = await api<{ job: { code: string } }>(`/api/requests/${id}`, {
        method: "PATCH",
        json: {
          action: "convert",
          scheduledFor: localMidnight(convDate),
          priority: convPriority,
          technicianUserId: convTech === "none" ? undefined : convTech,
        },
      });
      toast({
        title: `Request ${req?.code} converted to ${res.job.code}`,
        description: `Scheduled for ${fmtDate(convDate)}${convTech !== "none" ? " · technician assigned" : " · unassigned for now"}.`,
      });
      setConvertOpen(false);
      await refresh();
      onChanged();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not convert",
        description: e instanceof Error ? e.message : "Please try again.",
      });
    } finally {
      setBusy(null);
    }
  };

  const spin = (key: string) =>
    busy === key ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl w-[calc(100%-2rem)] rounded-2xl p-5 sm:p-6 max-h-[90vh] overflow-y-auto sd-scroll">
        <DialogTitle className="sr-only">Request details</DialogTitle>
        {loading && !data ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-sd-ink-soft">
            <Loader2 className="w-6 h-6 animate-spin text-sd-forest" aria-hidden="true" />
            <span className="text-sm">Loading request…</span>
          </div>
        ) : error && !data ? (
          <div className="sd-inset p-5 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-sd-error mt-0.5 shrink-0" aria-hidden="true" />
            <div className="flex-1">
              <div className="font-semibold text-sd-ink text-sm">Failed to load request</div>
              <div className="text-xs text-sd-ink-soft mt-0.5">{error}</div>
              <button className="text-xs font-semibold text-sd-forest hover:underline mt-2" onClick={refresh}>
                Retry
              </button>
            </div>
          </div>
        ) : req ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-sd-ink text-lg flex flex-wrap items-center gap-2 pr-6">
                {req.code} <span className="text-sd-ink-soft font-normal">·</span>{" "}
                {REQUEST_CATEGORY_LABELS[req.category] ?? req.category}
                <StatusPill status={req.status} />
                <PriorityPill priority={req.priority} />
              </DialogTitle>
              <DialogDescription className="text-sd-ink-soft">
                {req.customer.name} · {req.customer.city} · raised {relativeDay(req.createdAt)} via{" "}
                {SOURCE_LABELS[req.source] ?? req.source.toLowerCase()}
              </DialogDescription>
            </DialogHeader>

            {req.aiSummary && (
              <div className="rounded-2xl bg-[#7A6AAC]/[0.09] border border-[#7A6AAC]/25 p-4">
                <div className="flex items-center gap-1.5 text-[0.72rem] font-bold uppercase tracking-wide text-[#5d4f96] mb-1.5">
                  <Sparkles className="w-3.5 h-3.5" aria-hidden="true" /> AI summary
                </div>
                <p className="text-sm text-sd-ink leading-relaxed">{req.aiSummary}</p>
                {req.aiPriority && (
                  <p className="text-xs text-[#5d4f96] mt-2">
                    Suggested priority: <strong>{req.aiPriority}</strong>
                  </p>
                )}
              </div>
            )}

            <div className="sd-inset p-4 text-sm text-sd-ink leading-relaxed whitespace-pre-wrap">
              {req.description}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sd-clay-sm p-4">
                <div className="flex items-center gap-1.5 text-[0.7rem] font-bold uppercase tracking-wide text-sd-ink-soft mb-2.5">
                  <Phone className="w-3.5 h-3.5" aria-hidden="true" /> Customer
                </div>
                <div className="text-sm font-semibold text-sd-ink">{req.customer.name}</div>
                <div className="mt-1.5 space-y-1 text-xs text-sd-ink-soft">
                  <div className="flex items-center gap-1.5"><Mail className="w-3 h-3 shrink-0" aria-hidden="true" />{req.customer.email}</div>
                  <div className="flex items-center gap-1.5"><Phone className="w-3 h-3 shrink-0" aria-hidden="true" />{req.customer.phone}</div>
                  <div className="flex items-center gap-1.5"><MapPin className="w-3 h-3 shrink-0" aria-hidden="true" />{req.customer.city}</div>
                </div>
              </div>
              <div className="sd-clay-sm p-4">
                <div className="flex items-center gap-1.5 text-[0.7rem] font-bold uppercase tracking-wide text-sd-ink-soft mb-2.5">
                  <Zap className="w-3.5 h-3.5" aria-hidden="true" /> Installation
                </div>
                {req.installation ? (
                  <>
                    <div className="text-sm font-semibold text-sd-ink">{req.installation.assetCode}</div>
                    <div className="mt-1.5 space-y-1 text-xs text-sd-ink-soft">
                      <div>{req.installation.capacityKw} kW · {req.installation.city}</div>
                      <div className="truncate">{req.installation.siteAddress}</div>
                      <div>
                        Inverter: {req.installation.inverterMake} {req.installation.inverterModel}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-sd-ink-soft">No specific installation linked to this request.</div>
                )}
              </div>
            </div>

            {req.reviewNotes && (
              <div className="sd-inset p-4">
                <div className="text-[0.7rem] font-bold uppercase tracking-wide text-sd-ink-soft mb-1.5">Review notes</div>
                <p className="text-sm text-sd-ink leading-relaxed whitespace-pre-wrap">{req.reviewNotes}</p>
              </div>
            )}

            <div>
              <div className="flex items-center gap-1.5 text-[0.7rem] font-bold uppercase tracking-wide text-sd-ink-soft mb-2.5">
                <CalendarPlus className="w-3.5 h-3.5" aria-hidden="true" /> Linked jobs
              </div>
              {req.jobs.length > 0 ? (
                <div className="relative pl-4 border-l-2 border-sd-line space-y-3">
                  {req.jobs.map((j) => (
                    <div key={j.id} className="relative">
                      <span className="absolute -left-[1.45rem] top-1 w-2.5 h-2.5 rounded-full bg-sd-forest border-2 border-white" aria-hidden="true" />
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-sd-ink">{j.code}</span>
                        <StatusPill status={j.status} />
                        <span className="text-xs text-sd-ink-soft">scheduled {fmtDate(j.scheduledFor)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-sd-ink-soft">No jobs created from this request yet.</div>
              )}
            </div>

            {/* status-aware actions */}
            <div className="border-t border-sd-line pt-4 mt-1 space-y-4">
              {status === "NEW" && (
                <div className="sd-inset p-4 space-y-3">
                  <div className="text-[0.7rem] font-bold uppercase tracking-wide text-sd-ink-soft">Triage</div>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Review notes (shared with approve / reject)…"
                    rows={2}
                    className="bg-card/70 border border-sd-line shadow-none px-3.5 py-2.5 text-sm text-sd-ink placeholder:text-sd-ink-soft/60 focus-visible:ring-2 focus-visible:ring-sd-forest/40 min-h-[3.5rem]"
                    aria-label="Review notes"
                  />
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="w-40">
                      <Label>Priority</Label>
                      <Select value={priorityPick} onValueChange={setPriorityPick}>
                        <SelectTrigger className={selectCls} aria-label="Priority">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl border-sd-line">
                          {PRIORITIES.map((p) => (
                            <SelectItem key={p} value={p}>
                              {p}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      variant="outline"
                      className="h-10 rounded-xl border-sd-line"
                      disabled={!priorityPick || busy !== null}
                      onClick={() => act("priority", { action: "set_priority", priority: priorityPick }, `Priority set to ${priorityPick}`)}
                    >
                      {spin("priority")} Set priority
                    </Button>
                    <div className="flex-1" />
                    <Button
                      variant="outline"
                      className="h-10 rounded-xl border-sd-line"
                      disabled={busy !== null}
                      onClick={() => act("review", { action: "review", reviewNotes: notes || undefined }, "Review started")}
                    >
                      {spin("review")} Start review
                    </Button>
                    <Button
                      variant="outline"
                      className="h-10 rounded-xl border-sd-line"
                      disabled={busy !== null}
                      onClick={() => act("approve", { action: "approve", reviewNotes: notes || undefined }, `Request ${req.code} approved`)}
                    >
                      {spin("approve")} <CheckCircle2 className="w-4 h-4 text-sd-success" aria-hidden="true" /> Approve
                    </Button>
                    <Button
                      variant="outline"
                      className="h-10 rounded-xl border-[#C94B55]/35 text-[#a03340] hover:bg-[#C94B55]/10 hover:text-[#a03340]"
                      disabled={busy !== null}
                      onClick={() =>
                        act(
                          "reject",
                          { action: "reject", reviewNotes: notes || undefined },
                          `Request ${req.code} rejected`
                        )
                      }
                    >
                      {spin("reject")} <Ban className="w-4 h-4" aria-hidden="true" /> Reject
                    </Button>
                  </div>
                </div>
              )}

              {(status === "UNDER_REVIEW" || status === "APPROVED") && (
                <div className="sd-inset p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[0.7rem] font-bold uppercase tracking-wide text-sd-ink-soft">Convert to job</div>
                    {!convertOpen && (
                      <Button
                        variant="ghost"
                        className="sd-btn-primary h-9 px-4 border-0"
                        disabled={busy !== null}
                        onClick={() => {
                          setConvDate(tomorrowISO());
                          setConvTech("none");
                          setConvertOpen(true);
                        }}
                      >
                        <CalendarPlus className="w-4 h-4" aria-hidden="true" /> Convert to job
                      </Button>
                    )}
                  </div>
                  {convertOpen && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <Label>Scheduled for</Label>
                          <Input
                            type="date"
                            value={convDate}
                            onChange={(e) => setConvDate(e.target.value)}
                            className="bg-card/70 border border-sd-line shadow-none h-10 rounded-xl px-3.5 text-sm text-sd-ink"
                            aria-label="Scheduled for"
                          />
                        </div>
                        <div>
                          <Label>Technician</Label>
                          <Select value={convTech} onValueChange={setConvTech}>
                            <SelectTrigger className={selectCls} aria-label="Technician">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl border-sd-line">
                              <SelectItem value="none">Leave unassigned</SelectItem>
                              {technicians.map((t) => (
                                <SelectItem key={t.id} value={t.id}>
                                  {t.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Priority</Label>
                          <Select value={convPriority} onValueChange={setConvPriority}>
                            <SelectTrigger className={selectCls} aria-label="Priority">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl border-sd-line">
                              {PRIORITIES.map((p) => (
                                <SelectItem key={p} value={p}>
                                  {p}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button variant="ghost" className="h-10 px-4 text-sd-ink-soft hover:text-sd-ink" onClick={() => setConvertOpen(false)} disabled={busy !== null}>
                          <X className="w-4 h-4" aria-hidden="true" /> Not now
                        </Button>
                        <Button variant="ghost" className="sd-btn-primary h-10 px-5 border-0" disabled={busy !== null} onClick={convert}>
                          {spin("convert")} Create job
                        </Button>
                      </div>
                    </div>
                  )}
                  {!convertOpen && (
                    <p className="text-xs text-sd-ink-soft">
                      Converting schedules a field visit from this request. You can assign a technician now or leave it
                      unassigned.
                    </p>
                  )}
                </div>
              )}

              {status === "CONVERTED" && (
                <p className="text-xs text-sd-ink-soft">
                  This request has been converted. See the linked jobs above for live status.
                </p>
              )}

              {status !== "CLOSED" && (
                <div className="sd-clay-sm p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[0.7rem] font-bold uppercase tracking-wide text-sd-ink-soft mb-1">Close request</div>
                    <p className="text-xs text-sd-ink-soft">
                      Close without creating a job (duplicate, out of scope, or handled verbally).
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="h-9 rounded-xl border-sd-line shrink-0"
                    disabled={busy !== null}
                    onClick={() =>
                      act(
                        "close",
                        { action: "close", reviewNotes: notes || undefined },
                        `Request ${req.code} closed`
                      )
                    }
                  >
                    {spin("close")} Close
                  </Button>
                </div>
              )}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ── main view ───────────────────────────────────────────────────
export default function RequestsView() {
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const [page, setPage] = useState(1);
  const [recordOpen, setRecordOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // Reset pagination whenever filters change (adjust-state-during-render pattern)
  const filterKey = `${status}|${category}|${debounced}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
  }

  const path = "/api/requests" + qs({ status, category, search: debounced, page, pageSize: PAGE_SIZE });
  const list = useApi<RequestsPage>(path);
  const meta = useApi<MetaResponse>("/api/meta");

  const counts = list.data?.counts ?? {};
  const allCount = Object.values(counts).reduce((a, b) => a + b, 0);
  const rows = list.data?.requests ?? [];
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const th = "text-left px-4 py-3 text-sd-ink-soft font-medium text-xs uppercase tracking-wide whitespace-nowrap";

  return (
    <div>
      <PageHeader
        title="Service Requests"
        subtitle="Customer complaints and queries — triage them, convert them into field jobs, or close them out."
        actions={
          <Button variant="ghost" className="sd-btn-primary h-10 px-4 border-0" onClick={() => setRecordOpen(true)}>
            <Plus className="w-4 h-4" aria-hidden="true" /> Record request
          </Button>
        }
      />

      {/* status chips */}
      <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Filter by status">
        <FilterChip active={status === ""} onClick={() => setStatus("")}>
          All{list.data ? ` · ${allCount}` : ""}
        </FilterChip>
        {REQUEST_STATUSES.map((s) => (
          <FilterChip key={s} active={status === s} onClick={() => setStatus(s)}>
            {STATUS_LABELS[s] ?? s}
            {list.data ? ` · ${counts[s] ?? 0}` : ""}
          </FilterChip>
        ))}
      </div>

      {/* search + category */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-sd-ink-soft" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search code, description or customer…"
            aria-label="Search requests"
            className="sd-inset w-full py-2.5 pl-10 pr-4 text-sm text-sd-ink placeholder:text-sd-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-sd-forest/40"
          />
        </div>
        <Select value={category || "all"} onValueChange={(v) => setCategory(v === "all" ? "" : v)}>
          <SelectTrigger className="w-full sm:w-56 rounded-xl border-0 shadow-none bg-transparent sd-inset h-11 px-3.5 text-sm text-sd-ink data-[placeholder]:text-sd-ink-soft/60" aria-label="Filter by category">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent className="rounded-xl border-sd-line">
            <SelectItem value="all">All categories</SelectItem>
            {Object.entries(REQUEST_CATEGORY_LABELS).map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* table */}
      {list.loading && !list.data ? (
        <div className="sd-clay p-5 space-y-3.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-10 rounded-xl bg-sd-surface animate-pulse" style={{ animationDelay: `${i * 90}ms` }} />
          ))}
        </div>
      ) : list.error && !list.data ? (
        <div className="sd-clay p-5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-sd-error mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <div className="font-semibold text-sd-ink text-sm">Failed to load requests</div>
            <div className="text-xs text-sd-ink-soft mt-0.5">{list.error}</div>
            <button className="text-xs font-semibold text-sd-forest hover:underline mt-2" onClick={list.refresh}>
              Retry
            </button>
          </div>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No requests match"
          body="Try clearing the search or filters — or record a new request on behalf of a customer."
          action={
            <Button variant="ghost" className="sd-btn-primary h-10 px-4 border-0" onClick={() => setRecordOpen(true)}>
              <Plus className="w-4 h-4" aria-hidden="true" /> Record request
            </Button>
          }
        />
      ) : (
        <>
          <TableShell>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>Code</th>
                  <th className={th}>Customer</th>
                  <th className={th}>Category</th>
                  <th className={th}>Priority</th>
                  <th className={th}>Status</th>
                  <th className={th}>Created</th>
                  <th className={th}>Jobs</th>
                  <th className={th} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    tabIndex={0}
                    role="button"
                    onClick={() => setOpenId(r.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setOpenId(r.id);
                    }}
                    className="border-t border-sd-line/70 cursor-pointer hover:bg-sd-surface/60 transition-colors"
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-bold text-sd-forest">{r.code}</span>
                      <span className="block text-[0.66rem] text-sd-ink-soft mt-0.5">{SOURCE_LABELS[r.source] ?? r.source}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sd-ink font-medium">{r.customer.name}</span>
                      <span className="block text-[0.66rem] text-sd-ink-soft mt-0.5">{r.customer.city}</span>
                    </td>
                    <td className="px-4 py-3 text-sd-ink whitespace-nowrap">{REQUEST_CATEGORY_LABELS[r.category] ?? r.category}</td>
                    <td className="px-4 py-3">
                      <PriorityPill priority={r.priority} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={r.status} />
                    </td>
                    <td className="px-4 py-3 text-sd-ink-soft whitespace-nowrap" title={fmtDateTime(r.createdAt)}>
                      {relativeDay(r.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      {r.jobs.length > 0 ? (
                        <span className="flex flex-wrap gap-1">
                          {r.jobs.map((j) => (
                            <span key={j.id} className="sd-pill sd-pill-slate" title={STATUS_LABELS[j.status] ?? j.status}>
                              {j.code}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="text-sd-ink-soft">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ChevronRight className="w-4 h-4 text-sd-ink-soft" aria-hidden="true" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>

          <div className="flex items-center justify-between gap-3 pt-4">
            <div className="text-xs text-sd-ink-soft">
              {total > 0 ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}` : "0 requests"}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="h-9 rounded-xl border-sd-line" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button variant="outline" className="h-9 rounded-xl border-sd-line" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      <RecordRequestDialog open={recordOpen} onOpenChange={setRecordOpen} meta={meta.data} onCreated={() => list.refresh()} />
      {openId && (
        <RequestDetailDialog
          key={openId}
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => list.refresh()}
          technicians={meta.data?.technicians ?? []}
        />
      )}
    </div>
  );
}
