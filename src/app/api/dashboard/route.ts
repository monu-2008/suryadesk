// Operations dashboard — every number is computed from persisted records.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, handleApiError } from "@/lib/surya/auth";
import { refreshOccurrenceStatuses, amcStatusFor } from "@/lib/surya/engine";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER"]);
    const orgId = ctx.organizationId!;
    await refreshOccurrenceStatuses(orgId);

    const [totalCustomers, activeInstallations, amcs, occurrences, requests, jobs, techMembers] = await Promise.all([
      db.customer.count({ where: { organizationId: orgId, archivedAt: null } }),
      db.installation.count({ where: { organizationId: orgId, status: "ACTIVE" } }),
      db.amcContract.findMany({ where: { organizationId: orgId }, select: { status: true, startDate: true, endDate: true } }),
      db.maintenanceOccurrence.findMany({ where: { organizationId: orgId }, select: { status: true, dueDate: true } }),
      db.serviceRequest.findMany({ where: { organizationId: orgId }, select: { status: true, createdAt: true, category: true } }),
      db.serviceJob.findMany({ where: { organizationId: orgId }, select: { status: true, scheduledFor: true, createdAt: true, completedAt: true, customerId: true } }),
      db.organizationMember.findMany({ where: { organizationId: orgId, role: "TECHNICIAN", isActive: true }, include: { user: true } }),
    ]);

    // AMC live status
    const amcLive = amcs.map((a) => amcStatusFor(a, a.status));
    const activeAmc = amcLive.filter((s) => s === "ACTIVE" || s === "EXPIRING_SOON").length;
    const amcExpiringSoon = amcLive.filter((s) => s === "EXPIRING_SOON" || s === "RENEWAL_PENDING").length;

    const upcomingMaintenance = occurrences.filter((o) => o.status === "UPCOMING" || o.status === "DUE").length;
    const overdueMaintenance = occurrences.filter((o) => o.status === "OVERDUE").length;
    const openRequests = requests.filter((r) => ["NEW", "UNDER_REVIEW", "APPROVED"].includes(r.status)).length;
    const jobsInProgress = jobs.filter((j) => ["ASSIGNED", "IN_PROGRESS"].includes(j.status)).length;

    // request trend — last 6 months
    const trend: { month: string; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i, 1);
      const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      trend.push({
        month: d.toLocaleDateString("en-IN", { month: "short" }),
        count: requests.filter((r) => new Date(r.createdAt) >= d && new Date(r.createdAt) < next).length,
      });
    }

    // jobs by status
    const jobsByStatus: Record<string, number> = {};
    for (const j of jobs) jobsByStatus[j.status] = (jobsByStatus[j.status] ?? 0) + 1;

    // requests by category
    const requestsByCategory: Record<string, number> = {};
    for (const r of requests) requestsByCategory[r.category] = (requestsByCategory[r.category] ?? 0) + 1;

    // AMC expiry buckets
    const now = new Date();
    const inDays = (d: Date, n: number) => (d.getTime() - now.getTime()) / 86400000 <= n;
    const amcExpiry = {
      d30: amcs.filter((a) => new Date(a.endDate) > now && inDays(new Date(a.endDate), 30)).length,
      d60: amcs.filter((a) => new Date(a.endDate) > now && inDays(new Date(a.endDate), 60)).length,
      d90: amcs.filter((a) => new Date(a.endDate) > now && inDays(new Date(a.endDate), 90)).length,
      expired: amcs.filter((a) => new Date(a.endDate) < now && a.status !== "CANCELLED").length,
    };

    // technician workload — active jobs per technician
    const assignments = await db.jobAssignment.findMany({
      where: { organizationId: orgId, active: true, job: { status: { in: ["ASSIGNED", "IN_PROGRESS", "WORK_SUBMITTED", "AWAITING_CUSTOMER"] } } },
      select: { technicianUserId: true },
    });
    const workload = techMembers.map((t) => ({
      id: t.userId,
      name: t.user.name,
      title: t.title,
      activeJobs: assignments.filter((a) => a.technicianUserId === t.userId).length,
    }));

    // maintenance calendar preview — next 14 days
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const calendarFrom = new Date(startToday);
    const calendarTo = new Date(startToday.getTime() + 14 * 86400000);
    const calendarOcc = await db.maintenanceOccurrence.findMany({
      where: { organizationId: orgId, dueDate: { gte: calendarFrom, lte: calendarTo }, status: { in: ["UPCOMING", "DUE", "OVERDUE", "RESCHEDULED"] } },
      include: { installation: { include: { customer: true } } },
      orderBy: { dueDate: "asc" },
    });
    const calendar = calendarOcc.slice(0, 10).map((o) => ({
      id: o.id,
      dueDate: o.dueDate,
      status: o.status,
      customer: o.installation.customer.name,
      assetCode: o.installation.assetCode,
      capacityKw: o.installation.capacityKw,
    }));

    // recent activity — status events + audits
    const [events, audits] = await Promise.all([
      db.jobStatusEvent.findMany({ where: { organizationId: orgId }, include: { job: true }, orderBy: { createdAt: "desc" }, take: 8 }),
      db.auditEvent.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "desc" }, take: 8 }),
    ]);

    // critical pending actions
    const unassignedScheduled = jobsByStatus["SCHEDULED"] ?? 0;
    const awaitingCustomer = jobsByStatus["AWAITING_CUSTOMER"] ?? 0;
    const needsReview = jobsByStatus["NEEDS_REVIEW"] ?? 0;

    // today's schedule (for manager)
    const todayJobs = await db.serviceJob.count({
      where: {
        organizationId: orgId,
        scheduledFor: { gte: startToday, lt: new Date(startToday.getTime() + 86400000) },
        status: { in: ["SCHEDULED", "ASSIGNED", "IN_PROGRESS", "WORK_SUBMITTED", "AWAITING_CUSTOMER"] },
      },
    });

    // completion time (avg hours from scheduledFor to completedAt) for completed jobs
    const completedJobs = await db.serviceJob.findMany({
      where: { organizationId: orgId, status: "COMPLETED", completedAt: { not: null } },
      select: { scheduledFor: true, completedAt: true },
    });
    const avgCompletionHrs =
      completedJobs.length > 0
        ? Math.round(
            (completedJobs.reduce((s, j) => s + (new Date(j.completedAt!).getTime() - new Date(j.scheduledFor).getTime()) / 3600000, 0) / completedJobs.length) * 10
          ) / 10
        : 0;

    return NextResponse.json({
      kpis: {
        totalCustomers,
        activeInstallations,
        activeAmc,
        amcExpiringSoon,
        upcomingMaintenance,
        overdueMaintenance,
        openRequests,
        jobsInProgress,
        todayJobs,
        avgCompletionHrs,
        totalJobs: jobs.length,
      },
      trend,
      jobsByStatus,
      requestsByCategory,
      amcExpiry,
      workload,
      calendar,
      recentEvents: events.map((e) => ({ id: e.id, jobCode: e.job.code, fromStatus: e.fromStatus, toStatus: e.toStatus, at: e.createdAt })),
      recentAudits: audits.map((a) => ({ id: a.id, action: a.action, detail: a.detail, at: a.createdAt })),
      critical: { unassignedScheduled, awaitingCustomer, needsReview, overdueMaintenance, openRequests },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
