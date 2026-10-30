import { NextRequest, NextResponse } from "next/server";
import { destroySession, SESSION_COOKIE, handleApiError } from "@/lib/surya/auth";

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    if (token) await destroySession(token);
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(SESSION_COOKIE);
    return res;
  } catch (e) {
    return handleApiError(e);
  }
}
