// SuryaDesk shared domain constants, types and helpers
// (used by both API routes and client components)

export const ROLES = ["OWNER", "MANAGER", "TECHNICIAN", "CUSTOMER"] as const;
export type Role = (typeof ROLES)[number];

export const REQUEST_STATUSES = ["NEW", "UNDER_REVIEW", "APPROVED", "CONVERTED", "REJECTED", "CLOSED"] as const;
export const JOB_STATUSES = ["SCHEDULED", "ASSIGNED", "IN_PROGRESS", "WORK_SUBMITTED", "AWAITING_CUSTOMER", "COMPLETED", "NEEDS_REVIEW", "CANCELLED"] as const;
export const REQUEST_CATEGORIES = ["MAINTENANCE", "INVERTER", "CLEANING", "MONITORING", "INSPECTION", "OTHER"] as const;
export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export const AMC_STATUSES = ["ACTIVE", "EXPIRING_SOON", "EXPIRED", "RENEWAL_PENDING", "CANCELLED"] as const;
export const OCCURRENCE_STATUSES = ["UPCOMING", "DUE", "OVERDUE", "COMPLETED", "RESCHEDULED"] as const;

export const REQUEST_CATEGORY_LABELS: Record<string, string> = {
  MAINTENANCE: "Maintenance",
  INVERTER: "Inverter issue",
  CLEANING: "Panel cleaning",
  MONITORING: "Monitoring support",
  INSPECTION: "General inspection",
  OTHER: "Other",
};

export const STATUS_LABELS: Record<string, string> = {
  NEW: "New",
  UNDER_REVIEW: "Under Review",
  APPROVED: "Approved",
  CONVERTED: "Converted to Job",
  REJECTED: "Rejected",
  CLOSED: "Closed",
  SCHEDULED: "Scheduled",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In Progress",
  WORK_SUBMITTED: "Work Submitted",
  AWAITING_CUSTOMER: "Awaiting Customer",
  COMPLETED: "Completed",
  NEEDS_REVIEW: "Needs Review",
  CANCELLED: "Cancelled",
  UPCOMING: "Upcoming",
  DUE: "Due",
  OVERDUE: "Overdue",
  RESCHEDULED: "Rescheduled",
  ACTIVE: "Active",
  EXPIRING_SOON: "Expiring Soon",
  EXPIRED: "Expired",
  RENEWAL_PENDING: "Renewal Pending",
  NONE: "Not invited",
  INVITED: "Invited",
};

// status → tone used by StatusPill
export type PillTone = "green" | "amber" | "red" | "slate" | "teal" | "violet";
export const STATUS_TONES: Record<string, PillTone> = {
  NEW: "amber",
  UNDER_REVIEW: "violet",
  APPROVED: "teal",
  CONVERTED: "green",
  REJECTED: "red",
  CLOSED: "slate",
  SCHEDULED: "slate",
  ASSIGNED: "teal",
  IN_PROGRESS: "amber",
  WORK_SUBMITTED: "violet",
  AWAITING_CUSTOMER: "amber",
  COMPLETED: "green",
  NEEDS_REVIEW: "red",
  CANCELLED: "slate",
  UPCOMING: "slate",
  DUE: "amber",
  OVERDUE: "red",
  RESCHEDULED: "violet",
  ACTIVE: "green",
  EXPIRING_SOON: "amber",
  EXPIRED: "red",
  RENEWAL_PENDING: "amber",
  INVITED: "teal",
  LOW: "slate",
  MEDIUM: "teal",
  HIGH: "amber",
  URGENT: "red",
};

export const PRIORITY_TONES: Record<string, PillTone> = {
  LOW: "slate",
  MEDIUM: "teal",
  HIGH: "amber",
  URGENT: "red",
};

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  baseRole: Role;
  organizationId: string | null;
  organizationName: string | null;
  orgRole: Role | null; // OWNER | MANAGER | TECHNICIAN (staff) or CUSTOMER
  title: string | null;
  customerId: string | null; // for CUSTOMER role
  isDemoOrg: boolean;
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function fmtTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export function relativeDay(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOfDay(date) - startOfDay(now)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff < 0) return `${-diff} days ago`;
  return `in ${diff} days`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function inr(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return "₹" + amount.toLocaleString("en-IN");
}

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
