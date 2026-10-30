// Private attachment access — authorization checked per role, then the
// stored data URL is streamed. Attachments never get public URLs.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, ApiError, handleApiError } from "@/lib/surya/auth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    const { id } = await params;
    const att = await db.serviceAttachment.findFirst({ where: { id, organizationId: ctx.organizationId! }, include: { job: true } });
    if (!att) throw new ApiError(404, "Attachment not found");
    if (ctx.orgRole === "CUSTOMER") {
      if (!att.job || att.job.customerId !== ctx.customerId) throw new ApiError(403, "No access to this attachment");
    } else if (ctx.orgRole === "TECHNICIAN") {
      if (att.job) {
        const assigned = await db.jobAssignment.findFirst({ where: { organizationId: ctx.organizationId!, jobId: att.job.id, technicianUserId: ctx.userId, active: true } });
        if (!assigned) throw new ApiError(403, "No access to this attachment");
      }
    }
    const base64 = att.dataUrl.split(",")[1] ?? "";
    const buffer = Buffer.from(base64, "base64");
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": att.mimeType,
        "Cache-Control": "private, max-age=60",
        "Content-Disposition": `inline; filename="${att.fileName}"`,
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
