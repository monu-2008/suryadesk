import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword, createSession, sessionCookieOptions, SESSION_COOKIE, ApiError, handleApiError } from "@/lib/surya/auth";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    if (!email || !password) throw new ApiError(400, "Email and password are required");
    const user = await db.user.findUnique({
      where: { email: String(email).toLowerCase().trim() },
      include: { memberships: true, customer: true },
    });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new ApiError(401, "Invalid email or password");
    }
    if (!user.isActive) throw new ApiError(403, "This account has been deactivated");
    if (!user.emailVerified) {
      return NextResponse.json({ needsVerification: true, email: user.email }, { status: 403 });
    }
    const { token, expiresAt } = await createSession(user.id, req.headers.get("user-agent"));
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
    return res;
  } catch (e) {
    return handleApiError(e);
  }
}
