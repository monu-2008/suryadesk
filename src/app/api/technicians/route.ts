// Technician roster with workload computed from live assignments.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, handleApiError } from "@/lib/surya/auth";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER"]);
    const orgId = ctx.organizationId!;
    const members = await db.organizationMember.findMany({
      where: { organizationId: orgId, role: "TECHNICIAN" },
      include: { user: true },
      orderBy: { joinedAt: "asc" },
    });
    const assignments = await db.jobAssignment.findMany({
      where: { organizationId: orgId, active: true },
      include: { job: { select: { status: true, scheduledFor: true } } },
    });
    const technicians = members.map((m) => {
      const mine = assignments.filter((a) => a.technicianUserId === m.userId);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const endToday = new Date(today.getTime() + 86400000);
      return {
        id: m.userId,
        name: m.user.name,
        email: m.user.email,
        phone: m.user.phone,
        title: m.title,
        skills: JSON.parse(m.skills || "[]"),
        isActive: m.isActive,
        joinedAt: m.joinedAt,
        activeJobs: mine.filter((a) => ["ASSIGNED", "IN_PROGRESS"].includes(a.job.status)).length,
        todayJobs: mine.filter((a) => new Date(a.job.scheduledFor) >= today && new Date(a.job.scheduledFor) < endToday && !["COMPLETED", "CANCELLED"].includes(a.job.status)).length,
        completedJobs: mine.filter((a) => a.job.status === "COMPLETED").length,
        pendingJobs: mine.filter((a) => ["WORK_SUBMITTED", "AWAITING_CUSTOMER", "NEEDS_REVIEW"].includes(a.job.status)).length,
      };
    });
    return NextResponse.json({ technicians });
  } catch (e) {
    return handleApiError(e);
  }
}
