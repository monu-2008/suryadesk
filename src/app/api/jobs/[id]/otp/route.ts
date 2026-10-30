// Proof-of-Service OTP.
// POST → issue a challenge (hashed, expiring, rate-limited).
// PUT  → verify the code the customer read out; completes the job and
//        marks the report as customer-acknowledged.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, ApiError, handleApiError } from "@/lib/surya/auth";
import { issueOtp, verifyOtp } from "@/lib/surya/otp";
import { sendSms } from "@/lib/surya/notify";
import { audit, notify, notifyRoles } from "@/lib/surya/notify";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req, ["TECHNICIAN", "MANAGER", "OWNER"]);
    const { id } = await params;
    const orgId = ctx.organizationId!;
    const job = await db.serviceJob.findFirst({ where: { id, organizationId: orgId }, include: { customer: true, report: true } });
    if (!job) throw new ApiError(404, "Job not found");
    if (ctx.orgRole === "TECHNICIAN") {
      const assigned = await db.jobAssignment.findFirst({ where: { organizationId: orgId, jobId: id, technicianUserId: ctx.userId, active: true } });
      if (!assigned) throw new ApiError(403, "This job is not assigned to you");
    }
    if (!job.report) throw new ApiError(400, "Submit the service report before requesting customer acknowledgement");
    if (!["WORK_SUBMITTED", "AWAITING_CUSTOMER"].includes(job.status)) {
      throw new ApiError(400, "OTP confirmation is available once the report is submitted");
    }
    const result = await issueOtp(orgId, id, job.customer.phone, sendSms);
    if (job.status === "WORK_SUBMITTED") {
      await db.serviceJob.update({ where: { id }, data: { status: "AWAITING_CUSTOMER" } });
      await db.jobStatusEvent.create({ data: { organizationId: orgId, jobId: id, fromStatus: job.status, toStatus: "AWAITING_CUSTOMER", changedById: ctx.userId, note: "OTP requested" } });
    }
    return NextResponse.json({
      ok: true,
      expiresAt: result.expiresAt,
      attemptsLeft: result.attemptsLeft,
      smsMode: result.sms.mode, // "TEST" when no SMS provider is configured
      demoCode: result.demoCode, // only non-null in test mode
      message:
        result.sms.delivered
          ? "OTP sent to the customer via SMS."
          : "Test SMS mode — no SMS provider is configured in this environment. The code is shown below (demo only).",
    });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req, ["TECHNICIAN", "MANAGER", "OWNER"]);
    const { id } = await params;
    const orgId = ctx.organizationId!;
    const { code } = await req.json();
    if (!code || !/^\d{6}$/.test(String(code).trim())) throw new ApiError(400, "Enter the 6-digit code");
    const job = await db.serviceJob.findFirst({ where: { id, organizationId: orgId }, include: { customer: true, report: true } });
    if (!job) throw new ApiError(404, "Job not found");
    if (ctx.orgRole === "TECHNICIAN") {
      const assigned = await db.jobAssignment.findFirst({ where: { organizationId: orgId, jobId: id, technicianUserId: ctx.userId, active: true } });
      if (!assigned) throw new ApiError(403, "This job is not assigned to you");
    }
    if (job.status === "COMPLETED") throw new ApiError(400, "This job is already confirmed and completed");

    const result = await verifyOtp(orgId, id, String(code));

    const now = new Date();
    await db.serviceReport.update({
      where: { jobId: id },
      data: { acknowledgedByOtp: true, acknowledgedAt: now },
    });
    await db.serviceJob.update({ where: { id }, data: { status: "COMPLETED", completedAt: now } });
    await db.jobStatusEvent.create({
      data: { organizationId: orgId, jobId: id, fromStatus: job.status, toStatus: "COMPLETED", changedById: ctx.userId, note: "Customer OTP acknowledgement verified" },
    });
    // AMC visit usage
    if (job.maintenanceOccurrenceId) {
      const occ = await db.maintenanceOccurrence.findUnique({ where: { id: job.maintenanceOccurrenceId } });
      if (occ) {
        await db.maintenanceOccurrence.update({ where: { id: occ.id }, data: { status: "COMPLETED", completedAt: now, notes: "Completed via service job with OTP acknowledgement." } });
        const plan = await db.maintenancePlan.findUnique({ where: { id: occ.planId }, include: { amcContract: true } });
        if (plan?.amcContractId) {
          const amc = await db.amcContract.findUnique({ where: { id: plan.amcContractId } });
          if (amc) await db.amcContract.update({ where: { id: amc.id }, data: { visitsUsed: amc.visitsUsed + 1 } });
        }
      }
    }
    await audit({ organizationId: orgId, actorUserId: ctx.userId, action: "OTP_VERIFIED", entityType: "JOB", entityId: id, detail: `${job.code} acknowledged by customer OTP` });
    if (job.customer.userId) {
      await notify({ organizationId: orgId, userId: job.customer.userId, kind: "CUSTOMER_ACK", title: `Service confirmed — ${job.code}`, body: "Thank you for confirming the service. The final report is in your portal.", entityType: "JOB", entityId: id });
    }
    await notifyRoles(orgId, ["OWNER", "MANAGER"], { kind: "JOB_STATUS", title: `${job.code} completed`, body: "Customer OTP acknowledgement verified.", entityType: "JOB", entityId: id });
    return NextResponse.json({ ok: true, message: "Customer acknowledgement verified. Job completed." });
  } catch (e) {
    return handleApiError(e);
  }
}
