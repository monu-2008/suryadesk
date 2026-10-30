import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, ApiError, handleApiError } from "@/lib/surya/auth";
import { audit } from "@/lib/surya/notify";

// GET /api/installations?search=&city=&capacity=&page=&pageSize=
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER"]);
    const orgId = ctx.organizationId!;
    const sp = req.nextUrl.searchParams;
    const search = sp.get("search")?.trim() ?? "";
    const city = sp.get("city") ?? "";
    const page = Math.max(1, parseInt(sp.get("page") ?? "1"));
    const pageSize = Math.min(50, Math.max(5, parseInt(sp.get("pageSize") ?? "10")));
    const where = {
      organizationId: orgId,
      ...(search ? { OR: [{ assetCode: { contains: search } }, { siteAddress: { contains: search } }, { serialNumber: { contains: search } }, { customer: { name: { contains: search } } }] } : {}),
      ...(city ? { city } : {}),
    };
    const [total, rows] = await Promise.all([
      db.installation.count({ where }),
      db.installation.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, city: true } },
          amcContracts: { select: { id: true, status: true, endDate: true }, orderBy: { endDate: "desc" } },
          warranties: { select: { id: true, kind: true, status: true, endDate: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return NextResponse.json({
      total,
      page,
      pageSize,
      installations: rows.map((i) => ({
        ...i,
        primaryAmc: i.amcContracts[0] ?? null,
        warrantyCount: i.warranties.length,
      })),
    });
  } catch (e) {
    return handleApiError(e);
  }
}

// POST /api/installations — register a new solar asset
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER"]);
    const orgId = ctx.organizationId!;
    const b = await req.json();
    const { customerId, siteAddress, city, capacityKw, installDate, panelMake, panelModel, panelCount, inverterMake, inverterModel, serialNumber } = b;
    if (!customerId || !siteAddress || !city || !capacityKw || !installDate) throw new ApiError(400, "Customer, site address, city, capacity and install date are required");
    const customer = await db.customer.findFirst({ where: { id: customerId, organizationId: orgId, archivedAt: null } });
    if (!customer) throw new ApiError(404, "Customer not found");
    const cityTag = { Jaipur: "JAIP", Jodhpur: "JDHP", Ajmer: "AJMR", Udaipur: "UDRP", Kota: "KOTA", Delhi: "DELI", Ahmedabad: "AHMD" }[city] ?? city.slice(0, 4).toUpperCase();
    const seq = (await db.installation.count({ where: { organizationId: orgId, city } })) + 1;
    const assetCode = `ASSET-${cityTag}-${String(seq).padStart(4, "0")}`;
    const installation = await db.installation.create({
      data: {
        organizationId: orgId,
        customerId,
        assetCode,
        siteAddress,
        city,
        capacityKw: parseFloat(capacityKw),
        installDate: new Date(installDate),
        panelMake: panelMake || "—",
        panelModel: panelModel || "—",
        panelCount: parseInt(panelCount || "0") || 0,
        inverterMake: inverterMake || "—",
        inverterModel: inverterModel || "—",
        serialNumber: serialNumber || `SN-${Date.now().toString(36).toUpperCase()}`,
        status: "ACTIVE",
      },
    });
    await db.equipment.createMany({
      data: [
        { organizationId: orgId, installationId: installation.id, kind: "PANEL", brand: panelMake || "—", model: panelModel || "—", quantity: parseInt(panelCount || "0") || 1, installDate: new Date(installDate) },
        { organizationId: orgId, installationId: installation.id, kind: "INVERTER", brand: inverterMake || "—", model: inverterModel || "—", quantity: 1, installDate: new Date(installDate) },
      ],
    });
    await audit({ organizationId: orgId, actorUserId: ctx.userId, action: "INSTALLATION_CREATED", entityType: "INSTALLATION", entityId: installation.id, detail: assetCode });
    return NextResponse.json({ installation });
  } catch (e) {
    return handleApiError(e);
  }
}
