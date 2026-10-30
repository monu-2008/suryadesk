// Service requests — the customer's need. Separate from jobs.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, ApiError, handleApiError } from "@/lib/surya/auth";
import { audit, notify, notifyRoles } from "@/lib/surya/notify";

// GET /api/requests?status=&category=&priority=&search=&page=
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER", "CUSTOMER"]);
    const orgId = ctx.organizationId!;
    const sp = req.nextUrl.searchParams;
    const status = sp.get("status") ?? "";
    const category = sp.get("category") ?? "";
    const priority = sp.get("priority") ?? "";
    const search = sp.get("search")?.trim() ?? "";
    const page = Math.max(1, parseInt(sp.get("page") ?? "1"));
    const pageSize = Math.min(50, Math.max(5, parseInt(sp.get("pageSize") ?? "10")));

    const baseWhere = {
      organizationId: orgId,
      ...(ctx.orgRole === "CUSTOMER" ? { customerId: ctx.customerId! } : {}),
      ...(status ? { status } : {}),
      ...(category ? { category } : {}),
      ...(priority ? { priority } : {}),
      ...(search ? { OR: [{ code: { contains: search } }, { description: { contains: search } }, { customer: { name: { contains: search } } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      db.serviceRequest.count({ where: baseWhere }),
      db.serviceRequest.findMany({
        where: baseWhere,
        include: {
          customer: { select: { id: true, name: true, city: true } },
          installation: { select: { id: true, assetCode: true, capacityKw: true } },
          jobs: { select: { id: true, code: true, status: true, scheduledFor: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const all = await db.serviceRequest.findMany({
      where: { organizationId: orgId, ...(ctx.orgRole === "CUSTOMER" ? { customerId: ctx.customerId! } : {}) },
      select: { status: true },
    });
    const counts: Record<string, number> = {};
    for (const r of all) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return NextResponse.json({ total, page, pageSize, counts, requests: rows });
  } catch (e) {
    return handleApiError(e);
  }
}

// POST /api/requests — customer raises complaint (or staff records on behalf)
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER", "CUSTOMER"]);
    const orgId = ctx.organizationId!;
    const b = await req.json();
    const { category, description, installationId, priority, source } = b;
    if (!category || !description) throw new ApiError(400, "Category and description are required");
    let customerId: string;
    if (ctx.orgRole === "CUSTOMER") {
      customerId = ctx.customerId!;
    } else {
      if (!b.customerId) throw new ApiError(400, "Customer is required");
      customerId = b.customerId;
      const cust = await db.customer.findFirst({ where: { id: customerId, organizationId: orgId } });
      if (!cust) throw new ApiError(404, "Customer not found");
    }
    // validate installation ownership
    let instId: string | null = null;
    if (installationId) {
      const inst = await db.installation.findFirst({ where: { id: installationId, organizationId: orgId, customerId } });
      if (!inst) throw new ApiError(400, "Selected installation does not belong to this customer");
      instId = installationId;
    }
    const seq = (await db.serviceRequest.count({ where: { organizationId: orgId } })) + 1;
    const request = await db.serviceRequest.create({
      data: {
        organizationId: orgId,
        customerId,
        installationId: instId,
        code: `REQ-${String(seq).padStart(4, "0")}`,
        category,
        description,
        priority: ctx.orgRole === "CUSTOMER" ? "MEDIUM" : priority || "MEDIUM",
        status: "NEW",
        source: ctx.orgRole === "CUSTOMER" ? "PORTAL" : source || "PHONE",
      },
    });
    await audit({ organizationId: orgId, actorUserId: ctx.userId, action: "REQUEST_CREATED", entityType: "REQUEST", entityId: request.id, detail: request.code });
    // notify staff
    await notifyRoles(orgId, ["OWNER", "MANAGER"], {
      kind: "NEW_REQUEST",
      title: `New service request ${request.code}`,
      body: `${category} request from ${ctx.orgRole === "CUSTOMER" ? ctx.name : "service desk"}.`,
      entityType: "REQUEST",
      entityId: request.id,
    });
    return NextResponse.json({ request });
  } catch (e) {
    return handleApiError(e);
  }
}
