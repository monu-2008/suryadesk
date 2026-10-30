// SuryaDesk maintenance schedule engine.
// Generates due occurrences from each active plan's interval, prevents
// duplicates (unique planId+dueDate), and derives live status.
import { db } from "@/lib/db";

export function occurrenceStatusFor(dueDate: Date, completedAt: Date | null, rescheduledFrom: Date | null): string {
  if (completedAt) return "COMPLETED";
  if (rescheduledFrom) return "RESCHEDULED";
  const now = new Date();
  const startOfDue = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate()).getTime();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (startOfDue < startOfToday) return "OVERDUE";
  if (startOfDue === startOfToday) return "DUE";
  return "UPCOMING";
}

/**
 * Ensures every active plan has occurrences generated up to the next future
 * due date. Idempotent — existing occurrences (any status) are never touched.
 */
export async function generateDueOccurrences(organizationId: string) {
  const plans = await db.maintenancePlan.findMany({
    where: { organizationId, active: true },
    include: { occurrences: true },
  });
  let created = 0;
  for (const plan of plans) {
    const existingDates = new Set(plan.occurrences.map((o) => new Date(o.dueDate).toISOString().slice(0, 10)));
    // find last occurrence date or fall back to plan start
    const dates = [...plan.occurrences].map((o) => new Date(o.dueDate).getTime());
    const lastMs = dates.length ? Math.max(...dates) : new Date(plan.startDate).getTime();
    let next = new Date(lastMs + plan.intervalDays * 86400000);
    const now = new Date();
    // generate until we have at least one future occurrence
    let guard = 0;
    let hasFuture = plan.occurrences.some((o) => {
      const st = occurrenceStatusFor(new Date(o.dueDate), o.completedAt, o.rescheduledFrom);
      return st === "UPCOMING" || st === "DUE";
    });
    while (!hasFuture && guard < 12) {
      const day = next.toISOString().slice(0, 10);
      if (!existingDates.has(day)) {
        await db.maintenanceOccurrence.create({
          data: {
            organizationId,
            planId: plan.id,
            installationId: plan.installationId,
            dueDate: next,
            status: occurrenceStatusFor(next, null, null),
          },
        });
        existingDates.add(day);
        created++;
        hasFuture = next.getTime() > now.getTime();
      }
      next = new Date(next.getTime() + plan.intervalDays * 86400000);
      guard++;
    }
  }
  return { created };
}

/** Refresh non-terminal statuses against today's date (no history rewriting). */
export async function refreshOccurrenceStatuses(organizationId: string) {
  const occurrences = await db.maintenanceOccurrence.findMany({
    where: { organizationId, status: { in: ["UPCOMING", "DUE", "OVERDUE"] } },
  });
  for (const o of occurrences) {
    const live = occurrenceStatusFor(new Date(o.dueDate), o.completedAt, o.rescheduledFrom ? new Date(o.rescheduledFrom) : null);
    if (live !== o.status) {
      await db.maintenanceOccurrence.update({ where: { id: o.id }, data: { status: live } });
    }
  }
}

export function amcStatusFor(dates: { startDate: Date; endDate: Date }, currentStatus: string): string {
  if (currentStatus === "CANCELLED") return "CANCELLED";
  const now = new Date();
  const end = new Date(dates.endDate);
  const daysLeft = Math.round((end.getTime() - now.getTime()) / 86400000);
  if (daysLeft < 0) return currentStatus === "RENEWAL_PENDING" ? "RENEWAL_PENDING" : "EXPIRED";
  if (daysLeft <= 30) return currentStatus === "RENEWAL_PENDING" ? "RENEWAL_PENDING" : "EXPIRING_SOON";
  return "ACTIVE";
}
