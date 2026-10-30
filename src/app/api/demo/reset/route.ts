// Demo data reset — restricted to the designated demo organizations only.
// Never touches non-demo organizations.
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, ApiError, handleApiError } from "@/lib/surya/auth";
import { resetDemoOrganizations } from "@/lib/surya/seed";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    if (process.env.DEMO_MODE !== "true") throw new ApiError(403, "Demo reset is disabled outside demo mode");
    const ctx = await requireAuth(req, ["OWNER", "MANAGER"]);
    const org = await db.organization.findFirst({ where: { id: ctx.organizationId!, isDemo: true } });
    if (!org) throw new ApiError(403, "Reset is only available for the designated demo organization");
    const { confirm } = await req.json();
    if (confirm !== "RESET DEMO DATA") throw new ApiError(400, 'Type "RESET DEMO DATA" to confirm');
    const result = await resetDemoOrganizations();
    return NextResponse.json({ ...result, message: "Demo organization data was reset and reseeded. Your session is still valid — please reload." });
  } catch (e) {
    return handleApiError(e);
  }
}
