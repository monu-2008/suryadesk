// Service jobs — assigned field visits. Role-scoped:
// technicians see only their assignments, customers only their own jobs.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, ApiError, handleApiError } from "@/lib/surya/auth";
import { audit } from "@/lib/surya/notify";

// GET /api/jobs?status=&technicianId=&type=&search=&page=&scope=today|upcoming|overdue|completed
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    const orgId = ctx.organizationId!;
    const sp = req.nextUrl.searchParams;
    const status = sp.get("status") ?? "";
    const type = sp.get("type") ?? "";
    const search = sp.get("search")?.trim() ?? "";
    const scope = sp.get("scope") ?? "";
    const technicianId = sp.get("technicianId") ?? "";
    const page = Math.max(1, parseInt(sp.get("page") ?? "1"));
    const pageSize = Math.min(50, Math.max(5, parseInt(sp.get("pageSize") ?? "10")));

    // technician scope guard — a technician can never list others' jobs
    const techSelf = ctx.orgRole === "TECHNICIAN" ? ctx.userId : null;

    const assignedJobs = techSelf
      ? (await db.jobAssignment.findMany({ where: { organizationId: orgId, technicianUserId: techSelf, active: true }, select: { jobId: true } })).map((a) => a.jobId)
      : null;

    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    const endToday = new Date(startToday.getTime() + 86400000);

    const where = {
      organizationId: orgId,
      ...(ctx.orgRole === "CUSTOMER" ? { customerId: ctx.customerId! } : {}),
      ...(assignedJobs ? { id: { in: assignedJobs } } : {}),
      ...(technicianId && !techSelf ? { assignments: { some: { technicianUserId: technicianId, active: true } } } : {}),
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
      ...(search ? { OR: [{ code: { contains: search } }, { title: { contains: search } }, { customer: { name: { contains: search } } }, { installation: { assetCode: { contains: search } } }] } : {}),
      ...(scope === "today" ? { scheduledFor: { gte: startToday, lt: endToday }, status: { in: ["SCHEDULED", "ASSIGNED", "IN_PROGRESS", "WORK_SUBMITTED", "AWAITING_CUSTOMER"] } } : {}),
      ...(scope === "upcoming" ? { scheduledFor: { gte: endToday }, status: { in: ["SCHEDULED", "ASSIGNED"] } } : {}),
      ...(scope === "overdue" ? { scheduledFor: { lt: startToday }, status: { in: ["SCHEDULED", "ASSIGNED", "IN_PROGRESS"] } } : {}),
      ...(scope === "completed" ? { status: "COMPLETED" } : {}),
      ...(scope === "active" ? { status: { in: ["SCHEDULED", "ASSIGNED", "IN_PROGRESS", "WORK_SUBMITTED", "AWAITING_CUSTOMER"] } } : {}),
    };

    const [total, rows] = await Promise.all([
      db.serviceJob.count({ where }),
      db.serviceJob.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, city: true, phone: true } },
          installation: { select: { id: true, assetCode: true, capacityKw: true, siteAddress: true, city: true } },
          assignments: { where: { active: true }, include: { technician: { select: { id: true, name: true } } } },
          report: { select: { id: true, acknowledgedByOtp: true } },
          request: { select: { code: true } },
        },
        orderBy: { scheduledFor: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    // counts by status for filters (role-scoped)
    const allForCounts = await db.serviceJob.findMany({
      where: { organizationId: orgId, ...(ctx.orgRole === "CUSTOMER" ? { customerId: ctx.customerId! } : {}), ...(assignedJobs ? { id: { in: assignedJobs } } : {}) },
      select: { status: true, scheduledFor: true },
    });
    const counts: Record<string, number> = {};
    for (const j of allForCounts) counts[j.status] = (counts[j.status] ?? 0) + 1;

    return NextResponse.json({
      total,
      page,
      pageSize,
      counts,
      jobs: rows.map((j) => ({
        ...j,
        technician: j.assignments[0]?.technician ?? null,
        assignments: undefined,
      })),
    });
  } catch (e) {
    return handleApiError(e);
  }
}

// POST /api/jobs — staff create a direct job (complaint or maintenance)
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER"]);
    const orgId = ctx.organizationId!;
    const b = await req.json();
    const { customerId, installationId, title, description, type, priority, scheduledFor, technicianUserId } = b;
    if (!customerId || !title || !scheduledFor) throw new ApiError(400, "Customer, title and schedule date are required");
    const customer = await db.customer.findFirst({ where: { id: customerId, organizationId: orgId } });
    if (!customer) throw new ApiError(404, "Customer not found");
    if (installationId) {
      const inst = await db.installation.findFirst({ where: { id: installationId, organizationId: orgId, customerId } });
      if (!inst) throw new ApiError(400, "Selected installation does not belong to this customer");
    }
    const seq = (await db.serviceJob.count({ where: { organizationId: orgId } })) + 1;
    const job = await db.serviceJob.create({
      data: {
        organizationId: orgId,
        customerId,
        installationId: installationId ?? null,
        code: `JOB-${String(seq).padStart(4, "0")}`,
        title,
        description: description ?? null,
        type: type === "MAINTENANCE" ? "MAINTENANCE" : "COMPLAINT",
        priority: priority || "MEDIUM",
        status: "SCHEDULED",
        scheduledFor: new Date(scheduledFor),
        createdById: ctx.userId,
      },
    });
    await db.jobStatusEvent.create({ data: { organizationId: orgId, jobId: job.id, fromStatus: null, toStatus: "SCHEDULED", changedById: ctx.userId } });
    if (technicianUserId) {
      const techMember = await db.organizationMember.findFirst({ where: { organizationId: orgId, userId: technicianUserId, role: "TECHNICIAN", isActive: true } });
      if (!techMember) throw new ApiError(400, "Technician not found");
      await db.jobAssignment.create({ data: { organizationId: orgId, jobId: job.id, technicianUserId, assignedByUserId: ctx.userId } });
      await db.serviceJob.update({ where: { id: job.id }, data: { status: "ASSIGNED" } });
      await db.jobStatusEvent.create({ data: { organizationId: orgId, jobId: job.id, fromStatus: "SCHEDULED", toStatus: "ASSIGNED", changedById: ctx.userId, note: "Technician assigned" } });
    }
    await audit({ organizationId: orgId, actorUserId: ctx.userId, action: "JOB_CREATED", entityType: "JOB", entityId: job.id, detail: job.code });
    return NextResponse.json({ job });
  } catch (e) {
    return handleApiError(e);
  }
}
