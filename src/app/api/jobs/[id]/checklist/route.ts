// Job checklist — technician saves item results (online or from offline sync).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, ApiError, handleApiError } from "@/lib/surya/auth";

async function assertTechAccess(orgId: string, jobId: string, userId: string) {
  const job = await db.serviceJob.findFirst({ where: { id: jobId, organizationId: orgId } });
  if (!job) throw new ApiError(404, "Job not found");
  const assigned = await db.jobAssignment.findFirst({ where: { organizationId: orgId, jobId, technicianUserId: userId, active: true } });
  if (!assigned) throw new ApiError(403, "This job is not assigned to you");
  return job;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req, ["TECHNICIAN", "MANAGER", "OWNER"]);
    const { id } = await params;
    const job = await assertTechAccess(ctx.organizationId!, id, ctx.userId);
    if (["COMPLETED", "CANCELLED"].includes(job.status)) throw new ApiError(400, "This job is already closed");
    const { items } = await req.json();
    if (!Array.isArray(items)) throw new ApiError(400, "Checklist items are required");
    await db.jobChecklistResult.deleteMany({ where: { organizationId: ctx.organizationId!, jobId: id } });
    for (const item of items) {
      await db.jobChecklistResult.create({
        data: {
          organizationId: ctx.organizationId!,
          jobId: id,
          itemLabel: String(item.label),
          itemKind: item.kind === "TEXT" ? "TEXT" : "BOOLEAN",
          value: String(item.value ?? (item.kind === "TEXT" ? "" : "false")),
        },
      });
    }
    return NextResponse.json({ ok: true, saved: items.length });
  } catch (e) {
    return handleApiError(e);
  }
}
