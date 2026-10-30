"use client";
// Manager/Owner — Technician roster: one clay card per field engineer with
// live workload (today / active / pending review / completed) from /api/technicians.
import { motion } from "framer-motion";
import { CalendarDays, HardHat, Mail, Phone, TriangleAlert } from "lucide-react";
import { useApi } from "@/lib/surya/client";
import { fmtDate, parseJson } from "@/lib/surya/types";
import { EmptyState, PageHeader, SdAvatar, SkeletonRows } from "../shared/bits";
import { cn } from "@/lib/utils";

interface Technician {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  title: string | null;
  skills: string[] | string | null;
  isActive: boolean;
  joinedAt: string;
  activeJobs: number;
  todayJobs: number;
  completedJobs: number;
  pendingJobs: number;
}

interface TechniciansResponse {
  technicians: Technician[];
}

function skillsOf(t: Technician): string[] {
  if (Array.isArray(t.skills)) return t.skills;
  return parseJson<string[]>(typeof t.skills === "string" ? t.skills : null, []);
}

// file-local error card with retry (kept per contract: no new shared files)
function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="sd-clay p-5 flex flex-col sm:flex-row items-start gap-4" role="alert">
      <div className="rounded-2xl bg-[#C94B55]/10 p-3 shrink-0">
        <TriangleAlert className="w-5 h-5 text-[#a03340]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-sd-ink text-sm">Couldn&apos;t load the roster</div>
        <p className="text-xs text-sd-ink-soft mt-1 leading-relaxed">{message}</p>
      </div>
      <button onClick={onRetry} className="sd-btn-primary px-4 py-2 text-xs font-semibold sd-focus shrink-0">
        Try again
      </button>
    </div>
  );
}

function WorkTile({
  label,
  value,
  children,
}: {
  label: string;
  value: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="sd-inset rounded-xl px-2.5 py-2.5 min-w-0 flex flex-col items-center text-center gap-1">
      <div className="text-xl font-bold text-sd-ink leading-none">{value}</div>
      <div className="text-[0.58rem] font-semibold uppercase tracking-wide text-sd-ink-soft leading-tight">{label}</div>
      {children}
    </div>
  );
}

export default function TechniciansView() {
  const { data, loading, error, refresh } = useApi<TechniciansResponse>("/api/technicians");
  const technicians = data?.technicians ?? [];
  const maxActive = technicians.reduce((m, t) => Math.max(m, t.activeJobs), 0);

  let body: React.ReactNode;
  if (loading && !data) {
    body = <SkeletonRows rows={6} />;
  } else if (error) {
    body = <LoadError message={error} onRetry={refresh} />;
  } else if (technicians.length === 0) {
    body = (
      <EmptyState
        icon={HardHat}
        title="No technicians on the roster yet"
        body="Field staff appear here with their live workload once they join this organization."
      />
    );
  } else {
    body = (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {technicians.map((t, i) => {
          const skills = skillsOf(t);
          const activePct = maxActive > 0 ? Math.round((t.activeJobs / maxActive) * 100) : 0;
          return (
            <motion.article
              key={t.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.05, 0.3), duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="sd-clay sd-clay-raise p-5 flex flex-col gap-4"
            >
              {/* identity */}
              <div className="flex items-start gap-3.5 min-w-0">
                <SdAvatar name={t.name} size={44} className={cn(!t.isActive && "grayscale")} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sd-ink text-[0.95rem] leading-tight">{t.name}</span>
                    {!t.isActive && <span className="sd-pill sd-pill-slate">Inactive</span>}
                  </div>
                  <div className="text-xs text-sd-ink-soft mt-0.5">{t.title ?? "Field Technician"}</div>
                  <div className="mt-2.5 space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2 text-xs text-sd-ink-soft min-w-0">
                      <Mail className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate" title={t.email}>{t.email}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs min-w-0">
                      <Phone className="w-3.5 h-3.5 shrink-0 text-sd-ink-soft" aria-hidden="true" />
                      <span className={cn("truncate", t.phone ? "text-sd-ink-soft" : "text-sd-ink-soft/60")} title={t.phone ?? undefined}>
                        {t.phone ?? "No phone on file"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* skills */}
              {skills.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {skills.map((s) => (
                    <span key={s} className="sd-pill sd-pill-teal">{s}</span>
                  ))}
                </div>
              ) : (
                <p className="text-[0.72rem] italic text-sd-ink-soft/80">No skills recorded yet.</p>
              )}

              {/* live workload */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <WorkTile label="Today" value={t.todayJobs} />
                <WorkTile label="Active" value={t.activeJobs}>
                  <div
                    className="w-full h-1.5 rounded-full bg-white/70 overflow-hidden mt-0.5"
                    title={`${t.activeJobs} active of team peak ${maxActive}`}
                  >
                    <div
                      className="h-full rounded-full bg-sd-forest transition-all duration-500"
                      style={{ width: `${activePct}%` }}
                    />
                  </div>
                </WorkTile>
                <WorkTile label="Pending review" value={t.pendingJobs} />
                <WorkTile label="Completed" value={t.completedJobs} />
              </div>

              {/* joined */}
              <div className="flex items-center gap-1.5 text-[0.7rem] text-sd-ink-soft mt-auto pt-1">
                <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />
                Joined {fmtDate(t.joinedAt)}
              </div>
            </motion.article>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Technicians"
        subtitle="Field team roster and live workload."
        actions={
          data ? (
            <span className="sd-pill sd-pill-slate">
              {technicians.length} technician{technicians.length === 1 ? "" : "s"}
            </span>
          ) : undefined
        }
      />
      {body}
    </div>
  );
}
