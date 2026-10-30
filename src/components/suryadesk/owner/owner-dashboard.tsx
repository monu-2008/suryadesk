"use client";
// SuryaDesk — Owner operations dashboard (Task 7-a).
// Every figure on this page is computed live from GET /api/dashboard.

import { useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CalendarX,
  ChevronRight,
  CircleCheck,
  ClipboardCheck,
  Clock,
  FileText,
  FileWarning,
  HardHat,
  History,
  Hourglass,
  Inbox,
  RotateCw,
  ScrollText,
  Timer,
  UserX,
  Users,
  Wrench,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useApi } from "@/lib/surya/client";
import { useSd } from "@/lib/surya/store";
import { fmtDateTime, JOB_STATUSES, relativeDay, STATUS_LABELS } from "@/lib/surya/types";
import {
  EmptyState,
  KpiCard,
  PageHeader,
  SectionCard,
  SkeletonRows,
  StatusPill,
} from "@/components/suryadesk/shared/bits";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── API shapes (GET /api/dashboard) ─────────────────────────────
interface DashboardKpis {
  totalCustomers: number;
  activeInstallations: number;
  activeAmc: number;
  amcExpiringSoon: number;
  upcomingMaintenance: number;
  overdueMaintenance: number;
  openRequests: number;
  jobsInProgress: number;
  todayJobs: number;
  avgCompletionHrs: number;
  totalJobs: number;
}

interface DashboardData {
  kpis: DashboardKpis;
  trend: { month: string; count: number }[];
  jobsByStatus: Record<string, number>;
  requestsByCategory: Record<string, number>;
  amcExpiry: { d30: number; d60: number; d90: number; expired: number };
  workload: { id: string; name: string; title: string | null; activeJobs: number }[];
  calendar: { id: string; dueDate: string; status: string; customer: string; assetCode: string; capacityKw: number }[];
  recentEvents: { id: string; jobCode: string; fromStatus: string | null; toStatus: string; at: string }[];
  recentAudits: { id: string; action: string; detail: string | null; at: string }[];
  critical: {
    unassignedScheduled: number;
    awaitingCustomer: number;
    needsReview: number;
    overdueMaintenance: number;
    openRequests: number;
  };
}

// ── Local shared lookups ────────────────────────────────────────
const TOOLTIP_STYLE: CSSProperties = {
  borderRadius: 12,
  border: "1px solid #E4EAE5",
  background: "#fff",
  fontSize: 12,
};

const STATUS_COLORS: string[] = [
  "#176B52", "#F2B84B", "#3D9977", "#D99A32", "#747E77", "#C94B55", "#9DB8AA", "#E4EAE5",
];

interface DonutDatum {
  status: string;
  label: string;
  count: number;
  color: string;
}

function buildDonut(jobsByStatus: Record<string, number>): DonutDatum[] {
  return JOB_STATUSES.map((status, idx) => ({ status, idx, count: jobsByStatus[status] ?? 0 }))
    .filter((x) => x.count > 0)
    .map((x) => ({
      status: x.status,
      label: STATUS_LABELS[x.status] ?? x.status,
      count: x.count,
      color: STATUS_COLORS[x.idx % STATUS_COLORS.length],
    }));
}

type ActivityItem =
  | { kind: "event"; id: string; at: string; jobCode: string; toStatus: string }
  | { kind: "audit"; id: string; at: string; action: string; detail: string | null };

function prettyAction(action: string): string {
  const s = action.toLowerCase().replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Generic building blocks ─────────────────────────────────────
function FadeIn({ delay = 0, className, children }: { delay?: number; className?: string; children: ReactNode }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.section>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="sd-clay p-8 flex flex-col items-center text-center gap-4" role="alert">
      <div className="rounded-3xl bg-[#C94B55]/10 p-4">
        <AlertTriangle className="w-7 h-7 text-[#a03340]" />
      </div>
      <div>
        <div className="font-semibold text-sd-ink">Couldn&apos;t load the dashboard</div>
        <p className="text-sm text-sd-ink-soft mt-1 max-w-md">{message}</p>
      </div>
      <Button variant="outline" onClick={onRetry} className="rounded-xl">
        Try again
      </Button>
    </div>
  );
}

function ChartSkeleton({ height = 220 }: { height?: number }) {
  return <div className="rounded-2xl bg-sd-surface animate-pulse w-full" style={{ height }} aria-hidden="true" />;
}

function KpiSkeletonGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="sd-clay p-5 flex items-start gap-3.5" aria-hidden="true">
          <div className="w-11 h-11 rounded-2xl bg-sd-surface animate-pulse" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-6 w-16 rounded-lg bg-sd-surface animate-pulse" />
            <div className="h-3 w-24 rounded-md bg-sd-surface animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

function DashboardLoading() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="sd-clay h-[76px] animate-pulse" aria-hidden="true" />
        ))}
      </div>
      <KpiSkeletonGrid />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard title="Service request trend">
          <ChartSkeleton />
        </SectionCard>
        <SectionCard title="Job pipeline">
          <ChartSkeleton />
        </SectionCard>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard title="Technician workload">
          <ChartSkeleton />
        </SectionCard>
        <SectionCard title="AMC renewals">
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[80px] rounded-2xl bg-sd-surface animate-pulse" aria-hidden="true" />
            ))}
          </div>
        </SectionCard>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SkeletonRows rows={5} />
        <SkeletonRows rows={5} />
      </div>
    </div>
  );
}

// ── Status donut (pipeline) ─────────────────────────────────────
function StatusDonut({ data, total, totalLabel }: { data: DonutDatum[]; total: number; totalLabel: string }) {
  return (
    <div className="flex flex-col sm:flex-row items-center gap-5">
      <div className="relative w-full sm:w-[52%] h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="label"
              innerRadius={58}
              outerRadius={84}
              paddingAngle={2.5}
              cornerRadius={6}
              stroke="none"
            >
              {data.map((d) => (
                <Cell key={d.status} fill={d.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <div className="text-[1.7rem] font-bold text-sd-ink leading-none tabular-nums">{total}</div>
            <div className="text-[0.62rem] uppercase tracking-[0.14em] text-sd-ink-soft mt-1.5">{totalLabel}</div>
          </div>
        </div>
      </div>
      <div className="w-full sm:w-[48%] space-y-2.5 max-h-[220px] overflow-y-auto sd-scroll pr-1">
        {data.map((d) => (
          <div key={d.status} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 min-w-0">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
              <span className="truncate text-sd-ink-soft">{d.label}</span>
            </span>
            <span className="font-semibold text-sd-ink tabular-nums">{d.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Critical action chips ───────────────────────────────────────
type CriticalKey = keyof DashboardData["critical"];

const CRITICAL_CHIPS: { key: CriticalKey; label: string; icon: LucideIcon; view: string; tone: "error" | "amber" }[] = [
  { key: "needsReview", label: "Jobs needing review", icon: ClipboardCheck, view: "jobs", tone: "error" },
  { key: "overdueMaintenance", label: "Overdue maintenance", icon: CalendarX, view: "maintenance", tone: "error" },
  { key: "unassignedScheduled", label: "Unassigned jobs", icon: UserX, view: "jobs", tone: "amber" },
  { key: "awaitingCustomer", label: "Awaiting customer", icon: Hourglass, view: "jobs", tone: "amber" },
  { key: "openRequests", label: "Open requests", icon: Inbox, view: "requests", tone: "amber" },
];

const AMC_TILES: { key: keyof DashboardData["amcExpiry"]; label: string; icon: LucideIcon; bg: string; fg: string }[] = [
  { key: "d30", label: "Expiring ≤ 30 days", icon: Timer, bg: "rgba(217,154,50,0.16)", fg: "#96660d" },
  { key: "d60", label: "Expiring ≤ 60 days", icon: CalendarClock, bg: "rgba(217,154,50,0.11)", fg: "#96660d" },
  { key: "d90", label: "Expiring ≤ 90 days", icon: CalendarRange, bg: "rgba(217,154,50,0.07)", fg: "#96660d" },
  { key: "expired", label: "Already expired", icon: FileWarning, bg: "rgba(201,75,85,0.12)", fg: "#a03340" },
];

// ── Owner dashboard ─────────────────────────────────────────────
export default function OwnerDashboard() {
  const { user, setView } = useSd();
  const { data, loading, error, refresh } = useApi<DashboardData>("/api/dashboard");

  // Greeting — time of day + first name + today's date.
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = (user?.name ?? "").trim().split(/\s+/)[0] || "there";
  const dateLabel = now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  // Derived figures (all from the dashboard payload).
  const donutData = useMemo(() => buildDonut(data?.jobsByStatus ?? {}), [data]);
  const trendTotal = useMemo(() => (data?.trend ?? []).reduce((s, t) => s + t.count, 0), [data]);
  const activeAssignments = useMemo(() => (data?.workload ?? []).reduce((s, w) => s + w.activeJobs, 0), [data]);

  const activity = useMemo<ActivityItem[]>(() => {
    const events: ActivityItem[] = (data?.recentEvents ?? []).map((e) => ({
      kind: "event",
      id: e.id,
      at: e.at,
      jobCode: e.jobCode,
      toStatus: e.toStatus,
    }));
    const audits: ActivityItem[] = (data?.recentAudits ?? []).map((a) => ({
      kind: "audit",
      id: a.id,
      at: a.at,
      action: a.action,
      detail: a.detail,
    }));
    return [...events, ...audits]
      .sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime())
      .slice(0, 8);
  }, [data]);

  const totalCritical = data
    ? data.critical.needsReview +
      data.critical.overdueMaintenance +
      data.critical.unassignedScheduled +
      data.critical.awaitingCustomer +
      data.critical.openRequests
    : 0;

  const k = data?.kpis;
  const kpiCards: {
    label: string;
    value: string | number;
    icon: LucideIcon;
    tone: "forest" | "amber" | "error" | "slate";
    sub?: string;
    view: string;
  }[] = k
    ? [
        { label: "Total customers", value: k.totalCustomers, icon: Users, tone: "forest", view: "customers" },
        { label: "Active installations", value: k.activeInstallations, icon: Zap, tone: "forest", view: "installations" },
        { label: "Active AMC", value: k.activeAmc, icon: FileText, tone: "forest", sub: `${k.amcExpiringSoon} expiring soon`, view: "amc" },
        { label: "Avg completion time", value: `${k.avgCompletionHrs} h`, icon: Clock, tone: "slate", sub: `${k.totalJobs} jobs to date`, view: "jobs" },
        { label: "Jobs due today", value: k.todayJobs, icon: CalendarDays, tone: "amber", sub: `${k.jobsInProgress} in progress`, view: "jobs" },
        { label: "Overdue maintenance", value: k.overdueMaintenance, icon: AlertTriangle, tone: "error", sub: `${k.upcomingMaintenance} upcoming visits`, view: "maintenance" },
        { label: "Open requests", value: k.openRequests, icon: Inbox, tone: "amber", view: "requests" },
        { label: "Jobs in progress", value: k.jobsInProgress, icon: Wrench, tone: "forest", sub: `${k.todayJobs} due today`, view: "jobs" },
      ]
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting}, ${firstName}`}
        subtitle={dateLabel}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={loading}
            className="rounded-xl gap-2"
            aria-label="Refresh dashboard data"
          >
            <RotateCw className={cn("w-4 h-4", loading && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        }
      />

      {error && !data ? (
        <ErrorCard message={error} onRetry={refresh} />
      ) : !data ? (
        <DashboardLoading />
      ) : (
        <>
          {/* ── critical pending actions ── */}
          <FadeIn>
            {totalCritical === 0 ? (
              <div className="sd-clay px-5 py-4 flex items-center gap-3.5">
                <span className="rounded-2xl p-2.5 bg-[#16876a]/10 shrink-0">
                  <CircleCheck className="w-5 h-5 text-sd-success" />
                </span>
                <div>
                  <div className="text-sm font-semibold text-sd-ink">All clear — nothing needs your attention</div>
                  <div className="text-xs text-sd-ink-soft mt-0.5">
                    No overdue maintenance, unassigned jobs or open requests right now.
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <div className="text-[0.68rem] font-bold uppercase tracking-[0.12em] text-sd-ink-soft/70 mb-2">
                  Needs your attention
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
                  {CRITICAL_CHIPS.map((c) => {
                    const count = data.critical[c.key];
                    return (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => setView(c.view)}
                        className="sd-clay sd-clay-raise sd-focus p-4 text-left flex items-center gap-3.5 w-full"
                      >
                        <span
                          className={cn(
                            "rounded-2xl p-2.5 shrink-0",
                            c.tone === "error" ? "bg-[#C94B55]/10 text-[#a03340]" : "bg-[#D99A32]/15 text-[#96660d]"
                          )}
                        >
                          <c.icon className="w-5 h-5" />
                        </span>
                        <span className="min-w-0">
                          <span
                            className={cn(
                              "block text-[1.3rem] font-bold leading-none tabular-nums",
                              count === 0
                                ? "text-sd-ink-soft/50"
                                : c.tone === "error"
                                  ? "text-[#a03340]"
                                  : "text-[#96660d]"
                            )}
                          >
                            {count}
                          </span>
                          <span className="block text-[0.7rem] text-sd-ink-soft mt-1 leading-snug">{c.label}</span>
                        </span>
                        <ChevronRight className="w-4 h-4 text-sd-ink-soft/50 ml-auto shrink-0" />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </FadeIn>

          {/* ── KPI cards ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {kpiCards.map((c, i) => (
              <KpiCard
                key={c.label}
                label={c.label}
                value={c.value}
                icon={c.icon}
                tone={c.tone}
                sub={c.sub}
                delay={i * 0.06}
                onClick={() => setView(c.view)}
              />
            ))}
          </div>

          {/* ── trend + pipeline charts ── */}
          <FadeIn delay={0.05} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {trendTotal === 0 ? (
              <EmptyState
                icon={Inbox}
                title="No service requests yet"
                body="The request trend will chart here as customers raise requests."
              />
            ) : (
              <SectionCard title="Service request trend" subtitle={`${trendTotal} requests · last ${data.trend.length} months`}>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={data.trend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="sdTrendFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#176B52" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="#176B52" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E4EAE5" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#747E77" }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} width={34} tick={{ fontSize: 12, fill: "#747E77" }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: "#176B52", strokeOpacity: 0.25 }} />
                    <Area type="monotone" dataKey="count" name="Requests" stroke="#176B52" strokeWidth={2.5} fill="url(#sdTrendFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </SectionCard>
            )}

            {donutData.length === 0 ? (
              <EmptyState icon={ClipboardCheck} title="No jobs yet" body="The job pipeline will appear once jobs are created." />
            ) : (
              <SectionCard title="Job pipeline" subtitle={`${data.kpis.totalJobs} jobs · live status mix`}>
                <StatusDonut data={donutData} total={data.kpis.totalJobs} totalLabel="total jobs" />
              </SectionCard>
            )}
          </FadeIn>

          {/* ── workload + AMC renewals ── */}
          <FadeIn delay={0.1} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {data.workload.length === 0 || activeAssignments === 0 ? (
              <EmptyState
                icon={HardHat}
                title={data.workload.length === 0 ? "No technicians yet" : "No active jobs"}
                body={
                  data.workload.length === 0
                    ? "Add technicians to the team to see workload distribution."
                    : "No technician currently has an active job."
                }
              />
            ) : (
              <SectionCard
                title="Technician workload"
                subtitle={`${activeAssignments} active jobs across ${data.workload.length} technicians`}
              >
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.workload} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="#E4EAE5" />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: "#747E77" }} axisLine={false} tickLine={false} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={110}
                      tick={{ fontSize: 12, fill: "#1E2925" }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(n: string) => (n.length > 14 ? `${n.slice(0, 13)}…` : n)}
                    />
                    <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(23,107,82,0.06)" }} />
                    <Bar dataKey="activeJobs" name="Active jobs" fill="#176B52" radius={[0, 8, 8, 0]} barSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              </SectionCard>
            )}

            <SectionCard title="AMC renewals" subtitle="Renewal horizon across all contracts">
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                {AMC_TILES.map((t) => {
                  const value = data.amcExpiry[t.key];
                  return (
                    <div key={t.key} className="rounded-2xl p-4 flex items-center gap-3" style={{ background: t.bg }}>
                      <t.icon className="w-5 h-5 shrink-0" style={{ color: t.fg }} />
                      <div className="min-w-0">
                        <div className="text-[1.4rem] font-bold leading-none tabular-nums" style={{ color: t.fg }}>
                          {value}
                        </div>
                        <div className="text-[0.68rem] mt-1 leading-snug" style={{ color: t.fg, opacity: 0.8 }}>
                          {t.label}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-sd-ink-soft mt-4">
                {data.kpis.activeAmc} active contracts · {data.kpis.amcExpiringSoon} expiring soon
              </p>
            </SectionCard>
          </FadeIn>

          {/* ── maintenance calendar + recent activity ── */}
          <FadeIn delay={0.16} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {data.calendar.length === 0 ? (
              <EmptyState icon={CalendarDays} title="No maintenance due" body="No visits are scheduled in the next 14 days." />
            ) : (
              <SectionCard
                title="Maintenance calendar"
                subtitle="Next 14 days"
                bodyClassName="p-0"
                actions={
                  <button
                    type="button"
                    onClick={() => setView("maintenance")}
                    className="text-xs font-semibold text-sd-forest hover:underline sd-focus rounded"
                  >
                    View all
                  </button>
                }
              >
                <div className="max-h-80 overflow-y-auto sd-scroll divide-y divide-sd-line/70">
                  {data.calendar.map((item) => {
                    const d = new Date(item.dueDate);
                    return (
                      <div key={item.id} className="flex items-center gap-3.5 px-5 py-3">
                        <div className="sd-inset w-14 h-14 shrink-0 flex flex-col items-center justify-center">
                          <span className="text-lg font-bold text-sd-ink leading-none">{d.getDate()}</span>
                          <span className="text-[0.6rem] uppercase tracking-wide text-sd-ink-soft mt-1">
                            {d.toLocaleDateString("en-IN", { month: "short" })}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-sd-ink truncate">{item.customer}</div>
                          <div className="text-xs text-sd-ink-soft mt-0.5 truncate">
                            {item.assetCode} · {item.capacityKw} kW
                          </div>
                        </div>
                        <div className="shrink-0 flex flex-col items-end gap-1.5">
                          <StatusPill status={item.status} />
                          <span className="text-[0.66rem] text-sd-ink-soft">{relativeDay(item.dueDate)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </SectionCard>
            )}

            {activity.length === 0 ? (
              <EmptyState icon={History} title="No recent activity" body="Job updates and audit events will appear here." />
            ) : (
              <SectionCard title="Recent activity" subtitle="Job events & audit trail" bodyClassName="p-0">
                <div className="max-h-72 overflow-y-auto sd-scroll divide-y divide-sd-line/70">
                  {activity.map((item) => (
                    <div key={item.id} className="flex items-start gap-3.5 px-5 py-3.5">
                      <span
                        className={cn(
                          "rounded-xl p-2 shrink-0",
                          item.kind === "event" ? "bg-[#176B52]/10 text-sd-forest" : "bg-[#747E77]/10 text-[#5c665f]"
                        )}
                      >
                        {item.kind === "event" ? <Activity className="w-4 h-4" /> : <ScrollText className="w-4 h-4" />}
                      </span>
                      {item.kind === "event" ? (
                        <div className="min-w-0">
                          <div className="text-sm leading-snug flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold text-sd-ink">{item.jobCode}</span>
                            <span className="text-sd-ink-soft">moved to</span>
                            <StatusPill status={item.toStatus} />
                          </div>
                          <div className="text-[0.68rem] text-sd-ink-soft mt-1">{fmtDateTime(item.at)}</div>
                        </div>
                      ) : (
                        <div className="min-w-0">
                          <div className="text-sm leading-snug">
                            <span className="font-semibold text-sd-ink">{prettyAction(item.action)}</span>
                            {item.detail ? <span className="text-sd-ink-soft"> — {item.detail}</span> : null}
                          </div>
                          <div className="text-[0.68rem] text-sd-ink-soft mt-1">{fmtDateTime(item.at)}</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}
          </FadeIn>
        </>
      )}
    </div>
  );
}
