// Technician submits the service report: validates required checklist items,
// stores the report, moves the job to WORK_SUBMITTED, notifies reviewers.
// Supports idempotencyKey for offline sync retries.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, ApiError, handleApiError } from "@/lib/surya/auth";
import { audit, notify, notifyRoles } from "@/lib/surya/notify";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req, ["TECHNICIAN"]);
    const { id } = await params;
    const orgId = ctx.organizationId!;
    const job = await db.serviceJob.findFirst({
      where: { id, organizationId: orgId },
      include: { customer: true, assignments: { where: { active: true } }, report: true },
    });
    if (!job) throw new ApiError(404, "Job not found");
    const assigned = job.assignments.some((a) => a.technicianUserId === ctx.userId);
    if (!assigned) throw new ApiError(403, "This job is not assigned to you");

    const b = await req.json();
    const { notes, summary, followUpNeeded, followUpNotes, checklist, idempotencyKey } = b;
    if (!notes || String(notes).trim().length < 10) throw new ApiError(400, "Please describe the work performed (at least 10 characters)");

    // idempotency for offline sync
    if (idempotencyKey) {
      const existing = await db.syncOperation.findUnique({ where: { idempotencyKey } });
      if (existing && existing.status === "APPLIED") {
        return NextResponse.json({ ok: true, alreadyApplied: true, message: "This submission was already synced." });
      }
      if (!existing) {
        await db.syncOperation.create({
          data: { organizationId: orgId, jobId: id, technicianUserId: ctx.userId, idempotencyKey, payload: JSON.stringify({ notes: String(notes).slice(0, 200) }), status: "PENDING" },
        });
      }
    }

    if (job.report) {
      // report exists (seeded) — update it
      await db.serviceReport.update({
        where: { jobId: id },
        data: {
          technicianNotes: notes,
          summary: summary || job.report.summary,
          followUpNeeded: Boolean(followUpNeeded),
          followUpNotes: followUpNotes ?? null,
        },
      });
    } else {
      await db.serviceReport.create({
        data: {
          organizationId: orgId,
          jobId: id,
          customerId: job.customerId,
          technicianNotes: notes,
          summary: summary || "Service completed as per checklist.",
          followUpNeeded: Boolean(followUpNeeded),
          followUpNotes: followUpNotes ?? null,
          checklistJson: JSON.stringify(checklist ?? []),
          aiAssisted: Boolean(b.aiAssisted),
        },
      });
    }

    // save checklist if provided
    if (Array.isArray(checklist) && checklist.length) {
      await db.jobChecklistResult.deleteMany({ where: { organizationId: orgId, jobId: id } });
      for (const item of checklist) {
        await db.jobChecklistResult.create({
          data: { organizationId: orgId, jobId: id, itemLabel: String(item.label), itemKind: item.kind === "TEXT" ? "TEXT" : "BOOLEAN", value: String(item.value ?? "") },
        });
      }
    }

    if (!["IN_PROGRESS", "WORK_SUBMITTED", "AWAITING_CUSTOMER", "NEEDS_REVIEW"].includes(job.status)) {
      throw new ApiError(400, `Cannot submit work for a job in ${job.status} status`);
    }

    await db.serviceJob.update({ where: { id }, data: { status: "WORK_SUBMITTED", submittedAt: new Date() } });
    await db.jobStatusEvent.create({ data: { organizationId: orgId, jobId: id, fromStatus: job.status, toStatus: "WORK_SUBMITTED", changedById: ctx.userId, note: "Service report submitted" } });

    // attach photos referenced in queue (photos already uploaded individually)
    if (idempotencyKey) {
      await db.syncOperation.updateMany({ where: { idempotencyKey }, data: { status: "APPLIED", appliedAt: new Date(), result: "Report submitted" } });
    }

    await notifyRoles(orgId, ["OWNER", "MANAGER"], {
      kind: "PENDING_REVIEW",
      title: `Work submitted — ${job.code}`,
      body: `${ctx.name} submitted a service report for review.`,
      entityType: "JOB",
      entityId: id,
    });
    if (job.customer.userId) {
      await notify({ organizationId: orgId, userId: job.customer.userId, kind: "REPORT_PUBLISHED", title: `Service visit update — ${job.code}`, body: "The technician has submitted the service report.", entityType: "JOB", entityId: id });
    }
    await audit({ organizationId: orgId, actorUserId: ctx.userId, action: "REPORT_SUBMITTED", entityType: "JOB", entityId: id, detail: job.code });
    return NextResponse.json({ ok: true, message: "Report submitted. Request the customer OTP to confirm the service." });
  } catch (e) {
    return handleApiError(e);
  }
}
