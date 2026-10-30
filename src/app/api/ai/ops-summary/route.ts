// AI operations summary — statistics are ALWAYS computed from the database
// first; the model only narrates them. It can never invent numbers.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, handleApiError } from "@/lib/surya/auth";
import { aiComplete } from "@/lib/surya/ai";

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER"]);
    const orgId = ctx.organizationId!;

    // ground truth from DB
    const [requests, jobs, amcs, occurrences, techs] = await Promise.all([
      db.serviceRequest.findMany({ where: { organizationId: orgId }, select: { status: true, category: true, createdAt: true } }),
      db.serviceJob.findMany({ where: { organizationId: orgId }, select: { status: true, scheduledFor: true, completedAt: true } }),
      db.amcContract.findMany({ where: { organizationId: orgId }, select: { status: true, endDate: true } }),
      db.maintenanceOccurrence.findMany({ where: { organizationId: orgId }, select: { status: true, dueDate: true } }),
      db.organizationMember.findMany({ where: { organizationId: orgId, role: "TECHNICIAN", isActive: true }, include: { user: { select: { name: true } } } }),
    ]);
    const assignments = await db.jobAssignment.findMany({
      where: { organizationId: orgId, active: true, job: { status: { in: ["ASSIGNED", "IN_PROGRESS", "WORK_SUBMITTED", "AWAITING_CUSTOMER"] } } },
      select: { technicianUserId: true },
    });

    const openRequests = requests.filter((r) => ["NEW", "UNDER_REVIEW", "APPROVED"].includes(r.status));
    const activeJobs = jobs.filter((j) => ["ASSIGNED", "IN_PROGRESS"].includes(j.status));
    const awaitingCustomer = jobs.filter((j) => j.status === "AWAITING_CUSTOMER");
    const overdueMaintenance = occurrences.filter((o) => o.status === "OVERDUE");
    const expiringAmc = amcs.filter((a) => {
      const days = Math.round((new Date(a.endDate).getTime() - Date.now()) / 86400000);
      return a.status !== "CANCELLED" && days > 0 && days <= 30;
    });
    const workload = techs.map((t) => ({ name: t.user.name, activeJobs: assignments.filter((a) => a.technicianUserId === t.userId).length }));

    const stats = {
      openRequests: openRequests.length,
      newRequests: requests.filter((r) => r.status === "NEW").length,
      unresolvedByCategory: openRequests.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.category]: (acc[r.category] ?? 0) + 1 }), {}),
      jobsInProgress: activeJobs.length,
      jobsAwaitingCustomer: awaitingCustomer.length,
      overdueMaintenance: overdueMaintenance.length,
      amcExpiringSoon: expiringAmc.length,
      technicianWorkload: workload,
    };

    try {
      const res = await aiComplete(
        "You are the operations analyst of a solar after-sales service company. You will receive verified statistics computed directly from the company database. Write a concise operations briefing (max 180 words) with: 1) overall workload picture, 2) items needing attention (overdue maintenance, expiring AMC, awaiting-customer jobs), 3) workload balance across technicians, 4) two concrete next steps. Use ONLY the numbers provided — never invent statistics. Professional, warm, brief.",
        `Verified database statistics (do not modify): ${JSON.stringify(stats)}`
      );
      await db.aiGeneration.create({
        data: { organizationId: orgId, userId: ctx.userId, task: "OPS_SUMMARY", provider: "zai", model: res.model, inputSummary: "ops stats", outputJson: JSON.stringify(stats), status: "OK" },
      });
      return NextResponse.json({ ok: true, summary: res.content.trim(), stats });
    } catch {
      await db.aiGeneration.create({
        data: { organizationId: orgId, userId: ctx.userId, task: "OPS_SUMMARY", provider: "zai", model: "glm-4.5-air", inputSummary: "ops stats", status: "FAILED" },
      });
      // graceful degradation — show computed stats without AI narration
      return NextResponse.json({
        ok: false,
        stats,
        error: "AI narration is unavailable, but the statistics below are live from your database.",
      });
    }
  } catch (e) {
    return handleApiError(e);
  }
}
