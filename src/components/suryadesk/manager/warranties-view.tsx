"use client";
// SuryaDesk · Manager workspace · Warranties module
// Manufacturer + workmanship warranties across the installed base, with
// live-computed expiry. Deliberately separate from AMC service agreements.

import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle, Info, Loader2, Plus, Search, ShieldCheck,
} from "lucide-react";
import { api, qs, useApi } from "@/lib/surya/client";
import { fmtDate } from "@/lib/surya/types";
import { toast } from "@/hooks/use-toast";
import { EmptyState, PageHeader, StatusPill } from "../shared/bits";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

// ── API types (contract) ────────────────────────────────────────────────
interface WarrantyRow {
  id: string;
  kind: string; // PANEL_PRODUCT | PANEL_PERFORMANCE | INVERTER | SERVICE
  provider: string | null;
  coverage: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string; // live-computed by the API
  daysLeft: number | null;
  installation: { assetCode: string; customer: { name: string } | null } | null;
}

interface WarrantyListResp { warranties: WarrantyRow[] }

interface MetaResp {
  customers: { id: string; name: string; city: string | null }[];
  installations: { id: string; assetCode: string; customerId: string; capacityKw: number | null; city: string | null }[];
  cities: string[];
}

// ── labels & helpers ────────────────────────────────────────────────────
const KIND_LABELS: Record<string, string> = {
  PANEL_PRODUCT: "Panel product",
  PANEL_PERFORMANCE: "Panel performance",
  INVERTER: "Inverter",
  SERVICE: "Service workmanship",
};

const KIND_CHIPS: { value: string; label: string }[] = [
  { value: "ALL", label: "All kinds" },
  { value: "PANEL_PRODUCT", label: "Panel product" },
  { value: "PANEL_PERFORMANCE", label: "Panel performance" },
  { value: "INVERTER", label: "Inverter" },
  { value: "SERVICE", label: "Service workmanship" },
];

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
          <div className="font-semibold text-sd-ink text-sm">Couldn&apos;t load warranties</div>
          <div className="text-xs text-sd-ink-soft mt-0.5">{message}</div>
        </div>
      </div>
      <button className={btnGhost} onClick={onRetry}>Retry</button>
    </div>
  );
}

function DaysLeft({ days }: { days: number | null }) {
  if (days == null) return <span className="text-xs text-sd-ink-soft">—</span>;
  if (days < 0) return <span className="text-xs font-semibold text-[#a03340]">Expired {-days} day{days === -1 ? "" : "s"} ago</span>;
  if (days === 0) return <span className="text-xs font-semibold text-[#96660d]">Ends today</span>;
  if (days <= 30) return <span className="text-xs font-semibold text-[#96660d]">in {days} day{days === 1 ? "" : "s"}</span>;
  return <span className="text-xs font-medium text-sd-forest">in {days} day{days === 1 ? "" : "s"}</span>;
}

// ── main view ───────────────────────────────────────────────────────────
const emptyForm = {
  installationId: "",
  kind: "",
  provider: "",
  coverage: "",
  startDate: "",
  endDate: "",
};

export default function WarrantiesView() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 300);
  const [kind, setKind] = useState("ALL");

  const list = useApi<WarrantyListResp>(
    `/api/warranties${qs({ kind: kind === "ALL" ? "" : kind, search: debouncedSearch })}`
  );
  const meta = useApi<MetaResp>("/api/meta");

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const rows = list.data?.warranties ?? [];

  // meta gives customerId on installations — join to get customer names for the dropdown.
  const customerNameById = new Map<string, string>((meta.data?.customers ?? []).map((c) => [c.id, c.name]));

  async function submitAdd() {
    if (!form.installationId || !form.kind || !form.provider.trim() || !form.coverage.trim() || !form.startDate || !form.endDate) {
      toast({ variant: "destructive", title: "Check the form", description: "Installation, kind, provider, coverage and both dates are required." });
      return;
    }
    if (new Date(form.endDate) <= new Date(form.startDate)) {
      toast({ variant: "destructive", title: "Check the dates", description: "The end date must be after the start date." });
      return;
    }
    setSaving(true);
    try {
      await api("/api/warranties", {
        method: "POST",
        json: {
          installationId: form.installationId,
          kind: form.kind,
          provider: form.provider.trim(),
          coverage: form.coverage.trim(),
          startDate: form.startDate,
          endDate: form.endDate,
        },
      });
      toast({ title: "Warranty added", description: "Expiry status is tracked automatically from today." });
      setAddOpen(false);
      setForm(emptyForm);
      list.refresh();
    } catch (e) {
      toast({ variant: "destructive", title: "Could not add warranty", description: e instanceof Error ? e.message : "Please try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
      <PageHeader
        title="Warranties"
        subtitle="Manufacturer and workmanship coverage across your installed base, with live expiry tracking."
        actions={
          <button className={btnPrimary} onClick={() => setAddOpen(true)}>
            <Plus className="w-4 h-4" /> Add warranty
          </button>
        }
      />

      {/* note: warranties ≠ AMC */}
      <div className="sd-inset rounded-[0.875rem] p-4 flex items-start gap-3 mb-4">
        <Info className="w-4 h-4 text-sd-forest mt-0.5 shrink-0" />
        <p className="text-xs text-sd-ink-soft leading-relaxed">
          Manufacturer warranties (panels, inverters) are issued by the equipment makers and claimed through them — they
          differ from your own service agreements (AMC). Keep both on record so expiries never catch you off guard.
        </p>
      </div>

      {/* toolbar: search + kind chips */}
      <div className="sd-clay p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-sd-ink-soft pointer-events-none" />
          <input
            className={inputCls + " pl-10"}
            placeholder="Search provider, asset code or customer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search warranties"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-sd-ink-soft font-medium mr-1 whitespace-nowrap">
            {rows.length} record{rows.length === 1 ? "" : "s"}
          </span>
          {KIND_CHIPS.map((chip) => {
            const active = kind === chip.value;
            return (
              <button
                key={chip.value}
                onClick={() => setKind(chip.value)}
                aria-pressed={active}
                className={
                  "sd-pill sd-focus cursor-pointer border " +
                  (active
                    ? "sd-pill-green border-[#16876A]/40 shadow-sm"
                    : "sd-pill-slate border-transparent opacity-55 hover:opacity-100 transition-opacity")
                }
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* card list */}
      {list.loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="sd-clay p-5 h-56 animate-pulse" style={{ animationDelay: `${i * 90}ms` }} />
          ))}
        </div>
      )}
      {list.error && !list.loading && <ErrorCard message={list.error} onRetry={list.refresh} />}
      {!list.loading && !list.error && rows.length === 0 && (
        <EmptyState
          icon={ShieldCheck}
          title="No warranties found"
          body={search || kind !== "ALL" ? "Try clearing the filters or searching for something else." : "Record panel, inverter and workmanship warranties to track their expiry."}
          action={
            <button className={btnPrimary} onClick={() => setAddOpen(true)}>
              <Plus className="w-4 h-4" /> Add warranty
            </button>
          }
        />
      )}
      {!list.loading && !list.error && rows.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {rows.map((w, i) => (
            <motion.div
              key={w.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.04, 0.25), duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="sd-clay sd-clay-raise p-5 flex flex-col"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-sd-ink truncate">{w.provider ?? "Provider —"}</div>
                  <span className="sd-pill sd-pill-slate mt-1.5">{KIND_LABELS[w.kind] ?? w.kind}</span>
                </div>
                <StatusPill status={w.status} />
              </div>
              <div className="mt-3 flex items-center gap-2 min-w-0">
                <span className={monoBadge}>{w.installation?.assetCode ?? "—"}</span>
                <span className="text-xs text-sd-ink-soft truncate">{w.installation?.customer?.name ?? ""}</span>
              </div>
              <p className="text-sm text-sd-ink-soft mt-3 line-clamp-2 min-h-10 flex-1">
                {w.coverage ?? "No coverage description recorded."}
              </p>
              <div className="mt-3 pt-3 border-t border-sd-line/70 flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs text-sd-ink-soft whitespace-nowrap">
                  {fmtDate(w.startDate)} – {fmtDate(w.endDate)}
                </span>
                <DaysLeft days={w.daysLeft} />
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* add warranty dialog */}
      <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) setForm(emptyForm); }}>
        <DialogContent className="sm:max-w-xl w-[calc(100%-2rem)] rounded-2xl max-h-[90vh] overflow-y-auto sd-scroll">
          <DialogHeader>
            <DialogTitle className="text-sd-ink">Add warranty</DialogTitle>
            <DialogDescription>Record manufacturer or workmanship coverage for an installation.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Installation" required className="sm:col-span-2">
              <Select value={form.installationId} onValueChange={(v) => setForm({ ...form, installationId: v })}>
                <SelectTrigger className={selectCls} aria-label="Select installation">
                  <SelectValue placeholder="Choose the installation this warranty belongs to" />
                </SelectTrigger>
                <SelectContent>
                  {(meta.data?.installations ?? []).map((inst) => (
                    <SelectItem key={inst.id} value={inst.id}>
                      {inst.assetCode} · {customerNameById.get(inst.customerId) ?? "Customer"}{inst.city ? ` · ${inst.city}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Warranty kind" required className="sm:col-span-2">
              <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
                <SelectTrigger className={selectCls} aria-label="Warranty kind">
                  <SelectValue placeholder="What is covered?" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PANEL_PRODUCT">Panel product</SelectItem>
                  <SelectItem value="PANEL_PERFORMANCE">Panel performance</SelectItem>
                  <SelectItem value="INVERTER">Inverter</SelectItem>
                  <SelectItem value="SERVICE">Service workmanship</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Provider" required>
              <Input className={inputCls} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} placeholder="e.g. Waaree Energies" />
            </Field>
            <div className="hidden sm:block" aria-hidden="true" />
            <Field label="Coverage" required className="sm:col-span-2">
              <Textarea
                className={inputCls + " min-h-20"}
                value={form.coverage}
                onChange={(e) => setForm({ ...form, coverage: e.target.value })}
                placeholder="What the warranty covers, e.g. 12-year product defect replacement"
              />
            </Field>
            <Field label="Start date" required>
              <Input className={inputCls} type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </Field>
            <Field label="End date" required>
              <Input className={inputCls} type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </Field>
          </div>
          <DialogFooter>
            <button className={btnGhost} onClick={() => setAddOpen(false)} disabled={saving}>Cancel</button>
            <button className={btnPrimary} onClick={submitAdd} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Add warranty
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
