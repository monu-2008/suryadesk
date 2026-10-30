// Service reports — staff see org-wide, customers see their own.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, handleApiError } from "@/lib/surya/auth";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER", "CUSTOMER"]);
    const sp = req.nextUrl.searchParams;
    const search = sp.get("search")?.trim() ?? "";
    const ack = sp.get("ack") ?? "";
    const page = Math.max(1, parseInt(sp.get("page") ?? "1"));
    const pageSize = Math.min(50, Math.max(5, parseInt(sp.get("pageSize") ?? "10")));
    const where = {
      organizationId: ctx.organizationId!,
      ...(ctx.orgRole === "CUSTOMER" ? { customerId: ctx.customerId! } : {}),
      ...(ack === "yes" ? { acknowledgedByOtp: true } : ack === "no" ? { acknowledgedByOtp: false } : {}),
      ...(search ? { OR: [{ job: { code: { contains: search } } }, { customer: { name: { contains: search } } }, { technicianNotes: { contains: search } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      db.serviceReport.count({ where }),
      db.serviceReport.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, city: true } },
          job: { select: { id: true, code: true, title: true, status: true, type: true, scheduledFor: true, completedAt: true, installation: { select: { assetCode: true, capacityKw: true } } } },
        },
        orderBy: { publishedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return NextResponse.json({ total, page, pageSize, reports: rows });
  } catch (e) {
    return handleApiError(e);
  }
}
