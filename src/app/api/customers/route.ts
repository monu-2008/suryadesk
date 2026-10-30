import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, ApiError, handleApiError } from "@/lib/surya/auth";
import { audit, notify } from "@/lib/surya/notify";

// GET /api/customers?search=&city=&portal=&page=1&pageSize=10&sort=
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER"]);
    const orgId = ctx.organizationId!;
    const sp = req.nextUrl.searchParams;
    const search = sp.get("search")?.trim() ?? "";
    const city = sp.get("city") ?? "";
    const portal = sp.get("portal") ?? "";
    const page = Math.max(1, parseInt(sp.get("page") ?? "1"));
    const pageSize = Math.min(50, Math.max(5, parseInt(sp.get("pageSize") ?? "10")));

    const where = {
      organizationId: orgId,
      archivedAt: null,
      ...(search ? { OR: [{ name: { contains: search } }, { email: { contains: search } }, { phone: { contains: search } }] } : {}),
      ...(city ? { city } : {}),
      ...(portal ? { portalStatus: portal } : {}),
    };
    const [total, rows] = await Promise.all([
      db.customer.count({ where }),
      db.customer.findMany({
        where,
        include: {
          installations: { select: { id: true, capacityKw: true, status: true } },
          amcContracts: { select: { status: true, endDate: true } },
          jobs: { select: { status: true, completedAt: true, scheduledFor: true }, orderBy: { scheduledFor: "desc" } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const customers = rows.map((c) => {
      const lastService = c.jobs.find((j) => j.completedAt)?.completedAt ?? null;
      const activeAmc = c.amcContracts.some((a) => ["ACTIVE", "EXPIRING_SOON"].includes(a.status));
      return {
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        city: c.city,
        address: c.address,
        portalStatus: c.portalStatus,
        notes: c.notes,
        installationCount: c.installations.filter((i) => i.status === "ACTIVE").length,
        totalCapacityKw: c.installations.reduce((s, i) => s + i.capacityKw, 0),
        amcActive: activeAmc,
        lastService,
        createdAt: c.createdAt,
      };
    });
    return NextResponse.json({ total, page, pageSize, customers });
  } catch (e) {
    return handleApiError(e);
  }
}

// POST /api/customers — create
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER"]);
    const orgId = ctx.organizationId!;
    const { name, email, phone, city, address, notes } = await req.json();
    if (!name || !email || !phone || !city) throw new ApiError(400, "Name, email, phone and city are required");
    const emailNorm = String(email).toLowerCase().trim();
    const dupe = await db.customer.findFirst({ where: { organizationId: orgId, email: emailNorm } });
    if (dupe) throw new ApiError(409, "A customer with this email already exists");
    const customer = await db.customer.create({
      data: { organizationId: orgId, name, email: emailNorm, phone, city, address: address ?? null, notes: notes ?? null },
    });
    await audit({ organizationId: orgId, actorUserId: ctx.userId, action: "CUSTOMER_CREATED", entityType: "CUSTOMER", entityId: customer.id, detail: name });
    return NextResponse.json({ customer });
  } catch (e) {
    return handleApiError(e);
  }
}
