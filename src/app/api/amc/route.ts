import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, ApiError, handleApiError } from "@/lib/surya/auth";
import { audit } from "@/lib/surya/notify";

// GET /api/amc?status=&search=&page=&pageSize=
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER"]);
    const orgId = ctx.organizationId!;
    const sp = req.nextUrl.searchParams;
    const search = sp.get("search")?.trim() ?? "";
    const status = sp.get("status") ?? "";
    const page = Math.max(1, parseInt(sp.get("page") ?? "1"));
    const pageSize = Math.min(50, Math.max(5, parseInt(sp.get("pageSize") ?? "10")));
    const where = {
      organizationId: orgId,
      ...(status ? { status } : {}),
      ...(search ? { OR: [{ contractCode: { contains: search } }, { customer: { name: { contains: search } } }, { installation: { assetCode: { contains: search } } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      db.amcContract.count({ where }),
      db.amcContract.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, city: true } },
          installation: { select: { id: true, assetCode: true, capacityKw: true } },
        },
        orderBy: { endDate: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return NextResponse.json({ total, page, pageSize, contracts: rows });
  } catch (e) {
    return handleApiError(e);
  }
}

// POST /api/amc — create contract
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER"]);
    const orgId = ctx.organizationId!;
    const b = await req.json();
    const { customerId, installationId, startDate, endDate, visitIntervalDays, coveredVisits, includedServices, excludedServices, emergencyTat, price } = b;
    if (!customerId || !installationId || !startDate || !endDate) throw new ApiError(400, "Customer, installation, start and end dates are required");
    const customer = await db.customer.findFirst({ where: { id: customerId, organizationId: orgId } });
    const installation = await db.installation.findFirst({ where: { id: installationId, organizationId: orgId } });
    if (!customer || !installation) throw new ApiError(404, "Customer or installation not found");
    const year = new Date(startDate).getFullYear();
    const seq = (await db.amcContract.count({ where: { organizationId: orgId } })) + 1;
    const contractCode = `AMC-${year}-${String(seq).padStart(4, "0")}`;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const daysLeft = Math.round((end.getTime() - Date.now()) / 86400000);
    const contract = await db.amcContract.create({
      data: {
        organizationId: orgId,
        customerId,
        installationId,
        contractCode,
        startDate: start,
        endDate: end,
        visitIntervalDays: parseInt(visitIntervalDays || "180"),
        coveredVisits: parseInt(coveredVisits || "2"),
        includedServices: JSON.stringify(includedServices ?? []),
        excludedServices: JSON.stringify(excludedServices ?? []),
        emergencyTat: emergencyTat || "24 hours",
        price: price ? parseFloat(price) : null,
        status: daysLeft < 0 ? "EXPIRED" : daysLeft <= 30 ? "EXPIRING_SOON" : "ACTIVE",
      },
    });
    // create maintenance plan linked to the contract
    await db.maintenancePlan.create({
      data: {
        organizationId: orgId,
        installationId,
        amcContractId: contract.id,
        name: `${contract.visitIntervalDays}-day preventive maintenance`,
        intervalDays: contract.visitIntervalDays,
        startDate: start,
        active: true,
      },
    });
    await audit({ organizationId: orgId, actorUserId: ctx.userId, action: "AMC_CREATED", entityType: "AMC", entityId: contract.id, detail: contractCode });
    return NextResponse.json({ contract });
  } catch (e) {
    return handleApiError(e);
  }
}
