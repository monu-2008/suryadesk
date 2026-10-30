"use client";
// SuryaDesk — Manager home. Action-oriented landing for service managers:
// what needs attention right now, with one-click jumps into the workflows.
import { Inbox, UserX, Hourglass, AlertTriangle, ArrowRight } from "lucide-react";
import { useApi } from "@/lib/surya/client";
import { useSd } from "@/lib/surya/store";
import { fmtDate, relativeDay, REQUEST_CATEGORY_LABELS } from "@/lib/surya/types";
import { cn } from "@/lib/utils";
import { KpiCard, StatusPill, PriorityPill, SectionCard, SdAvatar } from "../shared/bits";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

// ── local response types (subset of what the APIs return) ──────
interface DashResponse {
  critical: {
    unassignedScheduled: number;
    awaitingCustomer: number;
    needsReview: number;
    overdueMaintenance: number;
    openRequests: number;
  };
  workload: { id: string; name: string; title: string | null; activeJobs: number }[];
  calendar: { id: string; dueDate: string; status: string; customer: string; assetCode: string; capacityKw: number }[];
}

interface RequestRow {
  id: string;
  code: string;
  category: string;
  priority: string;
  createdAt: string;
  customer: { id: string; name: string; city: string };
}

interface RequestsPage {
  total: number;
  requests: RequestRow[];
}

interface JobRow {
  id: string;
  code: string;
  title: string;
  status: string;
  scheduledFor: string;
  technician: { id: string; name: string } | null;
}

interface JobsPage {
  total: number;
  jobs: JobRow[];
}

// ── tiny inline error card ──────────────────────────────────────
function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="sd-clay p-5 flex flex-col sm:flex-row items-start gap-3">
      <AlertTriangle className="w-5 h-5 text-sd-error mt-0.5 shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sd-ink text-sm">Failed to load</div>
        <div className="text-xs text-sd-ink-soft mt-0.5">{message}</div>
      </div>
      <button className="text-xs font-semibold text-sd-forest hover:underline" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

// one compact request-inbox row (whole row jumps into the inbox)
function InboxRow({ r, onGo }: { r: RequestRow; onGo: () => void }) {
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={onGo}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onGo();
      }}
      className="flex items-center gap-3 px-5 py-3 border-t border-sd-line/70 first:border-t-0 hover:bg-sd-surface/50 transition-colors cursor-pointer"
    >
      <span className="text-xs font-bold text-sd-forest shrink-0 w-[4.6rem]">{r.code}</span>
      <PriorityPill priority={r.priority} className="shrink-0" />
      <span className="flex-1 min-w-0 truncate text-sm text-sd-ink">
        {REQUEST_CATEGORY_LABELS[r.category] ?? r.category} · {r.customer.name}
      </span>
      <span className="hidden sm:inline text-xs text-sd-ink-soft shrink-0">{relativeDay(r.createdAt)}</span>
      <button
        className="shrink-0 text-xs font-semibold text-sd-forest hover:underline inline-flex items-center gap-1"
        onClick={(e) => {
          e.stopPropagation();
          onGo();
        }}
      >
        Review <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

export default function ManagerHome() {
  const { user, setView } = useSd();
  const dash = useApi<DashResponse>("/api/dashboard");
  const newReqs = useApi<RequestsPage>("/api/requests?status=NEW&pageSize=5");
  const reviewReqs = useApi<RequestsPage>("/api/requests?status=UNDER_REVIEW&pageSize=5");
  const activeJobs = useApi<JobsPage>("/api/jobs?scope=active&pageSize=8");

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = user?.name?.split(/\s+/)[0] ?? "";
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  const critical = dash.data?.critical;
  const workload = dash.data?.workload ?? [];
  const maxLoad = Math.max(1, ...workload.map((w) => w.activeJobs));
  const week = (dash.data?.calendar ?? []).filter((o) => new Date(o.dueDate).getTime() <= Date.now() + 7 * 86400000).slice(0, 6);

  return (
    <div>
      {/* greeting */}
      <div className="mb-5">
        <h1 className="text-[1.45rem] sm:text-[1.7rem] font-bold tracking-tight text-sd-ink">
          {greeting}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="text-sm text-sd-ink-soft mt-1">
          {today} — here is what needs your attention today.
        </p>
      </div>

      {/* KPI strip — each card jumps into its workflow */}
      {dash.loading && !dash.data ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="sd-clay h-[6.5rem] animate-pulse" style={{ animationDelay: `${i * 90}ms` }} />
          ))}
        </div>
      ) : dash.error && !dash.data ? (
        <div className="mb-5">
          <ErrorCard message={dash.error} onRetry={dash.refresh} />
        </div>
      ) : (
        critical && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
            <KpiCard label="Open requests" value={critical.openRequests} sub="New, in review or approved" tone="forest" icon={Inbox} delay={0} onClick={() => setView("requests")} />
            <KpiCard label="Unassigned jobs" value={critical.unassignedScheduled} sub="Scheduled, no technician yet" tone="amber" icon={UserX} delay={0.05} onClick={() => setView("jobs")} />
            <KpiCard label="Awaiting customer" value={critical.awaitingCustomer} sub="Reports pending OTP acknowledgement" tone="slate" icon={Hourglass} delay={0.1} onClick={() => setView("jobs")} />
            <KpiCard label="Overdue maintenance" value={critical.overdueMaintenance} sub="Visits past their due date" tone="error" icon={AlertTriangle} delay={0.15} onClick={() => setView("maintenance")} />
          </div>
        )
      )}

      {/* row 1 — request inbox + active job board */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <SectionCard
          title="Request inbox"
          subtitle="Customer complaints waiting on you"
          bodyClassName="p-0"
          actions={
            <button className="text-xs font-semibold text-sd-forest hover:underline inline-flex items-center gap-1" onClick={() => setView("requests")}>
              Open inbox <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          }
        >
          <Tabs defaultValue="NEW">
            <div className="px-5 pb-3 pt-1">
              <TabsList className="bg-sd-surface">
                <TabsTrigger value="NEW">New{newReqs.data ? ` · ${newReqs.data.total}` : ""}</TabsTrigger>
                <TabsTrigger value="UNDER_REVIEW">Under review{reviewReqs.data ? ` · ${reviewReqs.data.total}` : ""}</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="NEW" className="mt-0">
              {newReqs.loading && !newReqs.data ? (
                <div className="px-5 py-6 space-y-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-9 rounded-xl bg-sd-surface animate-pulse" style={{ animationDelay: `${i * 90}ms` }} />
                  ))}
                </div>
              ) : newReqs.error && !newReqs.data ? (
                <div className="px-5 pb-5">
                  <ErrorCard message={newReqs.error} onRetry={newReqs.refresh} />
                </div>
              ) : newReqs.data && newReqs.data.requests.length > 0 ? (
                <div className="max-h-[21rem] overflow-y-auto sd-scroll">
                  {newReqs.data.requests.map((r) => (
                    <InboxRow key={r.id} r={r} onGo={() => setView("requests")} />
                  ))}
                </div>
              ) : (
                <div className="py-10 text-center text-sm text-sd-ink-soft px-6">No new requests — the inbox is clear.</div>
              )}
            </TabsContent>
            <TabsContent value="UNDER_REVIEW" className="mt-0">
              {reviewReqs.loading && !reviewReqs.data ? (
                <div className="px-5 py-6 space-y-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-9 rounded-xl bg-sd-surface animate-pulse" style={{ animationDelay: `${i * 90}ms` }} />
                  ))}
                </div>
              ) : reviewReqs.error && !reviewReqs.data ? (
                <div className="px-5 pb-5">
                  <ErrorCard message={reviewReqs.error} onRetry={reviewReqs.refresh} />
                </div>
              ) : reviewReqs.data && reviewReqs.data.requests.length > 0 ? (
                <div className="max-h-[21rem] overflow-y-auto sd-scroll">
                  {reviewReqs.data.requests.map((r) => (
                    <InboxRow key={r.id} r={r} onGo={() => setView("requests")} />
                  ))}
                </div>
              ) : (
                <div className="py-10 text-center text-sm text-sd-ink-soft px-6">Nothing under review right now.</div>
              )}
            </TabsContent>
          </Tabs>
        </SectionCard>

        <SectionCard
          title="Active job board"
          subtitle="Live jobs across the workflow"
          bodyClassName="p-0"
          actions={
            <button className="text-xs font-semibold text-sd-forest hover:underline inline-flex items-center gap-1" onClick={() => setView("jobs")}>
              Open board <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          }
        >
          {activeJobs.loading && !activeJobs.data ? (
            <div className="px-5 py-6 space-y-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-9 rounded-xl bg-sd-surface animate-pulse" style={{ animationDelay: `${i * 90}ms` }} />
              ))}
            </div>
          ) : activeJobs.error && !activeJobs.data ? (
            <div className="px-5 pb-5">
              <ErrorCard message={activeJobs.error} onRetry={activeJobs.refresh} />
            </div>
          ) : activeJobs.data && activeJobs.data.jobs.length > 0 ? (
            <div className="max-h-[21rem] overflow-y-auto sd-scroll">
              {activeJobs.data.jobs.map((j) => (
                <button
                  key={j.id}
                  onClick={() => setView("jobs")}
                  className="w-full flex items-center gap-3 px-5 py-3 border-t border-sd-line/70 first:border-t-0 hover:bg-sd-surface/50 transition-colors text-left"
                >
                  <span className="text-xs font-bold text-sd-forest shrink-0 w-[4.6rem]">{j.code}</span>
                  <span className="flex-1 min-w-0 truncate text-sm text-sd-ink">{j.title}</span>
                  <StatusPill status={j.status} className="shrink-0" />
                  {j.technician ? (
                    <span className="hidden md:inline text-xs text-sd-ink-soft shrink-0 max-w-[7rem] truncate">{j.technician.name}</span>
                  ) : (
                    <span className="sd-pill sd-pill-amber shrink-0">Unassigned</span>
                  )}
                  <span className="hidden sm:inline text-xs text-sd-ink-soft shrink-0">{fmtDate(j.scheduledFor)}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="py-10 text-center text-sm text-sd-ink-soft px-6">No active jobs right now.</div>
          )}
        </SectionCard>
      </div>

      {/* row 2 — technician availability + maintenance preview */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mt-5">
        <SectionCard title="Technician availability" subtitle="Active jobs per technician right now" bodyClassName="p-0">
          {dash.loading && !dash.data ? (
            <div className="px-5 py-6 space-y-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-12 rounded-xl bg-sd-surface animate-pulse" style={{ animationDelay: `${i * 90}ms` }} />
              ))}
            </div>
          ) : dash.error && !dash.data ? (
            <div className="px-5 pb-5">
              <ErrorCard message={dash.error} onRetry={dash.refresh} />
            </div>
          ) : workload.length > 0 ? (
            <div className="max-h-[21rem] overflow-y-auto sd-scroll">
              {workload.map((w) => {
                const pct = Math.round((w.activeJobs / maxLoad) * 100);
                return (
                  <div key={w.id} className="flex items-center gap-3.5 px-5 py-3.5 border-t border-sd-line/70 first:border-t-0">
                    <SdAvatar name={w.name} size={38} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold text-sd-ink truncate">{w.name}</span>
                        <span className="text-xs text-sd-ink-soft shrink-0" aria-label={`${w.activeJobs} active jobs`}>
                          {w.activeJobs} active
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-sd-inset overflow-hidden mt-1.5" role="img" aria-label={`${w.name} has ${w.activeJobs} of ${maxLoad} slots busy`}>
                        <div
                          className={cn("h-full rounded-full transition-all duration-500", w.activeJobs >= 3 ? "bg-sd-amber" : "bg-sd-forest")}
                          style={{ width: `${Math.max(pct, w.activeJobs > 0 ? 8 : 0)}%` }}
                        />
                      </div>
                      {w.title && <div className="text-[0.68rem] text-sd-ink-soft mt-1">{w.title}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-10 text-center text-sm text-sd-ink-soft px-6">No technicians on the team yet.</div>
          )}
        </SectionCard>

        <SectionCard
          title="Maintenance — next 7 days"
          subtitle="Preventive visits generated from AMC plans"
          bodyClassName="p-0"
          actions={
            <button className="text-xs font-semibold text-sd-forest hover:underline inline-flex items-center gap-1" onClick={() => setView("maintenance")}>
              Open calendar <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          }
        >
          {dash.loading && !dash.data ? (
            <div className="px-5 py-6 space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-10 rounded-xl bg-sd-surface animate-pulse" style={{ animationDelay: `${i * 90}ms` }} />
              ))}
            </div>
          ) : dash.error && !dash.data ? (
            <div className="px-5 pb-5">
              <ErrorCard message={dash.error} onRetry={dash.refresh} />
            </div>
          ) : week.length > 0 ? (
            <div className="max-h-[21rem] overflow-y-auto sd-scroll">
              {week.map((o) => {
                const d = new Date(o.dueDate);
                return (
                  <button
                    key={o.id}
                    onClick={() => setView("maintenance")}
                    className="w-full flex items-center gap-3 px-5 py-3 border-t border-sd-line/70 first:border-t-0 hover:bg-sd-surface/50 transition-colors text-left"
                  >
                    <span className="sd-inset px-2.5 py-1.5 rounded-xl text-center shrink-0 min-w-[3.4rem]">
                      <span className="block text-base font-bold text-sd-ink leading-none">{d.getDate()}</span>
                      <span className="block text-[0.62rem] uppercase tracking-wide text-sd-ink-soft mt-0.5">
                        {d.toLocaleDateString("en-IN", { month: "short" })}
                      </span>
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-sd-ink truncate">{o.customer}</span>
                      <span className="block text-xs text-sd-ink-soft truncate">
                        {o.assetCode} · {o.capacityKw} kW
                      </span>
                    </span>
                    <StatusPill status={o.status} className="shrink-0" />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="py-10 text-center text-sm text-sd-ink-soft px-6">No maintenance visits in the next 7 days.</div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
