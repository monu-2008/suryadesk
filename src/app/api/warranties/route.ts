import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, ApiError, handleApiError } from "@/lib/surya/auth";

// GET /api/warranties?kind=&status=&search=
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER"]);
    const orgId = ctx.organizationId!;
    const sp = req.nextUrl.searchParams;
    const search = sp.get("search")?.trim() ?? "";
    const kind = sp.get("kind") ?? "";
    const installationId = sp.get("installationId") ?? "";
    const where = {
      organizationId: orgId,
      ...(kind ? { kind } : {}),
      ...(installationId ? { installationId } : {}),
      ...(search ? { OR: [{ provider: { contains: search } }, { installation: { assetCode: { contains: search } } }, { installation: { customer: { name: { contains: search } } } }] } : {}),
    };
    const rows = await db.warranty.findMany({
      where,
      include: { installation: { include: { customer: { select: { id: true, name: true } } } } },
      orderBy: { endDate: "asc" },
      take: 200,
    });
    // live status refresh (cheap, computed)
    const now = new Date();
    const warranties = rows.map((w) => {
      const end = new Date(w.endDate);
      const daysLeft = Math.round((end.getTime() - now.getTime()) / 86400000);
      const status = daysLeft < 0 ? "EXPIRED" : daysLeft <= 60 ? "EXPIRING_SOON" : "ACTIVE";
      return { ...w, status, daysLeft };
    });
    return NextResponse.json({ warranties });
  } catch (e) {
    return handleApiError(e);
  }
}

// POST /api/warranties
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER"]);
    const b = await req.json();
    const { installationId, kind, provider, coverage, startDate, endDate } = b;
    if (!installationId || !kind || !provider || !startDate || !endDate) throw new ApiError(400, "Installation, type, provider, start and end dates are required");
    const installation = await db.installation.findFirst({ where: { id: installationId, organizationId: ctx.organizationId! } });
    if (!installation) throw new ApiError(404, "Installation not found");
    const end = new Date(endDate);
    const daysLeft = Math.round((end.getTime() - Date.now()) / 86400000);
    const warranty = await db.warranty.create({
      data: {
        organizationId: ctx.organizationId!,
        installationId,
        kind,
        provider,
        coverage: coverage || "",
        startDate: new Date(startDate),
        endDate: end,
        status: daysLeft < 0 ? "EXPIRED" : daysLeft <= 60 ? "EXPIRING_SOON" : "ACTIVE",
        documentName: b.documentName ?? null,
      },
    });
    return NextResponse.json({ warranty });
  } catch (e) {
    return handleApiError(e);
  }
}
