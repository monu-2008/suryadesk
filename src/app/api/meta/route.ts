// Dropdown/lookup data for forms + org profile + demo account listing (demo mode only).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, handleApiError, ApiError } from "@/lib/surya/auth";
import { audit } from "@/lib/surya/notify";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    const orgId = ctx.organizationId!;

    const [org, techs, templates, cities, customersLite, installationsLite] = await Promise.all([
      db.organization.findUnique({ where: { id: orgId } }),
      db.organizationMember.findMany({
        where: { organizationId: orgId, role: "TECHNICIAN", isActive: true },
        include: { user: true },
      }),
      db.checklistTemplate.findMany({ where: { organizationId: orgId } }),
      db.customer.findMany({ where: { organizationId: orgId, archivedAt: null }, select: { city: true } }),
      ctx.orgRole === "CUSTOMER"
        ? Promise.resolve([])
        : db.customer.findMany({
            where: { organizationId: orgId, archivedAt: null },
            select: { id: true, name: true, city: true, email: true, phone: true },
            orderBy: { name: "asc" },
          }),
      ctx.orgRole === "CUSTOMER"
        ? Promise.resolve([])
        : db.installation.findMany({
            where: { organizationId: orgId, status: "ACTIVE" },
            select: { id: true, assetCode: true, customerId: true, capacityKw: true, city: true },
            orderBy: { assetCode: "asc" },
          }),
    ]);

    const demoAccounts =
      process.env.DEMO_MODE === "true"
        ? [
            { email: "owner@demo.suryadesk.in", role: "Owner", name: "Priya Sharma", password: "Demo@1234" },
            { email: "manager@demo.suryadesk.in", role: "Manager", name: "Arjun Mehta", password: "Demo@1234" },
            { email: "tech1@demo.suryadesk.in", role: "Technician", name: "Ravi Kumar", password: "Demo@1234" },
            { email: "tech2@demo.suryadesk.in", role: "Technician", name: "Sunita Verma", password: "Demo@1234" },
            { email: "customer@demo.suryadesk.in", role: "Customer", name: "Anita Deshmukh", password: "Demo@1234" },
            { email: "customer2@demo.suryadesk.in", role: "Customer", name: "Vikram Rathore", password: "Demo@1234" },
          ]
        : null;

    return NextResponse.json({
      org,
      technicians: techs.map((t) => ({ id: t.userId, name: t.user.name, title: t.title, email: t.user.email })),
      templates: templates.map((t) => ({ id: t.id, name: t.name, kind: t.kind, items: JSON.parse(t.items) })),
      cities: [...new Set(cities.map((c) => c.city))].sort(),
      customers: customersLite,
      installations: installationsLite,
      demoAccounts,
      integrations: {
        smtpConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER),
        smsConfigured: Boolean(process.env.SMS_PROVIDER && process.env.SMS_API_KEY),
        aiConfigured: true,
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}

// PATCH /api/meta — update organization profile (owner/manager).
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER"]);
    const b = await req.json();
    if (b.name !== undefined && !String(b.name).trim()) throw new ApiError(400, "Organization name cannot be empty");
    const org = await db.organization.update({
      where: { id: ctx.organizationId! },
      data: {
        ...(b.name ? { name: String(b.name).trim() } : {}),
        ...(b.city !== undefined ? { city: b.city } : {}),
        ...(b.phone !== undefined ? { phone: b.phone } : {}),
        ...(b.email !== undefined ? { email: b.email } : {}),
        ...(b.supportEmail !== undefined ? { supportEmail: b.supportEmail } : {}),
        ...(b.address !== undefined ? { address: b.address } : {}),
      },
    });
    await audit({ organizationId: ctx.organizationId!, actorUserId: ctx.userId, action: "ORG_UPDATED", entityType: "ORGANIZATION", entityId: org.id, detail: org.name });
    return NextResponse.json({ org });
  } catch (e) {
    return handleApiError(e);
  }
}
