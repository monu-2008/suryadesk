"use client";
// SuryaDesk · Manager workspace · Installations module
// Card grid + register dialog + full installation detail (equipment, AMC,
// warranties, maintenance plan, service history). Capacity only — never generation.

import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, ClipboardList, Hash, Loader2, MapPin,
  Plus, Search, Sun, Zap,
} from "lucide-react";
import { api, qs, useApi } from "@/lib/surya/client";
import { fmtDate } from "@/lib/surya/types";
import { toast } from "@/hooks/use-toast";
import {
  EmptyState, LoadingBlock, PageHeader, SdAvatar, SectionCard, StatusPill,
} from "../shared/bits";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

// ── API types (contract) ────────────────────────────────────────────────
interface InstRow {
  id: string;
  assetCode: string;
  siteAddress: string | null;
  city: string | null;
  capacityKw: number | null;
  installDate: string | null;
  panelMake: string | null;
  panelModel: string | null;
  panelCount: number | null;
  inverterMake: string | null;
  inverterModel: string | null;
  serialNumber: string | null;
  status: string;
  customer: { id: string; name: string; city: string | null } | null;
  primaryAmc: { id: string; status: string; endDate: string | null } | null;
  warrantyCount: number;
}

interface InstListResp { total: number; page: number; pageSize: number; installations: InstRow[] }

interface MetaResp {
  customers: { id: string; name: string; city: string | null }[];
  installations: { id: string; assetCode: string; customerId: string; capacityKw: number | null; city: string | null }[];
  cities: string[];
}

interface Equipment {
  id: string;
  kind: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  quantity: number | null;
  installDate: string | null;
}

interface WarrLite {
  id: string;
  kind: string;
  provider: string | null;
  coverage: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
}

interface AmcLite {
  id: string;
  contractCode: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
  visitsUsed?: number | null;
  coveredVisits?: number | null;
}

interface Occurrence { id?: string; scheduledFor: string | null; status: string }
interface Plan { id?: string; name: string | null; intervalDays: number | null; occurrences: Occurrence[] }
interface JobLite { id: string; code: string; title: string | null; status: string; scheduledFor: string | null }

interface InstDetail extends InstRow {
  equipment: Equipment[];
  warranties: WarrLite[];
  amcContracts: AmcLite[];
  plans: Plan[];
  requests: unknown[];
  jobs: JobLite[];
}

// ── labels & helpers ────────────────────────────────────────────────────
const KIND_LABELS: Record<string, string> = {
  PANEL_PRODUCT: "Panel product",
  PANEL_PERFORMANCE: "Panel performance",
  INVERTER: "Inverter",
  SERVICE: "Service workmanship",
};

const EQUIP_KIND_LABELS: Record<string, string> = {
  PANEL: "Panel",
  INVERTER: "Inverter",
  BATTERY: "Battery",
  METER: "Meter",
};

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
const thCls = "text-left px-4 py-3 text-sd-ink-soft font-medium text-xs uppercase tracking-wide whitespace-nowrap";
const tdCls = "px-4 py-3 border-t border-sd-line/70 align-middle";
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
          <div className="font-semibold text-sd-ink text-sm">Couldn&apos;t load installations</div>
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

function InfoRow({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="w-4 h-4 text-sd-ink-soft mt-0.5 shrink-0" />
      <div className="min-w-0">
        <div className="text-[0.68rem] uppercase tracking-wide text-sd-ink-soft font-semibold">{label}</div>
        <div className="text-sm text-sd-ink mt-0.5 break-words">{value}</div>
      </div>
    </div>
  );
}

// ── installation detail dialog ──────────────────────────────────────────
function InstallationDetailDialog({ installationId, onClose }: { installationId: string; onClose: () => void }) {
  const { data, loading, error, refresh } = useApi<{ installation: InstDetail }>(`/api/installations/${installationId}`);
  const inst = data?.installation;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-3xl w-[calc(100%-2rem)] p-0 gap-0 rounded-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <DialogTitle className="sr-only">Loading installation</DialogTitle>
        {loading && <div className="p-6"><LoadingBlock label="Loading installation…" /></div>}
        {error && <div className="p-6"><ErrorCard message={error} onRetry={refresh} /></div>}
        {inst && (
          <>
            <DialogHeader className="px-5 sm:px-6 pt-5 pb-3 shrink-0">
              <div className="flex items-start justify-between gap-3 pr-8">
                <div className="min-w-0">
                  <DialogTitle className="text-lg font-bold text-sd-ink font-mono">{inst.assetCode}</DialogTitle>
                  <DialogDescription className="text-sm text-sd-ink-soft truncate">
                    {inst.customer?.name ?? "Unassigned"} · {fmtKw(inst.capacityKw)} · {inst.city ?? "—"}
                  </DialogDescription>
                </div>
                <StatusPill status={inst.status} />
              </div>
            </DialogHeader>

            <div className="px-5 sm:px-6 pb-5 overflow-y-auto sd-scroll">
              <Tabs defaultValue="overview">
                <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-sd-inset rounded-[0.875rem] p-1">
                  {[
                    ["overview", "Overview"],
                    ["amc", `AMC (${inst.amcContracts.length})`],
                    ["warranties", `Warranties (${inst.warranties.length})`],
                    ["maintenance", "Maintenance"],
                    ["service", `Service (${inst.jobs.length})`],
                  ].map(([v, l]) => (
                    <TabsTrigger
                      key={v}
                      value={v}
                      className="h-auto flex-none px-3 py-1.5 text-xs font-medium rounded-[0.6rem] text-sd-ink-soft data-[state=active]:bg-[var(--card)] data-[state=active]:text-sd-ink data-[state=active]:shadow-sm border-transparent"
                    >
                      {l}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {/* Overview */}
                <TabsContent value="overview" className="mt-4 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <InfoRow icon={Sun} label="Installed capacity" value={fmtKw(inst.capacityKw)} />
                    <InfoRow icon={CalendarDays} label="Commissioned" value={fmtDate(inst.installDate)} />
                    <InfoRow icon={MapPin} label="Site address" value={inst.siteAddress ?? "—"} />
                    <InfoRow icon={MapPin} label="City" value={inst.city ?? "—"} />
                    <InfoRow icon={Sun} label="Panels" value={[inst.panelMake, inst.panelModel].filter(Boolean).join(" ") || "—"} />
                    <InfoRow icon={Sun} label="Panel count" value={inst.panelCount != null ? `${inst.panelCount} panels` : "—"} />
                    <InfoRow icon={Zap} label="Inverter" value={[inst.inverterMake, inst.inverterModel].filter(Boolean).join(" ") || "—"} />
                    <InfoRow icon={Hash} label="Serial number" value={inst.serialNumber ?? "—"} />
                  </div>

                  <SectionCard title="Equipment" subtitle="Components registered on this site" bodyClassName="p-0 sm:p-0">
                    {inst.equipment.length === 0 ? (
                      <MiniEmpty text="No equipment components recorded." />
                    ) : (
                      <div className="overflow-x-auto sd-scroll">
                        <table className="w-full text-sm">
                          <thead>
                            <tr>
                              <th className={thCls}>Kind</th>
                              <th className={thCls}>Brand</th>
                              <th className={thCls}>Model</th>
                              <th className={thCls}>Serial</th>
                              <th className={thCls}>Qty</th>
                              <th className={thCls}>Installed</th>
                            </tr>
                          </thead>
                          <tbody>
                            {inst.equipment.map((eq) => (
                              <tr key={eq.id}>
                                <td className={tdCls + " font-medium text-sd-ink"}>{EQUIP_KIND_LABELS[eq.kind] ?? eq.kind}</td>
                                <td className={tdCls + " text-sd-ink"}>{eq.brand ?? "—"}</td>
                                <td className={tdCls + " text-sd-ink-soft"}>{eq.model ?? "—"}</td>
                                <td className={tdCls + " font-mono text-xs text-sd-ink-soft"}>{eq.serialNumber ?? "—"}</td>
                                <td className={tdCls + " text-sd-ink"}>{eq.quantity ?? "—"}</td>
                                <td className={tdCls + " text-sd-ink-soft whitespace-nowrap"}>{fmtDate(eq.installDate)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </SectionCard>
                </TabsContent>

                {/* AMC */}
                <TabsContent value="amc" className="mt-4">
                  {inst.amcContracts.length === 0 ? (
                    <MiniEmpty text="No AMC contracts attached to this installation." />
                  ) : (
                    <ul className="divide-y divide-sd-line/70">
                      {inst.amcContracts.map((c) => (
                        <li key={c.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                          <span className={monoBadge}>{c.contractCode}</span>
                          <div className="flex items-center gap-3 text-xs text-sd-ink-soft flex-wrap">
                            <span>{fmtDate(c.startDate)} – {fmtDate(c.endDate)}</span>
                            {c.coveredVisits != null && (
                              <span className="font-medium text-sd-ink">{c.visitsUsed ?? 0}/{c.coveredVisits} visits</span>
                            )}
                            <StatusPill status={c.status} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>

                {/* Warranties */}
                <TabsContent value="warranties" className="mt-4">
                  {inst.warranties.length === 0 ? (
                    <MiniEmpty text="No warranties recorded for this installation." />
                  ) : (
                    <ul className="divide-y divide-sd-line/70">
                      {inst.warranties.map((w) => (
                        <li key={w.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-sd-ink">{KIND_LABELS[w.kind] ?? w.kind}</div>
                            <div className="text-xs text-sd-ink-soft">{w.provider ?? "Manufacturer"} · {fmtDate(w.startDate)} – {fmtDate(w.endDate)}</div>
                          </div>
                          <StatusPill status={w.status} />
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>

                {/* Maintenance plan */}
                <TabsContent value="maintenance" className="mt-4 space-y-3">
                  {inst.plans.length === 0 ? (
                    <MiniEmpty text="No maintenance plan yet — create an AMC contract to generate scheduled visits." />
                  ) : (
                    inst.plans.map((plan, i) => (
                      <div key={plan.id ?? i} className="sd-inset rounded-[0.875rem] p-4">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2 min-w-0">
                            <ClipboardList className="w-4 h-4 text-sd-forest shrink-0" />
                            <span className="text-sm font-semibold text-sd-ink truncate">{plan.name ?? "Maintenance plan"}</span>
                          </div>
                          {plan.intervalDays != null && (
                            <span className="sd-pill sd-pill-teal">every {plan.intervalDays} days</span>
                          )}
                        </div>
                        {plan.occurrences.length === 0 ? (
                          <p className="text-xs text-sd-ink-soft mt-3">No scheduled visits generated yet.</p>
                        ) : (
                          <ul className="mt-3 max-h-64 overflow-y-auto sd-scroll divide-y divide-sd-line/50 pr-1">
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
                </TabsContent>

                {/* Service history */}
                <TabsContent value="service" className="mt-4">
                  {inst.jobs.length === 0 ? (
                    <MiniEmpty text="No service jobs recorded for this installation." />
                  ) : (
                    <ul className="divide-y divide-sd-line/70">
                      {inst.jobs.map((j) => (
                        <li key={j.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className={monoBadge}>{j.code}</span>
                            <span className="text-sm text-sd-ink truncate">{j.title ?? "Service job"}</span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-sd-ink-soft flex-wrap">
                            <span>{j.scheduledFor ? fmtDate(j.scheduledFor) : "—"}</span>
                            <StatusPill status={j.status} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>
              </Tabs>
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
  siteAddress: "",
  city: "",
  capacityKw: "",
  installDate: "",
  panelMake: "",
  panelModel: "",
  panelCount: "",
  inverterMake: "",
  inverterModel: "",
  serialNumber: "",
};

export default function InstallationsView() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 300);
  const [city, setCity] = useState("ALL");
  const [page, setPage] = useState(1);
  const pageSize = 9;

  useEffect(() => setPage(1), [debouncedSearch, city]);

  const list = useApi<InstListResp>(
    `/api/installations${qs({ search: debouncedSearch, city: city === "ALL" ? "" : city, page, pageSize })}`
  );
  const meta = useApi<MetaResp>("/api/meta");

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const rows = list.data?.installations ?? [];
  const total = list.data?.total ?? 0;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  async function submitAdd() {
    if (!form.customerId || !form.siteAddress.trim() || !form.city.trim() || !form.capacityKw || !form.installDate) {
      toast({ variant: "destructive", title: "Check the form", description: "Customer, site address, city, capacity and install date are required." });
      return;
    }
    const capacity = Number(form.capacityKw);
    if (!Number.isFinite(capacity) || capacity <= 0) {
      toast({ variant: "destructive", title: "Check the form", description: "Capacity must be a positive number in kW." });
      return;
    }
    setSaving(true);
    try {
      await api("/api/installations", {
        method: "POST",
        json: {
          customerId: form.customerId,
          siteAddress: form.siteAddress.trim(),
          city: form.city.trim(),
          capacityKw: capacity,
          installDate: form.installDate,
          panelMake: form.panelMake.trim() || undefined,
          panelModel: form.panelModel.trim() || undefined,
          panelCount: form.panelCount ? Number(form.panelCount) : undefined,
          inverterMake: form.inverterMake.trim() || undefined,
          inverterModel: form.inverterModel.trim() || undefined,
          serialNumber: form.serialNumber.trim() || undefined,
        },
      });
      toast({ title: "Installation registered", description: `${capacity} kW site added to your portfolio.` });
      setAddOpen(false);
      setForm(emptyForm);
      list.refresh();
      meta.refresh();
    } catch (e) {
      toast({ variant: "destructive", title: "Could not register installation", description: e instanceof Error ? e.message : "Please try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
      <PageHeader
        title="Installations"
        subtitle="Every commissioned site in your portfolio — capacity, equipment, contracts and upkeep."
        actions={
          <button className={btnPrimary} onClick={() => setAddOpen(true)}>
            <Plus className="w-4 h-4" /> Register installation
          </button>
        }
      />

      {/* toolbar */}
      <div className="sd-clay p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-sd-ink-soft pointer-events-none" />
          <input
            className={inputCls + " pl-10"}
            placeholder="Search asset code, customer, site…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search installations"
          />
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={city} onValueChange={setCity}>
            <SelectTrigger className={selectCls + " w-40"} aria-label="Filter by city">
              <SelectValue placeholder="All cities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All cities</SelectItem>
              {(meta.data?.cities ?? []).map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-sd-ink-soft whitespace-nowrap font-medium">
            {total} result{total === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {/* grid */}
      {list.loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="sd-clay p-5 h-52 animate-pulse" style={{ animationDelay: `${i * 90}ms` }} />
          ))}
        </div>
      )}
      {list.error && !list.loading && <ErrorCard message={list.error} onRetry={list.refresh} />}
      {!list.loading && !list.error && rows.length === 0 && (
        <EmptyState
          icon={Sun}
          title="No installations found"
          body={search || city !== "ALL" ? "Try clearing the filters or searching for something else." : "Register your first installation to attach contracts, warranties and service jobs."}
          action={
            <button className={btnPrimary} onClick={() => setAddOpen(true)}>
              <Plus className="w-4 h-4" /> Register installation
            </button>
          }
        />
      )}
      {!list.loading && !list.error && rows.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {rows.map((inst, i) => (
              <motion.button
                key={inst.id}
                type="button"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.05, 0.3), duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                onClick={() => setDetailId(inst.id)}
                className="sd-clay sd-clay-raise sd-focus p-5 text-left w-full"
                aria-label={`Open installation ${inst.assetCode}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-xs font-bold text-sd-forest">{inst.assetCode}</span>
                  <StatusPill status={inst.status} />
                </div>
                <div className="flex items-center gap-2.5 mt-3 min-w-0">
                  <SdAvatar name={inst.customer?.name ?? "?"} size={32} />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-sd-ink truncate">{inst.customer?.name ?? "Unassigned"}</div>
                    <div className="text-xs text-sd-ink-soft truncate">
                      {inst.city ?? "—"}{inst.siteAddress ? ` · ${inst.siteAddress}` : ""}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-3.5">
                  <span className="sd-pill sd-pill-amber">{fmtKw(inst.capacityKw)}</span>
                  {inst.primaryAmc && <StatusPill status={inst.primaryAmc.status} />}
                  {inst.warrantyCount > 0 && (
                    <span className="sd-pill sd-pill-slate">{inst.warrantyCount} warrant{inst.warrantyCount === 1 ? "y" : "ies"}</span>
                  )}
                </div>
                <div className="mt-3.5 pt-3.5 border-t border-sd-line/70 grid grid-cols-2 gap-2 text-xs text-sd-ink-soft">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Sun className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{[inst.panelMake, inst.panelCount ? `${inst.panelCount}×` : null].filter(Boolean).join(" ") || "Panels —"}</span>
                  </div>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Zap className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{inst.inverterMake ?? "Inverter —"}</span>
                  </div>
                </div>
                <div className="mt-2 text-[0.7rem] text-sd-ink-soft">Installed {fmtDate(inst.installDate)}</div>
              </motion.button>
            ))}
          </div>

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

      {/* register dialog */}
      <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) setForm(emptyForm); }}>
        <DialogContent className="sm:max-w-2xl w-[calc(100%-2rem)] rounded-2xl max-h-[90vh] overflow-y-auto sd-scroll">
          <DialogHeader>
            <DialogTitle className="text-sd-ink">Register installation</DialogTitle>
            <DialogDescription>Add a commissioned site — capacity is the installed DC/AC size in kW.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Customer" required className="sm:col-span-2">
              <Select value={form.customerId} onValueChange={(v) => setForm({ ...form, customerId: v })}>
                <SelectTrigger className={selectCls} aria-label="Select customer">
                  <SelectValue placeholder="Choose the customer who owns this site" />
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
            <Field label="Site address" required className="sm:col-span-2">
              <Input className={inputCls} value={form.siteAddress} onChange={(e) => setForm({ ...form, siteAddress: e.target.value })} placeholder="Roof no. / street, locality" />
            </Field>
            <Field label="City" required>
              <Input className={inputCls} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="e.g. Nashik" />
            </Field>
            <Field label="Installed capacity (kW)" required>
              <Input className={inputCls} type="number" step="0.5" min="0.1" value={form.capacityKw} onChange={(e) => setForm({ ...form, capacityKw: e.target.value })} placeholder="e.g. 5" />
            </Field>
            <Field label="Install date" required>
              <Input className={inputCls} type="date" value={form.installDate} onChange={(e) => setForm({ ...form, installDate: e.target.value })} />
            </Field>
            <Field label="Serial number">
              <Input className={inputCls} value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} placeholder="System serial (optional)" />
            </Field>
            <Field label="Panel make">
              <Input className={inputCls} value={form.panelMake} onChange={(e) => setForm({ ...form, panelMake: e.target.value })} placeholder="e.g. Waaree" />
            </Field>
            <Field label="Panel model">
              <Input className={inputCls} value={form.panelModel} onChange={(e) => setForm({ ...form, panelModel: e.target.value })} placeholder="e.g. WS-325" />
            </Field>
            <Field label="Panel count">
              <Input className={inputCls} type="number" min="1" value={form.panelCount} onChange={(e) => setForm({ ...form, panelCount: e.target.value })} placeholder="e.g. 16" />
            </Field>
            <Field label="Inverter make">
              <Input className={inputCls} value={form.inverterMake} onChange={(e) => setForm({ ...form, inverterMake: e.target.value })} placeholder="e.g. SolarEdge" />
            </Field>
            <Field label="Inverter model">
              <Input className={inputCls} value={form.inverterModel} onChange={(e) => setForm({ ...form, inverterModel: e.target.value })} placeholder="e.g. SE5000" />
            </Field>
          </div>
          <DialogFooter>
            <button className={btnGhost} onClick={() => setAddOpen(false)} disabled={saving}>Cancel</button>
            <button className={btnPrimary} onClick={submitAdd} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Register installation
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* detail dialog */}
      {detailId && <InstallationDetailDialog installationId={detailId} onClose={() => setDetailId(null)} />}
    </motion.div>
  );
}
