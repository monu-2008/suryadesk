// Maintenance occurrence actions: reschedule + create service job.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, ApiError, handleApiError } from "@/lib/surya/auth";
import { audit, notify } from "@/lib/surya/notify";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER"]);
    const { id } = await params;
    const orgId = ctx.organizationId!;
    const occ = await db.maintenanceOccurrence.findFirst({
      where: { id, organizationId: orgId },
      include: { installation: true, plan: true },
    });
    if (!occ) throw new ApiError(404, "Maintenance visit not found");
    const b = await req.json();

    if (b.action === "reschedule") {
      if (!b.newDate) throw new ApiError(400, "A new date is required");
      if (occ.status === "COMPLETED") throw new ApiError(400, "Completed visits cannot be rescheduled");
      await db.maintenanceOccurrence.update({
        where: { id },
        data: {
          dueDate: new Date(b.newDate),
          rescheduledFrom: occ.rescheduledFrom ?? occ.dueDate,
          status: "RESCHEDULED",
          notes: b.note ?? occ.notes,
        },
      });
      await audit({ organizationId: orgId, actorUserId: ctx.userId, action: "MAINTENANCE_RESCHEDULED", entityType: "MAINTENANCE", entityId: id, detail: `New date ${new Date(b.newDate).toLocaleDateString("en-IN")}` });
      return NextResponse.json({ ok: true, message: "Visit rescheduled" });
    }

    if (b.action === "create_job") {
      if (occ.jobId) throw new ApiError(400, "A service job already exists for this visit");
      if (occ.status === "COMPLETED") throw new ApiError(400, "This visit is already completed");
      const scheduledFor = b.scheduledFor ? new Date(b.scheduledFor) : occ.dueDate;
      const seq = (await db.serviceJob.count({ where: { organizationId: orgId } })) + 1;
      const job = await db.serviceJob.create({
        data: {
          organizationId: orgId,
          maintenanceOccurrenceId: occ.id,
          customerId: occ.installation.customerId,
          installationId: occ.installationId,
          code: `JOB-${String(seq).padStart(4, "0")}`,
          title: "Preventive maintenance visit",
          description: `Scheduled maintenance for ${occ.installation.assetCode} (${occ.plan.name}).`,
          type: "MAINTENANCE",
          priority: "MEDIUM",
          status: "SCHEDULED",
          scheduledFor,
          createdById: ctx.userId,
        },
      });
      await db.maintenanceOccurrence.update({ where: { id }, data: { jobId: job.id } });
      await db.jobStatusEvent.create({ data: { organizationId: orgId, jobId: job.id, fromStatus: null, toStatus: "SCHEDULED", changedById: ctx.userId, note: "Created from maintenance schedule" } });
      if (b.technicianUserId) {
        const techMember = await db.organizationMember.findFirst({
          where: { organizationId: orgId, userId: b.technicianUserId, role: "TECHNICIAN", isActive: true },
        });
        if (!techMember) throw new ApiError(400, "Technician not found in this organization");
        await db.jobAssignment.create({ data: { organizationId: orgId, jobId: job.id, technicianUserId: b.technicianUserId, assignedByUserId: ctx.userId } });
        await db.serviceJob.update({ where: { id: job.id }, data: { status: "ASSIGNED" } });
        await db.jobStatusEvent.create({ data: { organizationId: orgId, jobId: job.id, fromStatus: "SCHEDULED", toStatus: "ASSIGNED", changedById: ctx.userId, note: "Technician assigned" } });
        await notify({ organizationId: orgId, userId: b.technicianUserId, kind: "JOB_ASSIGNED", title: "New job assigned", body: `Maintenance visit ${job.code} on ${scheduledFor.toLocaleDateString("en-IN")}`, entityType: "JOB", entityId: job.id });
      }
      await audit({ organizationId: orgId, actorUserId: ctx.userId, action: "JOB_CREATED_FROM_MAINTENANCE", entityType: "JOB", entityId: job.id, detail: job.code });
      return NextResponse.json({ job });
    }

    throw new ApiError(400, "Unknown action");
  } catch (e) {
    return handleApiError(e);
  }
}
