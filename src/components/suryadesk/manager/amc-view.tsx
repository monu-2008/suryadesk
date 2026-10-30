"use client";
// SuryaDesk · Manager workspace · AMC contracts module
// Status chip filters, contract table, new-contract wizard dialog and a
// detail dialog with renew / mark-pending / cancel lifecycle actions.

import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle, Ban, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Clock,
  Eye, FileSignature, Loader2, Plus, RefreshCw, Search, ShieldCheck, XCircle,
} from "lucide-react";
import { api, qs, useApi } from "@/lib/surya/client";
import { fmtDate, inr, parseJson, STATUS_LABELS, STATUS_TONES, type PillTone } from "@/lib/surya/types";
import { toast } from "@/hooks/use-toast";
import {
  EmptyState, LoadingBlock, PageHeader, SectionCard, SkeletonRows, StatusPill, TableShell,
} from "../shared/bits";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

// ── API types (contract) ────────────────────────────────────────────────
interface AmcRow {
  id: string;
  contractCode: string;
  startDate: string | null;
  endDate: string | null;
  visitIntervalDays: number | null;
  coveredVisits: number | null;
  visitsUsed: number | null;
  includedServices: string | null;
  excludedServices: string | null;
  emergencyTat: number | null;
  price: number | null;
  status: string;
  customer: { id: string; name: string; city: string | null } | null;
  installation: { id: string; assetCode: string; capacityKw: number | null } | null;
}

interface AmcListResp { total: number; page: number; pageSize: number; contracts: AmcRow[] }

interface MetaResp {
  customers: { id: string; name: string; city: string | null }[];
  installations: { id: string; assetCode: string; customerId: string; capacityKw: number | null; city: string | null }[];
}

interface Occurrence { id?: string; scheduledFor: string | null; status: string }
interface Plan { id?: string; name: string | null; intervalDays: number | null; occurrences: Occurrence[] }

interface AmcDetail extends AmcRow {
  plans: Plan[];
}

// ── chips / helpers ─────────────────────────────────────────────────────
const STATUS_CHIPS: { value: string; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "EXPIRING_SOON", label: "Expiring soon" },
  { value: "EXPIRED", label: "Expired" },
  { value: "RENEWAL_PENDING", label: "Renewal pending" },
  { value: "CANCELLED", label: "Cancelled" },
];

const INTERVALS = [90, 120, 180, 365];

function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

const inputCls =
  "sd-inset px-3.5 py-2.5 text-sm text-sd-ink placeholder:text-sd-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-sd-forest/40 w-full";
const selectCls =
  "sd-inset w-full h-auto px-3.5 py-2.5 text-sm text-sd-ink font-normal border-0 shadow-none focus-visible:ring-2 focus-visible:ring-sd-forest/40 data-[placeholder]:text-sd-ink-soft/60";
const btnPrimary =
  "sd-btn-primary sd-focus px-4 py-2 text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed";
const btnGhost =
  "sd-clay-sm sd-focus sd-press px-3.5 py-2 text-sm font-medium text-sd-ink hover:bg-sd-surface transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed";
const btnDanger =
  "rounded-[0.875rem] bg-[#C94B55] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#b23f49] sd-focus inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed";
const thCls = "text-left px-4 py-3 text-sd-ink-soft font-medium text-xs uppercase tracking-wide whitespace-nowrap";
const tdCls = "px-4 py-3.5 border-t border-sd-line/70 align-middle";
const monoBadge =
  "font-mono text-[0.7rem] font-semibold text-sd-forest bg-sd-surface rounded-lg px-2 py-1 whitespace-nowrap";

function Field({ label, required, children, className }: { label: string; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={"space-y-1.5 " + (className ?? "")}>
      <label className="text-xs font-semibold text-sd-ink-soft tracking-wide">
        {label}
        {required && <span className="text-[#C94B55]"> *</span>}
      </label>
      {children}
    </div>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="sd-clay p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-[#C94B55]/10 p-2.5 shrink-0">
          <AlertTriangle className="w-4 h-4 text-[#a03340]" />
        </div>
        <div>
          <div className="font-semibold text-sd-ink text-sm">Couldn&apos;t load contracts</div>
          <div className="text-xs text-sd-ink-soft mt-0.5">{message}</div>
        </div>
      </div>
      <button className={btnGhost} onClick={onRetry}>Retry</button>
    </div>
  );
}

function MiniEmpty({ text }: { text: string }) {
  return <div className="py-8 text-center text-sm text-sd-ink-soft">{text}</div>;
}

function fmtKw(n: number | null | undefined): string {
  return n == null ? "—" : `${n} kW`;
}

function linesToArray(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── contract detail dialog ──────────────────────────────────────────────
function AmcDetailDialog({
  contractId, onClose, onChanged,
}: { contractId: string; onClose: () => void; onChanged: () => void }) {
  const { data, loading, error, refresh } = useApi<{ contract: AmcDetail }>(`/api/amc/${contractId}`);
  const contract = data?.contract;

  const [acting, setActing] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
  const [renewEnd, setRenewEnd] = useState("");
  const [renewPrice, setRenewPrice] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);

  const included = contract ? parseJson<string[]>(contract.includedServices, []) : [];
  const excluded = contract ? parseJson<string[]>(contract.excludedServices, []) : [];

  async function act(action: "renew" | "cancel" | "mark_renewal_pending", extra?: Record<string, unknown>) {
    if (!contract) return;
    setActing(true);
    try {
      await api(`/api/amc/${contract.id}`, { method: "PATCH", json: { action, ...extra } });
      const messages: Record<string, string> = {
        renew: "Contract renewed — visits counter reset and maintenance plan reactivated.",
        cancel: "Contract cancelled.",
        mark_renewal_pending: "Contract flagged for renewal follow-up.",
      };
      toast({ title: "Done", description: messages[action] });
      setRenewOpen(false);
      setCancelOpen(false);
      setRenewEnd("");
      setRenewPrice("");
      refresh();
      onChanged();
    } catch (e) {
      toast({ variant: "destructive", title: "Action failed", description: e instanceof Error ? e.message : "Please try again." });
    } finally {
      setActing(false);
    }
  }

  function confirmRenew() {
    if (!contract) return;
    if (!renewEnd) {
      toast({ variant: "destructive", title: "New end date required", description: "Pick the new contract end date to renew." });
      return;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (new Date(renewEnd) <= today) {
      toast({ variant: "destructive", title: "Invalid date", description: "The new end date must be in the future." });
      return;
    }
    if (renewPrice !== "" && !Number.isFinite(Number(renewPrice))) {
      toast({ variant: "destructive", title: "Check the price", description: "Renewal price must be a number." });
      return;
    }
    act("renew", {
      endDate: renewEnd,
      ...(renewPrice !== "" ? { price: Number(renewPrice) } : {}),
    });
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-3xl w-[calc(100%-2rem)] p-0 gap-0 rounded-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <DialogTitle className="sr-only">Loading contract</DialogTitle>
        {loading && <div className="p-6"><LoadingBlock label="Loading contract…" /></div>}
        {error && <div className="p-6"><ErrorCard message={error} onRetry={refresh} /></div>}
        {contract && (
          <>
            <DialogHeader className="px-5 sm:px-6 pt-5 pb-3 shrink-0">
              <div className="flex items-start justify-between gap-3 pr-8">
                <div className="min-w-0">
                  <DialogTitle className="text-lg font-bold text-sd-ink font-mono">{contract.contractCode}</DialogTitle>
                  <DialogDescription className="text-sm text-sd-ink-soft truncate">
                    {contract.customer?.name ?? "—"} · {contract.installation?.assetCode ?? "—"} ({fmtKw(contract.installation?.capacityKw)})
                  </DialogDescription>
                </div>
                <StatusPill status={contract.status} />
              </div>
            </DialogHeader>

            <div className="px-5 sm:px-6 pb-5 overflow-y-auto sd-scroll space-y-4">
              {/* key facts */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  ["Period", `${fmtDate(contract.startDate)} – ${fmtDate(contract.endDate)}`],
                  ["Visits", `${contract.visitsUsed ?? 0} of ${contract.coveredVisits ?? "—"} used`],
                  ["Visit interval", contract.visitIntervalDays ? `every ${contract.visitIntervalDays} days` : "—"],
                  ["Emergency TAT", contract.emergencyTat != null ? `${contract.emergencyTat} hours` : "—"],
                ].map(([label, value]) => (
                  <div key={label} className="sd-inset rounded-[0.875rem] px-3.5 py-3">
                    <div className="text-[0.66rem] uppercase tracking-wide text-sd-ink-soft font-semibold">{label}</div>
                    <div className="text-sm font-semibold text-sd-ink mt-1">{value}</div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-sd-forest" />
                <span className="text-sm text-sd-ink-soft">Contract value</span>
                <span className="text-base font-bold text-sd-ink">{inr(contract.price)}</span>
              </div>

              {/* inclusions / exclusions */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <SectionCard title="Included services" subtitle="Covered under this contract">
                  {included.length === 0 ? (
                    <MiniEmpty text="No services listed." />
                  ) : (
                    <ul className="space-y-2">
                      {included.map((s, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-sd-ink">
                          <CheckCircle2 className="w-4 h-4 text-sd-forest mt-0.5 shrink-0" /> {s}
                        </li>
                      ))}
                    </ul>
                  )}
                </SectionCard>
                <SectionCard title="Excluded services" subtitle="Billed separately, if needed">
                  {excluded.length === 0 ? (
                    <MiniEmpty text="No exclusions listed." />
                  ) : (
                    <ul className="space-y-2">
                      {excluded.map((s, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-sd-ink">
                          <XCircle className="w-4 h-4 text-[#a03340] mt-0.5 shrink-0" /> {s}
                        </li>
                      ))}
                    </ul>
                  )}
                </SectionCard>
              </div>

              {/* maintenance plan */}
              <SectionCard title="Maintenance plan" subtitle="Scheduled visits generated by this contract">
                {contract.plans.length === 0 ? (
                  <MiniEmpty text="No maintenance plan attached." />
                ) : (
                  contract.plans.map((plan, i) => (
                    <div key={plan.id ?? i} className={i > 0 ? "mt-4" : undefined}>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <ClipboardList className="w-4 h-4 text-sd-forest shrink-0" />
                          <span className="text-sm font-semibold text-sd-ink truncate">{plan.name ?? "Plan"}</span>
                        </div>
                        {plan.intervalDays != null && <span className="sd-pill sd-pill-teal">every {plan.intervalDays} days</span>}
                      </div>
                      {plan.occurrences.length === 0 ? (
                        <p className="text-xs text-sd-ink-soft mt-2">No scheduled visits.</p>
                      ) : (
                        <ul className="mt-2 max-h-56 overflow-y-auto sd-scroll divide-y divide-sd-line/50 pr-1">
                          {plan.occurrences.map((o, j) => (
                            <li key={o.id ?? j} className="py-2.5 flex items-center justify-between gap-2">
                              <span className="text-sm text-sd-ink">{fmtDate(o.scheduledFor)}</span>
                              <StatusPill status={o.status} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))
                )}
              </SectionCard>

              {/* lifecycle actions */}
              <div className="sd-inset rounded-[0.875rem] p-4 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    className={btnGhost}
                    onClick={() => act("mark_renewal_pending")}
                    disabled={acting || contract.status === "RENEWAL_PENDING" || contract.status === "CANCELLED"}
                  >
                    <Clock className="w-4 h-4" /> Mark renewal pending
                  </button>
                  <button
                    className={btnGhost}
                    onClick={() => setRenewOpen((v) => !v)}
                    disabled={acting || contract.status === "CANCELLED"}
                  >
                    <RefreshCw className="w-4 h-4" /> Renew contract
                  </button>
                  <button
                    className={btnDanger}
                    onClick={() => setCancelOpen(true)}
                    disabled={acting || contract.status === "CANCELLED"}
                  >
                    <Ban className="w-4 h-4" /> Cancel contract
                  </button>
                </div>
                {renewOpen && (
                  <div className="border-t border-sd-line/70 pt-3 space-y-3">
                    <p className="text-xs text-sd-ink-soft flex items-start gap-1.5">
                      <CalendarDays className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      Renewing resets the visits-used counter and reactivates the maintenance plan from the new period.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Field label="New end date" required>
                        <Input className={inputCls} type="date" value={renewEnd} onChange={(e) => setRenewEnd(e.target.value)} />
                      </Field>
                      <Field label="Renewal price (₹)">
                        <Input className={inputCls} type="number" min="0" step="0.01" value={renewPrice} onChange={(e) => setRenewPrice(e.target.value)} placeholder="Keep current price" />
                      </Field>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button className={btnGhost} onClick={() => setRenewOpen(false)} disabled={acting}>Discard</button>
                      <button className={btnPrimary} onClick={confirmRenew} disabled={acting || !renewEnd}>
                        {acting && <Loader2 className="w-4 h-4 animate-spin" />} Confirm renewal
                      </button>
                    </div>
                  </div>
                )}
                <AlertDialog open={cancelOpen} onOpenChange={(o) => { if (!o) setCancelOpen(false); }}>
                  <AlertDialogContent className="rounded-2xl">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Cancel this contract?</AlertDialogTitle>
                      <AlertDialogDescription>
                        {contract.contractCode} will be marked cancelled and its scheduled maintenance visits will stop
                        generating. This can&apos;t be undone from here.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="rounded-[0.875rem]">Keep contract</AlertDialogCancel>
                      <AlertDialogAction
                        className="rounded-[0.875rem] bg-[#C94B55] text-white hover:bg-[#b23f49] sd-focus"
                        onClick={(e) => { e.preventDefault(); act("cancel"); }}
                      >
                        {acting && <Loader2 className="w-4 h-4 animate-spin" />} Cancel contract
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── main view ───────────────────────────────────────────────────────────
const emptyForm = {
  customerId: "",
  installationId: "",
  startDate: "",
  endDate: "",
  visitIntervalDays: "",
  coveredVisits: "",
  emergencyTat: "",
  price: "",
  included: "",
  excluded: "",
};

export default function AmcView() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 300);
  const [status, setStatus] = useState("ALL");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  useEffect(() => setPage(1), [debouncedSearch, status]);

  const list = useApi<AmcListResp>(
    `/api/amc${qs({ search: debouncedSearch, status: status === "ALL" ? "" : status, page, pageSize })}`
  );
  const meta = useApi<MetaResp>("/api/meta");

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const rows = list.data?.contracts ?? [];
  const total = list.data?.total ?? 0;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const customerInstallations = (meta.data?.installations ?? []).filter(
    (i) => !form.customerId || i.customerId === form.customerId
  );

  async function submitAdd() {
    if (!form.customerId || !form.installationId || !form.startDate || !form.endDate || !form.visitIntervalDays || !form.coveredVisits || !form.emergencyTat || form.price === "") {
      toast({ variant: "destructive", title: "Check the form", description: "Customer, installation, dates, interval, visits, TAT and price are required." });
      return;
    }
    if (new Date(form.endDate) <= new Date(form.startDate)) {
      toast({ variant: "destructive", title: "Check the dates", description: "The end date must be after the start date." });
      return;
    }
    const covered = Number(form.coveredVisits);
    const price = Number(form.price);
    if (!Number.isFinite(covered) || covered < 1) {
      toast({ variant: "destructive", title: "Check the form", description: "Covered visits must be at least 1." });
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      toast({ variant: "destructive", title: "Check the form", description: "Price must be zero or more." });
      return;
    }
    setSaving(true);
    try {
      await api("/api/amc", {
        method: "POST",
        json: {
          customerId: form.customerId,
          installationId: form.installationId,
          startDate: form.startDate,
          endDate: form.endDate,
          visitIntervalDays: Number(form.visitIntervalDays),
          coveredVisits: covered,
          includedServices: linesToArray(form.included),
          excludedServices: linesToArray(form.excluded),
          emergencyTat: Number(form.emergencyTat),
          price,
        },
      });
      toast({ title: "Contract created", description: "The AMC contract and its maintenance plan are live." });
      setAddOpen(false);
      setForm(emptyForm);
      list.refresh();
    } catch (e) {
      toast({ variant: "destructive", title: "Could not create contract", description: e instanceof Error ? e.message : "Please try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
      <PageHeader
        title="AMC Contracts"
        subtitle="Annual maintenance contracts — coverage, scheduled visits and renewals at a glance."
        actions={
          <button className={btnPrimary} onClick={() => setAddOpen(true)}>
            <Plus className="w-4 h-4" /> New contract
          </button>
        }
      />

      {/* toolbar: search + status chips */}
      <div className="sd-clay p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-sd-ink-soft pointer-events-none" />
          <input
            className={inputCls + " pl-10"}
            placeholder="Search contract code or customer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search contracts"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-sd-ink-soft font-medium mr-1 whitespace-nowrap">
            {total} result{total === 1 ? "" : "s"}
          </span>
          {STATUS_CHIPS.map((chip) => {
            const active = status === chip.value;
            const tone: PillTone = chip.value === "ALL" ? "slate" : STATUS_TONES[chip.value] ?? "slate";
            return (
              <button
                key={chip.value}
                onClick={() => setStatus(chip.value)}
                aria-pressed={active}
                className={
                  "sd-pill sd-focus cursor-pointer border " +
                  (active
                    ? "sd-pill-green border-[#16876A]/40 shadow-sm"
                    : `sd-pill-${tone} border-transparent opacity-55 hover:opacity-100 transition-opacity`)
                }
              >
                {chip.value === "ALL" ? chip.label : STATUS_LABELS[chip.value] ?? chip.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* table */}
      {list.loading && <SkeletonRows rows={6} />}
      {list.error && !list.loading && <ErrorCard message={list.error} onRetry={list.refresh} />}
      {!list.loading && !list.error && rows.length === 0 && (
        <EmptyState
          icon={ShieldCheck}
          title="No contracts found"
          body={search || status !== "ALL" ? "Try clearing the search or status filter." : "Create your first AMC contract to schedule preventive maintenance visits."}
          action={
            <button className={btnPrimary} onClick={() => setAddOpen(true)}>
              <Plus className="w-4 h-4" /> New contract
            </button>
          }
        />
      )}
      {!list.loading && !list.error && rows.length > 0 && (
        <>
          <TableShell>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Contract</th>
                  <th className={thCls}>Customer</th>
                  <th className={thCls}>Installation</th>
                  <th className={thCls}>Period</th>
                  <th className={thCls}>Visits</th>
                  <th className={thCls}>Price</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls + " text-right"}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="cursor-pointer hover:bg-sd-surface/60 transition-colors" onClick={() => setDetailId(c.id)}>
                    <td className={tdCls}>
                      <div className="flex items-center gap-2">
                        <FileSignature className="w-4 h-4 text-sd-forest shrink-0" />
                        <span className="font-mono text-xs font-bold text-sd-ink">{c.contractCode}</span>
                      </div>
                    </td>
                    <td className={tdCls}>
                      <div className="font-semibold text-sd-ink">{c.customer?.name ?? "—"}</div>
                      <div className="text-xs text-sd-ink-soft">{c.customer?.city ?? ""}</div>
                    </td>
                    <td className={tdCls}>
                      <div className="font-mono text-xs font-semibold text-sd-forest">{c.installation?.assetCode ?? "—"}</div>
                      <div className="text-xs text-sd-ink-soft">{fmtKw(c.installation?.capacityKw)}</div>
                    </td>
                    <td className={tdCls + " text-sd-ink whitespace-nowrap"}>
                      {fmtDate(c.startDate)} – {fmtDate(c.endDate)}
                    </td>
                    <td className={tdCls}>
                      <div className="text-sm font-semibold text-sd-ink whitespace-nowrap">
                        {c.visitsUsed ?? 0}/{c.coveredVisits ?? "—"}
                      </div>
                      {c.coveredVisits ? (
                        <div className="w-16 h-1.5 rounded-full bg-sd-inset mt-1.5" aria-hidden="true">
                          <div
                            className="h-1.5 rounded-full bg-sd-forest"
                            style={{ width: `${Math.min(100, ((c.visitsUsed ?? 0) / c.coveredVisits) * 100)}%` }}
                          />
                        </div>
                      ) : null}
                    </td>
                    <td className={tdCls + " font-semibold text-sd-ink whitespace-nowrap"}>{inr(c.price)}</td>
                    <td className={tdCls}><StatusPill status={c.status} /></td>
                    <td className={tdCls + " text-right"} onClick={(e) => e.stopPropagation()}>
                      <button
                        className="sd-clay-sm sd-focus sd-press px-3 py-1.5 text-xs font-medium text-sd-ink hover:bg-sd-surface transition-colors inline-flex items-center gap-1.5"
                        onClick={() => setDetailId(c.id)}
                      >
                        <Eye className="w-3.5 h-3.5" /> View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>

          {/* pagination */}
          <div className="flex items-center justify-between gap-3 mt-4 flex-wrap">
            <p className="text-xs text-sd-ink-soft">{from}–{to} of {total}</p>
            <div className="flex items-center gap-2">
              <button className={btnGhost} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Previous page">
                <ChevronLeft className="w-4 h-4" /> Prev
              </button>
              <button className={btnGhost} disabled={to >= total} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* new contract dialog */}
      <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) setForm(emptyForm); }}>
        <DialogContent className="sm:max-w-2xl w-[calc(100%-2rem)] rounded-2xl max-h-[90vh] overflow-y-auto sd-scroll">
          <DialogHeader>
            <DialogTitle className="text-sd-ink">New AMC contract</DialogTitle>
            <DialogDescription>
              A maintenance plan with scheduled visits is generated automatically from the interval and covered visits.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Customer" required>
              <Select
                value={form.customerId}
                onValueChange={(v) => setForm({ ...form, customerId: v, installationId: "" })}
              >
                <SelectTrigger className={selectCls} aria-label="Select customer">
                  <SelectValue placeholder="Choose customer" />
                </SelectTrigger>
                <SelectContent>
                  {(meta.data?.customers ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}{c.city ? ` · ${c.city}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Installation" required>
              <Select
                value={form.installationId}
                onValueChange={(v) => setForm({ ...form, installationId: v })}
                disabled={!form.customerId}
              >
                <SelectTrigger className={selectCls} aria-label="Select installation">
                  <SelectValue placeholder={form.customerId ? "Choose installation" : "Pick a customer first"} />
                </SelectTrigger>
                <SelectContent>
                  {customerInstallations.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-sd-ink-soft">No installations for this customer yet.</div>
                  ) : (
                    customerInstallations.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.assetCode} · {fmtKw(i.capacityKw)}{i.city ? ` · ${i.city}` : ""}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Start date" required>
              <Input className={inputCls} type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </Field>
            <Field label="End date" required>
              <Input className={inputCls} type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </Field>
            <Field label="Visit interval" required>
              <Select value={form.visitIntervalDays} onValueChange={(v) => setForm({ ...form, visitIntervalDays: v })}>
                <SelectTrigger className={selectCls} aria-label="Visit interval">
                  <SelectValue placeholder="How often?" />
                </SelectTrigger>
                <SelectContent>
                  {INTERVALS.map((d) => (
                    <SelectItem key={d} value={String(d)}>Every {d} days</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Covered visits" required>
              <Input className={inputCls} type="number" min="1" value={form.coveredVisits} onChange={(e) => setForm({ ...form, coveredVisits: e.target.value })} placeholder="e.g. 4" />
            </Field>
            <Field label="Emergency response time" required>
              <Select value={form.emergencyTat} onValueChange={(v) => setForm({ ...form, emergencyTat: v })}>
                <SelectTrigger className={selectCls} aria-label="Emergency response time">
                  <SelectValue placeholder="TAT for breakdowns" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24">24 hours</SelectItem>
                  <SelectItem value="48">48 hours</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Price (₹)" required>
              <Input className={inputCls} type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="e.g. 12000" />
            </Field>
            <Field label="Included services" className="sm:col-span-2" required={false}>
              <Textarea
                className={inputCls + " min-h-24"}
                value={form.included}
                onChange={(e) => setForm({ ...form, included: e.target.value })}
                placeholder={"One service per line, e.g.\nPanel cleaning\nInverter health check\nWiring inspection"}
              />
            </Field>
            <Field label="Excluded services" className="sm:col-span-2">
              <Textarea
                className={inputCls + " min-h-20"}
                value={form.excluded}
                onChange={(e) => setForm({ ...form, excluded: e.target.value })}
                placeholder={"One per line, e.g.\nSpare part replacement\nPanel relocation"}
              />
            </Field>
          </div>
          <DialogFooter>
            <button className={btnGhost} onClick={() => setAddOpen(false)} disabled={saving}>Cancel</button>
            <button className={btnPrimary} onClick={submitAdd} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Create contract
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* detail dialog */}
      {detailId && <AmcDetailDialog contractId={detailId} onClose={() => setDetailId(null)} onChanged={() => list.refresh()} />}
    </motion.div>
  );
}
