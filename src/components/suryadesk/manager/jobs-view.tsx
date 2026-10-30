"use client";
// SuryaDesk — Service Jobs board: list + filters + create dialog +
// rich job detail (timeline, checklist, photos, report) with
// status-aware management actions (assign / reschedule / cancel / review).
import { useEffect, useState } from "react";
import {
  Search, Plus, ChevronRight, AlertTriangle, Loader2, CheckCircle2, CircleDashed,
  ClipboardCheck, User, MapPin, Zap, Phone, CalendarClock, ListChecks, Paperclip,
  FileText, Undo2, X, Ban, HardHat, CalendarPlus,
} from "lucide-react";
import { api, useApi, qs } from "@/lib/surya/client";
import { toast } from "@/hooks/use-toast";
import {
  fmtDate, fmtDateTime, relativeDay, STATUS_LABELS, JOB_STATUSES, PRIORITIES,
} from "@/lib/surya/types";
import { cn } from "@/lib/utils";
import { StatusPill, PriorityPill, PageHeader, EmptyState, TableShell } from "../shared/bits";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

// ── local response types (subset of what the APIs return) ──────
interface JobRow {
  id: string;
  code: string;
  title: string;
  description: string | null;
  type: string;
  priority: string;
  status: string;
  scheduledFor: string;
  startedAt: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  cancellationReason: string | null;
  customer: { id: string; name: string; city: string; phone: string };
  installation: { id: string; assetCode: string; capacityKw: number; siteAddress: string; city: string } | null;
  technician: { id: string; name: string } | null;
  report: { id: string; acknowledgedByOtp: boolean } | null;
  request: { code: string } | null;
}

interface JobsPage {
  total: number;
  page: number;
  pageSize: number;
  counts: Record<string, number>;
  jobs: JobRow[];
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

interface JobDetailResponse {
  job: JobRow & {
    technician: { id: string; name: string; phone: string } | null;
    report:
      | {
          id: string;
          acknowledgedByOtp: boolean;
          acknowledgedAt: string | null;
          publishedAt: string;
          summary: string;
          technicianNotes: string;
          followUpNeeded: boolean;
          followUpNotes: string | null;
        }
      | null;
    statusEvents: { id: string; fromStatus: string | null; toStatus: string; note: string | null; createdAt: string }[];
    attachments: { id: string; fileName: string; caption: string | null; mimeType: string; sizeBytes: number; createdAt: string }[];
    checklistTemplate: { id: string; name: string; items: { label: string; kind: string; required: boolean }[] } | null;
    checklistResults: { itemLabel: string; itemKind: string; value: string }[];
    request: { code: string } | null;
    maintenanceOccurrence: { id: string; dueDate: string } | null;
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

const selectCls =
  "w-full h-10 rounded-xl border-0 shadow-none bg-transparent sd-inset px-3.5 text-sm text-sd-ink data-[placeholder]:text-sd-ink-soft/60 focus-visible:ring-2 focus-visible:ring-sd-forest/40";

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-semibold text-sd-ink mb-1.5">{children}</label>;
}

function TypePill({ type }: { type: string }) {
  return type === "MAINTENANCE" ? (
    <span className="sd-pill sd-pill-teal">Maintenance</span>
  ) : (
    <span className="sd-pill sd-pill-slate">Complaint</span>
  );
}

// ── create job dialog ───────────────────────────────────────────
function CreateJobDialog({
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
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<"COMPLAINT" | "MAINTENANCE">("COMPLAINT");
  const [priority, setPriority] = useState("MEDIUM");
  const [scheduledFor, setScheduledFor] = useState(tomorrowISO());
  const [technician, setTechnician] = useState("none");
  const [saving, setSaving] = useState(false);

  const insts = (meta?.installations ?? []).filter((i) => i.customerId === customerId);

  const reset = () => {
    setCustomerId("");
    setInstallationId("");
    setTitle("");
    setDescription("");
    setType("COMPLAINT");
    setPriority("MEDIUM");
    setScheduledFor(tomorrowISO());
    setTechnician("none");
  };

  const submit = async () => {
    if (!customerId || !title.trim() || !scheduledFor) {
      toast({ variant: "destructive", title: "Missing details", description: "Customer, title and schedule date are required." });
      return;
    }
    setSaving(true);
    try {
      const res = await api<{ job: { code: string } }>("/api/jobs", {
        method: "POST",
        json: {
          customerId,
          installationId: installationId || undefined,
          title: title.trim(),
          description: description.trim() || undefined,
          type,
          priority,
          scheduledFor: localMidnight(scheduledFor),
          technicianUserId: technician === "none" ? undefined : technician,
        },
      });
      toast({
        title: `Job ${res.job.code} created`,
        description: `Scheduled for ${fmtDate(scheduledFor)}${technician !== "none" ? " · technician assigned" : " · unassigned for now"}.`,
      });
      reset();
      onOpenChange(false);
      onCreated();
    } catch (e) {
      toast({ variant: "destructive", title: "Could not create job", description: e instanceof Error ? e.message : "Please try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl w-[calc(100%-2rem)] rounded-2xl p-5 sm:p-6 max-h-[88vh] overflow-y-auto sd-scroll">
        <DialogHeader>
          <DialogTitle className="text-sd-ink text-lg">Create a service job</DialogTitle>
          <DialogDescription className="text-sd-ink-soft">
            Schedule a field visit directly — complaint or preventive maintenance.
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
          <div className="sm:col-span-2">
            <Label>Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Inverter tripping — rooftop visit"
              className="bg-card/70 border border-sd-line shadow-none h-10 rounded-xl px-3.5 text-sm text-sd-ink placeholder:text-sd-ink-soft/60 focus-visible:ring-2 focus-visible:ring-sd-forest/40"
              aria-label="Job title"
            />
          </div>
          <div>
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v === "MAINTENANCE" ? "MAINTENANCE" : "COMPLAINT")}>
              <SelectTrigger className={selectCls} aria-label="Job type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-sd-line">
                <SelectItem value="COMPLAINT">Complaint</SelectItem>
                <SelectItem value="MAINTENANCE">Maintenance</SelectItem>
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
            <Label>Scheduled for</Label>
            <Input
              type="date"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              className="bg-card/70 border border-sd-line shadow-none h-10 rounded-xl px-3.5 text-sm text-sd-ink"
              aria-label="Scheduled for"
            />
          </div>
          <div>
            <Label>Technician</Label>
            <Select value={technician} onValueChange={setTechnician}>
              <SelectTrigger className={selectCls} aria-label="Technician">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-sd-line">
                <SelectItem value="none">Leave unassigned</SelectItem>
                {(meta?.technicians ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label>Description (optional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Context for the technician…"
              rows={3}
              className="sd-inset border-0 shadow-none px-3.5 py-2.5 text-sm text-sd-ink placeholder:text-sd-ink-soft/60 focus-visible:ring-2 focus-visible:ring-sd-forest/40 min-h-[4.5rem]"
              aria-label="Description"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" className="h-10 px-4 text-sd-ink-soft hover:text-sd-ink" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="ghost" className="sd-btn-primary h-10 px-5 border-0" onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <CalendarPlus className="w-4 h-4" aria-hidden="true" />}
            Create job
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── job detail dialog ───────────────────────────────────────────
function JobDetailDialog({
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
  const { data, loading, error, refresh } = useApi<JobDetailResponse>(`/api/jobs/${id}`);
  const [busy, setBusy] = useState<string | null>(null);

  const [techPick, setTechPick] = useState("none");
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [approveOpen, setApproveOpen] = useState(false);

  const job = data?.job;
  const status = job?.status ?? "";

  useEffect(() => {
    if (job) {
      setTechPick(job.technician?.id ?? "none");
      setRescheduleDate(toISODate(new Date(job.scheduledFor)));
    }
  }, [job?.id, job?.technician?.id, job?.scheduledFor]);

  const run = async (key: string, action: string, payload: Record<string, unknown>, okTitle: string, okDesc?: string) => {
    setBusy(key);
    try {
      await api(`/api/jobs/${id}`, { method: "PATCH", json: { action, ...payload } });
      toast({ title: okTitle, description: okDesc });
      setChangeNote("");
      setCancelReason("");
      await refresh();
      onChanged();
    } catch (e) {
      toast({ variant: "destructive", title: "Action failed", description: e instanceof Error ? e.message : "Please try again." });
    } finally {
      setBusy(null);
    }
  };

  const spin = (key: string) => (busy === key ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null);

  const sectionLabel = "flex items-center gap-1.5 text-[0.7rem] font-bold uppercase tracking-wide text-sd-ink-soft mb-2.5";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl w-[calc(100%-2rem)] rounded-2xl p-5 sm:p-6 max-h-[90vh] overflow-y-auto sd-scroll">
        <DialogTitle className="sr-only">Job details</DialogTitle>
        {loading && !data ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-sd-ink-soft">
            <Loader2 className="w-6 h-6 animate-spin text-sd-forest" aria-hidden="true" />
            <span className="text-sm">Loading job…</span>
          </div>
        ) : error && !data ? (
          <div className="sd-inset p-5 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-sd-error mt-0.5 shrink-0" aria-hidden="true" />
            <div className="flex-1">
              <div className="font-semibold text-sd-ink text-sm">Failed to load job</div>
              <div className="text-xs text-sd-ink-soft mt-0.5">{error}</div>
              <button className="text-xs font-semibold text-sd-forest hover:underline mt-2" onClick={refresh}>
                Retry
              </button>
            </div>
          </div>
        ) : job ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-sd-ink text-lg flex flex-wrap items-center gap-2 pr-6 leading-snug">
                {job.code} <span className="text-sd-ink-soft font-normal">·</span> <span className="truncate">{job.title}</span>
                <StatusPill status={job.status} />
                <PriorityPill priority={job.priority} />
                <TypePill type={job.type} />
              </DialogTitle>
              <DialogDescription className="text-sd-ink-soft">
                {job.customer.name} · {job.customer.city} · scheduled {fmtDate(job.scheduledFor)} ({relativeDay(job.scheduledFor)})
                {job.request ? ` · from ${job.request.code}` : ""}
                {job.maintenanceOccurrence ? ` · maintenance due ${fmtDate(job.maintenanceOccurrence.dueDate)}` : ""}
              </DialogDescription>
            </DialogHeader>

            {/* customer / installation / technician */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sd-clay-sm p-4">
                <div className={sectionLabel}>
                  <User className="w-3.5 h-3.5" aria-hidden="true" /> Customer
                </div>
                <div className="text-sm font-semibold text-sd-ink">{job.customer.name}</div>
                <div className="mt-1.5 space-y-1 text-xs text-sd-ink-soft">
                  <div className="flex items-center gap-1.5"><Phone className="w-3 h-3 shrink-0" aria-hidden="true" />{job.customer.phone}</div>
                  <div className="flex items-center gap-1.5"><MapPin className="w-3 h-3 shrink-0" aria-hidden="true" />{job.customer.city}</div>
                </div>
              </div>
              <div className="sd-clay-sm p-4">
                <div className={sectionLabel}>
                  <Zap className="w-3.5 h-3.5" aria-hidden="true" /> Installation
                </div>
                {job.installation ? (
                  <>
                    <div className="text-sm font-semibold text-sd-ink">{job.installation.assetCode}</div>
                    <div className="mt-1.5 space-y-1 text-xs text-sd-ink-soft">
                      <div>{job.installation.capacityKw} kW · {job.installation.city}</div>
                      <div className="truncate">{job.installation.siteAddress}</div>
                      <div>
                        Inverter: {(job.installation as { inverterMake?: string }).inverterMake ?? "—"}{" "}
                        {(job.installation as { inverterModel?: string }).inverterModel ?? ""}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-sd-ink-soft">No installation linked to this job.</div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-sd-ink-soft font-semibold">Technician:</span>
              {job.technician ? (
                <span className="inline-flex items-center gap-1.5 text-sd-ink">
                  <HardHat className="w-3.5 h-3.5 text-sd-forest" aria-hidden="true" />
                  {job.technician.name}
                  <span className="text-sd-ink-soft">({job.technician.phone})</span>
                </span>
              ) : (
                <span className="sd-pill sd-pill-amber">Unassigned</span>
              )}
            </div>

            {job.description && (
              <div className="sd-inset p-4 text-sm text-sd-ink leading-relaxed whitespace-pre-wrap">{job.description}</div>
            )}

            {status === "CANCELLED" && job.cancellationReason && (
              <div className="rounded-2xl bg-[#C94B55]/[0.08] border border-[#C94B55]/25 p-4">
                <div className="text-[0.7rem] font-bold uppercase tracking-wide text-[#a03340] mb-1">Cancelled</div>
                <p className="text-sm text-sd-ink">{job.cancellationReason}</p>
              </div>
            )}

            {/* status timeline */}
            <div>
              <div className={sectionLabel}>
                <CalendarClock className="w-3.5 h-3.5" aria-hidden="true" /> Status timeline
              </div>
              {job.statusEvents.length > 0 ? (
                <div className="relative pl-5 border-l-2 border-sd-line space-y-4">
                  {job.statusEvents.map((ev) => (
                    <div key={ev.id} className="relative">
                      <span className="absolute -left-[1.68rem] top-1 w-3 h-3 rounded-full bg-sd-forest border-2 border-white" aria-hidden="true" />
                      <div className="text-sm font-medium text-sd-ink">
                        {ev.fromStatus ? `${STATUS_LABELS[ev.fromStatus] ?? ev.fromStatus} → ` : "Created · "}
                        {STATUS_LABELS[ev.toStatus] ?? ev.toStatus}
                      </div>
                      {ev.note && <div className="text-xs text-sd-ink-soft mt-0.5">{ev.note}</div>}
                      <div className="text-[0.66rem] text-sd-ink-soft/80 mt-0.5">{fmtDateTime(ev.createdAt)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-sd-ink-soft">No status events recorded.</div>
              )}
            </div>

            {/* checklist */}
            <div>
              <div className={sectionLabel}>
                <ListChecks className="w-3.5 h-3.5" aria-hidden="true" /> Checklist
                {job.checklistTemplate && (
                  <span className="normal-case font-medium text-sd-ink-soft/80">· {job.checklistTemplate.name}</span>
                )}
              </div>
              {job.checklistResults.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {job.checklistResults.map((c, i) => (
                    <div key={i} className="sd-inset px-3.5 py-2.5 flex items-start gap-2.5">
                      {c.itemKind === "BOOLEAN" ? (
                        c.value === "true" ? (
                          <CheckCircle2 className="w-4 h-4 text-sd-success mt-0.5 shrink-0" aria-hidden="true" />
                        ) : (
                          <X className="w-4 h-4 text-sd-error mt-0.5 shrink-0" aria-hidden="true" />
                        )
                      ) : (
                        <ListChecks className="w-4 h-4 text-sd-info mt-0.5 shrink-0" aria-hidden="true" />
                      )}
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-sd-ink leading-snug">{c.itemLabel}</div>
                        {c.itemKind === "TEXT" && <div className="text-xs text-sd-ink-soft mt-0.5">{c.value}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-sd-ink-soft">
                  {job.checklistTemplate ? "Checklist not filled by the technician yet." : "No checklist template for this job type."}
                </div>
              )}
            </div>

            {/* attachments */}
            <div>
              <div className={sectionLabel}>
                <Paperclip className="w-3.5 h-3.5" aria-hidden="true" /> Photos ({job.attachments.length})
              </div>
              {job.attachments.length > 0 ? (
                <div className="flex flex-wrap gap-3">
                  {job.attachments.map((a) => (
                    <figure key={a.id} className="w-40">
                      <img
                        src={`/api/attachments/${a.id}`}
                        alt={a.caption || a.fileName}
                        className="h-20 w-full object-cover rounded-xl border border-sd-line bg-sd-surface"
                        loading="lazy"
                      />
                      <figcaption className="text-[0.66rem] text-sd-ink-soft mt-1 truncate" title={a.fileName}>
                        {a.caption || a.fileName}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-sd-ink-soft">No photos attached to this job.</div>
              )}
            </div>

            {/* report */}
            {job.report && (
              <div className="sd-clay-sm p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className={cn(sectionLabel, "mb-0")}>
                    <FileText className="w-3.5 h-3.5" aria-hidden="true" /> Service report
                  </div>
                  {job.report.acknowledgedByOtp ? (
                    <span className="sd-pill sd-pill-green" title={job.report.acknowledgedAt ? fmtDateTime(job.report.acknowledgedAt) : undefined}>
                      <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> OTP acknowledged
                    </span>
                  ) : (
                    <span className="sd-pill sd-pill-amber">OTP acknowledgement pending</span>
                  )}
                </div>
                <div className="sd-inset p-3.5">
                  <div className="text-[0.68rem] font-bold uppercase tracking-wide text-sd-ink-soft mb-1">Summary</div>
                  <p className="text-sm text-sd-ink leading-relaxed">{job.report.summary}</p>
                </div>
                {job.report.technicianNotes && (
                  <div>
                    <div className="text-[0.68rem] font-bold uppercase tracking-wide text-sd-ink-soft mb-1">Technician notes</div>
                    <p className="text-sm text-sd-ink leading-relaxed">{job.report.technicianNotes}</p>
                  </div>
                )}
                <div className="text-xs">
                  {job.report.followUpNeeded ? (
                    <span className="inline-flex flex-wrap items-center gap-1.5 text-[#96660d]">
                      <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                      <strong>Follow-up needed</strong>
                      {job.report.followUpNotes ? <span className="text-sd-ink-soft"> — {job.report.followUpNotes}</span> : null}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-sd-success">
                      <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> No follow-up needed
                    </span>
                  )}
                </div>
                <div className="text-[0.66rem] text-sd-ink-soft/80">
                  Published {fmtDateTime(job.report.publishedAt)}
                  {job.report.acknowledgedAt ? ` · acknowledged ${fmtDateTime(job.report.acknowledgedAt)}` : ""}
                </div>
              </div>
            )}

            {/* status-aware actions */}
            <div className="border-t border-sd-line pt-4 space-y-4">
              {(status === "SCHEDULED" || status === "ASSIGNED") && (
                <div className="sd-inset p-4">
                  <div className="text-[0.7rem] font-bold uppercase tracking-wide text-sd-ink-soft mb-2.5">
                    {status === "SCHEDULED" ? "Assign a technician" : "Reassign technician"}
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                    <div className="flex-1 min-w-0">
                      <Label>Technician</Label>
                      <Select value={techPick} onValueChange={setTechPick}>
                        <SelectTrigger className={selectCls} aria-label="Technician">
                          <SelectValue placeholder="Pick a technician" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl border-sd-line">
                          <SelectItem value="none">Pick a technician…</SelectItem>
                          {technicians.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      variant="ghost"
                      className="sd-btn-primary h-10 px-4 border-0 shrink-0"
                      disabled={techPick === "none" || busy !== null}
                      onClick={() => run("assign", status === "SCHEDULED" ? "assign" : "reassign", { technicianUserId: techPick }, "Technician assigned")}
                    >
                      {spin("assign")} {status === "SCHEDULED" ? "Assign" : "Reassign"}
                    </Button>
                  </div>
                </div>
              )}

              {["ASSIGNED", "IN_PROGRESS", "WORK_SUBMITTED"].includes(status) && (
                <div className="sd-inset p-4">
                  <div className="text-[0.7rem] font-bold uppercase tracking-wide text-sd-ink-soft mb-2.5">Reschedule</div>
                  <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                    <div className="flex-1 min-w-0">
                      <Label>New date</Label>
                      <Input
                        type="date"
                        value={rescheduleDate}
                        onChange={(e) => setRescheduleDate(e.target.value)}
                        className="bg-card/70 border border-sd-line shadow-none h-10 rounded-xl px-3.5 text-sm text-sd-ink"
                        aria-label="New date"
                      />
                    </div>
                    <Button
                      variant="outline"
                      className="h-10 rounded-xl border-sd-line shrink-0"
                      disabled={!rescheduleDate || busy !== null}
                      onClick={() => run("reschedule", "reschedule", { scheduledFor: localMidnight(rescheduleDate) }, `Job rescheduled to ${fmtDate(rescheduleDate)}`)}
                    >
                      {spin("reschedule")} Reschedule
                    </Button>
                  </div>
                </div>
              )}

              {["WORK_SUBMITTED", "AWAITING_CUSTOMER", "NEEDS_REVIEW"].includes(status) && (
                <div className="sd-inset p-4 space-y-3">
                  <div className="text-[0.7rem] font-bold uppercase tracking-wide text-sd-ink-soft">Request changes</div>
                  <Textarea
                    value={changeNote}
                    onChange={(e) => setChangeNote(e.target.value)}
                    placeholder="What should the technician fix or re-check?"
                    rows={2}
                    className="bg-card/70 border border-sd-line shadow-none px-3.5 py-2.5 text-sm text-sd-ink placeholder:text-sd-ink-soft/60 focus-visible:ring-2 focus-visible:ring-sd-forest/40 min-h-[3.5rem]"
                    aria-label="Change request note"
                  />
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      className="h-10 rounded-xl border-sd-line"
                      disabled={busy !== null}
                      onClick={() => run("changes", "request_changes", { note: changeNote || undefined }, "Sent back to technician")}
                    >
                      {spin("changes")} <Undo2 className="w-4 h-4" aria-hidden="true" /> Send back to technician
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {["WORK_SUBMITTED", "AWAITING_CUSTOMER"].includes(status) && (
                  <AlertDialog open={approveOpen} onOpenChange={setApproveOpen}>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" className="sd-btn-primary h-10 px-4 border-0" disabled={busy !== null}>
                        <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Approve completion (manager exception)
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="rounded-2xl max-w-md">
                      <AlertDialogHeader>
                        <AlertDialogTitle>Approve completion as a manager exception?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Use this only when the customer OTP acknowledgement cannot be obtained. The job will be marked
                          completed and this approval is recorded separately in the audit log.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="rounded-xl">Back</AlertDialogCancel>
                        <AlertDialogAction
                          className="sd-btn-primary h-10 px-4 rounded-xl border-0"
                          onClick={() => {
                            setApproveOpen(false);
                            run("approve", "approve_completion", {}, "Completion approved (manager exception)", "The job is now completed.");
                          }}
                        >
                          Approve exception
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}

                {["SCHEDULED", "ASSIGNED", "IN_PROGRESS", "WORK_SUBMITTED", "NEEDS_REVIEW"].includes(status) && (
                  <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        className="h-10 rounded-xl border-[#C94B55]/35 text-[#a03340] hover:bg-[#C94B55]/10 hover:text-[#a03340]"
                        disabled={busy !== null}
                      >
                        <Ban className="w-4 h-4" aria-hidden="true" /> Cancel job
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="rounded-2xl max-w-md">
                      <AlertDialogHeader>
                        <AlertDialogTitle>Cancel this job?</AlertDialogTitle>
                        <AlertDialogDescription>
                          The job will be marked cancelled. The customer and technician are no longer expected to act on it.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <div className="py-1">
                        <Label>Reason</Label>
                        <Input
                          value={cancelReason}
                          onChange={(e) => setCancelReason(e.target.value)}
                          placeholder="e.g. Duplicate of JOB-0003"
                          className="bg-card/70 border border-sd-line shadow-none h-10 rounded-xl px-3.5 text-sm text-sd-ink placeholder:text-sd-ink-soft/60"
                          aria-label="Cancellation reason"
                        />
                      </div>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="rounded-xl">Keep job</AlertDialogCancel>
                        <AlertDialogAction
                          className="h-10 px-4 rounded-xl border-0 bg-[#C94B55] text-white hover:bg-[#b53f49]"
                          onClick={() => {
                            setCancelOpen(false);
                            run("cancel", "cancel", { reason: cancelReason || undefined }, "Job cancelled");
                          }}
                        >
                          Cancel job
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ── main view ───────────────────────────────────────────────────
export default function JobsView() {
  const [scope, setScope] = useState("");
  const [status, setStatus] = useState("");
  const [technicianId, setTechnicianId] = useState("");
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // Reset pagination whenever filters change (adjust-state-during-render pattern)
  const filterKey = `${scope}|${status}|${technicianId}|${debounced}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
  }

  const path = "/api/jobs" + qs({ scope, status, technicianId, search: debounced, page, pageSize: PAGE_SIZE });
  const list = useApi<JobsPage>(path);
  const meta = useApi<MetaResponse>("/api/meta");

  const rows = list.data?.jobs ?? [];
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const SCOPES: { v: string; l: string }[] = [
    { v: "", l: "All" },
    { v: "today", l: "Today" },
    { v: "upcoming", l: "Upcoming" },
    { v: "overdue", l: "Overdue" },
    { v: "completed", l: "Completed" },
  ];

  const th = "text-left px-4 py-3 text-sd-ink-soft font-medium text-xs uppercase tracking-wide whitespace-nowrap";

  return (
    <div>
      <PageHeader
        title="Service Jobs"
        subtitle="The operational board — every field visit from scheduling to OTP-acknowledged completion."
        actions={
          <Button variant="ghost" className="sd-btn-primary h-10 px-4 border-0" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" aria-hidden="true" /> Create job
          </Button>
        }
      />

      {/* scope chips */}
      <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Filter by scope">
        {SCOPES.map((s) => (
          <button
            key={s.v}
            onClick={() => {
              setScope(s.v);
              setStatus("");
            }}
            aria-pressed={scope === s.v}
            className={cn(
              "sd-pill border transition-colors sd-focus",
              scope === s.v
                ? "bg-sd-forest text-white border-transparent"
                : "bg-card/70 text-sd-ink-soft border-sd-line hover:text-sd-ink hover:border-sd-forest/40"
            )}
          >
            {s.l}
          </button>
        ))}
      </div>

      {/* filters */}
      <div className="flex flex-col lg:flex-row gap-3 mb-4">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-sd-ink-soft" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search code, title, customer or asset…"
            aria-label="Search jobs"
            className="sd-inset w-full py-2.5 pl-10 pr-4 text-sm text-sd-ink placeholder:text-sd-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-sd-forest/40"
          />
        </div>
        <Select
          value={status || "all"}
          onValueChange={(v) => {
            setStatus(v === "all" ? "" : v);
            setScope("");
          }}
        >
          <SelectTrigger className="w-full lg:w-52 rounded-xl border-0 shadow-none bg-transparent sd-inset h-11 px-3.5 text-sm text-sd-ink data-[placeholder]:text-sd-ink-soft/60" aria-label="Filter by status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent className="rounded-xl border-sd-line">
            <SelectItem value="all">All statuses</SelectItem>
            {JOB_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s] ?? s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={technicianId || "all"} onValueChange={(v) => setTechnicianId(v === "all" ? "" : v)}>
          <SelectTrigger className="w-full lg:w-56 rounded-xl border-0 shadow-none bg-transparent sd-inset h-11 px-3.5 text-sm text-sd-ink data-[placeholder]:text-sd-ink-soft/60" aria-label="Filter by technician">
            <SelectValue placeholder="All technicians" />
          </SelectTrigger>
          <SelectContent className="rounded-xl border-sd-line">
            <SelectItem value="all">All technicians</SelectItem>
            {(meta.data?.technicians ?? []).map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
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
            <div className="font-semibold text-sd-ink text-sm">Failed to load jobs</div>
            <div className="text-xs text-sd-ink-soft mt-0.5">{list.error}</div>
            <button className="text-xs font-semibold text-sd-forest hover:underline mt-2" onClick={list.refresh}>
              Retry
            </button>
          </div>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No jobs match"
          body="Try a different scope or filter — or create a job from scratch."
          action={
            <Button variant="ghost" className="sd-btn-primary h-10 px-4 border-0" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4" aria-hidden="true" /> Create job
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
                  <th className={th}>Title</th>
                  <th className={th}>Customer</th>
                  <th className={th}>Technician</th>
                  <th className={th}>Type</th>
                  <th className={th}>Scheduled</th>
                  <th className={th}>Status</th>
                  <th className={th}>OTP</th>
                  <th className={th} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((j) => (
                  <tr
                    key={j.id}
                    tabIndex={0}
                    role="button"
                    onClick={() => setOpenId(j.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setOpenId(j.id);
                    }}
                    className="border-t border-sd-line/70 cursor-pointer hover:bg-sd-surface/60 transition-colors"
                  >
                    <td className="px-4 py-3 whitespace-nowrap font-bold text-sd-forest">{j.code}</td>
                    <td className="px-4 py-3">
                      <span className="block max-w-[16rem] truncate text-sd-ink font-medium">{j.title}</span>
                      {j.request && <span className="block text-[0.66rem] text-sd-ink-soft mt-0.5">from {j.request.code}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sd-ink">{j.customer.name}</span>
                      <span className="block text-[0.66rem] text-sd-ink-soft mt-0.5">{j.customer.city}</span>
                    </td>
                    <td className="px-4 py-3">
                      {j.technician ? (
                        <span className="text-sd-ink whitespace-nowrap">{j.technician.name}</span>
                      ) : (
                        <span className="sd-pill sd-pill-amber">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <TypePill type={j.type} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-sd-ink">{fmtDate(j.scheduledFor)}</span>
                      <span className="block text-[0.66rem] text-sd-ink-soft mt-0.5">{relativeDay(j.scheduledFor)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={j.status} />
                    </td>
                    <td className="px-4 py-3">
                      {j.report?.acknowledgedByOtp ? (
                        <span className="inline-flex items-center gap-1 text-sd-success" title="Customer acknowledged via OTP">
                          <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                          <span className="sr-only">OTP acknowledged</span>
                        </span>
                      ) : j.report ? (
                        <span title="OTP acknowledgement pending">
                          <CircleDashed className="w-4 h-4 text-[#D99A32]" aria-hidden="true" />
                          <span className="sr-only">OTP acknowledgement pending</span>
                        </span>
                      ) : (
                        <span className="text-sd-ink-soft/50" title="No service report yet">—</span>
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
              {total > 0 ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}` : "0 jobs"}
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

      <CreateJobDialog open={createOpen} onOpenChange={setCreateOpen} meta={meta.data} onCreated={() => list.refresh()} />
      {openId && (
        <JobDetailDialog
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
