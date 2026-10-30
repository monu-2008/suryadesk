// Maintenance schedule — refreshes live statuses, generates due occurrences,
// returns grouped lists (upcoming/due/overdue/completed/rescheduled).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, handleApiError } from "@/lib/surya/auth";
import { refreshOccurrenceStatuses, generateDueOccurrences } from "@/lib/surya/engine";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER"]);
    const orgId = ctx.organizationId!;
    const sp = req.nextUrl.searchParams;
    const status = sp.get("status") ?? "";
    const search = sp.get("search")?.trim() ?? "";

    await refreshOccurrenceStatuses(orgId);
    await generateDueOccurrences(orgId);

    const where = {
      organizationId: orgId,
      ...(status ? { status } : {}),
      ...(search
        ? { OR: [{ installation: { assetCode: { contains: search } } }, { installation: { customer: { name: { contains: search } } } }, { installation: { siteAddress: { contains: search } } }] }
        : {}),
    };
    const occurrences = await db.maintenanceOccurrence.findMany({
      where,
      include: {
        installation: { include: { customer: { select: { id: true, name: true, city: true, phone: true } } } },
        plan: { select: { id: true, name: true, intervalDays: true, amcContractId: true } },
      },
      orderBy: { dueDate: "asc" },
      take: 300,
    });
    const counts: Record<string, number> = { UPCOMING: 0, DUE: 0, OVERDUE: 0, COMPLETED: 0, RESCHEDULED: 0 };
    const all = await db.maintenanceOccurrence.findMany({ where: { organizationId: orgId }, select: { status: true } });
    for (const o of all) counts[o.status] = (counts[o.status] ?? 0) + 1;

    return NextResponse.json({
      counts,
      occurrences: occurrences.map((o) => ({
        id: o.id,
        dueDate: o.dueDate,
        status: o.status,
        completedAt: o.completedAt,
        rescheduledFrom: o.rescheduledFrom,
        jobId: o.jobId,
        notes: o.notes,
        customer: o.installation.customer,
        assetCode: o.installation.assetCode,
        installationId: o.installation.id,
        capacityKw: o.installation.capacityKw,
        siteAddress: o.installation.siteAddress,
        plan: o.plan,
      })),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
