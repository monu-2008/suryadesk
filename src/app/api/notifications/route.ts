// In-app notifications for the signed-in user.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, handleApiError } from "@/lib/surya/auth";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    const notifications = await db.notification.findMany({
      where: { userId: ctx.userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const unread = notifications.filter((n) => !n.readAt).length;
    return NextResponse.json({ notifications, unread });
  } catch (e) {
    return handleApiError(e);
  }
}

// PATCH — mark read (specific ids or all)
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    const { ids, all } = await req.json();
    if (all) {
      await db.notification.updateMany({ where: { userId: ctx.userId, readAt: null }, data: { readAt: new Date() } });
    } else if (Array.isArray(ids) && ids.length) {
      await db.notification.updateMany({ where: { userId: ctx.userId, id: { in: ids } }, data: { readAt: new Date() } });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
