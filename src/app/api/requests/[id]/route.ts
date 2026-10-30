// Request review workflow: review → approve/reject → convert to job → close.
// Convert creates a ServiceJob (+ optional technician assignment).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, ApiError, handleApiError } from "@/lib/surya/auth";
import { audit, notify, notifyRoles } from "@/lib/surya/notify";

const ALLOWED = ["NEW", "UNDER_REVIEW", "APPROVED", "CONVERTED", "REJECTED", "CLOSED"];

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER", "CUSTOMER"]);
    const { id } = await params;
    const request = await db.serviceRequest.findFirst({
      where: { id, organizationId: ctx.organizationId!, ...(ctx.orgRole === "CUSTOMER" ? { customerId: ctx.customerId! } : {}) },
      include: {
        customer: { select: { id: true, name: true, phone: true, email: true, city: true } },
        installation: true,
        jobs: { include: { report: true, assignments: { include: { technician: { select: { name: true } } } } } },
      },
    });
    if (!request) throw new ApiError(404, "Request not found");
    return NextResponse.json({ request });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER"]);
    const { id } = await params;
    const orgId = ctx.organizationId!;
    const request = await db.serviceRequest.findFirst({ where: { id, organizationId: orgId }, include: { customer: true } });
    if (!request) throw new ApiError(404, "Request not found");
    const b = await req.json();
    const action = b.action as string;

    if (action === "review") {
      await db.serviceRequest.update({ where: { id }, data: { status: "UNDER_REVIEW", reviewNotes: b.reviewNotes ?? request.reviewNotes, reviewedById: ctx.userId } });
      await notify({ organizationId: orgId, userId: request.customer.userId ?? "", kind: "JOB_STATUS", title: `Request ${request.code} is under review`, body: "Our team is reviewing your request.", entityType: "REQUEST", entityId: id }).catch(() => {});
      return NextResponse.json({ ok: true, message: "Request moved to review" });
    }

    if (action === "set_priority") {
      if (!["LOW", "MEDIUM", "HIGH", "URGENT"].includes(b.priority)) throw new ApiError(400, "Invalid priority");
      await db.serviceRequest.update({ where: { id }, data: { priority: b.priority } });
      await audit({ organizationId: orgId, actorUserId: ctx.userId, action: "REQUEST_PRIORITY_CHANGED", entityType: "REQUEST", entityId: id, detail: `${request.code} → ${b.priority}` });
      return NextResponse.json({ ok: true, message: `Priority set to ${b.priority}` });
    }

    if (action === "approve") {
      await db.serviceRequest.update({ where: { id }, data: { status: "APPROVED", reviewNotes: b.reviewNotes ?? request.reviewNotes, reviewedById: ctx.userId } });
      await audit({ organizationId: orgId, actorUserId: ctx.userId, action: "REQUEST_APPROVED", entityType: "REQUEST", entityId: id, detail: request.code });
      return NextResponse.json({ ok: true, message: "Request approved" });
    }

    if (action === "reject") {
      await db.serviceRequest.update({ where: { id }, data: { status: "REJECTED", reviewNotes: b.reviewNotes || "Rejected after review.", reviewedById: ctx.userId } });
      await audit({ organizationId: orgId, actorUserId: ctx.userId, action: "REQUEST_REJECTED", entityType: "REQUEST", entityId: id, detail: request.code });
      return NextResponse.json({ ok: true, message: "Request rejected" });
    }

    if (action === "close") {
      await db.serviceRequest.update({ where: { id }, data: { status: "CLOSED", reviewNotes: b.reviewNotes ?? request.reviewNotes } });
      return NextResponse.json({ ok: true, message: "Request closed" });
    }

    if (action === "convert") {
      if (!b.scheduledFor) throw new ApiError(400, "A scheduled date is required");
      if (request.status === "CONVERTED") throw new ApiError(400, "This request has already been converted");
      const seq = (await db.serviceJob.count({ where: { organizationId: orgId } })) + 1;
      const job = await db.serviceJob.create({
        data: {
          organizationId: orgId,
          requestId: id,
          customerId: request.customerId,
          installationId: request.installationId ?? (b.installationId || null),
          code: `JOB-${String(seq).padStart(4, "0")}`,
          title: `${request.category.charAt(0) + request.category.slice(1).toLowerCase()} service — ${request.code}`,
          description: request.description,
          type: "COMPLAINT",
          priority: b.priority || request.priority,
          status: "SCHEDULED",
          scheduledFor: new Date(b.scheduledFor),
          createdById: ctx.userId,
        },
      });
      await db.serviceRequest.update({ where: { id }, data: { status: "CONVERTED" } });
      await db.jobStatusEvent.create({ data: { organizationId: orgId, jobId: job.id, fromStatus: null, toStatus: "SCHEDULED", changedById: ctx.userId, note: `Created from ${request.code}` } });
      if (b.technicianUserId) {
        const techMember = await db.organizationMember.findFirst({ where: { organizationId: orgId, userId: b.technicianUserId, role: "TECHNICIAN", isActive: true } });
        if (!techMember) throw new ApiError(400, "Technician not found in this organization");
        await db.jobAssignment.create({ data: { organizationId: orgId, jobId: job.id, technicianUserId: b.technicianUserId, assignedByUserId: ctx.userId } });
        await db.serviceJob.update({ where: { id: job.id }, data: { status: "ASSIGNED" } });
        await db.jobStatusEvent.create({ data: { organizationId: orgId, jobId: job.id, fromStatus: "SCHEDULED", toStatus: "ASSIGNED", changedById: ctx.userId, note: "Technician assigned" } });
        await notify({ organizationId: orgId, userId: b.technicianUserId, kind: "JOB_ASSIGNED", title: `New job assigned — ${job.code}`, body: `Scheduled for ${new Date(b.scheduledFor).toLocaleDateString("en-IN")}`, entityType: "JOB", entityId: job.id });
      }
      await audit({ organizationId: orgId, actorUserId: ctx.userId, action: "REQUEST_CONVERTED", entityType: "JOB", entityId: job.id, detail: `${request.code} → ${job.code}` });
      await notifyRoles(orgId, ["OWNER", "MANAGER"], { kind: "JOB_STATUS", title: `${request.code} converted to ${job.code}`, entityType: "JOB", entityId: job.id });
      return NextResponse.json({ job, message: `Request converted to job ${job.code}` });
    }

    throw new ApiError(400, "Unknown action");
  } catch (e) {
    return handleApiError(e);
  }
}
