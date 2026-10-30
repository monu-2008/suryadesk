import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, ApiError, handleApiError } from "@/lib/surya/auth";
import { audit } from "@/lib/surya/notify";

// GET /api/customers/[id] — full profile with tabs data
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER"]);
    const { id } = await params;
    const customer = await db.customer.findFirst({
      where: { id, organizationId: ctx.organizationId!, archivedAt: null },
      include: {
        installations: { include: { amcContracts: { select: { status: true } }, warranties: { select: { kind: true, status: true, endDate: true } } }, orderBy: { installDate: "desc" } },
        amcContracts: { orderBy: { endDate: "desc" } },
        requests: { orderBy: { createdAt: "desc" } },
        jobs: { include: { report: true }, orderBy: { scheduledFor: "desc" } },
        reports: { orderBy: { publishedAt: "desc" } },
      },
    });
    if (!customer) throw new ApiError(404, "Customer not found");
    return NextResponse.json({ customer });
  } catch (e) {
    return handleApiError(e);
  }
}

// PATCH /api/customers/[id]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER"]);
    const { id } = await params;
    const existing = await db.customer.findFirst({ where: { id, organizationId: ctx.organizationId! } });
    if (!existing) throw new ApiError(404, "Customer not found");
    const data = await req.json();
    const { name, email, phone, city, address, notes } = data;
    const customer = await db.customer.update({
      where: { id },
      data: {
        ...(name ? { name } : {}),
        ...(email ? { email: String(email).toLowerCase().trim() } : {}),
        ...(phone ? { phone } : {}),
        ...(city ? { city } : {}),
        ...(address !== undefined ? { address } : {}),
        ...(notes !== undefined ? { notes } : {}),
      },
    });
    await audit({ organizationId: ctx.organizationId!, actorUserId: ctx.userId, action: "CUSTOMER_UPDATED", entityType: "CUSTOMER", entityId: id, detail: customer.name });
    return NextResponse.json({ customer });
  } catch (e) {
    return handleApiError(e);
  }
}

// DELETE /api/customers/[id] — soft archive
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER"]);
    const { id } = await params;
    const existing = await db.customer.findFirst({ where: { id, organizationId: ctx.organizationId! } });
    if (!existing) throw new ApiError(404, "Customer not found");
    await db.customer.update({ where: { id }, data: { archivedAt: new Date() } });
    await audit({ organizationId: ctx.organizationId!, actorUserId: ctx.userId, action: "CUSTOMER_ARCHIVED", entityType: "CUSTOMER", entityId: id, detail: existing.name });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
