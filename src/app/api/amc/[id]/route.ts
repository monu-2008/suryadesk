import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, ApiError, handleApiError } from "@/lib/surya/auth";
import { audit } from "@/lib/surya/notify";

// GET /api/amc/[id]
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER"]);
    const { id } = await params;
    const contract = await db.amcContract.findFirst({
      where: { id, organizationId: ctx.organizationId! },
      include: {
        customer: { select: { id: true, name: true, city: true, phone: true } },
        installation: { select: { id: true, assetCode: true, capacityKw: true, siteAddress: true } },
        plans: { include: { occurrences: { orderBy: { dueDate: "desc" }, take: 5 } } },
      },
    });
    if (!contract) throw new ApiError(404, "Contract not found");
    return NextResponse.json({ contract });
  } catch (e) {
    return handleApiError(e);
  }
}

// PATCH /api/amc/[id] — renew / cancel / update
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER"]);
    const { id } = await params;
    const existing = await db.amcContract.findFirst({ where: { id, organizationId: ctx.organizationId! } });
    if (!existing) throw new ApiError(404, "Contract not found");
    const b = await req.json();
    const data: Record<string, unknown> = {};
    if (b.action === "renew" && b.endDate) {
      data.endDate = new Date(b.endDate);
      data.status = "ACTIVE";
      data.visitsUsed = 0;
      // reactivate + extend plan
      const plan = await db.maintenancePlan.findFirst({ where: { amcContractId: id } });
      if (plan) await db.maintenancePlan.update({ where: { id: plan.id }, data: { active: true, startDate: new Date() } });
    } else if (b.action === "cancel") {
      data.status = "CANCELLED";
      const plan = await db.maintenancePlan.findFirst({ where: { amcContractId: id } });
      if (plan) await db.maintenancePlan.update({ where: { id: plan.id }, data: { active: false } });
    } else if (b.action === "mark_renewal_pending") {
      data.status = "RENEWAL_PENDING";
    }
    if (b.price !== undefined) data.price = parseFloat(b.price);
    const contract = await db.amcContract.update({ where: { id }, data });
    await audit({ organizationId: ctx.organizationId!, actorUserId: ctx.userId, action: `AMC_${(b.action ?? "UPDATED").toUpperCase()}`, entityType: "AMC", entityId: id, detail: contract.contractCode });
    return NextResponse.json({ contract });
  } catch (e) {
    return handleApiError(e);
  }
}
