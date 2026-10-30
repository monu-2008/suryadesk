// Customer portal aggregate — strictly scoped to the linked customer identity.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, handleApiError } from "@/lib/surya/auth";
import { refreshOccurrenceStatuses } from "@/lib/surya/engine";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req, ["CUSTOMER"]);
    const orgId = ctx.organizationId!;
    await refreshOccurrenceStatuses(orgId);

    const customer = await db.customer.findFirst({
      where: { id: ctx.customerId!, organizationId: orgId },
      include: {
        installations: {
          include: {
            equipment: true,
            warranties: true,
            amcContracts: true,
            plans: { include: { occurrences: { where: { status: { in: ["UPCOMING", "DUE", "OVERDUE", "RESCHEDULED"] } }, orderBy: { dueDate: "asc" }, take: 2 } } },
          },
          orderBy: { installDate: "desc" },
        },
        requests: { orderBy: { createdAt: "desc" }, include: { jobs: { include: { report: { select: { id: true } } } } } },
        jobs: {
          where: { status: { in: ["SCHEDULED", "ASSIGNED", "IN_PROGRESS", "WORK_SUBMITTED", "AWAITING_CUSTOMER"] } },
          include: { installation: { select: { assetCode: true } }, assignments: { where: { active: true }, include: { technician: { select: { name: true, phone: true } } } } },
          orderBy: { scheduledFor: "asc" },
        },
        reports: { orderBy: { publishedAt: "desc" }, include: { job: { select: { code: true, title: true, type: true } } } },
      },
    });
    if (!customer) return NextResponse.json({ customer: null });
    const org = await db.organization.findUnique({ where: { id: orgId } });
    return NextResponse.json({
      org: { name: org?.name, supportEmail: org?.supportEmail, phone: org?.phone },
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        city: customer.city,
        installations: customer.installations,
        requests: customer.requests,
        upcomingJobs: customer.jobs.map((j) => ({ ...j, technician: j.assignments[0]?.technician ?? null, assignments: undefined })),
        reports: customer.reports,
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
