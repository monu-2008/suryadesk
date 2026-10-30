// Team & permissions — owner manages members.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, ApiError, handleApiError } from "@/lib/surya/auth";
import { audit } from "@/lib/surya/notify";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req, ["OWNER", "MANAGER"]);
    const members = await db.organizationMember.findMany({
      where: { organizationId: ctx.organizationId! },
      include: { user: { select: { id: true, name: true, email: true, phone: true, createdAt: true } } },
      orderBy: { joinedAt: "asc" },
    });
    return NextResponse.json({
      members: members.map((m) => ({
        id: m.id,
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        phone: m.user.phone,
        role: m.role,
        title: m.title,
        isActive: m.isActive,
        joinedAt: m.joinedAt,
      })),
    });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireAuth(req, ["OWNER"]);
    const b = await req.json();
    if (!b.memberId) throw new ApiError(400, "Member is required");
    const member = await db.organizationMember.findFirst({ where: { id: b.memberId, organizationId: ctx.organizationId! } });
    if (!member) throw new ApiError(404, "Member not found");
    if (b.action === "deactivate") {
      if (member.role === "OWNER") throw new ApiError(400, "The organization owner cannot be deactivated");
      await db.organizationMember.update({ where: { id: member.id }, data: { isActive: false } });
      // historical service records are preserved — never deleted
      await audit({ organizationId: ctx.organizationId!, actorUserId: ctx.userId, action: "MEMBER_DEACTIVATED", entityType: "MEMBER", entityId: member.id, detail: member.userId });
      return NextResponse.json({ ok: true, message: "Member deactivated. Their past job history is preserved." });
    }
    if (b.action === "activate") {
      await db.organizationMember.update({ where: { id: member.id }, data: { isActive: true } });
      return NextResponse.json({ ok: true, message: "Member reactivated" });
    }
    if (b.action === "set_role") {
      if (!["MANAGER", "TECHNICIAN"].includes(b.role)) throw new ApiError(400, "Role must be MANAGER or TECHNICIAN");
      if (member.role === "OWNER") throw new ApiError(400, "Owner role cannot be changed");
      await db.organizationMember.update({ where: { id: member.id }, data: { role: b.role } });
      await audit({ organizationId: ctx.organizationId!, actorUserId: ctx.userId, action: "MEMBER_ROLE_CHANGED", entityType: "MEMBER", entityId: member.id, detail: `${b.role}` });
      return NextResponse.json({ ok: true, message: `Role updated to ${b.role}` });
    }
    throw new ApiError(400, "Unknown action");
  } catch (e) {
    return handleApiError(e);
  }
}
