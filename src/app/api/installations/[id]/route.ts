import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, ApiError, handleApiError } from "@/lib/surya/auth";

// GET /api/installations/[id] — asset detail with all related records
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER", "TECHNICIAN"]);
    const { id } = await params;
    const installation = await db.installation.findFirst({
      where: { id, organizationId: ctx.organizationId! },
      include: {
        customer: { select: { id: true, name: true, phone: true, email: true, city: true, address: true } },
        equipment: true,
        warranties: { orderBy: { endDate: "asc" } },
        amcContracts: { orderBy: { endDate: "desc" } },
        plans: { include: { occurrences: { orderBy: { dueDate: "desc" }, take: 3 } } },
        requests: { orderBy: { createdAt: "desc" }, take: 10 },
        jobs: { include: { report: { select: { id: true } } }, orderBy: { scheduledFor: "desc" }, take: 10 },
      },
    });
    if (!installation) throw new ApiError(404, "Installation not found");
    return NextResponse.json({ installation });
  } catch (e) {
    return handleApiError(e);
  }
}

// PATCH /api/installations/[id]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER"]);
    const { id } = await params;
    const existing = await db.installation.findFirst({ where: { id, organizationId: ctx.organizationId! } });
    if (!existing) throw new ApiError(404, "Installation not found");
    const b = await req.json();
    const installation = await db.installation.update({
      where: { id },
      data: {
        ...(b.siteAddress ? { siteAddress: b.siteAddress } : {}),
        ...(b.city ? { city: b.city } : {}),
        ...(b.capacityKw ? { capacityKw: parseFloat(b.capacityKw) } : {}),
        ...(b.status ? { status: b.status } : {}),
        ...(b.panelMake ? { panelMake: b.panelMake } : {}),
        ...(b.panelModel ? { panelModel: b.panelModel } : {}),
        ...(b.inverterMake ? { inverterMake: b.inverterMake } : {}),
        ...(b.inverterModel ? { inverterModel: b.inverterModel } : {}),
        ...(b.serialNumber ? { serialNumber: b.serialNumber } : {}),
        ...(b.notes !== undefined ? { notes: b.notes } : {}),
      },
    });
    return NextResponse.json({ installation });
  } catch (e) {
    return handleApiError(e);
  }
}
