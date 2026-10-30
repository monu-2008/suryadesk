"use client";
// Notifications inbox — click a card to mark it read (PATCH), "Mark all read"
// for bulk. Unread badge in the topbar stays in sync via the store.
import { useState } from "react";
import { CheckCircle2, CheckCheck, TriangleAlert } from "lucide-react";
import { api, useApi } from "@/lib/surya/client";
import { fmtDateTime, type PillTone } from "@/lib/surya/types";
import { useSd } from "@/lib/surya/store";
import { EmptyState, PageHeader, SkeletonRows } from "../shared/bits";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  readAt: string | null;
  createdAt: string;
}

interface NotificationsResponse {
  notifications: NotificationRow[];
  unread: number;
}

const KIND_META: Record<string, { label: string; tone: PillTone }> = {
  NEW_REQUEST: { label: "New request", tone: "amber" },
  JOB_ASSIGNED: { label: "Job assigned", tone: "teal" },
  JOB_STATUS: { label: "Job status", tone: "violet" },
  PENDING_REVIEW: { label: "Pending review", tone: "red" },
  AMC_REMINDER: { label: "AMC reminder", tone: "slate" },
  REPORT_PUBLISHED: { label: "Report published", tone: "green" },
  CUSTOMER_ACK: { label: "Customer ack", tone: "green" },
  ACCOUNT: { label: "Account", tone: "slate" },
};

function kindMeta(kind: string) {
  return KIND_META[kind] ?? { label: kind, tone: "slate" as PillTone };
}

// file-local error card with retry (kept per contract: no new shared files)
function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="sd-clay p-5 flex flex-col sm:flex-row items-start gap-4" role="alert">
      <div className="rounded-2xl bg-[#C94B55]/10 p-3 shrink-0">
        <TriangleAlert className="w-5 h-5 text-[#a03340]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-sd-ink text-sm">Couldn&apos;t load notifications</div>
        <p className="text-xs text-sd-ink-soft mt-1 leading-relaxed">{message}</p>
      </div>
      <button onClick={onRetry} className="sd-btn-primary px-4 py-2 text-xs font-semibold sd-focus shrink-0">
        Try again
      </button>
    </div>
  );
}

export default function NotificationsView() {
  const { data, loading, error, refresh } = useApi<NotificationsResponse>("/api/notifications");
  const setUnread = useSd((s) => s.setUnread);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [busy, setBusy] = useState(false);

  const all = data?.notifications ?? [];
  const unread = data?.unread ?? 0;
  const visible = filter === "unread" ? all.filter((n) => !n.readAt) : all;

  const markRead = async (n: NotificationRow) => {
    if (n.readAt || busy) return;
    setBusy(true);
    try {
      await api("/api/notifications", { method: "PATCH", json: { ids: [n.id] } });
      setUnread(Math.max(0, unread - 1));
      await refresh();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Couldn't mark as read",
        description: e instanceof Error ? e.message : "Please try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  const markAllRead = async () => {
    if (busy || unread === 0) return;
    setBusy(true);
    try {
      await api("/api/notifications", { method: "PATCH", json: { all: true } });
      setUnread(0);
      await refresh();
      toast({ title: "All caught up", description: "Every notification was marked as read." });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Couldn't mark all read",
        description: e instanceof Error ? e.message : "Please try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  let body: React.ReactNode;
  if (loading && !data) {
    body = <SkeletonRows rows={6} />;
  } else if (error) {
    body = <LoadError message={error} onRetry={refresh} />;
  } else if (visible.length === 0) {
    body = (
      <EmptyState
        icon={CheckCircle2}
        title="You're all caught up"
        body={
          filter === "unread"
            ? "No unread notifications right now."
            : "New notifications will appear here as work progresses."
        }
      />
    );
  } else {
    body = (
      <div className="max-h-[34rem] overflow-y-auto sd-scroll space-y-3 pr-1" aria-label="Notifications">
        {visible.map((n) => {
          const km = kindMeta(n.kind);
          return (
            <button
              key={n.id}
              onClick={() => markRead(n)}
              aria-label={`${n.title}${n.readAt ? "" : " — click to mark as read"}`}
              className={cn(
                "w-full text-left sd-clay sd-clay-raise p-4 flex items-start gap-3 sd-focus",
                n.readAt ? "opacity-70" : ""
              )}
            >
              <span
                className={cn("w-2.5 h-2.5 rounded-full mt-1.5 shrink-0", n.readAt ? "bg-sd-line" : "bg-sd-forest")}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                  <div className={cn("text-sm leading-snug min-w-0", n.readAt ? "font-medium text-sd-ink-soft" : "font-semibold text-sd-ink")}>
                    {n.title}
                  </div>
                  <span className={cn("sd-pill shrink-0", `sd-pill-${km.tone}`)}>{km.label}</span>
                </div>
                {n.body && <p className="text-xs text-sd-ink-soft mt-1.5 leading-relaxed">{n.body}</p>}
                <div className="text-[0.66rem] text-sd-ink-soft/80 mt-2">{fmtDateTime(n.createdAt)}</div>
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        subtitle="Activity across your workspace — click a card to mark it read."
        actions={
          <button
            onClick={markAllRead}
            disabled={busy || unread === 0}
            className="sd-btn-primary px-3.5 py-2 text-xs font-semibold sd-focus flex items-center gap-1.5"
          >
            <CheckCheck className="w-3.5 h-3.5" aria-hidden="true" />
            Mark all read
          </button>
        }
      />

      {/* filter chips */}
      <div className="sd-inset p-1 rounded-2xl flex gap-1 self-start" role="tablist" aria-label="Notification filter">
        {(["all", "unread"] as const).map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors sd-focus flex items-center gap-1.5",
              filter === f ? "bg-white text-sd-forest-deep shadow-sm" : "text-sd-ink-soft hover:text-sd-ink"
            )}
          >
            {f === "all" ? "All" : "Unread"}
            {f === "unread" && unread > 0 && (
              <span className="rounded-full bg-[#C94B55] text-white text-[0.6rem] font-bold px-1.5 py-0.5 leading-none">
                {unread}
              </span>
            )}
          </button>
        ))}
      </div>

      {body}
    </div>
  );
}
