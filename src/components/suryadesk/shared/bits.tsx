"use client";
// SuryaDesk shared UI primitives — used across all workspaces.
import { cn } from "@/lib/utils";
import { STATUS_LABELS, STATUS_TONES, PRIORITY_TONES, type PillTone, initials } from "@/lib/surya/types";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ── Logo ────────────────────────────────────────────────────────
export function SuryaLogo({ size = 34, withWordmark = true, light = false }: { size?: number; withWordmark?: boolean; light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <linearGradient id="sdlogo" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#1D7A5D" />
            <stop offset="1" stopColor="#104B3D" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="60" height="60" rx="18" fill="url(#sdlogo)" />
        <circle cx="40" cy="24" r="8" fill="#F2B84B" />
        <g stroke="#F2B84B" strokeWidth="2.4" strokeLinecap="round">
          <line x1="40" y1="8" x2="40" y2="11" />
          <line x1="54" y1="24" x2="51" y2="24" />
          <line x1="50" y1="14" x2="48" y2="16" />
          <line x1="50" y1="34" x2="48" y2="32" />
        </g>
        <g fill="#E9EEE8">
          <rect x="12" y="34" width="9" height="7" rx="1.6" />
          <rect x="23" y="34" width="9" height="7" rx="1.6" />
          <rect x="34" y="34" width="9" height="7" rx="1.6" />
          <rect x="45" y="34" width="7" height="7" rx="1.6" />
          <rect x="12" y="43" width="9" height="7" rx="1.6" />
          <rect x="23" y="43" width="9" height="7" rx="1.6" />
          <rect x="34" y="43" width="9" height="7" rx="1.6" />
          <rect x="45" y="43" width="7" height="7" rx="1.6" />
        </g>
      </svg>
      {withWordmark && (
        <div className="leading-none">
          <div className={cn("font-bold tracking-tight text-[1.15rem]", light ? "text-white" : "text-sd-ink")}>
            Surya<span className="text-sd-forest">Desk</span>
          </div>
          <div className={cn("text-[0.62rem] mt-1 tracking-wide", light ? "text-white/60" : "text-sd-ink-soft")}>SOLAR SERVICE OPS</div>
        </div>
      )}
    </div>
  );
}

// ── Status pill ─────────────────────────────────────────────────
export function StatusPill({ status, className }: { status: string; className?: string }) {
  const tone: PillTone = STATUS_TONES[status] ?? "slate";
  return <span className={cn("sd-pill", `sd-pill-${tone}`, className)}>{STATUS_LABELS[status] ?? status}</span>;
}

export function PriorityPill({ priority, className }: { priority: string; className?: string }) {
  const tone: PillTone = PRIORITY_TONES[priority] ?? "slate";
  return <span className={cn("sd-pill", `sd-pill-${tone}`, className)}>{priority}</span>;
}

// ── KPI card ────────────────────────────────────────────────────
export function KpiCard({
  label,
  value,
  icon: Icon,
  tone = "forest",
  sub,
  onClick,
  delay = 0,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: "forest" | "amber" | "error" | "info" | "slate";
  sub?: string;
  onClick?: () => void;
  delay?: number;
}) {
  const tones: Record<string, string> = {
    forest: "bg-[#176B52]/10 text-sd-forest",
    amber: "bg-[#D99A32]/12 text-[#96660d]",
    error: "bg-[#C94B55]/10 text-[#a03340]",
    info: "bg-[#4C78B8]/10 text-[#3a5c8f]",
    slate: "bg-[#747E77]/10 text-[#5c665f]",
  };
  return (
    <motion.button
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "sd-clay sd-clay-raise p-4 sm:p-5 text-left flex items-start gap-3.5 w-full",
        onClick && "cursor-pointer sd-focus"
      )}
    >
      <div className={cn("rounded-2xl p-2.5 shrink-0", tones[tone])}>
        <Icon className="w-5 h-5" strokeWidth={2} />
      </div>
      <div className="min-w-0">
        <div className="text-[1.35rem] sm:text-[1.5rem] font-bold tracking-tight text-sd-ink leading-tight">{value}</div>
        <div className="text-[0.78rem] text-sd-ink-soft mt-0.5 leading-snug">{label}</div>
        {sub && <div className="text-[0.7rem] text-sd-forest mt-1 font-medium">{sub}</div>}
      </div>
    </motion.button>
  );
}

// ── Page header ─────────────────────────────────────────────────
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div>
        <h1 className="text-[1.45rem] sm:text-[1.7rem] font-bold tracking-tight text-sd-ink">{title}</h1>
        {subtitle && <p className="text-sm text-sd-ink-soft mt-1 max-w-2xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

// ── Empty state ─────────────────────────────────────────────────
export function EmptyState({ icon: Icon, title, body, action }: { icon?: LucideIcon; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="sd-clay flex flex-col items-center justify-center py-14 px-6 text-center">
      {Icon && (
        <div className="rounded-3xl bg-sd-surface p-4 mb-4">
          <Icon className="w-7 h-7 text-sd-ink-soft" />
        </div>
      )}
      <div className="font-semibold text-sd-ink">{title}</div>
      {body && <div className="text-sm text-sd-ink-soft mt-1.5 max-w-sm">{body}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ── Loading / skeletons ─────────────────────────────────────────
export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="sd-clay flex items-center justify-center gap-3 py-16 text-sd-ink-soft">
      <Loader2 className="w-5 h-5 animate-spin text-sd-forest" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="sd-clay p-5 space-y-3.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 rounded-xl bg-sd-surface animate-pulse" style={{ animationDelay: `${i * 90}ms` }} />
      ))}
    </div>
  );
}

// ── Avatar ──────────────────────────────────────────────────────
export function SdAvatar({ name, size = 36, className }: { name: string; size?: number; className?: string }) {
  const palette = ["#176B52", "#3D9977", "#D99A32", "#4C78B8", "#C94B55", "#104B3D"];
  const color = palette[name.charCodeAt(0) % palette.length];
  return (
    <div
      className={cn("rounded-full flex items-center justify-center text-white font-semibold shrink-0", className)}
      style={{ width: size, height: size, background: color, fontSize: size * 0.36 }}
      aria-label={name}
    >
      {initials(name)}
    </div>
  );
}

// ── Section card ────────────────────────────────────────────────
export function SectionCard({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={cn("sd-clay overflow-hidden", className)}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-1">
          <div>
            {title && <h3 className="font-semibold text-sd-ink text-[0.95rem]">{title}</h3>}
            {subtitle && <p className="text-xs text-sd-ink-soft mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </div>
  );
}

// ── Demo badge ──────────────────────────────────────────────────
export function DemoBadge() {
  return (
    <span className="sd-pill sd-pill-amber border border-[#D99A32]/30" title="This workspace runs on the disposable demo dataset">
      DEMO ENVIRONMENT
    </span>
  );
}

// ── Table wrapper (responsive) ──────────────────────────────────
export function TableShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("sd-clay overflow-hidden", className)}>
      <div className="overflow-x-auto sd-scroll">{children}</div>
    </div>
  );
}
