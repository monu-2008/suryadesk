"use client";
// SuryaDesk customer portal — the homeowner's simple, reassuring view of their
// solar service relationship. Shows INSTALLED CAPACITY (kW) only — never
// generation / kWh / savings figures.
import { Fragment, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  House, PanelTop, FileText, Wrench, ClipboardCheck, User, Grid3x3, Zap, Cog, Sun,
  Check, X, CheckCircle2, Clock, CalendarDays, MapPin, Phone, Mail, LogOut, Info,
  AlertTriangle, ChevronDown, ChevronRight, LifeBuoy, Loader2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, useApi, qs } from "@/lib/surya/client";
import { useSd } from "@/lib/surya/store";
import {
  REQUEST_CATEGORY_LABELS, REQUEST_CATEGORIES, REQUEST_STATUSES, STATUS_LABELS,
  fmtDate, fmtDateTime, relativeDay, parseJson,
} from "@/lib/surya/types";
import { StatusPill, EmptyState, SkeletonRows, SdAvatar } from "@/components/suryadesk/shared/bits";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ── portal data types (mirror GET /api/portal) ──────────────────
interface PortalEquipment { id: string; kind: string; brand: string; model: string; serialNumber?: string | null; quantity: number }
interface PortalWarranty { id: string; kind: string; provider: string; coverage: string; startDate: string; endDate: string; status: string }
interface PortalOccurrence { id: string; dueDate: string; status: string }
interface PortalPlan { id: string; name: string; intervalDays: number; occurrences: PortalOccurrence[] }
interface PortalAmc {
  id: string; contractCode: string; startDate: string; endDate: string; status: string;
  visitIntervalDays: number; coveredVisits: number; visitsUsed: number;
  includedServices: string; excludedServices: string; emergencyTat?: string | null;
}
interface PortalInstallation {
  id: string; assetCode: string; capacityKw: number; installDate: string; siteAddress: string; city: string;
  panelMake: string; panelModel: string; panelCount: number; inverterMake: string; inverterModel: string;
  serialNumber: string; status: string;
  equipment: PortalEquipment[]; warranties: PortalWarranty[]; amcContracts: PortalAmc[]; plans: PortalPlan[];
}
interface PortalJob {
  id: string; code: string; title: string; status: string; scheduledFor: string; type?: string;
  installation?: { assetCode: string } | null; technician?: { name: string; phone: string } | null; report?: { id: string } | null;
}
interface PortalRequest {
  id: string; code: string; category: string; description: string; status: string; priority: string;
  createdAt: string; jobs?: PortalJob[];
}
interface PortalReport {
  id: string; summary: string; technicianNotes: string; followUpNeeded: boolean; followUpNotes?: string | null;
  acknowledgedByOtp: boolean; acknowledgedAt?: string | null; publishedAt: string;
  checklistJson: string; photosJson: string; job: { code: string; title: string; type: string };
}
interface PortalCustomer {
  id: string; name: string; email: string; phone: string; city: string;
  installations: PortalInstallation[]; requests: PortalRequest[]; upcomingJobs: PortalJob[]; reports: PortalReport[];
}
interface PortalData {
  org: { name: string | null; supportEmail: string | null; phone: string | null };
  customer: PortalCustomer | null;
}
interface RequestsListResponse {
  total: number; page: number; pageSize: number; counts: Record<string, number>;
  requests: {
    id: string; code: string; category: string; description: string; status: string; priority: string;
    createdAt: string; source?: string;
    jobs: { id: string; code: string; status: string; scheduledFor?: string | null }[];
  }[];
}

const WARRANTY_KIND_LABELS: Record<string, string> = {
  PANEL_PRODUCT: "Panel product warranty",
  PANEL_PERFORMANCE: "Panel performance warranty",
  INVERTER: "Inverter warranty",
  SERVICE: "Installation workmanship warranty",
};
const EQUIP_KIND_LABELS: Record<string, string> = { PANEL: "Panel", INVERTER: "Inverter", METER: "Meter", STRUCTURE: "Structure" };
function equipIcon(kind: string): LucideIcon {
  if (kind === "PANEL") return Grid3x3;
  if (kind === "INVERTER") return Zap;
  return Cog;
}
const OPEN_FLAG = "sd-portal-new-request"; // sessionStorage hand-off (home CTA → service tab dialog)

// ── root ────────────────────────────────────────────────────────
export default function CustomerPortal({ view = "portal:home" }: { view: string }) {
  const active = (view.split(":")[1] || "home").trim().toLowerCase() || "home";
  const { setView } = useSd();
  const { data, loading, error, refresh } = useApi<PortalData>("/api/portal");

  const tabs: { view: string; label: string; icon: LucideIcon }[] = [
    { view: "home", label: "Home", icon: House },
    { view: "solar", label: "My Solar", icon: PanelTop },
    { view: "contracts", label: "Contracts", icon: FileText },
    { view: "requests", label: "Service", icon: Wrench },
    { view: "reports", label: "Reports", icon: ClipboardCheck },
    { view: "profile", label: "Profile", icon: User },
  ];

  const raiseRequest = () => {
    try { sessionStorage.setItem(OPEN_FLAG, "1"); } catch { /* storage unavailable */ }
    setView("portal:requests");
  };

  return (
    <div>
      {/* friendly pill nav — sticky under the topbar, scrollable on mobile */}
      <div className="sticky top-16 z-30 -mx-4 sm:-mx-6 lg:-mx-8 bg-sd-cream/90 backdrop-blur-md border-b border-sd-line/80">
        <nav aria-label="Portal sections" className="max-w-3xl mx-auto px-4 sm:px-6 py-2.5 flex items-center gap-1.5 overflow-x-auto sd-scroll">
          {tabs.map((t) => {
            const isActive = t.view === active;
            return (
              <button
                key={t.view}
                onClick={() => setView("portal:" + t.view)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative shrink-0 flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[0.82rem] font-medium transition-colors sd-focus",
                  isActive ? "text-sd-forest-deep" : "text-sd-ink-soft hover:text-sd-ink"
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="portal-pill"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    className="absolute inset-0 rounded-full bg-[#176B52]/10 border border-[#176B52]/20"
                  />
                )}
                <t.icon className="w-4 h-4 relative" strokeWidth={isActive ? 2.3 : 2} />
                <span className="relative whitespace-nowrap">{t.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 pb-24">
        {loading ? (
          <SkeletonRows rows={6} />
        ) : error ? (
          <ErrorRetryCard message={error} onRetry={refresh} />
        ) : !data?.customer ? (
          <EmptyState
            icon={User}
            title="No customer profile linked to this account"
            body="Please contact your solar service provider so they can link your account to your customer record."
          />
        ) : active === "solar" ? (
          <SolarScreen c={data.customer} />
        ) : active === "contracts" ? (
          <ContractsScreen c={data.customer} />
        ) : active === "requests" ? (
          <ServiceScreen c={data.customer} refreshPortal={refresh} />
        ) : active === "reports" ? (
          <ReportsScreen c={data.customer} />
        ) : active === "profile" ? (
          <ProfileScreen org={data.org} c={data.customer} />
        ) : (
          <HomeScreen d={data} onRaiseRequest={raiseRequest} go={(v) => setView(v)} />
        )}
      </div>
    </div>
  );
}

// ── shared helpers ──────────────────────────────────────────────
function ErrorRetryCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="sd-clay p-8 flex flex-col items-center text-center">
      <div className="rounded-3xl bg-[#C94B55]/10 p-4 mb-4">
        <AlertTriangle className="w-7 h-7 text-[#a03340]" />
      </div>
      <div className="font-semibold text-sd-ink">We couldn&apos;t load this page</div>
      <p className="text-sm text-sd-ink-soft mt-1.5 max-w-sm">{message}</p>
      <button onClick={onRetry} className="mt-5 sd-btn-primary px-5 py-2.5 text-sm font-semibold sd-focus">
        Try again
      </button>
    </div>
  );
}

function ScreenHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-[1.45rem] sm:text-[1.7rem] font-bold tracking-tight text-sd-ink">{title}</h1>
      {subtitle && <p className="text-sm text-sd-ink-soft mt-1">{subtitle}</p>}
    </div>
  );
}

function SummaryCard({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: React.ReactNode }) {
  return (
    <div className="sd-clay p-4 flex items-start gap-3">
      <div className="rounded-2xl bg-[#176B52]/10 text-sd-forest p-2.5 shrink-0">
        <Icon className="w-[1.05rem] h-[1.05rem]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[0.66rem] font-bold uppercase tracking-wide text-sd-ink-soft">{label}</div>
        <div className="mt-1.5">{children}</div>
      </div>
    </div>
  );
}

// ── Home ────────────────────────────────────────────────────────
function HomeScreen({ d, onRaiseRequest, go }: { d: PortalData; onRaiseRequest: () => void; go: (v: string) => void }) {
  const c = d.customer!;
  const first = c.name.split(/\s+/)[0] || c.name;
  const totalKw = Math.round(c.installations.reduce((s, i) => s + (i.capacityKw ?? 0), 0) * 10) / 10;
  const amcs = c.installations.flatMap((i) => i.amcContracts);
  const newestAmc = amcs.reduce<PortalAmc | null>((best, a) => {
    if (!best) return a;
    return new Date(a.startDate) >= new Date(best.startDate) ? a : best;
  }, null);
  const nextJob = c.upcomingJobs[0];
  const nextOccurrence = c.installations
    .flatMap((i) => i.plans.flatMap((p) => p.occurrences))
    .reduce<string | null>((min, o) => (!min || new Date(o.dueDate) < new Date(min) ? o.dueDate : min), null);
  const nextVisitAt = nextJob?.scheduledFor ?? nextOccurrence;
  const openRequests = c.requests.filter((r) => !["CLOSED", "REJECTED"].includes(r.status));
  const latestReport = c.reports[0];
  const orgName = d.org.name ?? "your service provider";

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-[1.5rem] sm:text-[1.75rem] font-bold tracking-tight text-sd-ink">
          Welcome back, {first}
        </h1>
        <p className="text-sm text-sd-ink-soft mt-1">Here&apos;s a snapshot of your solar service.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SummaryCard icon={PanelTop} label="My installations">
          <div className="text-[1.3rem] font-bold tracking-tight text-sd-ink leading-none">{c.installations.length}</div>
          <div className="text-[0.7rem] text-sd-forest mt-1 font-medium">
            {totalKw > 0 ? `${totalKw} kW installed` : "on record"}
          </div>
        </SummaryCard>
        <SummaryCard icon={FileText} label="Active AMC">
          {newestAmc ? (
            <>
              <StatusPill status={newestAmc.status} />
              <div className="text-[0.7rem] text-sd-ink-soft mt-1.5 truncate">{newestAmc.contractCode}</div>
            </>
          ) : (
            <div className="text-[1.3rem] font-bold tracking-tight text-sd-ink leading-none">—</div>
          )}
        </SummaryCard>
        <SummaryCard icon={CalendarDays} label="Next service visit">
          {nextVisitAt ? (
            <>
              <div className="text-[1.02rem] font-bold text-sd-ink leading-tight">{fmtDate(nextVisitAt)}</div>
              <div className="text-[0.7rem] text-sd-forest mt-1 font-medium">{relativeDay(nextVisitAt)}</div>
            </>
          ) : (
            <div className="text-[1.3rem] font-bold tracking-tight text-sd-ink leading-none">—</div>
          )}
        </SummaryCard>
        <SummaryCard icon={Wrench} label="Open requests">
          <div className="text-[1.3rem] font-bold tracking-tight text-sd-ink leading-none">{openRequests.length}</div>
          <div className="text-[0.7rem] text-sd-ink-soft mt-1 font-medium truncate">
            {openRequests[0] ? `Latest ${openRequests[0].code}` : "Nothing pending"}
          </div>
        </SummaryCard>
      </div>

      {/* raise a request CTA */}
      <div className="sd-clay p-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="rounded-2xl bg-[#176B52]/10 text-sd-forest p-3.5 shrink-0 self-start sm:self-center">
          <Wrench className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sd-ink">Need help with your system?</div>
          <p className="text-sm text-sd-ink-soft mt-0.5">
            Tell us what you noticed — our team will review it and schedule a visit if needed.
          </p>
        </div>
        <button onClick={onRaiseRequest} className="sd-btn-primary px-5 py-3 text-sm font-semibold sd-focus">
          Raise a service request
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* upcoming visit */}
        {nextJob ? (
          <article className="sd-clay p-5">
            <div className="flex items-center gap-2 text-[0.66rem] font-bold uppercase tracking-wide text-sd-forest">
              <CalendarDays className="w-3.5 h-3.5" /> Next visit
            </div>
            <div className="mt-2 font-semibold text-sd-ink leading-snug">
              {nextJob.code} · {nextJob.title}
            </div>
            <div className="text-sm text-sd-ink-soft mt-1">
              {fmtDateTime(nextJob.scheduledFor)} ({relativeDay(nextJob.scheduledFor)})
            </div>
            <div className="text-sm text-sd-ink-soft mt-0.5">
              System {nextJob.installation?.assetCode ?? "—"}
            </div>
            <div className="text-sm text-sd-ink-soft mt-0.5">
              {nextJob.technician ? (
                <>Technician {nextJob.technician.name} · {nextJob.technician.phone}</>
              ) : (
                <>Technician being assigned — we&apos;ll share details before the visit.</>
              )}
            </div>
            <div className="mt-3"><StatusPill status={nextJob.status} /></div>
          </article>
        ) : (
          <article className="sd-clay p-5">
            <div className="flex items-center gap-2 text-[0.66rem] font-bold uppercase tracking-wide text-sd-forest">
              <CalendarDays className="w-3.5 h-3.5" /> Next visit
            </div>
            <p className="text-sm text-sd-ink-soft mt-2 leading-relaxed">
              No service visit scheduled right now. We&apos;ll notify you when one is planned — you can also see
              upcoming maintenance dates under Contracts.
            </p>
          </article>
        )}

        {/* latest report */}
        {latestReport ? (
          <article className="sd-clay p-5">
            <div className="flex items-center gap-2 text-[0.66rem] font-bold uppercase tracking-wide text-sd-forest">
              <ClipboardCheck className="w-3.5 h-3.5" /> Latest service report
            </div>
            <div className="mt-2 font-semibold text-sd-ink leading-snug">
              {latestReport.job.code} · {latestReport.job.title}
            </div>
            <div className="text-sm text-sd-ink-soft mt-1">{fmtDate(latestReport.publishedAt)}</div>
            <p className="text-sm text-sd-ink mt-2 leading-relaxed line-clamp-2">{latestReport.summary}</p>
            <div className="mt-3 flex items-center gap-2 text-xs">
              {latestReport.acknowledgedByOtp ? (
                <span className="flex items-center gap-1.5 text-sd-success font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Confirmed by you via OTP
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-sd-ink-soft">
                  <Clock className="w-3.5 h-3.5" /> Awaiting your OTP confirmation
                </span>
              )}
            </div>
            <button onClick={() => go("portal:reports")} className="mt-3 text-sm font-semibold text-sd-forest hover:underline sd-focus rounded">
              View report →
            </button>
          </article>
        ) : (
          <article className="sd-clay p-5">
            <div className="flex items-center gap-2 text-[0.66rem] font-bold uppercase tracking-wide text-sd-forest">
              <ClipboardCheck className="w-3.5 h-3.5" /> Latest service report
            </div>
            <p className="text-sm text-sd-ink-soft mt-2 leading-relaxed">
              No service reports yet — they appear here after a visit is completed and published.
            </p>
          </article>
        )}
      </div>

      {/* support */}
      <article className="sd-clay p-5">
        <div className="flex items-center gap-2 text-[0.66rem] font-bold uppercase tracking-wide text-sd-forest">
          <LifeBuoy className="w-3.5 h-3.5" /> Need to talk to us?
        </div>
        <div className="mt-3 grid sm:grid-cols-2 gap-3">
          {d.org.supportEmail && (
            <a href={`mailto:${d.org.supportEmail}`} className="flex items-center gap-2.5 text-sm text-sd-ink hover:text-sd-forest sd-clay-sm px-3.5 py-2.5 transition-colors">
              <Mail className="w-4 h-4 text-sd-forest shrink-0" /> <span className="truncate">{d.org.supportEmail}</span>
            </a>
          )}
          {d.org.phone && (
            <a href={`tel:${d.org.phone}`} className="flex items-center gap-2.5 text-sm text-sd-ink hover:text-sd-forest sd-clay-sm px-3.5 py-2.5 transition-colors">
              <Phone className="w-4 h-4 text-sd-forest shrink-0" /> <span className="truncate">{d.org.phone}</span>
            </a>
          )}
          {!d.org.supportEmail && !d.org.phone && (
            <p className="text-sm text-sd-ink-soft">Please reach out to your provider at their office.</p>
          )}
        </div>
        <p className="text-xs text-sd-ink-soft mt-3">Service by {orgName}.</p>
      </article>
    </section>
  );
}

// ── My Solar ────────────────────────────────────────────────────
function SolarScreen({ c }: { c: PortalCustomer }) {
  return (
    <section>
      <ScreenHeader title="My Solar" subtitle="Your installed systems and the equipment on record." />
      {c.installations.length === 0 ? (
        <EmptyState
          icon={PanelTop}
          title="No installations on record yet"
          body="Once your provider adds your system to SuryaDesk, it will appear here."
        />
      ) : (
        <div className="space-y-4">
          {c.installations.map((inst) => (
            <InstallationCard key={inst.id} inst={inst} />
          ))}
        </div>
      )}
    </section>
  );
}

function InstallationCard({ inst }: { inst: PortalInstallation }) {
  return (
    <article className="sd-clay p-5">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="font-bold text-sd-ink">{inst.assetCode}</h2>
        <span className="sd-pill bg-[#176B52]/10 text-[#116b53]">{inst.capacityKw} kW installed</span>
        <StatusPill status={inst.status} className="ml-auto" />
      </header>
      <ul className="mt-3.5 space-y-2 text-sm">
        <li className="flex items-start gap-2.5 text-sd-ink">
          <MapPin className="w-4 h-4 text-sd-forest mt-0.5 shrink-0" />
          <span>{inst.siteAddress}{inst.city ? `, ${inst.city}` : ""}</span>
        </li>
        <li className="flex items-start gap-2.5 text-sd-ink">
          <CalendarDays className="w-4 h-4 text-sd-forest mt-0.5 shrink-0" />
          <span>Installed {fmtDate(inst.installDate)}</span>
        </li>
        <li className="flex items-start gap-2.5 text-sd-ink">
          <Sun className="w-4 h-4 text-sd-forest mt-0.5 shrink-0" />
          <span>
            {inst.panelCount} × {inst.panelMake} {inst.panelModel} panels · {inst.inverterMake} {inst.inverterModel} inverter
          </span>
        </li>
      </ul>

      {inst.equipment.length > 0 && (
        <div className="mt-4 sd-inset p-3.5">
          <div className="text-[0.66rem] font-bold uppercase tracking-wide text-sd-ink-soft mb-2.5">Equipment on record</div>
          <ul className="space-y-2">
            {inst.equipment.map((e) => {
              const Icon = equipIcon(e.kind);
              return (
                <li key={e.id} className="flex items-center gap-3 text-sm">
                  <span className="rounded-lg bg-white/80 text-sd-forest p-1.5 shrink-0">
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className="text-sd-ink font-medium min-w-0 truncate">{e.brand} {e.model}</span>
                  <span className="text-sd-ink-soft shrink-0">× {e.quantity}</span>
                  <span className="ml-auto sd-pill sd-pill-slate shrink-0">{EQUIP_KIND_LABELS[e.kind] ?? e.kind}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mt-3.5 text-xs text-sd-ink-soft">Serial no. {inst.serialNumber || "—"}</div>
    </article>
  );
}

// ── Contracts ───────────────────────────────────────────────────
function ContractsScreen({ c }: { c: PortalCustomer }) {
  const amcs = c.installations.flatMap((i) => i.amcContracts.map((a) => ({ ...a, assetCode: i.assetCode })));
  const warranties = c.installations.flatMap((i) => i.warranties.map((w) => ({ ...w, assetCode: i.assetCode })));
  const plans = c.installations.flatMap((i) => i.plans.map((p) => ({ ...p, assetCode: i.assetCode })));

  return (
    <section className="space-y-7">
      <ScreenHeader title="Contracts & cover" subtitle="Your AMC contracts, warranties and maintenance schedule in one place." />

      <div>
        <h2 className="text-[0.95rem] font-bold text-sd-ink mb-3">AMC contracts</h2>
        {amcs.length === 0 ? (
          <p className="text-sm text-sd-ink-soft">No AMC contracts on record.</p>
        ) : (
          <div className="space-y-4">
            {amcs.map((a) => <AmcCard key={a.id} amc={a} />)}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-[0.95rem] font-bold text-sd-ink mb-3">Warranties</h2>
        {warranties.length === 0 ? (
          <p className="text-sm text-sd-ink-soft">No warranties on record.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {warranties.map((w) => <WarrantyCard key={w.id} w={w} />)}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-[0.95rem] font-bold text-sd-ink mb-3">Maintenance schedule</h2>
        {plans.length === 0 ? (
          <p className="text-sm text-sd-ink-soft">No maintenance plans on record.</p>
        ) : (
          <div className="space-y-4">
            {plans.map((p) => <PlanCard key={p.id} plan={p} />)}
          </div>
        )}
      </div>
    </section>
  );
}

function AmcCard({ amc }: { amc: PortalAmc & { assetCode: string } }) {
  const included = parseJson<string[]>(amc.includedServices, []);
  const excluded = parseJson<string[]>(amc.excludedServices, []);
  const visitPct = amc.coveredVisits > 0 ? Math.min(100, Math.round((amc.visitsUsed / amc.coveredVisits) * 100)) : 0;

  return (
    <article className="sd-clay p-5">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="font-bold text-sd-ink">{amc.contractCode}</h3>
        <span className="text-xs text-sd-ink-soft">{amc.assetCode}</span>
        <StatusPill status={amc.status} className="ml-auto" />
      </header>
      <div className="text-sm text-sd-ink-soft mt-1">{fmtDate(amc.startDate)} – {fmtDate(amc.endDate)}</div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-sd-ink-soft">Service visits</span>
          <span className="font-semibold text-sd-ink">{amc.visitsUsed} of {amc.coveredVisits} used</span>
        </div>
        {amc.coveredVisits > 0 && (
          <div className="mt-2 h-2 rounded-full bg-sd-inset overflow-hidden" role="progressbar" aria-valuenow={visitPct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-sd-forest" style={{ width: `${visitPct}%` }} />
          </div>
        )}
      </div>

      <div className="mt-4 grid sm:grid-cols-2 gap-4">
        <div>
          <div className="text-[0.66rem] font-bold uppercase tracking-wide text-sd-forest mb-2">What&apos;s included</div>
          {included.length === 0 ? (
            <p className="text-sm text-sd-ink-soft">—</p>
          ) : (
            <ul className="space-y-1.5">
              {included.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-sd-ink">
                  <Check className="w-4 h-4 text-sd-success mt-0.5 shrink-0" /> {s}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="text-[0.66rem] font-bold uppercase tracking-wide text-[#a03340] mb-2">Not included</div>
          {excluded.length === 0 ? (
            <p className="text-sm text-sd-ink-soft">—</p>
          ) : (
            <ul className="space-y-1.5">
              {excluded.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-sd-ink">
                  <X className="w-4 h-4 text-[#a03340] mt-0.5 shrink-0" /> {s}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {amc.emergencyTat && (
        <div className="mt-4 flex items-center gap-2.5 text-sm text-sd-ink">
          <Phone className="w-4 h-4 text-sd-forest" />
          Emergency response within {amc.emergencyTat}
        </div>
      )}
    </article>
  );
}

function WarrantyCard({ w }: { w: PortalWarranty & { assetCode: string } }) {
  return (
    <article className="sd-clay p-5">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-sd-ink text-[0.95rem] leading-snug">{WARRANTY_KIND_LABELS[w.kind] ?? w.kind}</h3>
        <StatusPill status={w.status} className="ml-auto" />
      </header>
      <ul className="mt-2.5 space-y-1.5 text-sm">
        <li className="text-sd-ink"><span className="text-sd-ink-soft">Provider: </span>{w.provider}</li>
        <li className="text-sd-ink-soft leading-relaxed">{w.coverage}</li>
        <li className="text-sd-ink">{fmtDate(w.startDate)} – {fmtDate(w.endDate)}</li>
        <li className="text-xs text-sd-ink-soft pt-1">{w.assetCode}</li>
      </ul>
    </article>
  );
}

function PlanCard({ plan }: { plan: PortalPlan & { assetCode: string } }) {
  return (
    <article className="sd-clay p-5">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-sd-ink">{plan.name}</h3>
        <span className="text-xs text-sd-ink-soft">every {plan.intervalDays} days</span>
        <span className="text-xs text-sd-ink-soft ml-auto">{plan.assetCode}</span>
      </header>
      {plan.occurrences.length === 0 ? (
        <p className="text-sm text-sd-ink-soft mt-2.5">No upcoming visits on the schedule.</p>
      ) : (
        <ul className="mt-3 divide-y divide-sd-line/70">
          {plan.occurrences.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="text-sd-ink">
                {fmtDate(o.dueDate)} <span className="text-sd-ink-soft">({relativeDay(o.dueDate)})</span>
              </span>
              <StatusPill status={o.status} />
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

// ── Service (requests) ──────────────────────────────────────────
function ServiceScreen({ c, refreshPortal }: { c: PortalCustomer; refreshPortal: () => void }) {
  const [status, setStatus] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  // home CTA hand-off: open the dialog once, on mount (deferred to avoid
  // synchronous setState within the effect body)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (sessionStorage.getItem(OPEN_FLAG) === "1") {
        sessionStorage.removeItem(OPEN_FLAG);
        timer = setTimeout(() => setDialogOpen(true), 0);
      }
    } catch { /* storage unavailable */ }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, []);

  const listPath = "/api/requests" + qs({ status: status || undefined, page: 1, pageSize: 50 });
  const list = useApi<RequestsListResponse>(listPath);
  const counts = list.data?.counts ?? {};
  const allCount = Object.values(counts).reduce((a, b) => a + b, 0);
  const chipStatuses = REQUEST_STATUSES.filter((s) => (counts[s] ?? 0) > 0);
  const shown = list.data?.requests ?? [];

  return (
    <section>
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 mb-5">
        <div className="flex-1">
          <ScreenHeader title="Service" subtitle="Raise a request or track the ones you have raised." />
        </div>
        <button onClick={() => setDialogOpen(true)} className="sd-btn-primary px-4 py-2.5 text-sm font-semibold sd-focus inline-flex items-center gap-2 shrink-0">
          <Wrench className="w-4 h-4" /> New service request
        </button>
      </div>

      {/* status filter chips */}
      <div className="flex gap-2 overflow-x-auto sd-scroll pb-1 mb-4" role="tablist" aria-label="Filter requests by status">
        <FilterChip active={status === ""} onClick={() => setStatus("")}>All ({allCount})</FilterChip>
        {chipStatuses.map((s) => (
          <FilterChip key={s} active={status === s} onClick={() => setStatus(s)}>
            {STATUS_LABELS[s] ?? s} ({counts[s] ?? 0})
          </FilterChip>
        ))}
      </div>

      {list.loading ? (
        <SkeletonRows rows={5} />
      ) : list.error ? (
        <ErrorRetryCard message={list.error} onRetry={list.refresh} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title={status ? "No requests with this status" : "No service requests yet"}
          body={status ? "Try another filter, or check All." : "When you raise a request, you can follow it here."}
          action={
            <button onClick={() => setDialogOpen(true)} className="sd-btn-primary px-5 py-2.5 text-sm font-semibold sd-focus">
              Raise a service request
            </button>
          }
        />
      ) : (
        <div className="space-y-4">
          {shown.map((r) => (
            <article key={r.id} className="sd-clay p-5">
              <header className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-sd-ink">{r.code}</span>
                <StatusPill status={r.status} />
                <span className="ml-auto text-xs text-sd-ink-soft">{fmtDateTime(r.createdAt)}</span>
              </header>
              <div className="mt-1 text-[0.68rem] font-bold uppercase tracking-wide text-sd-forest">
                {REQUEST_CATEGORY_LABELS[r.category] ?? r.category}
              </div>
              <p className="mt-2 text-sm text-sd-ink leading-relaxed line-clamp-2">{r.description}</p>

              {r.jobs && r.jobs.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-sd-ink-soft">Linked jobs:</span>
                  {r.jobs.map((j) => (
                    <span key={j.id} className="flex items-center gap-1.5">
                      <StatusPill status={j.status} />
                      <span className="text-xs text-sd-ink-soft">{j.code}</span>
                    </span>
                  ))}
                </div>
              )}

              <RequestTimeline status={r.status} jobCount={r.jobs?.length ?? 0} />
            </article>
          ))}
          {list.data && list.data.total > shown.length && (
            <p className="text-xs text-center text-sd-ink-soft">Showing the {shown.length} most recent of {list.data.total} requests.</p>
          )}
        </div>
      )}

      <NewRequestDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        installations={c.installations}
        onDone={() => { list.refresh(); refreshPortal(); }}
      />
    </section>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors sd-focus whitespace-nowrap",
        active ? "bg-[#176B52]/12 text-sd-forest-deep border-[#176B52]/25" : "bg-white text-sd-ink-soft border-sd-line hover:text-sd-ink"
      )}
    >
      {children}
    </button>
  );
}

function RequestTimeline({ status, jobCount }: { status: string; jobCount: number }) {
  if (status === "REJECTED") {
    return (
      <p className="mt-4 text-xs text-sd-ink-soft leading-relaxed">
        <span className="sd-pill sd-pill-red mr-1.5">Declined</span>
        This request was closed without a job. Reach out to us if that looks wrong.
      </p>
    );
  }
  const steps: { label: string; done: boolean }[] = [
    { label: "Received", done: true },
    { label: "In review", done: status !== "NEW" },
    { label: "Job created", done: jobCount > 0 },
    { label: "Resolved", done: status === "CLOSED" },
  ];
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs" aria-label="Request progress">
      {steps.map((s, i) => (
        <Fragment key={s.label}>
          {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-sd-line" aria-hidden="true" />}
          <span className={cn("flex items-center gap-1.5", s.done ? "text-sd-ink font-medium" : "text-sd-ink-soft")}>
            {s.done ? (
              <Check className="w-3.5 h-3.5 text-sd-success" aria-hidden="true" />
            ) : (
              <span className="w-1.5 h-1.5 rounded-full bg-sd-line" aria-hidden="true" />
            )}
            {s.label}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

function NewRequestDialog({
  open, onOpenChange, installations, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  installations: PortalInstallation[];
  onDone: () => void;
}) {
  const [installationId, setInstallationId] = useState(installations[0]?.id ?? "");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const trimmed = description.trim();
  const canSubmit = Boolean(category) && trimmed.length >= 10 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await api("/api/requests", {
        method: "POST",
        json: {
          category,
          description: trimmed,
          ...(installationId ? { installationId } : {}),
        },
      });
      toast({
        title: "Request submitted",
        description: "Our team will review it — we will keep you posted at every step.",
      });
      setCategory("");
      setDescription("");
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Couldn't submit request",
        description: e instanceof Error ? e.message : "Please try again in a moment.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg">New service request</DialogTitle>
          <DialogDescription>
            Tell us what you noticed. Our team will review it and get back to you.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          className="space-y-4"
        >
          {installations.length > 0 && (
            <div>
              <span className="text-sm font-semibold text-sd-ink">Which system?</span>
              <div className="mt-1.5">
                <Select value={installationId} onValueChange={setInstallationId}>
                  <SelectTrigger aria-label="Select installation" className="w-full h-11 rounded-xl bg-sd-inset border-sd-line text-sd-ink">
                    <SelectValue placeholder="Choose your system" />
                  </SelectTrigger>
                  <SelectContent>
                    {installations.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.assetCode} — {i.siteAddress}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div>
            <span className="text-sm font-semibold text-sd-ink">What kind of issue?</span>
            <div className="mt-1.5">
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger aria-label="Select category" className="w-full h-11 rounded-xl bg-sd-inset border-sd-line text-sd-ink">
                  <SelectValue placeholder="Choose a category" />
                </SelectTrigger>
                <SelectContent>
                  {REQUEST_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>{REQUEST_CATEGORY_LABELS[cat] ?? cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <span className="text-sm font-semibold text-sd-ink">Describe it</span>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell us what you noticed…"
              className="mt-1.5 min-h-28 sd-inset border-0 shadow-none focus-visible:ring-2 focus-visible:ring-sd-forest/40 text-sm text-sd-ink placeholder:text-sd-ink-soft/60 resize-none"
            />
            {trimmed.length > 0 && trimmed.length < 10 && (
              <p className="text-xs text-[#a03340] mt-1.5">Please add a little more detail (at least 10 characters).</p>
            )}
          </div>

          <DialogFooter className="gap-2.5">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-xl border border-sd-line bg-white px-4 py-2.5 text-sm font-medium text-sd-ink-soft hover:text-sd-ink sd-focus"
            >
              Cancel
            </button>
            <button type="submit" disabled={!canSubmit} className="sd-btn-primary px-5 py-2.5 text-sm font-semibold sd-focus inline-flex items-center gap-2 disabled:cursor-not-allowed">
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {submitting ? "Submitting…" : "Submit request"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Reports ─────────────────────────────────────────────────────
function ReportsScreen({ c }: { c: PortalCustomer }) {
  return (
    <section>
      <ScreenHeader title="Reports" subtitle="Every visit, documented — summaries, checklists and photos." />
      {c.reports.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No service reports yet"
          body="Reports appear here after a visit is completed and published."
        />
      ) : (
        <div className="space-y-4">
          {c.reports.map((rep) => <ReportCard key={rep.id} rep={rep} />)}
        </div>
      )}
    </section>
  );
}

function ReportCard({ rep }: { rep: PortalReport }) {
  const [notesOpen, setNotesOpen] = useState(false);
  const photos = parseJson<{ id: string; caption?: string }[]>(rep.photosJson, []);
  const checklist = parseJson<{ label: string; kind?: string; value?: string }[]>(rep.checklistJson, []);
  const isMaintenance = rep.job.type === "MAINTENANCE";

  return (
    <article className="sd-clay p-5">
      <header className="flex flex-wrap items-center gap-2">
        <span className="font-bold text-sd-ink">{rep.job.code}</span>
        <span className="text-sm text-sd-ink-soft min-w-0 truncate">{rep.job.title}</span>
        <span className={cn("sd-pill ml-auto shrink-0", isMaintenance ? "sd-pill-teal" : "sd-pill-amber")}>
          {isMaintenance ? "Maintenance visit" : "Complaint visit"}
        </span>
      </header>
      <div className="text-xs text-sd-ink-soft mt-1">Published {fmtDateTime(rep.publishedAt)}</div>
      <p className="mt-3 text-sm text-sd-ink leading-relaxed">{rep.summary}</p>

      {rep.followUpNeeded && (
        <div className="mt-4 rounded-xl bg-[#D99A32]/10 border border-[#D99A32]/25 p-3.5 text-sm text-[#96660d] flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            <span className="font-semibold">Follow-up recommended. </span>
            {rep.followUpNotes || "Our team suggests a follow-up visit."}
          </span>
        </div>
      )}

      <div className="mt-4">
        {rep.acknowledgedByOtp ? (
          <div className="flex items-start gap-2.5 text-sm text-sd-success">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            <span>Confirmed by you via OTP · {fmtDateTime(rep.acknowledgedAt)}</span>
          </div>
        ) : (
          <div className="flex items-start gap-2.5 text-sm text-sd-ink-soft">
            <Clock className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Awaiting your OTP confirmation — the technician will share a short code during the visit.
              Share it only once the work is done to your satisfaction.
            </span>
          </div>
        )}
      </div>

      <Collapsible open={notesOpen} onOpenChange={setNotesOpen} className="mt-4">
        <CollapsibleTrigger className="flex items-center gap-1.5 text-sm font-semibold text-sd-forest rounded-lg sd-focus">
          Work details
          <ChevronDown className={cn("w-4 h-4 transition-transform", notesOpen && "rotate-180")} />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 text-sm text-sd-ink-soft leading-relaxed whitespace-pre-wrap">
          {rep.technicianNotes || "—"}
        </CollapsibleContent>
      </Collapsible>

      {checklist.length > 0 && (
        <div className="mt-4">
          <div className="text-[0.66rem] font-bold uppercase tracking-wide text-sd-ink-soft mb-2">Checklist</div>
          <ul className="grid sm:grid-cols-2 gap-y-2 gap-x-4">
            {checklist.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-sd-ink leading-snug">
                {item.kind === "TEXT" ? (
                  <>
                    <FileText className="w-4 h-4 text-sd-forest mt-0.5 shrink-0" />
                    <span>
                      <span className="text-sd-ink-soft">{item.label}: </span>
                      {item.value || "—"}
                    </span>
                  </>
                ) : item.value === "true" ? (
                  <>
                    <Check className="w-4 h-4 text-sd-success mt-0.5 shrink-0" />
                    {item.label}
                  </>
                ) : (
                  <>
                    <X className="w-4 h-4 text-sd-error mt-0.5 shrink-0" />
                    {item.label}
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {photos.length > 0 && (
        <div className="mt-4">
          <div className="text-[0.66rem] font-bold uppercase tracking-wide text-sd-ink-soft mb-2">Photos from the visit</div>
          <div className="flex gap-3 overflow-x-auto sd-scroll pt-1">
            {photos.map((p) => (
              <img
                key={p.id}
                src={"/api/attachments/" + p.id}
                alt={p.caption || "Photo from the service visit"}
                className="w-32 h-24 object-cover rounded-xl border border-sd-line shrink-0"
                loading="lazy"
              />
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

// ── Profile ─────────────────────────────────────────────────────
function ProfileScreen({ org, c }: { org: PortalData["org"]; c: PortalCustomer }) {
  const [signingOut, setSigningOut] = useState(false);
  const orgName = org.name ?? "your service provider";

  const signOut = async () => {
    setSigningOut(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch { /* proceed to local sign-out regardless */ }
    useSd.setState({ user: null });
  };

  return (
    <section className="space-y-4">
      <ScreenHeader title="Profile" subtitle="Your details as held by your solar service provider." />

      <article className="sd-clay p-5 flex items-center gap-4">
        <SdAvatar name={c.name} size={56} />
        <div className="min-w-0">
          <div className="text-lg font-bold text-sd-ink leading-tight truncate">{c.name}</div>
          <div className="text-sm text-sd-ink-soft mt-0.5">{c.city}</div>
        </div>
      </article>

      <article className="sd-clay p-5">
        <h3 className="font-semibold text-sd-ink text-[0.95rem] mb-3">Contact details</h3>
        <ul className="space-y-2.5 text-sm">
          <li className="flex items-center gap-2.5 text-sd-ink">
            <Mail className="w-4 h-4 text-sd-forest shrink-0" /> {c.email}
          </li>
          <li className="flex items-center gap-2.5 text-sd-ink">
            <Phone className="w-4 h-4 text-sd-forest shrink-0" /> {c.phone}
          </li>
          <li className="flex items-center gap-2.5 text-sd-ink">
            <MapPin className="w-4 h-4 text-sd-forest shrink-0" /> {c.city}
          </li>
        </ul>
      </article>

      <article className="sd-clay p-5">
        <h3 className="font-semibold text-sd-ink text-[0.95rem] mb-3">Your service provider</h3>
        <div className="font-semibold text-sd-ink">{org.name ?? "Your solar service provider"}</div>
        <ul className="mt-2.5 space-y-2 text-sm">
          {org.supportEmail && (
            <li className="flex items-center gap-2.5 text-sd-ink">
              <Mail className="w-4 h-4 text-sd-forest shrink-0" /> {org.supportEmail}
            </li>
          )}
          {org.phone && (
            <li className="flex items-center gap-2.5 text-sd-ink">
              <Phone className="w-4 h-4 text-sd-forest shrink-0" /> {org.phone}
            </li>
          )}
          {!org.supportEmail && !org.phone && <li className="text-sd-ink-soft">No support contacts on record.</li>}
        </ul>
      </article>

      <div className="sd-clay p-5 flex items-start gap-3 text-sm text-sd-ink-soft leading-relaxed">
        <Info className="w-4 h-4 text-sd-forest mt-0.5 shrink-0" />
        <span>Your data belongs to {orgName} — contact them for any correction.</span>
      </div>

      <button
        onClick={signOut}
        disabled={signingOut}
        className="w-full flex items-center justify-center gap-2 rounded-xl border border-sd-line bg-white px-4 py-3 text-sm font-semibold text-[#a03340] hover:bg-[#C94B55]/5 transition-colors sd-focus disabled:opacity-60"
      >
        {signingOut ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
        Sign out
      </button>
    </section>
  );
}
