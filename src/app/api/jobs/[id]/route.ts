// Job detail + management actions (assign/reassign/reschedule/start/cancel/
// manager completion approval). Enforces role-scoped access on every read.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, ApiError, handleApiError } from "@/lib/surya/auth";
import { audit, notify } from "@/lib/surya/notify";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    const { id } = await params;
    const job = await db.serviceJob.findFirst({
      where: { id, organizationId: ctx.organizationId! },
      include: {
        customer: true,
        installation: { include: { equipment: true, warranties: true, amcContracts: { orderBy: { endDate: "desc" } } } },
        assignments: { where: { active: true }, include: { technician: { select: { id: true, name: true, phone: true } } } },
        request: true,
        report: true,
        statusEvents: { orderBy: { createdAt: "asc" } },
        attachments: { select: { id: true, fileName: true, caption: true, mimeType: true, createdAt: true, sizeBytes: true } },
      },
    });
    if (!job) throw new ApiError(404, "Job not found");
    // linked maintenance occurrence (plain FK, no relation)
    const occurrence = job.maintenanceOccurrenceId
      ? await db.maintenanceOccurrence.findFirst({ where: { id: job.maintenanceOccurrenceId, organizationId: ctx.organizationId! } })
      : null;
    // access control
    if (ctx.orgRole === "CUSTOMER" && job.customerId !== ctx.customerId) throw new ApiError(403, "You do not have access to this job");
    if (ctx.orgRole === "TECHNICIAN" && !job.assignments.some((a) => a.technicianUserId === ctx.userId)) {
      throw new ApiError(403, "This job is not assigned to you");
    }
    // checklist template + saved results
    const template = await db.checklistTemplate.findFirst({
      where: { organizationId: ctx.organizationId!, kind: job.type === "MAINTENANCE" ? "MAINTENANCE" : "COMPLAINT" },
    });
    const results = await db.jobChecklistResult.findMany({ where: { organizationId: ctx.organizationId!, jobId: id } });
    return NextResponse.json({
      job: {
        ...job,
        technician: job.assignments[0]?.technician ?? null,
        assignments: undefined,
        checklistTemplate: template ? { id: template.id, name: template.name, items: JSON.parse(template.items) } : null,
        checklistResults: results,
        maintenanceOccurrence: occurrence,
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER", "TECHNICIAN"]);
    const { id } = await params;
    const orgId = ctx.organizationId!;
    const job = await db.serviceJob.findFirst({ where: { id, organizationId: orgId }, include: { customer: true, assignments: { where: { active: true } } } });
    if (!job) throw new ApiError(404, "Job not found");
    const b = await req.json();
    const action = b.action as string;

    // Technician self-service: start visit (only for own assigned jobs)
    if (action === "start") {
      if (ctx.orgRole !== "TECHNICIAN") throw new ApiError(403, "Only the assigned technician can start the visit");
      if (!job.assignments.some((a) => a.technicianUserId === ctx.userId)) throw new ApiError(403, "This job is not assigned to you");
      if (job.status !== "ASSIGNED") throw new ApiError(400, `Cannot start a job in ${job.status} status`);
      await db.serviceJob.update({ where: { id }, data: { status: "IN_PROGRESS", startedAt: new Date() } });
      await db.jobStatusEvent.create({ data: { organizationId: orgId, jobId: id, fromStatus: job.status, toStatus: "IN_PROGRESS", changedById: ctx.userId, note: "Visit started" } });
      return NextResponse.json({ ok: true, message: "Visit started" });
    }

    if (ctx.orgRole === "TECHNICIAN") throw new ApiError(403, "You do not have permission to perform this action");

    const transition = async (toStatus: string, note?: string, actor?: string) => {
      await db.serviceJob.update({ where: { id }, data: { status: toStatus } });
      await db.jobStatusEvent.create({ data: { organizationId: orgId, jobId: id, fromStatus: job.status, toStatus, changedById: actor ?? ctx.userId, note: note ?? null } });
    };

    if (action === "assign" || action === "reassign") {
      if (!["SCHEDULED", "ASSIGNED"].includes(job.status)) throw new ApiError(400, `Cannot reassign a job in ${job.status} status`);
      if (!b.technicianUserId) throw new ApiError(400, "Technician is required");
      const techMember = await db.organizationMember.findFirst({ where: { organizationId: orgId, userId: b.technicianUserId, role: "TECHNICIAN", isActive: true } });
      if (!techMember) throw new ApiError(400, "Technician not found in this organization");
      if (job.assignments.length) {
        await db.jobAssignment.updateMany({ where: { jobId: id, active: true }, data: { active: false } });
      }
      await db.jobAssignment.create({ data: { organizationId: orgId, jobId: id, technicianUserId: b.technicianUserId, assignedByUserId: ctx.userId } });
      if (job.status === "SCHEDULED") await transition("ASSIGNED", "Technician assigned");
      await notify({ organizationId: orgId, userId: b.technicianUserId, kind: "JOB_ASSIGNED", title: `Job assigned — ${job.code}`, body: `Scheduled for ${new Date(job.scheduledFor).toLocaleDateString("en-IN")}`, entityType: "JOB", entityId: id });
      await audit({ organizationId: orgId, actorUserId: ctx.userId, action: action.toUpperCase(), entityType: "JOB", entityId: id, detail: job.code });
      return NextResponse.json({ ok: true, message: "Technician assigned" });
    }

    if (action === "reschedule") {
      if (!b.scheduledFor) throw new ApiError(400, "New date is required");
      if (["COMPLETED", "CANCELLED"].includes(job.status)) throw new ApiError(400, "Closed jobs cannot be rescheduled");
      await db.serviceJob.update({ where: { id }, data: { scheduledFor: new Date(b.scheduledFor) } });
      await db.jobStatusEvent.create({ data: { organizationId: orgId, jobId: id, fromStatus: job.status, toStatus: job.status, changedById: ctx.userId, note: `Rescheduled to ${new Date(b.scheduledFor).toLocaleDateString("en-IN")}` } });
      for (const a of job.assignments) {
        await notify({ organizationId: orgId, userId: a.technicianUserId, kind: "JOB_STATUS", title: `${job.code} rescheduled`, body: `New date: ${new Date(b.scheduledFor).toLocaleDateString("en-IN")}`, entityType: "JOB", entityId: id });
      }
      return NextResponse.json({ ok: true, message: "Job rescheduled" });
    }

    if (action === "cancel") {
      if (["COMPLETED", "CANCELLED"].includes(job.status)) throw new ApiError(400, "Job is already closed");
      await db.serviceJob.update({ where: { id }, data: { status: "CANCELLED", cancellationReason: b.reason || "Cancelled by service desk" } });
      await db.jobStatusEvent.create({ data: { organizationId: orgId, jobId: id, fromStatus: job.status, toStatus: "CANCELLED", changedById: ctx.userId, note: b.reason ?? null } });
      await audit({ organizationId: orgId, actorUserId: ctx.userId, action: "JOB_CANCELLED", entityType: "JOB", entityId: id, detail: job.code });
      return NextResponse.json({ ok: true, message: "Job cancelled" });
    }

    if (action === "approve_completion") {
      // Manager exception approval when OTP cannot be obtained — audited separately.
      if (!["WORK_SUBMITTED", "AWAITING_CUSTOMER", "NEEDS_REVIEW"].includes(job.status)) throw new ApiError(400, "Job is not awaiting review");
      await db.serviceJob.update({ where: { id }, data: { status: "COMPLETED", completedAt: new Date() } });
      await db.jobStatusEvent.create({ data: { organizationId: orgId, jobId: id, fromStatus: job.status, toStatus: "COMPLETED", changedById: ctx.userId, note: "Manager exception approval (customer OTP unavailable)" } });
      await audit({ organizationId: orgId, actorUserId: ctx.userId, action: "JOB_COMPLETED_MANAGER_APPROVAL", entityType: "JOB", entityId: id, detail: `${job.code} — exception approval` });
      if (job.customer.userId) {
        await notify({ organizationId: orgId, userId: job.customer.userId, kind: "REPORT_PUBLISHED", title: `Service completed — ${job.code}`, body: "Your service report is available in the portal.", entityType: "JOB", entityId: id });
      }
      return NextResponse.json({ ok: true, message: "Completion approved (manager exception)" });
    }

    if (action === "request_changes") {
      if (!["WORK_SUBMITTED", "NEEDS_REVIEW"].includes(job.status)) throw new ApiError(400, "Job is not in a reviewable state");
      await transition("NEEDS_REVIEW", b.note || "Manager requested changes");
      for (const a of job.assignments) {
        await notify({ organizationId: orgId, userId: a.technicianUserId, kind: "PENDING_REVIEW", title: `${job.code} needs attention`, body: b.note || "Manager requested changes.", entityType: "JOB", entityId: id });
      }
      return NextResponse.json({ ok: true, message: "Sent back to technician" });
    }

    throw new ApiError(400, "Unknown action");
  } catch (e) {
    return handleApiError(e);
  }
}
