"use client";
// SuryaDesk — Maintenance calendar: preventive visits generated from each
// installation's AMC plan interval. 14-day strip + full schedule list.
import { useEffect, useMemo, useState } from "react";
import {
  Search, AlertTriangle, Loader2, CalendarDays, CalendarPlus, CalendarClock, Eye,
  MapPin, HardHat, Zap,
} from "lucide-react";
import { api, useApi, qs } from "@/lib/surya/client";
import { toast } from "@/hooks/use-toast";
import { useSd } from "@/lib/surya/store";
import { fmtDate, relativeDay, STATUS_LABELS } from "@/lib/surya/types";
import { cn } from "@/lib/utils";
import { StatusPill, PageHeader, EmptyState, SdAvatar } from "../shared/bits";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";

// ── local response types (subset of what the APIs return) ──────
interface Occurrence {
  id: string;
  dueDate: string;
  status: string;
  completedAt: string | null;
  rescheduledFrom: string | null;
  jobId: string | null;
  notes: string | null;
  customer: { id: string; name: string; city: string; phone: string };
  assetCode: string;
  installationId: string;
  capacityKw: number;
  siteAddress: string;
  plan: { id: string; name: string; intervalDays: number; amcContractId: string | null } | null;
}

interface MaintenanceResponse {
  counts: { UPCOMING: number; DUE: number; OVERDUE: number; COMPLETED: number; RESCHEDULED: number };
  occurrences: Occurrence[];
}

interface MetaResponse {
  technicians: { id: string; name: string; title: string | null }[];
  customers: { id: string; name: string; city: string }[];
  installations: { id: string; assetCode: string; customerId: string; capacityKw: number; city: string }[];
  cities: string[];
}

// ── small helpers ───────────────────────────────────────────────
const OCC_STATUSES = ["UPCOMING", "DUE", "OVERDUE", "COMPLETED", "RESCHEDULED"] as const;

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

// ── create-job dialog for an occurrence ─────────────────────────
function OccJobDialog({
  occ,
  technicians,
  onClose,
  onDone,
}: {
  occ: Occurrence;
  technicians: { id: string; name: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [scheduledFor, setScheduledFor] = useState(toISODate(new Date(occ.dueDate)));
  const [technician, setTechnician] = useState("none");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!scheduledFor) {
      toast({ variant: "destructive", title: "Pick a date", description: "A scheduled date is required." });
      return;
    }
    setSaving(true);
    try {
      const res = await api<{ job: { code: string } }>(`/api/maintenance/${occ.id}`, {
        method: "POST",
        json: {
          action: "create_job",
          scheduledFor: localMidnight(scheduledFor),
          technicianUserId: technician === "none" ? undefined : technician,
        },
      });
      toast({
        title: `Job ${res.job.code} created for ${occ.assetCode}`,
        description: `Scheduled for ${fmtDate(scheduledFor)}${technician !== "none" ? " · technician assigned" : " · unassigned for now"}.`,
      });
      onDone();
    } catch (e) {
      toast({ variant: "destructive", title: "Could not create job", description: e instanceof Error ? e.message : "Please try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md w-[calc(100%-2rem)] rounded-2xl p-5 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-sd-ink text-lg">Create maintenance job</DialogTitle>
          <DialogDescription className="text-sd-ink-soft">
            {occ.customer.name} · {occ.assetCode} · {occ.capacityKw} kW — due {fmtDate(occ.dueDate)} ({relativeDay(occ.dueDate)})
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                {technicians.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" className="h-10 px-4 text-sd-ink-soft hover:text-sd-ink" onClick={onClose} disabled={saving}>
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

// ── reschedule dialog for an occurrence ─────────────────────────
function OccRescheduleDialog({
  occ,
  onClose,
  onDone,
}: {
  occ: Occurrence;
  onClose: () => void;
  onDone: () => void;
}) {
  const [newDate, setNewDate] = useState(toISODate(new Date(occ.dueDate)));
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!newDate) {
      toast({ variant: "destructive", title: "Pick a date", description: "A new date is required." });
      return;
    }
    setSaving(true);
    try {
      await api(`/api/maintenance/${occ.id}`, {
        method: "POST",
        json: { action: "reschedule", newDate: localMidnight(newDate) },
      });
      toast({
        title: "Visit rescheduled",
        description: `${occ.assetCode} — new date ${fmtDate(newDate)} (was ${fmtDate(occ.dueDate)}).`,
      });
      onDone();
    } catch (e) {
      toast({ variant: "destructive", title: "Could not reschedule", description: e instanceof Error ? e.message : "Please try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md w-[calc(100%-2rem)] rounded-2xl p-5 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-sd-ink text-lg">Reschedule visit</DialogTitle>
          <DialogDescription className="text-sd-ink-soft">
            {occ.customer.name} · {occ.assetCode} — currently due {fmtDate(occ.dueDate)} ({relativeDay(occ.dueDate)})
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label>New date</Label>
          <Input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className="bg-card/70 border border-sd-line shadow-none h-10 rounded-xl px-3.5 text-sm text-sd-ink"
            aria-label="New date"
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" className="h-10 px-4 text-sd-ink-soft hover:text-sd-ink" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="ghost" className="sd-btn-primary h-10 px-5 border-0" onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <CalendarClock className="w-4 h-4" aria-hidden="true" />}
            Reschedule
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── main view ───────────────────────────────────────────────────
export default function MaintenanceView() {
  const { setView } = useSd();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [jobOcc, setJobOcc] = useState<Occurrence | null>(null);
  const [resOcc, setResOcc] = useState<Occurrence | null>(null);

  const { data, loading, error, refresh } = useApi<MaintenanceResponse>(
    "/api/maintenance" + qs({ status, search: debounced })
  );
  const meta = useApi<MetaResponse>("/api/meta");

  const occurrences = data?.occurrences ?? [];
  const counts = data?.counts;
  const allCount = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;

  // 14-day strip
  const days = useMemo(() => {
    const out: Date[] = [];
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    for (let i = 0; i < 14; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      out.push(d);
    }
    return out;
  }, []);

  const dayOf = (o: Occurrence) => toISODate(new Date(o.dueDate));
  const forDay = (iso: string) => occurrences.filter((o) => dayOf(o) === iso);
  const visible = selectedDay ? occurrences.filter((o) => dayOf(o) === selectedDay) : occurrences;

  const dotColor = (iso: string) => {
    const list = forDay(iso);
    if (list.some((o) => o.status === "OVERDUE")) return "#C94B55";
    if (list.some((o) => o.status === "DUE")) return "#D99A32";
    return "#176B52";
  };

  return (
    <div>
      <PageHeader
        title="Maintenance Calendar"
        subtitle="Generated from each installation's AMC plan interval — every preventive visit the team owes customers."
      />

      {/* status chips */}
      <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Filter by status">
        <button
          onClick={() => setStatus("")}
          aria-pressed={status === ""}
          className={cn(
            "sd-pill border transition-colors sd-focus",
            status === ""
              ? "bg-sd-forest text-white border-transparent"
              : "bg-card/70 text-sd-ink-soft border-sd-line hover:text-sd-ink hover:border-sd-forest/40"
          )}
        >
          All{data ? ` · ${allCount}` : ""}
        </button>
        {OCC_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            aria-pressed={status === s}
            className={cn(
              "sd-pill border transition-colors sd-focus",
              status === s
                ? "bg-sd-forest text-white border-transparent"
                : "bg-card/70 text-sd-ink-soft border-sd-line hover:text-sd-ink hover:border-sd-forest/40"
            )}
          >
            {STATUS_LABELS[s] ?? s}
            {data ? ` · ${counts?.[s] ?? 0}` : ""}
          </button>
        ))}
      </div>

      {/* search */}
      <div className="relative mb-4">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-sd-ink-soft" aria-hidden="true" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customer, asset or site address…"
          aria-label="Search maintenance visits"
          className="sd-inset w-full py-2.5 pl-10 pr-4 text-sm text-sd-ink placeholder:text-sd-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-sd-forest/40"
        />
      </div>

      {/* 14-day strip */}
      <div className="sd-clay p-3 mb-5" role="group" aria-label="Filter by day">
        <div className="flex gap-2 overflow-x-auto sd-scroll pb-1">
          <button
            onClick={() => setSelectedDay(null)}
            aria-pressed={selectedDay === null}
            className={cn(
              "shrink-0 px-3.5 rounded-2xl text-xs font-semibold transition-colors sd-focus flex flex-col items-center justify-center min-w-[5.4rem]",
              selectedDay === null ? "bg-sd-forest text-white" : "bg-sd-surface text-sd-ink-soft hover:text-sd-ink"
            )}
          >
            All days
          </button>
          {days.map((d) => {
            const iso = toISODate(d);
            const active = selectedDay === iso;
            const list = forDay(iso);
            const n = Math.min(list.length, 6);
            const color = dotColor(iso);
            return (
              <button
                key={iso}
                onClick={() => setSelectedDay(active ? null : iso)}
                aria-pressed={active}
                title={list.length > 0 ? `${list.length} visit${list.length === 1 ? "" : "s"} on ${fmtDate(d)}` : `No visits on ${fmtDate(d)}`}
                className={cn(
                  "shrink-0 w-[4.3rem] rounded-2xl py-2.5 text-center transition-colors sd-focus",
                  active ? "bg-sd-forest text-white" : "bg-sd-surface text-sd-ink hover:bg-sd-surface/70"
                )}
              >
                <span className="block text-[0.58rem] uppercase tracking-wide opacity-75">
                  {d.toLocaleDateString("en-IN", { weekday: "short" })}
                </span>
                <span className="block text-lg font-bold leading-none mt-0.5">{d.getDate()}</span>
                <span className="block text-[0.6rem] opacity-75 mt-0.5">
                  {d.toLocaleDateString("en-IN", { month: "short" })}
                </span>
                <span className="mt-1.5 flex justify-center gap-1 h-1.5" aria-hidden="true">
                  {list.length === 0 ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-sd-ink-soft/15" />
                  ) : (
                    Array.from({ length: n }).map((_, i) => (
                      <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: active ? "#F2B84B" : color }} />
                    ))
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* list */}
      {loading && !data ? (
        <div className="sd-clay p-5 space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 rounded-xl bg-sd-surface animate-pulse" style={{ animationDelay: `${i * 90}ms` }} />
          ))}
        </div>
      ) : error && !data ? (
        <div className="sd-clay p-5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-sd-error mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <div className="font-semibold text-sd-ink text-sm">Failed to load maintenance schedule</div>
            <div className="text-xs text-sd-ink-soft mt-0.5">{error}</div>
            <button className="text-xs font-semibold text-sd-forest hover:underline mt-2" onClick={refresh}>
              Retry
            </button>
          </div>
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={selectedDay ? `No visits on ${fmtDate(selectedDay)}` : "No visits match"}
          body={
            selectedDay
              ? "Pick another day on the strip, or clear the day filter to see the full schedule."
              : "Try a different status or search — the schedule is generated from active AMC plans."
          }
        />
      ) : (
        <div className="sd-clay overflow-hidden">
          <div className="max-h-[32rem] overflow-y-auto sd-scroll">
            {visible.map((o) => {
              const d = new Date(o.dueDate);
              const done = o.status === "COMPLETED";
              return (
                <div
                  key={o.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 sm:px-5 py-4 border-t border-sd-line/70 first:border-t-0"
                >
                  {/* date pill */}
                  <span className="sd-inset px-3 py-2 rounded-xl text-center shrink-0 min-w-[3.6rem]">
                    <span className="block text-lg font-bold text-sd-ink leading-none">{d.getDate()}</span>
                    <span className="block text-[0.62rem] uppercase tracking-wide text-sd-ink-soft mt-0.5">
                      {d.toLocaleDateString("en-IN", { month: "short" })}
                    </span>
                  </span>

                  {/* status */}
                  <span className="shrink-0">
                    <StatusPill status={o.status} />
                    {o.rescheduledFrom && (
                      <span className="block text-[0.62rem] text-sd-ink-soft mt-1">moved from {fmtDate(o.rescheduledFrom)}</span>
                    )}
                    {o.completedAt && (
                      <span className="block text-[0.62rem] text-sd-ink-soft mt-1">done {fmtDate(o.completedAt)}</span>
                    )}
                  </span>

                  {/* customer */}
                  <span className="flex items-center gap-2.5 min-w-0 sm:min-w-[12rem]">
                    <SdAvatar name={o.customer.name} size={34} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-sd-ink truncate">{o.customer.name}</span>
                      <span className="block text-[0.68rem] text-sd-ink-soft truncate">{o.customer.city}</span>
                    </span>
                  </span>

                  {/* asset + plan */}
                  <span className="min-w-0 sm:min-w-[13rem]">
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-sd-ink">
                      <Zap className="w-3.5 h-3.5 text-sd-forest shrink-0" aria-hidden="true" />
                      <span className="truncate">{o.assetCode}</span>
                      <span className="text-sd-ink-soft font-normal">· {o.capacityKw} kW</span>
                    </span>
                    {o.plan ? (
                      <span className="block text-[0.68rem] text-sd-ink-soft mt-0.5 truncate">
                        {o.plan.name} · every {o.plan.intervalDays} days
                      </span>
                    ) : null}
                  </span>

                  {/* site */}
                  <span className="hidden lg:flex items-center gap-1.5 min-w-0 max-w-[15rem] text-xs text-sd-ink-soft">
                    <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{o.siteAddress}</span>
                  </span>

                  {/* actions */}
                  <span className="flex items-center gap-2 ml-auto">
                    {o.jobId ? (
                      <Button variant="outline" className="h-9 rounded-xl border-sd-line" onClick={() => setView("jobs")}>
                        <Eye className="w-4 h-4" aria-hidden="true" /> View job
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        className="sd-btn-primary h-9 px-4 border-0"
                        disabled={done}
                        onClick={() => setJobOcc(o)}
                      >
                        <CalendarPlus className="w-4 h-4" aria-hidden="true" /> Create job
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      className="h-9 rounded-xl border-sd-line"
                      disabled={done}
                      onClick={() => setResOcc(o)}
                    >
                      <CalendarClock className="w-4 h-4" aria-hidden="true" /> Reschedule
                    </Button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* list footer hint */}
      {data && (
        <p className="text-xs text-sd-ink-soft mt-3 flex items-center gap-1.5">
          <HardHat className="w-3.5 h-3.5" aria-hidden="true" />
          Turn a visit into a job to send a technician; the visit is then tracked on the job board.
        </p>
      )}

      {jobOcc && (
        <OccJobDialog
          occ={jobOcc}
          technicians={meta.data?.technicians ?? []}
          onClose={() => setJobOcc(null)}
          onDone={() => {
            setJobOcc(null);
            refresh();
          }}
        />
      )}
      {resOcc && (
        <OccRescheduleDialog
          occ={resOcc}
          onClose={() => setResOcc(null)}
          onDone={() => {
            setResOcc(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
