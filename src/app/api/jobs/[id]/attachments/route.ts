// Service photographs — private attachments stored as data URLs, served only
// through the authorized attachment endpoint (never public URLs).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, ApiError, handleApiError } from "@/lib/surya/auth";

const MAX_BYTES = 4 * 1024 * 1024; // 4 MB
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req, ["TECHNICIAN", "MANAGER", "OWNER"]);
    const { id } = await params;
    const job = await db.serviceJob.findFirst({ where: { id, organizationId: ctx.organizationId! } });
    if (!job) throw new ApiError(404, "Job not found");
    if (ctx.orgRole === "TECHNICIAN") {
      const assigned = await db.jobAssignment.findFirst({ where: { organizationId: ctx.organizationId!, jobId: id, technicianUserId: ctx.userId, active: true } });
      if (!assigned) throw new ApiError(403, "This job is not assigned to you");
    }
    if (["COMPLETED", "CANCELLED"].includes(job.status) && ctx.orgRole === "TECHNICIAN") {
      throw new ApiError(400, "This job is already closed");
    }
    const { dataUrl, fileName, mimeType, caption } = await req.json();
    if (!dataUrl || !String(dataUrl).startsWith("data:")) throw new ApiError(400, "A valid image is required");
    if (!ALLOWED_MIME.includes(mimeType)) throw new ApiError(400, "Only JPEG, PNG, WebP or SVG images are allowed");
    const sizeBytes = Math.round((String(dataUrl).length * 3) / 4);
    if (sizeBytes > MAX_BYTES) throw new ApiError(400, "Image is too large (max 4 MB)");

    const attachment = await db.serviceAttachment.create({
      data: {
        organizationId: ctx.organizationId!,
        jobId: id,
        kind: "PHOTO",
        fileName: fileName || "photo",
        mimeType,
        sizeBytes,
        dataUrl,
        caption: caption ?? null,
        uploadedById: ctx.userId,
      },
    });
    return NextResponse.json({ attachment: { id: attachment.id, fileName: attachment.fileName, caption: attachment.caption, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes, createdAt: attachment.createdAt } });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    const { id } = await params;
    const job = await db.serviceJob.findFirst({ where: { id, organizationId: ctx.organizationId! } });
    if (!job) throw new ApiError(404, "Job not found");
    if (ctx.orgRole === "CUSTOMER" && job.customerId !== ctx.customerId) throw new ApiError(403, "No access");
    if (ctx.orgRole === "TECHNICIAN") {
      const assigned = await db.jobAssignment.findFirst({ where: { organizationId: ctx.organizationId!, jobId: id, technicianUserId: ctx.userId, active: true } });
      if (!assigned) throw new ApiError(403, "No access");
    }
    const attachments = await db.serviceAttachment.findMany({
      where: { organizationId: ctx.organizationId!, jobId: id },
      select: { id: true, fileName: true, caption: true, mimeType: true, sizeBytes: true, createdAt: true },
    });
    return NextResponse.json({ attachments });
  } catch (e) {
    return handleApiError(e);
  }
}
