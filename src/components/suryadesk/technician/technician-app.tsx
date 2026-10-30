"use client";
// ─────────────────────────────────────────────────────────────────────────────
// SuryaDesk · Technician field app (mobile-first view)
// One self-contained workspace: Today, My Jobs, Offline Sync, Profile, plus a
// full-screen job overlay (checklist → photos → report → customer OTP).
// Offline engine: IndexedDB cache (job lists + job details) + an idempotent
// sync queue (start / checklist / photo / submit) replayed via POST /api/sync.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import {
  AlarmClock, AlertTriangle, ArrowLeft, BadgeCheck, CalendarCheck, CalendarClock, CalendarDays,
  Camera, CheckCircle2, ChevronDown, ChevronUp, ClipboardCheck, ClipboardList, Clock, CloudOff,
  Copy, Database, HardHat, Info, Loader2, LogOut, MapPin, MessageSquare, Phone, Play, RefreshCw,
  Search, Send, Sparkles, Sun, User, Wifi, WifiOff, XCircle, Zap, type LucideIcon,
} from "lucide-react";
import { api, qs, useApi } from "@/lib/surya/client";
import { useSd } from "@/lib/surya/store";
import { fmtDate, fmtDateTime, fmtTime, relativeDay, STATUS_LABELS } from "@/lib/surya/types";
import {
  EmptyState, KpiCard, PriorityPill, SdAvatar, SectionCard, SkeletonRows, StatusPill,
} from "@/components/suryadesk/shared/bits";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ── Types (API shapes used by this workspace) ─────────────────────────────────

interface TechJob {
  id: string;
  code: string;
  title: string;
  description: string | null;
  type: string;
  priority: string;
  status: string;
  scheduledFor: string;
  customer: { id: string; name: string; city: string | null; phone: string | null };
  installation: { id: string; assetCode: string; capacityKw: number | null; siteAddress: string | null; city: string | null } | null;
  technician: { id: string; name: string } | null;
  report: { id: string; acknowledgedByOtp: boolean } | null;
}

interface JobsResponse {
  total: number;
  page: number;
  pageSize: number;
  counts: Record<string, number>;
  jobs: TechJob[];
}

interface ChecklistItem { label: string; kind: "BOOLEAN" | "TEXT"; required?: boolean }
interface ChecklistResult { itemLabel: string; itemKind: string; value: string }
interface JobAttachment { id: string; fileName: string; caption: string | null; mimeType: string; sizeBytes: number; createdAt: string }
interface StatusEvent { fromStatus: string | null; toStatus: string; note: string | null; createdAt: string }

interface InstallationDetail {
  id: string;
  assetCode: string;
  capacityKw: number | null;
  siteAddress: string | null;
  city: string | null;
  panelMake: string | null;
  panelModel: string | null;
  panelCount: number | null;
  inverterMake: string | null;
  inverterModel: string | null;
  serialNumber: string | null;
  equipment: unknown[];
  warranties: unknown[];
  amcContracts: unknown[];
}

interface ServiceReport {
  id: string;
  technicianNotes: string | null;
  summary: string | null;
  acknowledgedByOtp: boolean;
  followUpNeeded: boolean;
  followUpNotes: string | null;
}

interface JobDetail {
  id: string;
  code: string;
  title: string;
  description: string | null;
  type: string;
  priority: string;
  status: string;
  scheduledFor: string;
  cancellationReason?: string | null;
  customer: { id: string; name: string; phone: string | null; email?: string | null; city: string | null; address: string | null };
  installation: InstallationDetail | null;
  technician: { id: string; name: string } | null;
  report: ServiceReport | null;
  statusEvents: StatusEvent[];
  attachments: JobAttachment[];
  checklistTemplate: { id: string; name: string; items: ChecklistItem[] } | null;
  checklistResults: ChecklistResult[];
}

interface OtpIssueResponse {
  ok: boolean;
  expiresAt: string;
  attemptsLeft: number;
  smsMode: string;
  demoCode: string | null;
  message: string;
}

type QueueKind = "start" | "checklist" | "photo" | "submit";

interface QueueItem {
  id?: number;
  kind: QueueKind;
  jobId: string;
  jobCode: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  queuedAt: string;
  lastResult?: "APPLIED" | "DUPLICATE" | "REJECTED" | null;
  lastMessage?: string | null;
}

interface SyncResult { idempotencyKey: string; status: "APPLIED" | "DUPLICATE" | "REJECTED"; message: string }
interface SyncResponse { ok: boolean; results: SyncResult[] }

// ── Offline engine · IndexedDB (no new deps) ──────────────────────────────────

const IDB_NAME = "suryadesk-offline";
const IDB_VERSION = 1;

function openIdb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("cache")) db.createObjectStore("cache", { keyPath: "key" });
        if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "id", autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Run a single request in a transaction; resolves with the request result (or null on failure). */
function idbRequest<T>(
  storeName: "cache" | "queue",
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openIdb().then((db) => {
    if (!db) return null;
    return new Promise<T | null>((resolve) => {
      let out: T | null = null;
      let settled = false;
      const done = (v: T | null) => {
        if (settled) return;
        settled = true;
        resolve(v);
      };
      try {
        const tx = db.transaction(storeName, mode);
        const req = run(tx.objectStore(storeName));
        req.onsuccess = () => {
          out = req.result;
        };
        tx.oncomplete = () => {
          try { db.close(); } catch { /* ignore */ }
          done(out);
        };
        tx.onerror = () => {
          try { db.close(); } catch { /* ignore */ }
          done(null);
        };
        tx.onabort = () => {
          try { db.close(); } catch { /* ignore */ }
          done(null);
        };
      } catch {
        done(null);
      }
    });
  });
}

async function cacheSet(key: string, value: unknown): Promise<void> {
  await idbRequest("cache", "readwrite", (s) => s.put({ key, value }));
}

async function cacheGet<T>(key: string): Promise<T | null> {
  const rec = await idbRequest<{ key: string; value: T } | undefined>("cache", "readonly", (s) => s.get(key));
  return rec ? rec.value : null;
}

async function queueAdd(item: Omit<QueueItem, "id">): Promise<void> {
  await idbRequest("queue", "readwrite", (s) => s.add(item));
}

async function queueAll(): Promise<QueueItem[]> {
  return (await idbRequest<QueueItem[]>("queue", "readonly", (s) => s.getAll())) ?? [];
}

async function queueRemove(id: number): Promise<void> {
  await idbRequest("queue", "readwrite", (s) => s.delete(id));
}

async function queueUpdate(id: number, patch: Partial<QueueItem>): Promise<void> {
  const existing = await idbRequest<QueueItem | undefined>("queue", "readonly", (s) => s.get(id));
  if (!existing) return;
  await idbRequest("queue", "readwrite", (s) => s.put({ ...existing, ...patch, id }));
}

async function countQueue(): Promise<number> {
  return (await idbRequest<number>("queue", "readonly", (s) => s.count())) ?? 0;
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function genKey(kind: string, jobId: string): string {
  return `sd-${kind}-${jobId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const TYPE_LABELS: Record<string, string> = {
  MAINTENANCE: "Maintenance visit",
  COMPLAINT: "Service complaint",
};

const KIND_LABELS: Record<QueueKind, string> = {
  start: "Visit start",
  checklist: "Checklist",
  photo: "Photo",
  submit: "Report submission",
};

const KIND_ICONS: Record<QueueKind, LucideIcon> = {
  start: Play,
  checklist: ClipboardCheck,
  photo: Camera,
  submit: Send,
};

const OVERDUE_STATUSES = ["SCHEDULED", "ASSIGNED", "IN_PROGRESS"];

function isOverdue(job: { scheduledFor: string; status: string }): boolean {
  return OVERDUE_STATUSES.includes(job.status) && new Date(job.scheduledFor).getTime() < startOfToday();
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read the selected photo"));
    r.readAsDataURL(file);
  });
}

/** Compress an image data URL to at most `maxDim` px on the longest side, JPEG `quality`. */
function compressImage(dataUrl: string, maxDim = 1280, quality = 0.8): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        if (!img.width || !img.height) {
          resolve(dataUrl);
          return;
        }
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function fetchJobs(scope: string, search: string): Promise<JobsResponse> {
  return api<JobsResponse>(`/api/jobs${qs({ scope: scope || undefined, search: search || undefined, page: 1, pageSize: 50 })}`);
}

function clientFilterJobs(res: JobsResponse, search: string): JobsResponse {
  const q = search.trim().toLowerCase();
  if (!q) return res;
  const jobs = res.jobs.filter((j) =>
    j.code.toLowerCase().includes(q) ||
    j.title.toLowerCase().includes(q) ||
    (j.customer?.name ?? "").toLowerCase().includes(q) ||
    (j.installation?.assetCode ?? "").toLowerCase().includes(q));
  return { ...res, jobs, total: jobs.length };
}

function friendlyListError(e: string): string {
  return e === "offline-no-cache"
    ? "You're offline and this list hasn't been saved on this device yet. Reconnect once to cache it."
    : e;
}

/** Navigate to My Jobs with a preselected scope (survives the SPA view remount). */
function gotoTechJobs(scope: string): void {
  try {
    window.sessionStorage.setItem("sd-tech-scope", scope);
  } catch { /* private mode */ }
  useSd.getState().setView("tech:jobs");
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    const t = setTimeout(sync, 0); // defer to avoid synchronous setState in effect body
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      clearTimeout(t);
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return online;
}

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Jobs list for one scope — online fetch with IndexedDB cache fallback. */
function useJobs(opts: { scope: string; search: string; online: boolean }) {
  const { scope, search, online } = opts;
  const [data, setData] = useState<JobsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cacheKey = `jobs:${scope || "all"}`;
      const finish = (d: JobsResponse | null, cached: boolean, err: string | null) => {
        if (cancelled) return;
        setData(d);
        setFromCache(cached);
        setError(err);
        setLoading(false);
      };
      if (!online) {
        const cached = await cacheGet<JobsResponse>(cacheKey);
        finish(cached ? clientFilterJobs(cached, search) : null, true, cached ? null : "offline-no-cache");
        return;
      }
      setLoading(true);
      setError(null);
      setFromCache(false);
      try {
        const res = await fetchJobs(scope, search);
        if (!search.trim()) await cacheSet(cacheKey, res); // cache full lists only
        finish(res, false, null);
      } catch (e) {
        const cached = await cacheGet<JobsResponse>(cacheKey);
        if (cached) finish(clientFilterJobs(cached, search), true, null);
        else finish(null, false, errMsg(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope, search, online, tick]);

  return { data, loading, error, fromCache, refresh };
}

interface ScopeBundle { today: JobsResponse | null; upcoming: JobsResponse | null; overdue: JobsResponse | null; completed: JobsResponse | null }

/** Today dashboard data — four scope queries, cached individually. */
function useTodayData(online: boolean) {
  const [data, setData] = useState<ScopeBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    const scopes = ["today", "upcoming", "overdue", "completed"] as const;
    (async () => {
      const readCache = async (): Promise<ScopeBundle> => {
        const entries = await Promise.all(
          scopes.map(async (s) => [s, await cacheGet<JobsResponse>(`jobs:${s}`)] as const),
        );
        return Object.fromEntries(entries) as unknown as ScopeBundle;
      };
      const anyCached = (b: ScopeBundle) => Object.values(b).some((v) => v != null);

      if (!online) {
        const cached = await readCache();
        if (cancelled) return;
        setData(anyCached(cached) ? cached : null);
        setFromCache(true);
        setError(anyCached(cached) ? null : "offline-no-cache");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      setFromCache(false);
      try {
        const results = await Promise.all(scopes.map((s) => fetchJobs(s, "")));
        const bundle: ScopeBundle = { today: results[0], upcoming: results[1], overdue: results[2], completed: results[3] };
        await Promise.all(scopes.map((s, i) => cacheSet(`jobs:${s}`, results[i])));
        if (cancelled) return;
        setData(bundle);
        setLoading(false);
      } catch (e) {
        const cached = await readCache();
        if (cancelled) return;
        if (anyCached(cached)) {
          setData(cached);
          setFromCache(true);
          setError(null);
        } else {
          setError(errMsg(e));
        }
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [online, tick]);

  return { data, loading, error, fromCache, refresh };
}

// ── Small UI atoms ────────────────────────────────────────────────────────────

function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("w-4 h-4 animate-spin", className)} />;
}

function OnlineChip({ online }: { online: boolean }) {
  return (
    <span className={cn("sd-pill shrink-0", online ? "sd-pill-green" : "sd-pill-slate")}>
      {online ? <Wifi className="w-3 h-3" /> : <CloudOff className="w-3 h-3" />}
      {online ? "Online" : "Offline — drafts saved locally"}
    </span>
  );
}

function CachedNote({ text = "Showing the saved copy from this device" }: { text?: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-sd-ink-soft">
      <CloudOff className="w-3.5 h-3.5 shrink-0" />
      {text}
    </div>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="sd-clay p-5 flex flex-col items-start gap-3">
      <div className="flex items-center gap-2 text-[#a03340] font-semibold text-sm">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        Something went wrong
      </div>
      <p className="text-sm text-sd-ink-soft">{message}</p>
      <button onClick={onRetry} className="sd-btn-primary px-5 min-h-11 text-sm font-semibold sd-focus">
        Try again
      </button>
    </div>
  );
}

/** Large clay toggle switch (min 56px touch target) used for BOOLEAN checklist items. */
function BigToggle({
  checked, onChange, label, required,
}: { checked: boolean; onChange: (v: boolean) => void; label: string; required?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="w-full min-h-14 flex items-center justify-between gap-3 sd-inset px-4 py-3 text-left sd-focus"
    >
      <span className="text-sm text-sd-ink font-medium leading-snug">
        {label}
        {required && <span className="text-[#a03340] ml-0.5" aria-hidden="true">*</span>}
      </span>
      <span
        className="relative w-14 h-8 rounded-full shrink-0 transition-colors duration-200"
        style={{ background: checked ? "#1D7A5D" : "#D5DED8" }}
      >
        <span
          className="absolute top-1 w-6 h-6 rounded-full bg-white shadow-md transition-all duration-200"
          style={{ left: checked ? "1.75rem" : "0.25rem" }}
        />
      </span>
    </button>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: ReactNode }) {
  return (
    <div className="flex items-start gap-3 min-h-10">
      <span className="sd-inset p-2 shrink-0">
        <Icon className="w-4 h-4 text-sd-ink-soft" />
      </span>
      <div className="min-w-0 pt-0.5">
        <div className="text-[0.65rem] font-semibold uppercase tracking-wide text-sd-ink-soft">{label}</div>
        <div className="text-sm text-sd-ink font-medium leading-snug">{value}</div>
      </div>
    </div>
  );
}

/** mm:ss countdown from an ISO expiry date. */
function OtpCountdown({ expiresAt }: { expiresAt: string }) {
  const [left, setLeft] = useState(() => Math.max(0, new Date(expiresAt).getTime() - Date.now()));
  useEffect(() => {
    const iv = window.setInterval(() => setLeft(Math.max(0, new Date(expiresAt).getTime() - Date.now())), 1000);
    return () => window.clearInterval(iv);
  }, [expiresAt]);
  if (left <= 0) return <span className="font-mono text-xs font-semibold text-[#a03340]">expired</span>;
  const mm = Math.floor(left / 60000);
  const ss = Math.floor((left % 60000) / 1000);
  return (
    <span className="font-mono text-xs font-semibold text-sd-ink tabular-nums">
      {mm}:{String(ss).padStart(2, "0")}
    </span>
  );
}

function StatusTimeline({ events }: { events: StatusEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!events || events.length === 0) return null;
  const visible = expanded ? events : events.slice(-3);
  const hidden = events.length - visible.length;
  return (
    <div className="mt-4 pt-4 border-t border-sd-line/70">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center justify-between w-full text-xs font-semibold text-sd-ink-soft sd-focus min-h-9"
        aria-expanded={expanded}
      >
        <span className="uppercase tracking-wide">Status timeline</span>
        <span className="flex items-center gap-1 text-sd-forest">
          {expanded ? "Show less" : `Show all (${events.length})`}
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </span>
      </button>
      <div className="mt-2 space-y-2.5">
        {hidden > 0 && (
          <div className="text-[0.68rem] text-sd-ink-soft/70 pl-1">+ {hidden} earlier event{hidden > 1 ? "s" : ""}</div>
        )}
        {visible.map((ev, i) => (
          <div key={`${ev.createdAt}-${i}`} className="flex items-start gap-2.5">
            <div className="flex flex-col items-center pt-1">
              <span className="w-2 h-2 rounded-full bg-sd-forest/70" />
              {i < visible.length - 1 && <span className="w-px flex-1 min-h-4 bg-sd-line mt-1" />}
            </div>
            <div className="min-w-0">
              <div className="text-xs text-sd-ink leading-snug">
                {ev.fromStatus && (
                  <span className="text-sd-ink-soft">{STATUS_LABELS[ev.fromStatus] ?? ev.fromStatus} → </span>
                )}
                <span className="font-semibold">{STATUS_LABELS[ev.toStatus] ?? ev.toStatus}</span>
              </div>
              {ev.note && <div className="text-[0.68rem] text-sd-ink-soft mt-0.5">{ev.note}</div>}
              <div className="text-[0.64rem] text-sd-ink-soft/70 mt-0.5">{fmtDateTime(ev.createdAt)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function JobCard({ job, onOpen }: { job: TechJob; onOpen: (id: string) => void }) {
  const overdue = isOverdue(job);
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      onClick={() => onOpen(job.id)}
      className="sd-clay sd-clay-raise w-full text-left p-4 sd-focus"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.7rem] font-bold tracking-wide text-sd-ink-soft">{job.code}</span>
        <StatusPill status={job.status} />
      </div>
      <div className="font-semibold text-sd-ink text-[0.95rem] mt-1.5 leading-snug">{job.title}</div>
      <div className="text-sm text-sd-ink-soft mt-1">
        {job.customer?.name}
        {job.customer?.city ? ` · ${job.customer.city}` : ""}
      </div>
      <div className="flex items-center gap-3 mt-2 text-xs flex-wrap">
        <span className={cn("inline-flex items-center gap-1", overdue ? "text-[#a03340] font-semibold" : "text-sd-ink-soft")}>
          <Clock className="w-3.5 h-3.5" />
          {fmtTime(job.scheduledFor)} · {relativeDay(job.scheduledFor)}
        </span>
        {job.installation && (
          <span className="inline-flex items-center gap-1 text-sd-ink-soft">
            <Zap className="w-3.5 h-3.5" />
            {job.installation.assetCode}
          </span>
        )}
        {(job.priority === "HIGH" || job.priority === "URGENT") && <PriorityPill priority={job.priority} />}
      </div>
    </motion.button>
  );
}

function JobDetailSkeleton() {
  return (
    <div className="space-y-4">
      <div className="sd-clay p-5 space-y-3">
        <div className="h-6 w-3/4 rounded-lg bg-sd-surface animate-pulse" />
        <div className="h-4 w-1/2 rounded-lg bg-sd-surface animate-pulse" />
      </div>
      {[1, 2, 3].map((i) => (
        <div key={i} className="sd-clay p-5 space-y-3">
          <div className="h-4 w-1/3 rounded-lg bg-sd-surface animate-pulse" />
          <div className="h-10 rounded-xl bg-sd-surface animate-pulse" />
          <div className="h-10 rounded-xl bg-sd-surface animate-pulse" />
        </div>
      ))}
    </div>
  );
}

// ── Bottom navigation ─────────────────────────────────────────────────────────

const TECH_TABS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "today", label: "Today", icon: Sun },
  { id: "jobs", label: "My Jobs", icon: ClipboardList },
  { id: "queue", label: "Sync", icon: RefreshCw },
  { id: "profile", label: "Profile", icon: User },
];

function BottomNav({ active, queued }: { active: string; queued: number }) {
  const setView = useSd((s) => s.setView);
  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur-md border-t border-sd-line pb-[env(safe-area-inset-bottom)]"
    >
      <div className="max-w-lg mx-auto grid grid-cols-4">
        {TECH_TABS.map((tab) => {
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setView(`tech:${tab.id}`)}
              aria-current={isActive ? "page" : undefined}
              className="relative flex flex-col items-center justify-center gap-0.5 min-h-[3.5rem] sd-focus"
            >
              {isActive && (
                <motion.span
                  layoutId="tech-tab-pill"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  className="absolute inset-x-3 inset-y-1 rounded-2xl bg-[#176B52]/10"
                />
              )}
              <span className="relative">
                <tab.icon
                  className={cn("w-5 h-5", isActive ? "text-sd-forest" : "text-sd-ink-soft")}
                  strokeWidth={isActive ? 2.3 : 2}
                />
                {tab.id === "queue" && queued > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 min-w-[17px] h-[17px] px-1 rounded-full bg-[#C94B55] text-white text-[0.6rem] font-bold flex items-center justify-center border-2 border-white">
                    {queued > 9 ? "9+" : queued}
                  </span>
                )}
              </span>
              <span className={cn("relative text-[0.62rem] font-semibold", isActive ? "text-sd-forest-deep" : "text-sd-ink-soft")}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ── Today screen ──────────────────────────────────────────────────────────────

function TodayScreen({ online, onOpenJob }: { online: boolean; onOpenJob: (id: string) => void }) {
  const user = useSd((s) => s.user);
  const { data, loading, error, fromCache, refresh } = useTodayData(online);
  const firstName = (user?.name ?? "").trim().split(/\s+/)[0] || "there";
  const dateLine = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  const todayJobs = useMemo(
    () => (data?.today?.jobs ?? []).slice().sort((a, b) => (a.scheduledFor < b.scheduledFor ? -1 : 1)),
    [data],
  );

  return (
    <div className="space-y-5">
      <div className="pt-1">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-sd-ink">Hi, {firstName}</h1>
            <p className="text-sm text-sd-ink-soft mt-0.5">{dateLine}</p>
          </div>
          <OnlineChip online={online} />
        </div>
        {fromCache && (
          <div className="mt-2">
            <CachedNote />
          </div>
        )}
      </div>

      {error && !data && <ErrorCard message={friendlyListError(error)} onRetry={refresh} />}

      <div className="grid grid-cols-2 gap-3">
        {loading && !data ? (
          [0, 1, 2, 3].map((i) => <div key={i} className="sd-clay h-[92px] animate-pulse" />)
        ) : (
          <>
            <KpiCard label="Today's jobs" value={data?.today?.total ?? 0} icon={Sun} tone="amber" onClick={() => gotoTechJobs("today")} />
            <KpiCard label="Upcoming" value={data?.upcoming?.total ?? 0} icon={CalendarClock} tone="slate" delay={0.05} onClick={() => gotoTechJobs("upcoming")} />
            <KpiCard label="Overdue" value={data?.overdue?.total ?? 0} icon={AlarmClock} tone="error" delay={0.1} onClick={() => gotoTechJobs("overdue")} />
            <KpiCard label="Completed" value={data?.completed?.total ?? 0} icon={CheckCircle2} tone="forest" delay={0.15} onClick={() => gotoTechJobs("completed")} />
          </>
        )}
      </div>

      <section aria-label="Today's jobs">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-sd-ink">
            Today&apos;s jobs <span className="text-sd-ink-soft font-normal">({todayJobs.length})</span>
          </h2>
          <button onClick={() => gotoTechJobs("today")} className="text-sm font-semibold text-sd-forest min-h-9 sd-focus">
            View all
          </button>
        </div>
        {loading && !data ? (
          <SkeletonRows rows={3} />
        ) : error && !data ? null : todayJobs.length === 0 ? (
          <EmptyState
            icon={CalendarCheck}
            title="No visits today"
            body="You're all caught up. New assignments will appear here."
          />
        ) : (
          <div className="space-y-3">
            {todayJobs.map((j) => (
              <JobCard key={j.id} job={j} onOpen={onOpenJob} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── My Jobs screen ────────────────────────────────────────────────────────────

const JOB_SCOPES: { id: string; label: string }[] = [
  { id: "", label: "All" },
  { id: "today", label: "Today" },
  { id: "upcoming", label: "Upcoming" },
  { id: "overdue", label: "Overdue" },
  { id: "completed", label: "Completed" },
];

function JobsScreen({ online, onOpenJob }: { online: boolean; onOpenJob: (id: string) => void }) {
  const [scope, setScope] = useState<string>(() => {
    try {
      return window.sessionStorage.getItem("sd-tech-scope") ?? "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    try {
      window.sessionStorage.removeItem("sd-tech-scope");
    } catch { /* ignore */ }
  }, []);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 300);
  const { data, loading, error, fromCache, refresh } = useJobs({ scope, search: debouncedSearch, online });
  const jobs = data?.jobs ?? [];

  return (
    <div className="space-y-4">
      <div className="pt-1 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-sd-ink">My Jobs</h1>
        <OnlineChip online={online} />
      </div>
      {fromCache && <CachedNote />}

      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-sd-ink-soft" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search code, title, customer, asset…"
          aria-label="Search jobs"
          className="sd-inset w-full py-3 pl-10 pr-4 text-sm text-sd-ink placeholder:text-sd-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-sd-forest/40"
        />
      </div>

      <div className="flex gap-2 overflow-x-auto sd-scroll -mx-1 px-1 pb-1" role="tablist" aria-label="Job filters">
        {JOB_SCOPES.map((s) => {
          const active = scope === s.id;
          return (
            <button
              key={s.id || "all"}
              role="tab"
              aria-selected={active}
              onClick={() => setScope(s.id)}
              className={cn(
                "shrink-0 min-h-11 px-4 rounded-full text-sm font-semibold sd-focus transition-colors",
                active ? "bg-[#176B52] text-white" : "sd-inset text-sd-ink-soft",
              )}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {loading && !data ? (
        <SkeletonRows rows={5} />
      ) : error && !data ? (
        <ErrorCard message={friendlyListError(error)} onRetry={refresh} />
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No jobs found"
          body={search.trim() ? `Nothing matches "${search.trim()}". Try a different search or filter.` : "Jobs assigned to you will appear here."}
        />
      ) : (
        <div className={cn("space-y-3 transition-opacity", loading && "opacity-50")}>
          {jobs.map((j) => (
            <JobCard key={j.id} job={j} onOpen={onOpenJob} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sync screen ───────────────────────────────────────────────────────────────

function QueueScreen({ online, bumpQueue }: { online: boolean; bumpQueue: () => Promise<void> }) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastResults, setLastResults] = useState<(SyncResult & { jobCode?: string; kind?: string })[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    queueAll().then((q) => {
      if (!cancelled) {
        setItems(q);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const rejectedCount = items.filter((i) => i.lastResult === "REJECTED").length;

  const syncNow = async () => {
    if (!online || items.length === 0 || syncing) return;
    setSyncing(true);
    try {
      const res = await api<SyncResponse>("/api/sync", {
        method: "POST",
        json: {
          items: items.map((i) => ({ kind: i.kind, jobId: i.jobId, idempotencyKey: i.idempotencyKey, payload: i.payload })),
        },
      });
      const byKey = new Map(res.results.map((r) => [r.idempotencyKey, r]));
      const infoByKey = new Map(items.map((i) => [i.idempotencyKey, { jobCode: i.jobCode, kind: i.kind }]));
      for (const it of items) {
        const r = byKey.get(it.idempotencyKey);
        if (!r || it.id == null) continue;
        if (r.status === "REJECTED") {
          await queueUpdate(it.id, { lastResult: "REJECTED", lastMessage: r.message });
        } else {
          await queueRemove(it.id); // APPLIED / DUPLICATE leave the queue
        }
      }
      setLastResults(res.results.map((r) => ({ ...r, ...(infoByKey.get(r.idempotencyKey) ?? {}) })));
      setTick((t) => t + 1);
      await bumpQueue();
      const applied = res.results.filter((r) => r.status === "APPLIED").length;
      const dups = res.results.filter((r) => r.status === "DUPLICATE").length;
      const rejected = res.results.filter((r) => r.status === "REJECTED").length;
      toast({
        title: "Sync complete",
        description: `${applied} applied · ${dups} duplicate${dups === 1 ? "" : "s"} · ${rejected} rejected.`,
      });
    } catch (e) {
      toast({ variant: "destructive", title: "Sync failed", description: errMsg(e) });
    } finally {
      setSyncing(false);
    }
  };

  const clearRejected = async () => {
    for (const it of items) {
      if (it.lastResult === "REJECTED" && it.id != null) await queueRemove(it.id);
    }
    setLastResults([]);
    setTick((t) => t + 1);
    await bumpQueue();
    toast({ title: "Rejected items cleared", description: "They will not be retried." });
  };

  return (
    <div className="space-y-4">
      <div className="pt-1 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-sd-ink">Offline Sync</h1>
        <OnlineChip online={online} />
      </div>

      <div className="sd-clay p-5 flex items-start gap-3">
        <span className="sd-inset p-2.5 shrink-0">
          <Info className="w-4 h-4 text-sd-forest" />
        </span>
        <p className="text-sm text-sd-ink-soft leading-relaxed">
          Drafts and photos you save offline are queued on this device. Sync validates each assignment on the
          server before applying. Photos and submissions use idempotency keys so nothing is applied twice.
        </p>
      </div>

      {loading ? (
        <SkeletonRows rows={3} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={RefreshCw}
          title="Nothing to sync"
          body="Checklists, photos, visit starts and reports you save while offline will queue here."
        />
      ) : (
        <>
          <div className="space-y-3">
            {items.map((item) => {
              const KindIcon = KIND_ICONS[item.kind] ?? ClipboardCheck;
              const rejected = item.lastResult === "REJECTED";
              const photoUrl = (item.payload as { dataUrl?: string }).dataUrl;
              return (
                <div key={item.id ?? item.idempotencyKey} className="sd-clay p-4 flex items-start gap-3">
                  <span className={cn("rounded-xl p-2.5 shrink-0", rejected ? "bg-[#C94B55]/10" : "bg-sd-surface")}>
                    <KindIcon className={cn("w-4 h-4", rejected ? "text-[#a03340]" : "text-sd-ink-soft")} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-sd-ink">{item.jobCode}</span>
                      <span className={cn("sd-pill", rejected ? "sd-pill-red" : "sd-pill-amber")}>
                        {rejected ? "Rejected" : "Queued"}
                      </span>
                    </div>
                    <div className="text-xs text-sd-ink-soft mt-0.5">
                      {KIND_LABELS[item.kind] ?? item.kind} · queued {fmtDateTime(item.queuedAt)}
                    </div>
                    {rejected && item.lastMessage && (
                      <div className="text-xs text-[#a03340] mt-1.5 flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                        {item.lastMessage}
                      </div>
                    )}
                    {photoUrl && (
                      <img
                        src={photoUrl}
                        alt={`Queued photo for ${item.jobCode}`}
                        className="w-14 h-14 rounded-lg object-cover mt-2 border border-sd-line"
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <button
            onClick={syncNow}
            disabled={!online || syncing}
            className="sd-btn-primary w-full min-h-12 font-semibold sd-focus flex items-center justify-center gap-2"
          >
            {syncing ? <Spinner /> : <RefreshCw className="w-4 h-4" />}
            Retry sync now
          </button>
          {!online && (
            <p className="text-xs text-sd-ink-soft text-center flex items-center justify-center gap-1.5">
              <WifiOff className="w-3.5 h-3.5" />
              Reconnect to sync {items.length} item{items.length === 1 ? "" : "s"}.
            </p>
          )}
          {rejectedCount > 0 && (
            <button
              onClick={clearRejected}
              className="w-full min-h-11 rounded-xl text-sm font-semibold text-[#a03340] bg-[#C94B55]/[0.08] sd-focus"
            >
              Clear {rejectedCount} rejected item{rejectedCount === 1 ? "" : "s"}
            </button>
          )}
        </>
      )}

      {lastResults.length > 0 && (
        <section aria-label="Last sync results" className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-sd-ink-soft px-1">Last sync results</h2>
          {lastResults.map((r, i) => (
            <div key={`${r.idempotencyKey}-${i}`} className="flex items-start gap-2.5 p-3 rounded-xl sd-inset">
              {r.status === "APPLIED" ? (
                <CheckCircle2 className="w-4 h-4 text-sd-success shrink-0 mt-0.5" />
              ) : r.status === "DUPLICATE" ? (
                <Copy className="w-4 h-4 text-sd-ink-soft shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-4 h-4 text-[#a03340] shrink-0 mt-0.5" />
              )}
              <div className="min-w-0 flex-1 text-sm">
                <span className="font-semibold text-sd-ink">{r.jobCode ?? "Job"}</span>
                <span className="text-sd-ink-soft"> · {r.kind ? KIND_LABELS[r.kind as QueueKind] ?? r.kind : "item"}</span>
                <div className="text-xs text-sd-ink-soft mt-0.5">{r.message}</div>
              </div>
              <span
                className={cn(
                  "sd-pill shrink-0",
                  r.status === "APPLIED" ? "sd-pill-green" : r.status === "DUPLICATE" ? "sd-pill-slate" : "sd-pill-red",
                )}
              >
                {r.status}
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

// ── Profile screen ────────────────────────────────────────────────────────────

function ProfileScreen({ online }: { online: boolean }) {
  const user = useSd((s) => s.user);
  const [signingOut, setSigningOut] = useState(false);
  const [queued, setQueued] = useState<number | null>(null);
  const [storage, setStorage] = useState<{ usage?: number; quota?: number } | null>(null);
  const { data: completedData } = useApi<{ total: number }>(online ? "/api/jobs?scope=completed&pageSize=5" : null);

  useEffect(() => {
    countQueue().then(setQueued).catch(() => {});
    try {
      if (navigator.storage && "estimate" in navigator.storage) {
        navigator.storage.estimate().then(setStorage).catch(() => {});
      }
    } catch { /* not supported */ }
  }, []);

  if (!user) return null;

  const signOut = async () => {
    setSigningOut(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch { /* session already gone */ }
    useSd.setState({ user: null });
  };

  return (
    <div className="space-y-4">
      <div className="pt-1 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-sd-ink">Profile</h1>
        <OnlineChip online={online} />
      </div>

      <div className="sd-clay p-5">
        <div className="flex items-center gap-4">
          <SdAvatar name={user.name} size={56} />
          <div className="min-w-0">
            <div className="text-lg font-bold text-sd-ink leading-tight truncate">{user.name}</div>
            <div className="flex items-center gap-1.5 text-sm text-sd-forest font-medium mt-0.5">
              <HardHat className="w-3.5 h-3.5 shrink-0" />
              {user.title || "Field Technician"}
            </div>
            <div className="text-sm text-sd-ink-soft truncate mt-0.5">{user.email}</div>
          </div>
        </div>
        {user.organizationName && (
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="sd-pill sd-pill-teal">{user.organizationName}</span>
            <span className="sd-pill sd-pill-slate">{user.orgRole}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <KpiCard label="Completed jobs" value={completedData?.total ?? "—"} icon={CheckCircle2} tone="forest" />
        <KpiCard label="Queued offline" value={queued ?? "—"} icon={Database} tone="slate" />
      </div>

      <div className="sd-clay p-5 flex items-start gap-3">
        <span className="sd-inset p-2.5 shrink-0">
          <Database className="w-4 h-4 text-sd-ink-soft" />
        </span>
        <div className="text-sm text-sd-ink-soft leading-relaxed">
          <span className="font-semibold text-sd-ink">Offline storage.</span> Drafts, photos and reports you save
          offline are stored only on this device and are removed once synced. The server re-validates every
          assignment before applying anything.
          {storage?.usage != null && storage?.quota != null && (
            <span className="block mt-1.5 text-xs">
              This device is using about {fmtBytes(storage.usage)} of {fmtBytes(storage.quota)} browser storage.
            </span>
          )}
        </div>
      </div>

      <button
        onClick={signOut}
        disabled={signingOut}
        className="sd-clay sd-clay-raise w-full min-h-12 flex items-center justify-center gap-2 text-sm font-semibold text-[#a03340] sd-focus"
      >
        {signingOut ? <Spinner /> : <LogOut className="w-4 h-4" />}
        Sign out
      </button>

      <p className="text-center text-xs text-sd-ink-soft/70 pt-1">SuryaDesk Field App · works offline</p>
    </div>
  );
}

// ── Job screen (full-screen overlay) ──────────────────────────────────────────

function JobScreen({
  jobId, online, closing, onClose, bumpQueue,
}: {
  jobId: string;
  online: boolean;
  closing: boolean;
  onClose: () => void;
  bumpQueue: () => Promise<void>;
}) {
  // detail fetch
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // queued (offline) photos for this job
  const [pendingPhotos, setPendingPhotos] = useState<QueueItem[]>([]);
  const loadPendingPhotos = useCallback(async () => {
    const all = await queueAll();
    setPendingPhotos(all.filter((i) => i.jobId === jobId && i.kind === "photo" && i.lastResult !== "REJECTED"));
  }, [jobId]);

  // checklist + report draft state
  const [checklist, setChecklist] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [summary, setSummary] = useState("");
  const [followUp, setFollowUp] = useState(false);
  const [followUpNotes, setFollowUpNotes] = useState("");
  const [aiNote, setAiNote] = useState<string | null>(null);

  // OTP state
  const [otpState, setOtpState] = useState<OtpIssueResponse | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpDone, setOtpDone] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const detailRef = useRef<JobDetail | null>(null);
  const checklistTouched = useRef(false);
  const reportTouched = useRef(false);
  const checklistInitedFor = useRef<string | null>(null);
  const reportInitedFor = useRef<string | null>(null);

  useEffect(() => {
    detailRef.current = detail;
  }, [detail]);

  // fetch detail (online) / read cache (offline)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cacheKey = `job:${jobId}`;
      if (!online) {
        const cached = await cacheGet<{ job: JobDetail }>(cacheKey);
        if (cancelled) return;
        if (cached?.job) {
          setDetail(cached.job);
          setFromCache(true);
          setError(null);
        } else {
          setDetail(null);
          setError("offline-no-cache");
        }
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      setFromCache(false);
      try {
        const res = await api<{ job: JobDetail }>(`/api/jobs/${jobId}`);
        if (cancelled) return;
        setDetail(res.job);
        await cacheSet(cacheKey, res);
      } catch (e) {
        const cached = await cacheGet<{ job: JobDetail }>(cacheKey);
        if (cancelled) return;
        if (cached?.job) {
          setDetail(cached.job);
          setFromCache(true);
          setError(null);
        } else {
          setError(errMsg(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, online, tick]);

  useEffect(() => {
    void loadPendingPhotos();
  }, [loadPendingPhotos, tick]);

  // initialise checklist values from server (preserving unsaved local edits)
  useEffect(() => {
    if (!detail) return;
    if (checklistInitedFor.current === detail.id && checklistTouched.current) return;
    checklistInitedFor.current = detail.id;
    const next: Record<string, string> = {};
    for (const r of detail.checklistResults ?? []) next[r.itemLabel] = r.value;
    for (const it of detail.checklistTemplate?.items ?? []) {
      if (!(it.label in next)) next[it.label] = it.kind === "BOOLEAN" ? "false" : "";
    }
    setChecklist(next);
    checklistTouched.current = false;
  }, [detail]);

  // initialise report draft from server (preserving unsaved local edits)
  useEffect(() => {
    if (!detail) return;
    if (reportInitedFor.current === detail.id && reportTouched.current) return;
    reportInitedFor.current = detail.id;
    setNotes(detail.report?.technicianNotes ?? "");
    setSummary(detail.report?.summary ?? "");
    setFollowUp(Boolean(detail.report?.followUpNeeded));
    setFollowUpNotes(detail.report?.followUpNotes ?? "");
    reportTouched.current = false;
  }, [detail]);

  /** Optimistically patch the in-memory + cached detail (used by offline queue writes). */
  const patchDetail = useCallback(
    (updater: (d: JobDetail) => JobDetail) => {
      const cur = detailRef.current;
      if (!cur) return;
      const next = updater(cur);
      detailRef.current = next;
      setDetail(next);
      void cacheSet(`job:${jobId}`, { job: next });
    },
    [jobId],
  );

  const template = detail?.checklistTemplate ?? null;
  const status = detail?.status ?? "";
  const canWork = ["IN_PROGRESS", "WORK_SUBMITTED", "AWAITING_CUSTOMER", "NEEDS_REVIEW"].includes(status);
  const otpAvailable = ["WORK_SUBMITTED", "AWAITING_CUSTOMER"].includes(status);

  const checklistItems = useMemo(
    () =>
      (template?.items ?? []).map((it) => ({
        label: it.label,
        kind: it.kind,
        value: checklist[it.label] ?? (it.kind === "BOOLEAN" ? "false" : ""),
      })),
    [template, checklist],
  );

  // ── mutations ──────────────────────────────────────────────────────────────

  const startVisit = async () => {
    if (!detail) return;
    if (online) {
      setBusy("start");
      try {
        await api(`/api/jobs/${jobId}`, { method: "PATCH", json: { action: "start" } });
        toast({ title: "Visit started", description: "The checklist, photos and report are now available." });
        refresh();
      } catch (e) {
        toast({ variant: "destructive", title: "Could not start the visit", description: errMsg(e) });
      } finally {
        setBusy(null);
      }
    } else {
      await queueAdd({
        kind: "start",
        jobId,
        jobCode: detail.code,
        payload: {},
        idempotencyKey: genKey("start", jobId),
        queuedAt: new Date().toISOString(),
      });
      await bumpQueue();
      patchDetail((d) => ({ ...d, status: "IN_PROGRESS" }));
      toast({ title: "Saved offline", description: "The visit start is queued and will sync when you reconnect." });
    }
  };

  const saveChecklist = async () => {
    if (!detail || !template) return;
    const items = checklistItems;
    const asResults = items.map((i) => ({ itemLabel: i.label, itemKind: i.kind, value: i.value }));
    if (online) {
      setBusy("checklist");
      try {
        await api(`/api/jobs/${jobId}/checklist`, { method: "POST", json: { items } });
        patchDetail((d) => ({ ...d, checklistResults: asResults }));
        checklistTouched.current = false;
        toast({ title: "Checklist saved", description: `${items.length} item${items.length === 1 ? "" : "s"} recorded.` });
      } catch (e) {
        toast({ variant: "destructive", title: "Could not save the checklist", description: errMsg(e) });
      } finally {
        setBusy(null);
      }
    } else {
      await queueAdd({
        kind: "checklist",
        jobId,
        jobCode: detail.code,
        payload: { items },
        idempotencyKey: genKey("checklist", jobId),
        queuedAt: new Date().toISOString(),
      });
      await bumpQueue();
      patchDetail((d) => ({ ...d, checklistResults: asResults }));
      toast({ title: "Saved to queue", description: "Your checklist will sync when you reconnect." });
    }
  };

  const onPhotoPicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !detail) return;
    if (file.size > 20 * 1024 * 1024) {
      toast({ variant: "destructive", title: "Photo too large", description: "Please choose a photo under 20 MB." });
      return;
    }
    setBusy("photo");
    try {
      const rawDataUrl = await readAsDataUrl(file);
      const isSvg = file.type === "image/svg+xml";
      const dataUrl = isSvg ? rawDataUrl : await compressImage(rawDataUrl, 1280, 0.8);
      const mimeType = isSvg ? "image/svg+xml" : "image/jpeg";
      const fileName = `${file.name.replace(/\.[^.]+$/, "")}${isSvg ? ".svg" : ".jpg"}`;
      if (Math.round(dataUrl.length * 0.75) > 4 * 1024 * 1024) {
        toast({ variant: "destructive", title: "Photo too large", description: "Even after compression it exceeds the 4 MB limit." });
        return;
      }
      if (online) {
        const res = await api<{ attachment: JobAttachment }>(`/api/jobs/${jobId}/attachments`, {
          method: "POST",
          json: { dataUrl, fileName, mimeType },
        });
        patchDetail((d) => ({ ...d, attachments: [...(d.attachments ?? []), res.attachment] }));
        toast({ title: "Photo added", description: fileName });
      } else {
        await queueAdd({
          kind: "photo",
          jobId,
          jobCode: detail.code,
          payload: { dataUrl, fileName, mimeType },
          idempotencyKey: genKey("photo", jobId),
          queuedAt: new Date().toISOString(),
        });
        await bumpQueue();
        await loadPendingPhotos();
        toast({ title: "Photo saved offline", description: "It will upload when you reconnect." });
      }
    } catch (err) {
      toast({ variant: "destructive", title: "Could not add the photo", description: errMsg(err) });
    } finally {
      setBusy(null);
    }
  };

  const aiDraft = async () => {
    setBusy("ai");
    try {
      const res = await api<{ ok: boolean; summary?: string; error?: string }>("/api/ai/report-assist", {
        method: "POST",
        json: { jobId, notes },
      });
      if (res.ok && res.summary) {
        setSummary(res.summary);
        setAiNote("AI draft — review before submitting");
        toast({ title: "Draft ready", description: "Review and edit the summary before submitting." });
      } else {
        toast({ variant: "destructive", title: "AI draft unavailable", description: res.error ?? "Write the summary manually and try again later." });
      }
    } catch (e) {
      toast({ variant: "destructive", title: "AI draft failed", description: errMsg(e) });
    } finally {
      setBusy(null);
    }
  };

  const submitReport = async () => {
    if (!detail) return;
    if (notes.trim().length < 10) {
      toast({ variant: "destructive", title: "Notes are too short", description: "Describe the work performed (at least 10 characters)." });
      return;
    }
    const payload = {
      notes,
      summary,
      followUpNeeded: followUp,
      followUpNotes: followUp ? followUpNotes : null,
      checklist: checklistItems,
    };
    if (online) {
      setBusy("submit");
      try {
        const res = await api<{ ok: boolean; alreadyApplied?: boolean; message?: string }>(`/api/jobs/${jobId}/submit`, {
          method: "POST",
          json: { ...payload, idempotencyKey: genKey("submit", jobId) },
        });
        toast({
          title: res.alreadyApplied ? "Already submitted" : "Report submitted",
          description: res.message ?? "Next: request the customer OTP to confirm the service.",
        });
        refresh();
      } catch (e) {
        toast({ variant: "destructive", title: "Could not submit", description: errMsg(e) });
      } finally {
        setBusy(null);
      }
    } else {
      await queueAdd({
        kind: "submit",
        jobId,
        jobCode: detail.code,
        payload,
        idempotencyKey: genKey("submit", jobId),
        queuedAt: new Date().toISOString(),
      });
      await bumpQueue();
      patchDetail((d) => ({
        ...d,
        status: "WORK_SUBMITTED",
        report: d.report
          ? { ...d.report, technicianNotes: notes, summary, followUpNeeded: followUp, followUpNotes: followUp ? followUpNotes : null }
          : d.report,
      }));
      toast({ title: "Saved offline", description: "Your report is queued and will be submitted when you reconnect." });
    }
  };

  const requestOtp = async () => {
    setOtpBusy(true);
    setOtpError(null);
    try {
      const res = await api<OtpIssueResponse>(`/api/jobs/${jobId}/otp`, { method: "POST" });
      setOtpState(res);
      setOtpCode("");
      toast({ title: "Code sent", description: res.message });
    } catch (e) {
      const m = errMsg(e);
      setOtpError(m);
      toast({ variant: "destructive", title: "Could not send the code", description: m });
    } finally {
      setOtpBusy(false);
    }
  };

  const verifyOtpCode = async () => {
    if (!/^\d{6}$/.test(otpCode)) {
      setOtpError("Enter the 6-digit code the customer reads out.");
      return;
    }
    setOtpBusy(true);
    setOtpError(null);
    try {
      const res = await api<{ ok: boolean; message: string }>(`/api/jobs/${jobId}/otp`, {
        method: "PUT",
        json: { code: otpCode },
      });
      setOtpDone(true);
      toast({ title: "Service confirmed", description: res.message });
      refresh();
    } catch (e) {
      const m = errMsg(e);
      setOtpError(m);
      toast({ variant: "destructive", title: "Verification failed", description: m });
    } finally {
      setOtpBusy(false);
    }
  };

  const copyDemoCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast({ title: "Code copied" });
    } catch {
      toast({ variant: "destructive", title: "Copy failed", description: "Please enter the code manually." });
    }
  };

  if (typeof document === "undefined") return null;
  const inst = detail?.installation ?? null;
  const managerNote = [...(detail?.statusEvents ?? [])]
    .reverse()
    .find((ev) => ev.toStatus === "NEEDS_REVIEW")?.note;
  const photosCount = (detail?.attachments?.length ?? 0) + pendingPhotos.length;

  return createPortal(
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: closing ? "100%" : 0 }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      role="dialog"
      aria-modal="true"
      aria-label={detail ? `${detail.code} — ${detail.title}` : "Job details"}
      className="fixed inset-0 z-[60] bg-sd-cream overflow-y-auto sd-scroll"
    >
      {/* sticky header */}
      <div className="sticky top-0 z-20 bg-sd-cream/90 backdrop-blur-md border-b border-sd-line">
        <div className="max-w-lg mx-auto flex items-center gap-3 px-4 h-16">
          <button onClick={onClose} aria-label="Back to job list" className="sd-clay-sm p-2.5 text-sd-ink sd-focus shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-[0.7rem] font-bold tracking-wide text-sd-ink-soft">{detail?.code ?? "Job"}</div>
            <div className="truncate text-sm font-semibold text-sd-ink">{detail?.title ?? "Loading…"}</div>
          </div>
          {detail && <StatusPill status={detail.status} className="shrink-0" />}
        </div>
      </div>

      <div className="max-w-lg mx-auto w-full px-4 py-4 space-y-4 pb-[calc(env(safe-area-inset-bottom)_+_2.5rem)]">
        {!detail && loading && <JobDetailSkeleton />}

        {!detail && error === "offline-no-cache" && (
          <EmptyState
            icon={CloudOff}
            title="Not available offline"
            body="This job hasn't been opened on this device yet. Open it once while online and it will be saved for offline use."
          />
        )}

        {!detail && error && error !== "offline-no-cache" && <ErrorCard message={error} onRetry={refresh} />}

        {detail && (
          <div className={cn("space-y-4 transition-opacity", loading && "opacity-60")}>
            {fromCache && <CachedNote text="Saved copy — may be out of date" />}

            {/* hero */}
            <div className="pt-1">
              <h1 className="text-xl font-bold tracking-tight text-sd-ink leading-snug">{detail.title}</h1>
              <p className="text-sm text-sd-ink-soft mt-1">
                {TYPE_LABELS[detail.type] ?? detail.type} · {fmtDate(detail.scheduledFor)} at {fmtTime(detail.scheduledFor)} ·{" "}
                <span className={cn(isOverdue(detail) && "text-[#a03340] font-semibold")}>
                  {relativeDay(detail.scheduledFor)}
                </span>
              </p>
            </div>

            {/* status-specific banner cards */}
            {status === "SCHEDULED" && (
              <div className="sd-clay p-5 flex items-start gap-3.5">
                <span className="sd-inset p-2.5 shrink-0">
                  <Clock className="w-5 h-5 text-sd-ink-soft" />
                </span>
                <div>
                  <div className="font-semibold text-sd-ink">Awaiting confirmation</div>
                  <p className="text-sm text-sd-ink-soft mt-0.5">
                    The service desk hasn&apos;t confirmed this assignment yet. You can start the visit once it&apos;s confirmed.
                  </p>
                </div>
              </div>
            )}

            {status === "ASSIGNED" && (
              <div className="sd-clay p-5">
                <div className="flex items-center gap-2.5 mb-1">
                  <span className="rounded-xl bg-[#176B52]/10 p-2.5">
                    <Play className="w-4 h-4 text-sd-forest" />
                  </span>
                  <div className="font-semibold text-sd-ink">Ready when you are</div>
                </div>
                <p className="text-sm text-sd-ink-soft mb-4">
                  Start the visit when you arrive on site. The checklist, photos and service report will unlock.
                </p>
                <button
                  onClick={startVisit}
                  disabled={busy === "start"}
                  className="sd-btn-primary w-full min-h-12 font-semibold sd-focus flex items-center justify-center gap-2"
                >
                  {busy === "start" ? <Spinner /> : <Play className="w-4 h-4" />}
                  Start visit
                </button>
                {!online && (
                  <p className="text-xs text-sd-ink-soft mt-2.5 text-center">
                    You&apos;re offline — the start will be queued and synced later.
                  </p>
                )}
              </div>
            )}

            {status === "NEEDS_REVIEW" && (
              <div className="rounded-2xl border border-[#C94B55]/30 bg-[#C94B55]/[0.06] p-4 flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-[#a03340] shrink-0 mt-0.5" />
                <div className="text-sm text-sd-ink leading-relaxed">
                  <span className="font-semibold">Changes requested.</span>{" "}
                  <span className="text-sd-ink-soft">
                    {managerNote || "The service desk asked for changes. Please review and resubmit your report below."}
                  </span>
                </div>
              </div>
            )}

            {otpDone ? (
              <motion.div
                initial={{ scale: 0.92, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 20 }}
                className="sd-clay p-6 flex flex-col items-center text-center gap-3"
              >
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 320, damping: 16, delay: 0.12 }}
                  className="rounded-full bg-[#16876a]/12 p-4"
                >
                  <CheckCircle2 className="w-10 h-10 text-sd-success" />
                </motion.span>
                <div className="font-bold text-sd-ink text-lg">Service confirmed!</div>
                <p className="text-sm text-sd-ink-soft">
                  The customer&apos;s OTP acknowledgement is recorded and this job is now completed. Thank you!
                </p>
              </motion.div>
            ) : status === "COMPLETED" ? (
              <div className="sd-clay p-5 flex items-start gap-3.5">
                <span className="rounded-2xl bg-[#16876a]/10 p-2.5 shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-sd-success" />
                </span>
                <div>
                  <div className="font-semibold text-sd-ink">Completed</div>
                  <p className="text-sm text-sd-ink-soft mt-0.5">
                    {detail.report?.acknowledgedByOtp
                      ? "Service confirmed by customer OTP."
                      : "Closed by the service desk (manager approval)."}
                  </p>
                  {detail.report?.summary && <p className="text-sm text-sd-ink mt-2 leading-relaxed">{detail.report.summary}</p>}
                </div>
              </div>
            ) : null}

            {status === "CANCELLED" && (
              <div className="sd-clay p-5 flex items-start gap-3.5">
                <span className="rounded-2xl bg-[#747E77]/10 p-2.5 shrink-0">
                  <XCircle className="w-5 h-5 text-sd-ink-soft" />
                </span>
                <div>
                  <div className="font-semibold text-sd-ink">This job was cancelled</div>
                  <p className="text-sm text-sd-ink-soft mt-0.5">
                    {detail.cancellationReason || "The service desk cancelled this visit."}
                  </p>
                </div>
              </div>
            )}

            {/* customer */}
            <SectionCard title="Customer">
              <div className="flex items-center gap-3">
                <SdAvatar name={detail.customer.name} size={44} />
                <div className="min-w-0">
                  <div className="font-semibold text-sd-ink">{detail.customer.name}</div>
                  {detail.customer.city && <div className="text-xs text-sd-ink-soft">{detail.customer.city}</div>}
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {detail.customer.phone && (
                  <a
                    href={`tel:${detail.customer.phone.replace(/[^+\d]/g, "")}`}
                    className="flex items-center gap-2.5 text-sm text-sd-forest font-semibold min-h-11"
                  >
                    <span className="sd-inset p-2 shrink-0">
                      <Phone className="w-4 h-4" />
                    </span>
                    Call {detail.customer.phone}
                  </a>
                )}
                {(detail.customer.address || detail.customer.city) && (
                  <div className="flex items-start gap-2.5 text-sm text-sd-ink-soft min-h-11">
                    <span className="sd-inset p-2 shrink-0">
                      <MapPin className="w-4 h-4" />
                    </span>
                    <span className="pt-2 leading-snug">
                      {[detail.customer.address, detail.customer.city].filter(Boolean).join(", ")}
                    </span>
                  </div>
                )}
              </div>
            </SectionCard>

            {/* installation (capacity only — never generation/kWh) */}
            {inst && (
              <SectionCard title="Installation" subtitle={inst.assetCode}>
                <div className="space-y-3">
                  <InfoRow
                    icon={Zap}
                    label="Installed capacity"
                    value={inst.capacityKw != null ? `${inst.capacityKw} kW` : "—"}
                  />
                  <InfoRow
                    icon={Sun}
                    label="Panels"
                    value={
                      [inst.panelMake, inst.panelModel].filter(Boolean).join(" ") +
                      (inst.panelCount ? ` × ${inst.panelCount}` : "") || "—"
                    }
                  />
                  <InfoRow
                    icon={Zap}
                    label="Inverter"
                    value={[inst.inverterMake, inst.inverterModel].filter(Boolean).join(" ") || "—"}
                  />
                  <InfoRow icon={ClipboardCheck} label="Serial number" value={inst.serialNumber || "—"} />
                  {(inst.siteAddress || inst.city) && (
                    <InfoRow icon={MapPin} label="Site" value={[inst.siteAddress, inst.city].filter(Boolean).join(", ")} />
                  )}
                </div>
                {(inst.equipment?.length > 0 || inst.warranties?.length > 0 || inst.amcContracts?.length > 0) && (
                  <div className="flex flex-wrap gap-2 mt-4">
                    {inst.equipment?.length ? <span className="sd-pill sd-pill-slate">{inst.equipment.length} equipment units</span> : null}
                    {inst.warranties?.length ? <span className="sd-pill sd-pill-teal">{inst.warranties.length} warranties</span> : null}
                    {inst.amcContracts?.length ? <span className="sd-pill sd-pill-amber">{inst.amcContracts.length} AMC contracts</span> : null}
                  </div>
                )}
              </SectionCard>
            )}

            {/* visit details + timeline */}
            <SectionCard title="Visit details">
              <p className="text-sm text-sd-ink leading-relaxed">
                {detail.description || "No description provided by the service desk."}
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <span className="sd-pill sd-pill-slate">{TYPE_LABELS[detail.type] ?? detail.type}</span>
                <PriorityPill priority={detail.priority} />
                <span className="sd-pill sd-pill-slate">
                  <CalendarDays className="w-3 h-3" />
                  {fmtDate(detail.scheduledFor)}
                </span>
                <span className="sd-pill sd-pill-slate">
                  <Clock className="w-3 h-3" />
                  {fmtTime(detail.scheduledFor)}
                </span>
              </div>
              <StatusTimeline events={detail.statusEvents ?? []} />
            </SectionCard>

            {/* checklist */}
            {canWork && template && (
              <SectionCard title="Checklist" subtitle={template.name}>
                <div className="space-y-2.5">
                  {template.items.map((it) =>
                    it.kind === "BOOLEAN" ? (
                      <BigToggle
                        key={it.label}
                        label={it.label}
                        required={it.required}
                        checked={checklist[it.label] === "true"}
                        onChange={(v) => {
                          checklistTouched.current = true;
                          setChecklist((c) => ({ ...c, [it.label]: String(v) }));
                        }}
                      />
                    ) : (
                      <div key={it.label}>
                        <label className="block text-sm font-medium text-sd-ink mb-1.5">
                          {it.label}
                          {it.required && <span className="text-[#a03340] ml-0.5" aria-hidden="true">*</span>}
                        </label>
                        <textarea
                          value={checklist[it.label] ?? ""}
                          onChange={(e) => {
                            checklistTouched.current = true;
                            setChecklist((c) => ({ ...c, [it.label]: e.target.value }));
                          }}
                          rows={2}
                          aria-label={it.label}
                          placeholder="Type your observation…"
                          className="sd-inset px-3.5 py-2.5 text-sm text-sd-ink placeholder:text-sd-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-sd-forest/40 w-full"
                        />
                      </div>
                    ),
                  )}
                </div>
                <button
                  onClick={saveChecklist}
                  disabled={busy === "checklist"}
                  className="sd-btn-primary w-full min-h-12 font-semibold sd-focus flex items-center justify-center gap-2 mt-4"
                >
                  {busy === "checklist" ? <Spinner /> : <ClipboardCheck className="w-4 h-4" />}
                  {online ? "Save checklist" : "Save to queue"}
                </button>
              </SectionCard>
            )}

            {/* photos */}
            {(canWork || status === "COMPLETED") && (
              <SectionCard title="Photos" subtitle={`${photosCount} photo${photosCount === 1 ? "" : "s"} on this job`}>
                <div className="grid grid-cols-3 gap-2">
                  {(detail.attachments ?? []).map((a) => (
                    <a
                      key={a.id}
                      href={`/api/attachments/${a.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="relative aspect-square rounded-xl overflow-hidden sd-inset block"
                      title={a.caption || a.fileName}
                    >
                      <img
                        src={`/api/attachments/${a.id}`}
                        alt={a.caption || a.fileName || "Service photo"}
                        className="w-full h-full object-cover"
                      />
                    </a>
                  ))}
                  {pendingPhotos.map((q) => (
                    <div key={q.id ?? q.idempotencyKey} className="relative aspect-square rounded-xl overflow-hidden ring-2 ring-[#D99A32]/70">
                      <img
                        src={String((q.payload as { dataUrl?: string }).dataUrl ?? "")}
                        alt={`Queued photo for ${q.jobCode}`}
                        className="w-full h-full object-cover"
                      />
                      <span className="absolute bottom-1 left-1 right-1 bg-black/55 text-white text-[0.55rem] font-bold rounded-md py-0.5 text-center tracking-wide">
                        QUEUED
                      </span>
                    </div>
                  ))}
                  {canWork && (
                    <button
                      onClick={() => fileRef.current?.click()}
                      disabled={busy === "photo"}
                      aria-label="Add photo"
                      className="aspect-square min-h-[84px] rounded-xl sd-inset flex flex-col items-center justify-center gap-1 text-sd-ink-soft sd-focus"
                    >
                      {busy === "photo" ? <Spinner /> : (
                        <>
                          <Camera className="w-5 h-5" />
                          <span className="text-[0.65rem] font-semibold">Add photo</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
                {canWork && !online && (
                  <p className="text-xs text-sd-ink-soft mt-3 flex items-center gap-1.5">
                    <CloudOff className="w-3.5 h-3.5 shrink-0" />
                    Offline — photos are compressed and queued on this device.
                  </p>
                )}
                {photosCount === 0 && !canWork && (
                  <p className="text-sm text-sd-ink-soft">No photos were attached to this job.</p>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={onPhotoPicked}
                  aria-hidden="true"
                />
              </SectionCard>
            )}

            {/* report form */}
            {canWork && (
              <SectionCard title="Service report" subtitle="Shared with the customer after review.">
                <label className="block text-sm font-medium text-sd-ink mb-1.5">
                  Service notes <span className="text-[#a03340]" aria-hidden="true">*</span>
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => {
                    reportTouched.current = true;
                    setNotes(e.target.value);
                  }}
                  rows={4}
                  aria-label="Service notes"
                  placeholder="Describe what you did on site — parts checked, issues found, work completed…"
                  className="sd-inset px-3.5 py-2.5 text-sm text-sd-ink placeholder:text-sd-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-sd-forest/40 w-full"
                />

                <div className="flex items-center justify-between gap-2 mt-4 mb-1.5">
                  <label className="text-sm font-medium text-sd-ink">Customer summary (optional)</label>
                  <button
                    onClick={aiDraft}
                    disabled={!online || busy === "ai" || notes.trim().length < 10}
                    title={!online ? "Online only" : notes.trim().length < 10 ? "Write at least 10 characters of notes first" : "Draft a summary with AI"}
                    className="flex items-center gap-1.5 text-xs font-semibold text-sd-forest min-h-9 px-2 sd-focus disabled:text-sd-ink-soft/50"
                  >
                    {busy === "ai" ? <Spinner /> : <Sparkles className="w-3.5 h-3.5" />}
                    AI draft
                  </button>
                </div>
                {aiNote && (
                  <p className="text-xs text-[#96660d] flex items-center gap-1.5 mb-1.5">
                    <Info className="w-3 h-3 shrink-0" />
                    {aiNote}
                  </p>
                )}
                <textarea
                  value={summary}
                  onChange={(e) => {
                    reportTouched.current = true;
                    setSummary(e.target.value);
                  }}
                  rows={3}
                  aria-label="Customer summary"
                  placeholder="A short summary the customer will read…"
                  className="sd-inset px-3.5 py-2.5 text-sm text-sd-ink placeholder:text-sd-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-sd-forest/40 w-full"
                />

                <div className="mt-3">
                  <BigToggle
                    label="Follow-up needed"
                    checked={followUp}
                    onChange={(v) => {
                      reportTouched.current = true;
                      setFollowUp(v);
                    }}
                  />
                </div>
                {followUp && (
                  <textarea
                    value={followUpNotes}
                    onChange={(e) => {
                      reportTouched.current = true;
                      setFollowUpNotes(e.target.value);
                    }}
                    rows={2}
                    aria-label="Follow-up notes"
                    placeholder="What needs to be followed up?"
                    className="sd-inset px-3.5 py-2.5 text-sm text-sd-ink placeholder:text-sd-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-sd-forest/40 w-full mt-2.5"
                  />
                )}

                <button
                  onClick={submitReport}
                  disabled={busy === "submit"}
                  className="sd-btn-primary w-full min-h-12 font-semibold sd-focus flex items-center justify-center gap-2 mt-4"
                >
                  {busy === "submit" ? <Spinner /> : <Send className="w-4 h-4" />}
                  {online ? "Submit report" : "Save to queue"}
                </button>
              </SectionCard>
            )}

            {/* read-only report for completed jobs */}
            {status === "COMPLETED" && detail.report && (
              <SectionCard title="Service report">
                <div className="space-y-3 text-sm">
                  <div>
                    <div className="text-[0.65rem] font-semibold uppercase tracking-wide text-sd-ink-soft mb-1">Notes</div>
                    <p className="text-sd-ink leading-relaxed">{detail.report.technicianNotes || "—"}</p>
                  </div>
                  {detail.report.summary && (
                    <div>
                      <div className="text-[0.65rem] font-semibold uppercase tracking-wide text-sd-ink-soft mb-1">Summary</div>
                      <p className="text-sd-ink leading-relaxed">{detail.report.summary}</p>
                    </div>
                  )}
                  {detail.report.followUpNeeded && (
                    <div className="rounded-xl bg-[#D99A32]/10 p-3 text-xs text-[#7a5a1e] leading-relaxed">
                      <span className="font-semibold">Follow-up needed:</span> {detail.report.followUpNotes || "—"}
                    </div>
                  )}
                  {(detail.checklistResults ?? []).length > 0 && (
                    <div>
                      <div className="text-[0.65rem] font-semibold uppercase tracking-wide text-sd-ink-soft mb-1.5">Checklist</div>
                      <div className="space-y-1.5">
                        {detail.checklistResults.map((r) => (
                          <div key={r.itemLabel} className="flex items-start gap-2">
                            {r.itemKind === "BOOLEAN" ? (
                              r.value === "true" ? (
                                <CheckCircle2 className="w-4 h-4 text-sd-success mt-0.5 shrink-0" />
                              ) : (
                                <XCircle className="w-4 h-4 text-[#a03340]/70 mt-0.5 shrink-0" />
                              )
                            ) : (
                              <span className="w-1.5 h-1.5 rounded-full bg-sd-ink-soft/50 mt-1.5 shrink-0" />
                            )}
                            <span className="text-sd-ink">
                              {r.itemLabel}
                              {r.itemKind === "TEXT" && r.value ? `: ${r.value}` : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </SectionCard>
            )}

            {/* customer OTP acknowledgement */}
            {otpAvailable && !otpDone && (
              <SectionCard title="Customer confirmation" subtitle="Verify the service with a one-time code.">
                {!online && (
                  <div className="flex items-center gap-2 text-xs text-sd-ink-soft mb-3">
                    <WifiOff className="w-3.5 h-3.5 shrink-0" />
                    Online only — request the code once you have a connection.
                  </div>
                )}

                {!otpState ? (
                  <button
                    onClick={requestOtp}
                    disabled={!online || otpBusy}
                    className="sd-btn-primary w-full min-h-12 font-semibold sd-focus flex items-center justify-center gap-2"
                  >
                    {otpBusy ? <Spinner /> : <MessageSquare className="w-4 h-4" />}
                    Request customer OTP
                  </button>
                ) : (
                  <div className="space-y-4">
                    {otpState.smsMode === "TEST" && otpState.demoCode ? (
                      <div className="rounded-2xl border-2 border-[#F2B84B]/70 bg-[#D99A32]/[0.07] p-4">
                        <div className="flex items-start gap-3">
                          <span className="rounded-xl bg-[#D99A32]/15 p-2 shrink-0">
                            <MessageSquare className="w-4 h-4 text-[#96660d]" />
                          </span>
                          <p className="text-xs text-[#7a5a1e] leading-relaxed">
                            <span className="font-bold text-[#96660d]">TEST SMS MODE</span> — no SMS provider is
                            configured in this environment. In a real deployment the customer receives this code by
                            SMS and reads it out to you. It is shown here for demo purposes only.
                          </p>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-3 sd-inset px-4 py-3 bg-white/70">
                          <span className="font-mono text-2xl font-bold tracking-[0.3em] text-sd-ink">
                            {otpState.demoCode}
                          </span>
                          <button
                            onClick={() => copyDemoCode(otpState.demoCode as string)}
                            aria-label="Copy code"
                            className="sd-clay-sm p-2.5 text-sd-ink-soft sd-focus"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-sd-ink-soft">
                        The customer received the code by SMS. Ask them to read it out to you.
                      </p>
                    )}

                    <div className="flex items-center justify-between text-xs text-sd-ink-soft">
                      <span>Code expires in</span>
                      <OtpCountdown expiresAt={otpState.expiresAt} />
                    </div>

                    <div className="flex flex-col items-center gap-1.5">
                      <InputOTP maxLength={6} value={otpCode} onChange={setOtpCode} disabled={otpBusy || !online}>
                        <InputOTPGroup>
                          {[0, 1, 2, 3, 4, 5].map((i) => (
                            <InputOTPSlot
                              key={i}
                              index={i}
                              className="h-12 w-10 text-lg border-sd-line bg-white first:rounded-l-xl last:rounded-r-xl data-[active=true]:border-[#176B52] data-[active=true]:ring-[#176B52]/25"
                            />
                          ))}
                        </InputOTPGroup>
                      </InputOTP>
                      <span className="text-[0.68rem] text-sd-ink-soft">Enter the 6-digit code the customer reads out</span>
                    </div>

                    {otpError && (
                      <div className="text-sm text-[#a03340] flex items-start gap-1.5">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        {otpError}
                      </div>
                    )}

                    <div className="flex flex-col gap-2">
                      <button
                        onClick={verifyOtpCode}
                        disabled={otpBusy || !online || otpCode.length !== 6}
                        className="sd-btn-primary w-full min-h-12 font-semibold sd-focus flex items-center justify-center gap-2"
                      >
                        {otpBusy ? <Spinner /> : <BadgeCheck className="w-4 h-4" />}
                        Verify &amp; complete
                      </button>
                      <button
                        onClick={requestOtp}
                        disabled={otpBusy || !online}
                        className="text-sm font-semibold text-sd-forest min-h-11 sd-focus"
                      >
                        Request a new code
                      </button>
                    </div>
                  </div>
                )}
              </SectionCard>
            )}
          </div>
        )}
      </div>
    </motion.div>,
    document.body,
  );
}

// ── Root component ────────────────────────────────────────────────────────────

export default function TechnicianApp({ view }: { view: string }) {
  const online = useOnline();
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [closingJob, setClosingJob] = useState(false);
  const [queued, setQueued] = useState(0);

  const bumpQueue = useCallback(async () => {
    setQueued(await countQueue());
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void bumpQueue();
    }, 0); // deferred — avoids synchronous setState in effect body
    return () => clearTimeout(t);
  }, [bumpQueue]);

  // toast on connectivity changes
  const prevOnline = useRef(online);
  useEffect(() => {
    if (prevOnline.current === online) return;
    const was = prevOnline.current;
    prevOnline.current = online;
    if (was && !online) {
      toast({ title: "You're offline", description: "Drafts, photos and reports will be saved on this device." });
    } else if (!was && online) {
      toast({
        title: "Back online",
        description: queued > 0 ? `${queued} item${queued === 1 ? "" : "s"} waiting — open the Sync tab to send them.` : "You're connected again.",
      });
    }
  }, [online, queued]);

  const rawScreen = view.startsWith("tech:") ? view.slice(5) : view;
  const screen = ["today", "jobs", "queue", "profile"].includes(rawScreen) ? rawScreen : "today";

  const openJob = useCallback((id: string) => setActiveJobId(id), []);
  const closeJob = useCallback(() => {
    setClosingJob(true);
    window.setTimeout(() => {
      setActiveJobId(null);
      setClosingJob(false);
    }, 230);
  }, []);

  return (
    <div className="overflow-x-hidden">
      <div className="max-w-lg mx-auto w-full px-4 pb-28 pt-1">
        {screen === "today" && <TodayScreen online={online} onOpenJob={openJob} />}
        {screen === "jobs" && <JobsScreen online={online} onOpenJob={openJob} />}
        {screen === "queue" && <QueueScreen online={online} bumpQueue={bumpQueue} />}
        {screen === "profile" && <ProfileScreen online={online} />}
      </div>

      <BottomNav active={screen} queued={queued} />

      {activeJobId && typeof document !== "undefined" && (
        <JobScreen
          key={activeJobId}
          jobId={activeJobId}
          online={online}
          closing={closingJob}
          onClose={closeJob}
          bumpQueue={bumpQueue}
        />
      )}
    </div>
  );
}
