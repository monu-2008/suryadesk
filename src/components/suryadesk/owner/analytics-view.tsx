"use client";
// SuryaDesk — Service analytics for owner/manager (Task 7-a).
// Data sources:
//   GET /api/dashboard          (job status mix, request categories, avg completion)
//   GET /api/reports?pageSize=50 (published reports + OTP acknowledgement)
//   GET /api/requests?pageSize=50 (request priority mix)
// Date-range tabs filter timestamped records client-side; aggregates without
// timestamps are always shown as all-time totals (never invented).

import { useCallback, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { motion } from "framer-motion";
import {
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
  AlertTriangle,
  BadgeCheck,
  CircleCheck,
  ClipboardCheck,
  Clock,
  Hourglass,
  Info,
  RotateCw,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { qs, useApi } from "@/lib/surya/client";
import {
  fmtDateTime,
  JOB_STATUSES,
  REQUEST_CATEGORIES,
  REQUEST_CATEGORY_LABELS,
  STATUS_LABELS,
} from "@/lib/surya/types";
import {
  EmptyState,
  KpiCard,
  PageHeader,
  PriorityPill,
  SectionCard,
  SkeletonRows,
  StatusPill,
  TableShell,
} from "@/components/suryadesk/shared/bits";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── API shapes ──────────────────────────────────────────────────
interface DashLite {
  kpis: { avgCompletionHrs: number; totalJobs: number };
  jobsByStatus: Record<string, number>;
  requestsByCategory: Record<string, number>;
}

interface ReportRow {
  id: string;
  acknowledgedByOtp: boolean;
  publishedAt: string;
  customer: { name: string };
  job: {
    code: string;
    type: string;
    status: string;
    completedAt: string | null;
    scheduledFor: string;
  };
}

interface ReportsPage {
  total: number;
  reports: ReportRow[];
}

interface RequestRow {
  id: string;
  code: string;
  category: string;
  status: string;
  priority: string;
  createdAt: string;
}

interface RequestsPage {
  total: number;
  requests: RequestRow[];
}

// ── Range config ────────────────────────────────────────────────
type RangeKey = "month" | "quarter" | "all";

const RANGE_LABELS: Record<RangeKey, string> = {
  month: "This month",
  quarter: "Last 3 months",
  all: "All time",
};

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

function prettyJobType(type: string): string {
  return type.toLowerCase().replace(/_/g, " ");
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

function ErrorCard({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <div className="sd-clay p-8 flex flex-col items-center text-center gap-4" role="alert">
      <div className="rounded-3xl bg-[#C94B55]/10 p-4">
        <AlertTriangle className="w-7 h-7 text-[#a03340]" />
      </div>
      <div>
        <div className="font-semibold text-sd-ink">{title}</div>
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

function KpiSkeletonGrid({ count = 4 }: { count?: number }) {
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

const PRIORITY_TILES = [
  { key: "LOW", bg: "rgba(116,126,119,0.13)", fg: "#5c665f" },
  { key: "MEDIUM", bg: "rgba(61,153,119,0.14)", fg: "#1d6b50" },
  { key: "HIGH", bg: "rgba(217,154,50,0.14)", fg: "#96660d" },
  { key: "URGENT", bg: "rgba(201,75,85,0.12)", fg: "#a03340" },
] as const;

// ── Analytics view ──────────────────────────────────────────────
export default function AnalyticsView() {
  const [range, setRange] = useState<RangeKey>("month");

  const dash = useApi<DashLite>("/api/dashboard");
  const reportsQ = useApi<ReportsPage>(`/api/reports${qs({ pageSize: 50 })}`);
  const requestsQ = useApi<RequestsPage>(`/api/requests${qs({ pageSize: 50 })}`);

  // Range start (client-side); null means "all time".
  const rangeStart = useMemo<Date | null>(() => {
    if (range === "all") return null;
    const now = new Date();
    if (range === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
    const d = new Date(now);
    d.setMonth(d.getMonth() - 3);
    return d;
  }, [range]);

  const inRange = useCallback(
    (iso: string | null | undefined): boolean => {
      if (!iso) return false;
      if (!rangeStart) return true;
      return new Date(iso).getTime() >= rangeStart.getTime();
    },
    [rangeStart]
  );

  // Reports filtered by publishedAt within the selected range.
  const reports = useMemo(
    () => (reportsQ.data?.reports ?? []).filter((r) => inRange(r.publishedAt)),
    [reportsQ.data, inRange]
  );
  const ackCount = reports.filter((r) => r.acknowledgedByOtp).length;
  const ackPct = reports.length > 0 ? Math.round((ackCount / reports.length) * 100) : 0;

  // Requests filtered by createdAt within the selected range (priority mix).
  const requestRows = useMemo(
    () => (requestsQ.data?.requests ?? []).filter((r) => inRange(r.createdAt)),
    [requestsQ.data, inRange]
  );
  const priorityCounts = useMemo(() => {
    const c: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, URGENT: 0 };
    for (const r of requestRows) if (r.priority in c) c[r.priority] += 1;
    return c;
  }, [requestRows]);

  // Aggregates without timestamps — always all-time totals from /api/dashboard.
  const categoryData = useMemo(() => {
    const byCat = dash.data?.requestsByCategory ?? {};
    return REQUEST_CATEGORIES.map((key) => ({ label: REQUEST_CATEGORY_LABELS[key] ?? key, count: byCat[key] ?? 0 }));
  }, [dash.data]);
  const categoryTotal = categoryData.reduce((s, c) => s + c.count, 0);

  const donutData = useMemo(() => buildDonut(dash.data?.jobsByStatus ?? {}), [dash.data]);

  // Pre-computed consts (avoid property narrowing inside JSX branches).
  const totalReportsAllTime = reportsQ.data?.total ?? 0;
  const fetchedRequestCount = requestsQ.data?.requests?.length ?? 0;
  const totalRequestsAllTime = requestsQ.data?.total ?? 0;
  const dashTotalJobs = dash.data?.kpis.totalJobs ?? 0;
  const avgCompletionHrs = dash.data?.kpis.avgCompletionHrs ?? 0;
  const busy = dash.loading || reportsQ.loading || requestsQ.loading;

  const refreshAll = () => {
    dash.refresh();
    reportsQ.refresh();
    requestsQ.refresh();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Service analytics"
        subtitle="Deeper insight into request volume, throughput and report acknowledgements."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={refreshAll}
            disabled={busy}
            className="rounded-xl gap-2"
            aria-label="Refresh analytics data"
          >
            <RotateCw className={cn("w-4 h-4", busy && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        }
      />

      {/* ── date-range tabs ── */}
      <Tabs value={range} onValueChange={(v) => setRange(v as RangeKey)}>
        <TabsList className="rounded-xl">
          <TabsTrigger value="month">This month</TabsTrigger>
          <TabsTrigger value="quarter">Last 3 months</TabsTrigger>
          <TabsTrigger value="all">All time</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* ── 1. requests by category ── */}
      <FadeIn delay={0.05}>
        {!dash.data ? (
          dash.error ? (
            <ErrorCard title="Couldn't load category data" message={dash.error} onRetry={dash.refresh} />
          ) : (
            <SectionCard title="Requests by category">
              <ChartSkeleton />
            </SectionCard>
          )
        ) : categoryTotal === 0 ? (
          <EmptyState
            icon={Wrench}
            title="No service requests yet"
            body="Requests raised by customers will show up here by category."
          />
        ) : (
          <SectionCard title="Requests by category" subtitle={`${categoryTotal} requests · all-time`}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={categoryData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E4EAE5" vertical={false} />
                <XAxis
                  dataKey="label"
                  interval={0}
                  angle={-22}
                  textAnchor="end"
                  height={56}
                  tick={{ fontSize: 10.5, fill: "#747E77" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis allowDecimals={false} width={34} tick={{ fontSize: 12, fill: "#747E77" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(217,154,50,0.08)" }} />
                <Bar dataKey="count" name="Requests" fill="#D99A32" radius={[8, 8, 0, 0]} barSize={38} />
              </BarChart>
            </ResponsiveContainer>
          </SectionCard>
        )}
      </FadeIn>

      {/* ── 2. completion metrics ── */}
      <FadeIn delay={0.08}>
        {!dash.data || !reportsQ.data ? (
          dash.error || reportsQ.error ? (
            <ErrorCard
              title="Couldn't load completion metrics"
              message={(dash.error ?? reportsQ.error) ?? "Failed to load"}
              onRetry={refreshAll}
            />
          ) : (
            <KpiSkeletonGrid count={4} />
          )
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <KpiCard
              label="Published reports"
              value={reports.length}
              icon={ClipboardCheck}
              tone="forest"
              delay={0}
              sub={`${totalReportsAllTime} all-time`}
            />
            <KpiCard
              label="OTP acknowledged"
              value={ackCount}
              icon={ShieldCheck}
              tone="forest"
              delay={0.06}
              sub="customer-verified"
            />
            <KpiCard
              label="Acknowledgement rate"
              value={`${ackPct}%`}
              icon={BadgeCheck}
              tone="amber"
              delay={0.12}
              sub={`${ackCount} of ${reports.length} in range`}
            />
            <KpiCard
              label="Avg completion time"
              value={`${avgCompletionHrs} h`}
              icon={Clock}
              tone="slate"
              delay={0.18}
              sub="scheduled → completed · all-time"
            />
          </div>
        )}
      </FadeIn>

      {/* ── 3. job status distribution + 4. priority mix ── */}
      <FadeIn delay={0.12} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {!dash.data ? (
          dash.error ? (
            <ErrorCard title="Couldn't load job data" message={dash.error} onRetry={dash.refresh} />
          ) : (
            <SectionCard title="Job status distribution">
              <ChartSkeleton />
            </SectionCard>
          )
        ) : donutData.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="No jobs yet" body="The pipeline chart will appear once jobs exist." />
        ) : (
          <SectionCard title="Job status distribution" subtitle={`${dashTotalJobs} jobs · all-time`}>
            <StatusDonut data={donutData} total={dashTotalJobs} totalLabel="total jobs" />
          </SectionCard>
        )}

        {!requestsQ.data ? (
          requestsQ.error ? (
            <ErrorCard title="Couldn't load requests" message={requestsQ.error} onRetry={requestsQ.refresh} />
          ) : (
            <SectionCard title="Priority mix">
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                {PRIORITY_TILES.map((p) => (
                  <div key={p.key} className="h-[96px] rounded-2xl bg-sd-surface animate-pulse" aria-hidden="true" />
                ))}
              </div>
            </SectionCard>
          )
        ) : totalRequestsAllTime === 0 ? (
          <EmptyState
            icon={Wrench}
            title="No service requests yet"
            body="Priorities will show here once customers raise requests."
          />
        ) : (
          <SectionCard
            title="Priority mix"
            subtitle={`${requestRows.length} of ${fetchedRequestCount} recent requests · ${RANGE_LABELS[range]}`}
          >
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              {PRIORITY_TILES.map((p) => (
                <div key={p.key} className="rounded-2xl p-4" style={{ background: p.bg }}>
                  <PriorityPill priority={p.key} />
                  <div className="text-[1.6rem] font-bold leading-none mt-3 tabular-nums" style={{ color: p.fg }}>
                    {priorityCounts[p.key]}
                  </div>
                  <div className="text-[0.68rem] mt-1.5 leading-snug" style={{ color: p.fg, opacity: 0.78 }}>
                    requests · {RANGE_LABELS[range].toLowerCase()}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-sd-ink-soft mt-4">
              {totalRequestsAllTime} requests on record · showing the {fetchedRequestCount} most recent
            </p>
          </SectionCard>
        )}
      </FadeIn>

      {/* ── 5. report acknowledgements table ── */}
      <FadeIn delay={0.18}>
        {!reportsQ.data ? (
          reportsQ.error ? (
            <ErrorCard title="Couldn't load reports" message={reportsQ.error} onRetry={reportsQ.refresh} />
          ) : (
            <SkeletonRows rows={6} />
          )
        ) : reports.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title={totalReportsAllTime === 0 ? "No service reports yet" : "No reports in this range"}
            body={
              totalReportsAllTime === 0
                ? "Reports appear here once technicians publish them."
                : "Try a wider date range to see more reports."
            }
          />
        ) : (
          <div>
            <div className="mb-2.5 px-1">
              <h3 className="font-semibold text-sd-ink text-[0.95rem]">Report acknowledgements</h3>
              <p className="text-xs text-sd-ink-soft mt-0.5">
                {reports.length} of {totalReportsAllTime} reports · {RANGE_LABELS[range]}
              </p>
            </div>
            <TableShell>
              <div className="max-h-96 overflow-y-auto sd-scroll">
                <table className="w-full text-sm min-w-[620px] border-collapse">
                  <thead className="sticky top-0 z-10 bg-white">
                    <tr>
                      <th className="text-left px-4 py-3 text-sd-ink-soft font-medium text-xs uppercase tracking-wide border-b border-sd-line">
                        Customer
                      </th>
                      <th className="text-left px-4 py-3 text-sd-ink-soft font-medium text-xs uppercase tracking-wide border-b border-sd-line">
                        Job
                      </th>
                      <th className="text-left px-4 py-3 text-sd-ink-soft font-medium text-xs uppercase tracking-wide border-b border-sd-line">
                        Status
                      </th>
                      <th className="text-left px-4 py-3 text-sd-ink-soft font-medium text-xs uppercase tracking-wide border-b border-sd-line">
                        Acknowledged
                      </th>
                      <th className="text-left px-4 py-3 text-sd-ink-soft font-medium text-xs uppercase tracking-wide border-b border-sd-line">
                        Published
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map((r) => (
                      <tr key={r.id} className="border-t border-sd-line/70">
                        <td className="px-4 py-3 font-medium text-sd-ink">{r.customer.name}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-sd-ink">{r.job.code}</div>
                          <div className="text-xs text-sd-ink-soft mt-0.5">{prettyJobType(r.job.type)}</div>
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill status={r.job.status} />
                        </td>
                        <td className="px-4 py-3">
                          {r.acknowledgedByOtp ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-sd-success">
                              <CircleCheck className="w-3.5 h-3.5" /> OTP verified
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#96660d]">
                              <Hourglass className="w-3.5 h-3.5" /> Pending
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sd-ink-soft">{fmtDateTime(r.publishedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TableShell>
          </div>
        )}
      </FadeIn>

      {/* ── note card ── */}
      <FadeIn delay={0.24}>
        <div className="sd-inset p-4 flex items-start gap-3">
          <Info className="w-4 h-4 text-sd-forest mt-0.5 shrink-0" />
          <p className="text-xs text-sd-ink-soft leading-relaxed">
            <span className="font-semibold text-sd-ink">
              All figures are computed live from your organization&apos;s records.
            </span>{" "}
            Date-range filters apply to timestamped records — reports (by published date) and requests (by created
            date). Aggregates without timestamps — category mix, job pipeline and completion averages — are shown
            as all-time totals.
          </p>
        </div>
      </FadeIn>
    </div>
  );
}
