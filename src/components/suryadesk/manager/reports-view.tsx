"use client";
// Manager/Owner — Service Reports: Proof of Service records with customer OTP
// acknowledgements. Search + acknowledgement filter + detail dialog.
import { useEffect, useState } from "react";
import {
  CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Clock, Eye, Search,
  Sparkles, TriangleAlert, XCircle,
} from "lucide-react";
import { qs, useApi } from "@/lib/surya/client";
import { fmtDate, fmtDateTime, parseJson } from "@/lib/surya/types";
import { EmptyState, PageHeader, SkeletonRows, StatusPill, TableShell } from "../shared/bits";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface ReportRow {
  id: string;
  technicianNotes: string | null;
  summary: string | null;
  followUpNeeded: boolean;
  followUpNotes: string | null;
  checklistJson: string | null;
  photosJson: string | null;
  aiAssisted: boolean;
  acknowledgedByOtp: boolean;
  acknowledgedAt: string | null;
  publishedAt: string;
  customer: { id: string; name: string; city: string | null };
  job: {
    id: string;
    code: string;
    title: string;
    status: string;
    type: string;
    scheduledFor: string;
    completedAt: string | null;
    installation: { assetCode: string; capacityKw: number } | null;
  };
}

interface ReportsPage {
  total: number;
  page: number;
  pageSize: number;
  reports: ReportRow[];
}

interface ChecklistItem {
  label: string;
  kind: string;
  value: string;
}

interface PhotoItem {
  id: string;
  caption?: string | null;
}

const PAGE_SIZE = 10;

const ACK_OPTIONS = [
  { value: "", label: "All" },
  { value: "yes", label: "OTP verified" },
  { value: "no", label: "Pending acknowledgement" },
] as const;

const TYPE_LABELS: Record<string, string> = { COMPLAINT: "Complaint", MAINTENANCE: "Maintenance" };
const TYPE_TONES: Record<string, string> = { COMPLAINT: "sd-pill-amber", MAINTENANCE: "sd-pill-teal" };

// file-local error card with retry (kept per contract: no new shared files)
function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="sd-clay p-5 flex flex-col sm:flex-row items-start gap-4" role="alert">
      <div className="rounded-2xl bg-[#C94B55]/10 p-3 shrink-0">
        <TriangleAlert className="w-5 h-5 text-[#a03340]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-sd-ink text-sm">Couldn&apos;t load service reports</div>
        <p className="text-xs text-sd-ink-soft mt-1 leading-relaxed">{message}</p>
      </div>
      <button onClick={onRetry} className="sd-btn-primary px-4 py-2 text-xs font-semibold sd-focus shrink-0">
        Try again
      </button>
    </div>
  );
}

export default function ReportsView() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [ack, setAck] = useState<"" | "yes" | "no">("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ReportRow | null>(null);

  // debounced search (~300ms)
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const path = `/api/reports${qs({ search, ack, page, pageSize: PAGE_SIZE })}`;
  const { data, loading, error, refresh } = useApi<ReportsPage>(path, [path]);

  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // clamp page when the result set shrinks (adjust-state-during-render pattern)
  if (data) {
    if (total === 0 && page !== 1) setPage(1);
    else if (total > 0 && page > lastPage) setPage(lastPage);
  }

  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const hasFilters = search !== "" || ack !== "";

  let body: React.ReactNode;
  if (loading && !data) {
    body = <SkeletonRows rows={6} />;
  } else if (error) {
    body = <LoadError message={error} onRetry={refresh} />;
  } else if (data && data.reports.length === 0) {
    body = (
      <EmptyState
        icon={ClipboardCheck}
        title={hasFilters ? "No reports match your filters" : "No service reports yet"}
        body={
          hasFilters
            ? "Try a different search term or clear the acknowledgement filter."
            : "Reports appear here once technicians publish their work from a service job."
        }
      />
    );
  } else if (data) {
    body = (
      <div className="space-y-4">
        <div className={cn("transition-opacity", loading && "opacity-60 pointer-events-none")}>
          <TableShell>
            <table className="w-full min-w-[54rem] text-sm">
              <thead>
                <tr>
                  <th className="text-left px-4 py-3 text-sd-ink-soft font-medium text-xs uppercase tracking-wide">Report</th>
                  <th className="text-left px-4 py-3 text-sd-ink-soft font-medium text-xs uppercase tracking-wide">Customer</th>
                  <th className="text-left px-4 py-3 text-sd-ink-soft font-medium text-xs uppercase tracking-wide">Asset</th>
                  <th className="text-left px-4 py-3 text-sd-ink-soft font-medium text-xs uppercase tracking-wide">Published</th>
                  <th className="text-left px-4 py-3 text-sd-ink-soft font-medium text-xs uppercase tracking-wide">Follow-up</th>
                  <th className="text-left px-4 py-3 text-sd-ink-soft font-medium text-xs uppercase tracking-wide">Acknowledgement</th>
                  <th className="text-right px-4 py-3 text-sd-ink-soft font-medium text-xs uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.reports.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-sd-line/70 hover:bg-sd-surface/50 transition-colors cursor-pointer"
                    onClick={() => setSelected(r)}
                  >
                    <td className="px-4 py-3.5">
                      <div className="font-semibold text-sd-ink whitespace-nowrap">{r.job.code}</div>
                      <div className="text-xs text-sd-ink-soft max-w-[15rem] truncate" title={r.job.title}>{r.job.title}</div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="text-sd-ink">{r.customer.name}</div>
                      <div className="text-xs text-sd-ink-soft">{r.customer.city ?? "—"}</div>
                    </td>
                    <td className="px-4 py-3.5">
                      {r.job.installation ? (
                        <>
                          <div className="text-sd-ink font-medium">{r.job.installation.assetCode}</div>
                          <div className="text-xs text-sd-ink-soft">{r.job.installation.capacityKw} kW</div>
                        </>
                      ) : (
                        <span className="text-sd-ink-soft">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-sd-ink whitespace-nowrap">{fmtDateTime(r.publishedAt)}</td>
                    <td className="px-4 py-3.5">
                      {r.followUpNeeded ? (
                        <span className="sd-pill sd-pill-amber" title={r.followUpNotes ?? undefined}>Needed</span>
                      ) : (
                        <span className="text-sd-ink-soft">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      {r.acknowledgedByOtp ? (
                        <div>
                          <div className="flex items-center gap-1.5 text-sd-success">
                            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                            <span className="text-xs font-semibold">OTP verified</span>
                          </div>
                          <div className="text-[0.65rem] text-sd-ink-soft mt-0.5">{fmtDate(r.acknowledgedAt)}</div>
                        </div>
                      ) : (
                        <div>
                          <div className="flex items-center gap-1.5 text-[#96660d]">
                            <Clock className="w-4 h-4" aria-hidden="true" />
                            <span className="text-xs font-semibold">Pending</span>
                          </div>
                          <div className="text-[0.65rem] text-sd-ink-soft mt-0.5">Awaiting customer OTP</div>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="rounded-xl h-8 px-3 text-xs font-semibold text-sd-forest"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelected(r);
                        }}
                      >
                        <Eye className="w-4 h-4 mr-1.5" aria-hidden="true" /> View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        </div>

        {/* pagination */}
        {total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-sd-ink-soft">
              Showing {from}–{to} of {total} report{total === 1 ? "" : "s"}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl"
                disabled={page >= lastPage || loading}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Next page"
              >
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Service Reports"
        subtitle="Proof of Service records with customer OTP acknowledgements."
        actions={data ? <span className="sd-pill sd-pill-slate">{total} total</span> : undefined}
      />

      {/* toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-sd-ink-soft" aria-hidden="true" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search code, customer or notes…"
            aria-label="Search service reports"
            className="sd-inset w-full py-2.5 pl-10 pr-4 text-sm text-sd-ink placeholder:text-sd-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-sd-forest/40"
          />
        </div>
        <div className="sd-inset p-1 rounded-2xl flex gap-1 self-start sm:self-auto" role="tablist" aria-label="Acknowledgement filter">
          {ACK_OPTIONS.map((o) => (
            <button
              key={o.value}
              role="tab"
              aria-selected={ack === o.value}
              onClick={() => {
                setAck(o.value);
                setPage(1);
              }}
              className={cn(
                "px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors sd-focus",
                ack === o.value ? "bg-white text-sd-forest-deep shadow-sm" : "text-sd-ink-soft hover:text-sd-ink"
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {body}

      {/* detail dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        {selected && (
          <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto sd-scroll rounded-2xl">
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2.5 text-lg leading-tight">
                <span className="font-mono text-sd-forest-deep">{selected.job.code}</span>
                <span className="text-sd-ink">{selected.job.title}</span>
              </DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1">
                <StatusPill status={selected.job.status} />
                <span className={cn("sd-pill", TYPE_TONES[selected.job.type] ?? "sd-pill-slate")}>
                  {TYPE_LABELS[selected.job.type] ?? selected.job.type}
                </span>
                <span className="text-xs">{selected.customer.name} · {selected.customer.city ?? "—"}</span>
                <span className="text-xs">Published {fmtDateTime(selected.publishedAt)}</span>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* summary */}
              <div className="sd-inset p-4">
                <div className="text-[0.62rem] font-bold uppercase tracking-wide text-sd-ink-soft/80">Summary</div>
                <p className="text-sm text-sd-ink mt-1.5 leading-relaxed">{selected.summary || "—"}</p>
              </div>

              {/* technician notes */}
              <div className="sd-inset p-4">
                <div className="text-[0.62rem] font-bold uppercase tracking-wide text-sd-ink-soft/80">Technician notes</div>
                <p className="text-sm text-sd-ink mt-1.5 leading-relaxed whitespace-pre-wrap">
                  {selected.technicianNotes || "—"}
                </p>
              </div>

              {/* follow-up */}
              {selected.followUpNeeded && (
                <div className="sd-inset p-4 border-l-4 border-l-[#D99A32]/70">
                  <div className="text-[0.62rem] font-bold uppercase tracking-wide text-[#96660d]">Follow-up required</div>
                  <p className="text-sm text-sd-ink mt-1.5 leading-relaxed">
                    {selected.followUpNotes || "No follow-up notes recorded."}
                  </p>
                </div>
              )}

              {/* checklist */}
              {(() => {
                const items = parseJson<ChecklistItem[]>(selected.checklistJson, []);
                if (items.length === 0) return null;
                return (
                  <section>
                    <h4 className="text-xs font-bold uppercase tracking-wide text-sd-ink-soft/80 mb-2.5">
                      Checklist ({items.length})
                    </h4>
                    <ul className="sd-inset p-4">
                      {items.map((c, i) => {
                        const isBool = c.kind === "BOOLEAN";
                        const done = isBool ? c.value === "true" : null;
                        return (
                          <li
                            key={i}
                            className="flex items-start justify-between gap-4 py-2.5 border-b border-sd-line/60 last:border-b-0 first:pt-0 last:pb-0"
                          >
                            <span className="text-sm text-sd-ink leading-snug">{c.label}</span>
                            {done === true && <CheckCircle2 className="w-4 h-4 text-sd-success shrink-0 mt-0.5" aria-label="Done" />}
                            {done === false && <XCircle className="w-4 h-4 text-sd-error shrink-0 mt-0.5" aria-label="Not done" />}
                            {done === null && (
                              <span className="text-sm text-sd-ink-soft text-right max-w-[55%]">{c.value || "—"}</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })()}

              {/* photos */}
              {(() => {
                const photos = parseJson<PhotoItem[]>(selected.photosJson, []);
                if (photos.length === 0) return null;
                return (
                  <section>
                    <h4 className="text-xs font-bold uppercase tracking-wide text-sd-ink-soft/80 mb-2.5">
                      Photos ({photos.length})
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {photos.map((p) => (
                        <figure key={p.id} className="min-w-0">
                          <img
                            src={`/api/attachments/${p.id}`}
                            alt={p.caption || "Service photo"}
                            loading="lazy"
                            className="w-full h-28 sm:h-32 object-cover rounded-xl border border-sd-line"
                          />
                          <figcaption className="text-[0.66rem] text-sd-ink-soft mt-1 truncate">
                            {p.caption || "Service photo"}
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  </section>
                );
              })()}

              {/* meta chips */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {selected.aiAssisted && (
                  <span className="sd-pill sd-pill-violet">
                    <Sparkles className="w-3 h-3" aria-hidden="true" /> AI-assisted draft
                  </span>
                )}
                {selected.acknowledgedByOtp ? (
                  <span className="sd-pill sd-pill-green">
                    <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                    OTP verified · {fmtDateTime(selected.acknowledgedAt)}
                  </span>
                ) : (
                  <span className="sd-pill sd-pill-amber">
                    <Clock className="w-3 h-3" aria-hidden="true" /> Awaiting customer OTP
                  </span>
                )}
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
