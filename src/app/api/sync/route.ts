// Offline sync — technician submissions queued in IndexedDB are replayed here.
// Idempotency keys prevent duplicate application of the same submission.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, ApiError, handleApiError } from "@/lib/surya/auth";

interface QueuedItem {
  kind: "checklist" | "photo" | "submit" | "start";
  jobId: string;
  idempotencyKey?: string;
  payload: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req, ["TECHNICIAN"]);
    const orgId = ctx.organizationId!;
    const { items } = (await req.json()) as { items: QueuedItem[] };
    if (!Array.isArray(items) || !items.length) throw new ApiError(400, "No queued items supplied");

    const results: { idempotencyKey: string; status: "APPLIED" | "DUPLICATE" | "REJECTED"; message: string }[] = [];

    for (const item of items) {
      const key = item.idempotencyKey ?? `${item.kind}:${item.jobId}:${ctx.userId}:${Date.now()}`;
      // server-side assignment validation
      const job = await db.serviceJob.findFirst({ where: { id: item.jobId, organizationId: orgId } });
      if (!job) {
        results.push({ idempotencyKey: key, status: "REJECTED", message: "Job not found (may have been removed)" });
        continue;
      }
      const assigned = await db.jobAssignment.findFirst({ where: { organizationId: orgId, jobId: item.jobId, technicianUserId: ctx.userId, active: true } });
      if (!assigned) {
        results.push({ idempotencyKey: key, status: "REJECTED", message: "Server-side assignment check failed" });
        continue;
      }
      const existing = await db.syncOperation.findUnique({ where: { idempotencyKey: key } });
      if (existing && existing.status === "APPLIED") {
        results.push({ idempotencyKey: key, status: "DUPLICATE", message: "Already synced earlier" });
        continue;
      }
      if (!existing) {
        await db.syncOperation.create({ data: { organizationId: orgId, jobId: item.jobId, technicianUserId: ctx.userId, idempotencyKey: key, payload: JSON.stringify(item.kind), status: "PENDING" } });
      }

      try {
        if (item.kind === "start") {
          if (job.status === "ASSIGNED") {
            await db.serviceJob.update({ where: { id: job.id }, data: { status: "IN_PROGRESS", startedAt: new Date() } });
            await db.jobStatusEvent.create({ data: { organizationId: orgId, jobId: job.id, fromStatus: job.status, toStatus: "IN_PROGRESS", changedById: ctx.userId, note: "Visit started (synced from offline draft)" } });
          }
          results.push({ idempotencyKey: key, status: "APPLIED", message: "Visit started" });
        } else if (item.kind === "checklist") {
          const itemsList = (item.payload.items as { label: string; kind: string; value: string }[]) ?? [];
          await db.jobChecklistResult.deleteMany({ where: { organizationId: orgId, jobId: job.id } });
          for (const ci of itemsList) {
            await db.jobChecklistResult.create({ data: { organizationId: orgId, jobId: job.id, itemLabel: ci.label, itemKind: ci.kind, value: String(ci.value ?? "") } });
          }
          results.push({ idempotencyKey: key, status: "APPLIED", message: "Checklist saved" });
        } else if (item.kind === "photo") {
          const { dataUrl, fileName, mimeType, caption } = item.payload as { dataUrl: string; fileName: string; mimeType: string; caption?: string };
          if (dataUrl && String(dataUrl).startsWith("data:image/")) {
            await db.serviceAttachment.create({
              data: { organizationId: orgId, jobId: job.id, kind: "PHOTO", fileName: fileName || "photo.jpg", mimeType: mimeType || "image/jpeg", sizeBytes: Math.round((dataUrl.length * 3) / 4), dataUrl, caption: caption ?? null, uploadedById: ctx.userId },
            });
            results.push({ idempotencyKey: key, status: "APPLIED", message: "Photo uploaded" });
          } else {
            results.push({ idempotencyKey: key, status: "REJECTED", message: "Invalid image payload" });
          }
        } else if (item.kind === "submit") {
          const { notes, summary, followUpNeeded, followUpNotes, checklist } = item.payload as Record<string, never>;
          if (!notes || String(notes).trim().length < 10) {
            results.push({ idempotencyKey: key, status: "REJECTED", message: "Notes too short" });
          } else {
            const report = await db.serviceReport.findUnique({ where: { jobId: job.id } });
            if (report) {
              await db.serviceReport.update({ where: { jobId: job.id }, data: { technicianNotes: String(notes), summary: String(summary ?? report.summary), followUpNeeded: Boolean(followUpNeeded), followUpNotes: (followUpNotes as string) ?? null } });
            } else {
              await db.serviceReport.create({
                data: { organizationId: orgId, jobId: job.id, customerId: job.customerId, technicianNotes: String(notes), summary: String(summary ?? "Service completed as per checklist."), followUpNeeded: Boolean(followUpNeeded), followUpNotes: (followUpNotes as string) ?? null, checklistJson: JSON.stringify(checklist ?? []) },
              });
            }
            if (!report) {
              if (Array.isArray(checklist)) {
                await db.jobChecklistResult.deleteMany({ where: { organizationId: orgId, jobId: job.id } });
                for (const ci of checklist as { label: string; kind: string; value: string }[]) {
                  await db.jobChecklistResult.create({ data: { organizationId: orgId, jobId: job.id, itemLabel: ci.label, itemKind: ci.kind, value: String(ci.value ?? "") } });
                }
              }
            }
            if (["ASSIGNED", "IN_PROGRESS", "NEEDS_REVIEW"].includes(job.status)) {
              await db.serviceJob.update({ where: { id: job.id }, data: { status: "WORK_SUBMITTED", submittedAt: new Date() } });
              await db.jobStatusEvent.create({ data: { organizationId: orgId, jobId: job.id, fromStatus: job.status, toStatus: "WORK_SUBMITTED", changedById: ctx.userId, note: "Service report submitted (offline sync)" } });
            }
            results.push({ idempotencyKey: key, status: "APPLIED", message: "Report submitted" });
          }
        } else {
          results.push({ idempotencyKey: key, status: "REJECTED", message: `Unknown item kind ${item.kind}` });
        }
        await db.syncOperation.updateMany({ where: { idempotencyKey: key }, data: { status: "APPLIED", appliedAt: new Date() } });
      } catch (err) {
        results.push({ idempotencyKey: key, status: "REJECTED", message: err instanceof Error ? err.message : "Failed" });
      }
    }
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    return handleApiError(e);
  }
}
