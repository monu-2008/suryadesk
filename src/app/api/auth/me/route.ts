import { NextRequest, NextResponse } from "next/server";
import { getAuth, handleApiError } from "@/lib/surya/auth";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getAuth(req);
    if (!ctx) return NextResponse.json({ user: null });
    let unread = 0;
    if (ctx.organizationId) {
      unread = await db.notification.count({ where: { userId: ctx.userId, readAt: null } });
    }
    return NextResponse.json({ user: ctx, unread });
  } catch (e) {
    return handleApiError(e);
  }
}
