// Audit trail — owner only.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, handleApiError } from "@/lib/surya/auth";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req, ["OWNER"]);
    const events = await db.auditEvent.findMany({
      where: { organizationId: ctx.organizationId! },
      include: { actor: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ events });
  } catch (e) {
    return handleApiError(e);
  }
}
